/** Session-routed process handles with task-owned execution and termination. @module @deepseek-ai/dsh-subprocess-remote */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:os'
import { PassThrough, Writable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { OutputCollector } from '@deepseek-ai/dsh-subprocess-local/output'
import type {
  SubprocessHandle, SubprocessOutcome, SubprocessOutputMode, SubprocessOutputRead,
  SubprocessOutputReader, SubprocessSpawnSpec, SubprocessTerminalEnvironment,
} from '@deepseek-ai/dsh-subprocess'

/** Transport budgets do not impose a lifetime on the command. */
export interface Config {
  /** Execution service that serves `/jobs/by-session/<root-session>/process`. */
  endpoint: string
  /** Optional Bearer credential for the execution service. */
  token?: string
  /** Delay between idle output reads, in milliseconds. */
  pollIntervalMs: number
  /** Budget for one HTTP transport request, in milliseconds. */
  requestTimeoutMs: number
  /** Bound for recovering an unknown transport outcome, in milliseconds. */
  maxRecoveryMs: number
  /** Maximum output bytes requested per stream read. */
  maxReadBytes: number
  /** Pipe backpressure and remote retention budget, in bytes. */
  pipeBufferBytes: number
}

interface Frame {
  call_id: string
  status: 'running' | 'completed' | 'killed'
  exit_code: number | null
  signal: NodeJS.Signals | null
  range_empty: boolean
  stdout_b64: string
  stderr_b64: string
  stdout_offset: number
  stderr_offset: number
  stdout_lossy: boolean
  stderr_lossy: boolean
  stdout_spill_path?: string
  stderr_spill_path?: string
}

class ProtocolError extends Error {}
class HttpFailure extends Error {
  constructor(readonly status: number, readonly callId: string) {
    super(`task process ${callId}: HTTP ${status}`)
  }
}

const signals = new Set(Object.keys(constants.signals))
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function frameOf(value: unknown, callId: string): Frame {
  const invalid = () => new ProtocolError(`task process ${callId}: invalid worker response`)
  if (!isRecord(value) || value.call_id !== callId
    || typeof value.status !== 'string' || !['running', 'completed', 'killed'].includes(value.status)
    || !(value.exit_code === null || Number.isSafeInteger(value.exit_code))
    || !(value.signal === null || (typeof value.signal === 'string' && signals.has(value.signal)))
    || typeof value.range_empty !== 'boolean') throw invalid()
  for (const name of ['stdout', 'stderr']) {
    const data = value[`${name}_b64`]
    const offset = value[`${name}_offset`]
    if (typeof data !== 'string' || Buffer.from(data, 'base64').toString('base64') !== data
      || !Number.isSafeInteger(offset) || Number(offset) < Buffer.from(data, 'base64').length
      || typeof value[`${name}_lossy`] !== 'boolean') throw invalid()
    const path = value[`${name}_spill_path`]
    if (path !== undefined && (typeof path !== 'string' || !path.startsWith('/'))) throw invalid()
  }
  if (value.status === 'running' && value.range_empty) throw invalid()
  return {
    call_id: callId, status: value.status as Frame['status'],
    exit_code: value.exit_code as number | null, signal: value.signal as NodeJS.Signals | null,
    range_empty: value.range_empty,
    stdout_b64: value.stdout_b64 as string, stderr_b64: value.stderr_b64 as string,
    stdout_offset: value.stdout_offset as number, stderr_offset: value.stderr_offset as number,
    stdout_lossy: value.stdout_lossy as boolean, stderr_lossy: value.stderr_lossy as boolean,
    ...value.stdout_spill_path === undefined ? {} : { stdout_spill_path: value.stdout_spill_path as string },
    ...value.stderr_spill_path === undefined ? {} : { stderr_spill_path: value.stderr_spill_path as string },
  }
}

function rootSession(ctx: Context, agentId: string): string {
  const sessions = ctx.get('sessions')
  const seen = new Set<string>()
  let current = SessionId(agentId)
  while (sessions !== undefined) {
    if (seen.has(current)) throw new Error('session parent chain contains a cycle')
    seen.add(current)
    const parent = sessions.get(current)?.header.parentSession
    if (parent === undefined) break
    current = parent
  }
  return current
}

/** The collector uses byte coordinates; only task-world recovery paths are public. */
class RemoteOutput {
  offset = 0
  readonly pipe: PassThrough | undefined
  readonly reader: SubprocessOutputReader
  private collector: OutputCollector
  private origin = 0
  private spillPath: string | undefined
  private remoteLoss = false
  private readonly maxBytes: number

  constructor(readonly mode: SubprocessOutputMode, pipeBytes: number, private readonly label: 'stdout' | 'stderr') {
    this.maxBytes = typeof mode === 'object' ? mode.maxBytes : pipeBytes
    this.collector = new OutputCollector(this.maxBytes, label, undefined)
    this.pipe = mode === 'pipe' ? new PassThrough({ highWaterMark: pipeBytes }) : undefined
    this.reader = { readFrom: fromByte => this.readFrom(fromByte) }
  }

  retentionBytes(): number {
    return Math.max(1, typeof this.mode === 'object' ? this.mode.spill?.maxBytes ?? this.maxBytes : this.maxBytes)
  }

  async append(frame: Frame): Promise<number> {
    const bytes = Buffer.from(frame[`${this.label}_b64`], 'base64')
    const next = frame[`${this.label}_offset`]
    const start = next - bytes.length
    if (next < this.offset || start < this.offset) throw new ProtocolError('worker output cursor moved backwards')
    if (this.mode === 'pipe' && (start > this.offset || frame[`${this.label}_lossy`])) {
      throw new ProtocolError('worker lost bytes from a piped process stream')
    }
    if (start > this.offset) {
      this.collector.seal()
      this.collector = new OutputCollector(this.maxBytes, this.label, undefined)
      this.origin = start
    }
    this.remoteLoss ||= frame[`${this.label}_lossy`]
    this.spillPath = frame[`${this.label}_spill_path`]
    this.offset = next
    if (bytes.length === 0) return 0
    this.collector.push(bytes)
    if (this.mode === 'inherit') process[this.label].write(bytes)
    const pipe = this.pipe
    if (pipe !== undefined && !pipe.destroyed && !pipe.write(bytes)) {
      await new Promise<void>((resolve, reject) => {
        const clear = () => {
          pipe.off('drain', drained)
          pipe.off('close', drained)
          pipe.off('error', failed)
        }
        const drained = () => { clear(); resolve() }
        const failed = (error: Error) => { clear(); reject(error) }
        pipe.once('drain', drained)
        pipe.once('close', drained)
        pipe.once('error', failed)
      })
    }
    return bytes.length
  }

  private readFrom(fromByte: number): SubprocessOutputRead {
    const read = this.collector.readFrom(Math.max(0, fromByte - this.origin))
    return {
      text: read.text, nextOffset: this.origin + read.nextOffset,
      lossy: read.lossy || fromByte < this.origin || (this.remoteLoss && fromByte === 0),
      ...this.spillPath === undefined ? {} : { spillPath: this.spillPath },
    }
  }

  end(): void { this.collector.seal(); this.pipe?.end() }
  destroy(): void { this.collector.seal(); this.pipe?.destroy() }
}

/** One call id is allocated once and is never used for another spawn. */
class RemoteProcess implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: PassThrough | undefined
  readonly stderr: PassThrough | undefined
  readonly control = undefined
  readonly collected: { stdout?: SubprocessOutputReader; stderr?: SubprocessOutputReader }
  readonly done: Promise<SubprocessOutcome>
  private readonly child = Promise.withResolvers<SubprocessOutcome>()
  private readonly empty = Promise.withResolvers<boolean>()
  private readonly ready = Promise.withResolvers<void>()
  private readonly out: RemoteOutput
  private readonly err: RemoteOutput
  private readonly pumping: Promise<void>
  private stopping: Promise<void> | undefined
  private inputSequence = 0
  private inputEnded = false
  private childEnded = false
  private rangeEmpty = false
  private readonly abort = () => this.terminate()
  private readonly callId = randomUUID()

  constructor(
    private readonly config: Config, private readonly sessionId: string, private readonly spec: SubprocessSpawnSpec,
  ) {
    this.out = new RemoteOutput(spec.stdio.stdout, config.pipeBufferBytes, 'stdout')
    this.err = new RemoteOutput(spec.stdio.stderr, config.pipeBufferBytes, 'stderr')
    this.stdout = this.out.pipe
    this.stderr = this.err.pipe
    this.collected = {
      ...typeof spec.stdio.stdout === 'object' ? { stdout: this.out.reader } : {},
      ...typeof spec.stdio.stderr === 'object' ? { stderr: this.err.reader } : {},
    }
    this.done = this.child.promise
    void this.done.catch(() => {})
    void this.empty.promise.catch(() => {})
    void this.ready.promise.catch(() => {})
    if (spec.stdio.stdin === 'pipe') {
      this.stdin = new Writable({
        write: (chunk: Buffer, _encoding, callback) => {
          void this.input({ data_b64: chunk.toString('base64') }).then(() => callback(), error => callback(asError(error)))
        },
        final: (callback) => {
          void this.endInput().then(() => callback(), error => callback(asError(error)))
        },
        destroy: (error, callback) => {
          void this.endInput().then(() => callback(error), failure => callback(error ?? asError(failure)))
        },
      })
      this.stdin.on('error', (error) => {
        process.stderr.write(`subprocess-remote stdin for ${this.callId} failed: ${error.message}\n`)
      })
    }
    spec.signal?.addEventListener('abort', this.abort, { once: true })
    this.pumping = this.run()
    if (spec.signal?.aborted) this.terminate()
  }

  private async request(body: Record<string, unknown>, timeoutMs: number): Promise<Frame> {
    const token = this.config.token?.trim()
    const response = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/jobs/by-session/${encodeURIComponent(this.sessionId)}/process`, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...token ? { Authorization: `Bearer ${token}` } : {} },
      body: JSON.stringify({ ...body, call_id: this.callId }),
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
    })
    if (!response.ok) throw new HttpFailure(response.status, this.callId)
    return frameOf(await response.json(), this.callId)
  }

  private async recover(body: Record<string, unknown>): Promise<Frame> {
    const deadline = performance.now() + this.config.maxRecoveryMs
    let failure: unknown
    while (performance.now() < deadline) {
      try { return await this.request(body, Math.min(this.config.requestTimeoutMs, deadline - performance.now())) } catch (error) {
        if (error instanceof ProtocolError || (error instanceof HttpFailure && error.status < 500)) throw error
        failure = error
      }
      await delay(Math.min(this.config.pollIntervalMs, Math.max(0, deadline - performance.now())))
    }
    throw new Error(`task process ${this.callId}: state remains unknown after recovery budget`, { cause: failure })
  }

  private async run(): Promise<void> {
    try {
      try {
        await this.request({
          op: 'spawn', argv: [...this.spec.argv], cwd: this.spec.cwd,
          ...typeof this.spec.stdio.stdin === 'object' ? { stdin: this.spec.stdio.stdin.data } : {},
          ...this.spec.stdio.stdin === 'pipe' ? { stdin_pipe: true } : {},
          ...this.spec.env === undefined ? {} : {
            env: Object.fromEntries(Object.entries(this.spec.env).map(([key, value]) => [key, value ?? null])),
          },
          grace_ms: this.spec.graceMs,
          stdout_max_bytes: this.out.retentionBytes(), stderr_max_bytes: this.err.retentionBytes(),
        }, this.config.requestTimeoutMs)
      } catch (error) {
        if (error instanceof HttpFailure && error.status < 500) {
          this.rangeEmpty = true
          this.empty.resolve(true)
          throw error
        }
        // A lost acceptance reply is recovered by reading this id, never by spawning again.
        await this.recover({ op: 'read', stdout_offset: 0, stderr_offset: 0, max_bytes: this.config.maxReadBytes })
      }
      this.ready.resolve()
      while (true) {
        const frame = await this.recover({
          op: 'read', stdout_offset: this.out.offset, stderr_offset: this.err.offset, max_bytes: this.config.maxReadBytes,
        })
        const bytes = await this.out.append(frame) + await this.err.append(frame)
        if (frame.range_empty) { this.rangeEmpty = true; this.empty.resolve(true) }
        if (!this.childEnded && frame.status !== 'running' && bytes === 0) {
          this.childEnded = true
          this.out.end()
          this.err.end()
          this.stdin?.destroy()
          this.child.resolve({ exitCode: frame.exit_code, signal: frame.signal })
        }
        if (this.childEnded && this.rangeEmpty) return
        if (bytes === 0) await delay(this.config.pollIntervalMs)
      }
    } catch (error) {
      this.ready.reject(error)
      this.child.reject(error)
      if (!this.rangeEmpty) this.empty.reject(error)
      this.out.end()
      this.err.end()
      this.stdin?.destroy()
    } finally {
      this.spec.signal?.removeEventListener('abort', this.abort)
    }
  }

  private async input(body: Record<string, unknown>): Promise<void> {
    await this.ready.promise
    const inputSequence = ++this.inputSequence
    await this.recover({ op: 'stdin', ...body, input_seq: inputSequence })
  }

  private async endInput(): Promise<void> {
    if (this.inputEnded || this.childEnded || this.rangeEmpty) return
    this.inputEnded = true
    await this.input({ end: true })
  }

  terminate(): void {
    if (this.rangeEmpty || this.stopping !== undefined) return
    this.stopping = (async () => {
      await this.ready.promise.catch(() => {})
      const frame = await this.recover({ op: 'terminate', grace_ms: this.spec.graceMs })
      if (frame.range_empty) { this.rangeEmpty = true; this.empty.resolve(true) }
    })()
    void this.stopping.catch(error => this.empty.reject(error))
  }

  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false
    if (this.rangeEmpty) return true
    if (signal === undefined) return this.empty.promise
    let abort!: () => void
    const cancelled = new Promise<boolean>((resolve) => {
      abort = () => resolve(false)
      signal.addEventListener('abort', abort, { once: true })
    })
    try { return await Promise.race([this.empty.promise, cancelled]) } finally { signal.removeEventListener('abort', abort) }
  }

  async dispose(): Promise<void> {
    this.terminate()
    try {
      await this.stopping
      if (!await this.waitForExit()) throw new Error(`task process ${this.callId}: termination not confirmed`)
    } finally {
      this.out.destroy()
      this.err.destroy()
      this.stdin?.destroy()
      await this.pumping
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Live task process provider; caller-owned signals control command deadlines. */
export class RemoteSubprocessRuntime extends SubprocessRuntime {
  static Config = z.object({
    endpoint: z.string().required(), token: z.string(),
    pollIntervalMs: z.number().default(250), requestTimeoutMs: z.number().default(5000),
    maxRecoveryMs: z.number().default(60_000), maxReadBytes: z.number().default(65_536),
    pipeBufferBytes: z.number().default(1_048_576),
  })
  private readonly live = new Set<RemoteProcess>()
  private closed = false

  constructor(ctx: Context, readonly config: Config) {
    super(ctx)
    const endpoint = new URL(config.endpoint)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('subprocess-remote endpoint must be an HTTP(S) service address without credentials')
    }
    for (const [name, value] of Object.entries(config)) {
      if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`subprocess-remote ${name} must be a positive integer`)
    }
    if (config.maxReadBytes > 1_048_576) throw new Error('subprocess-remote maxReadBytes exceeds the process protocol limit')
    ctx.effect(() => async () => {
      this.closed = true
      const results = await Promise.allSettled([...this.live].map(handle => handle.dispose()))
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      this.live.clear()
      if (failures.length > 0) throw new AggregateError(failures, 'remote process cleanup could not be confirmed')
    })
  }

  override async resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    void env
    if (!command || command.includes('\0')) throw new Error('subprocess-remote executable must be nonempty')
    return command
  }

  override async terminalEnvironment(signal?: AbortSignal): Promise<SubprocessTerminalEnvironment> {
    signal?.throwIfAborted()
    return { platform: 'posix', defaultShell: '/bin/sh' }
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.closed) throw new Error('subprocess-remote provider has been disposed')
    spec.signal?.throwIfAborted()
    if (!spec.agentId) throw new Error('subprocess-remote spec names no agent')
    if (spec.stdio.control !== undefined) throw new Error('task process protocol does not expose a separate control descriptor')
    if (spec.argv.length === 0 || spec.argv.some(argument => argument.includes('\0'))) throw new Error('subprocess-remote argv is invalid')
    const handle = new RemoteProcess(this.config, rootSession(this.ctx, spec.agentId), spec)
    this.live.add(handle)
    void Promise.all([handle.done, handle.waitForExit()]).then(() => this.live.delete(handle), () => {})
    return handle
  }

  override spawnTerminal(): Promise<never> {
    return Promise.reject(new Error('task process protocol does not expose a PTY'))
  }
}

export default RemoteSubprocessRuntime
