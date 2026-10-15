/** One managed `llama-server` process: loopback readiness, authenticated completions, crash restart, and idle reclamation. */
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { JevProviderError } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { z } from 'zod'
import type { Config } from './index.ts'

/** Runner facts of one completion at the first generated position. */
export interface ReflexCompletion {
  /** Token text to natural-log probability for the returned top tokens; the first occurrence of a token wins. */
  readonly logprobs: ReadonlyMap<string, number>
  /** `timings.prompt_n`: prompt tokens evaluated by this call. */
  readonly promptTokens: number
  /** `timings.cache_n`: prompt tokens reused from the runner's prefix cache. */
  readonly cachedTokens: number
  /** `timings.prompt_ms`: prompt evaluation time. */
  readonly promptMs: number
}

/** A ready runner; failures throw `JevProviderError` with `transport`, `timeout`, or `invalid-response`. */
export interface ReflexRunnerClient {
  /**
   * Request one token with the full candidate distribution.
   * @param prompt - complete chat-wrapped contract prompt.
   * @param signal - question cancellation; an abort rethrows its reason.
   * @returns validated log probabilities and prompt timings.
   */
  complete(prompt: string, signal: AbortSignal): Promise<ReflexCompletion>
}

/** Runner client that can bypass the prefix cache, used by the self-test to measure uncached prefill. */
export interface ManagedRunnerClient extends ReflexRunnerClient {
  /**
   * @param prompt - complete chat-wrapped contract prompt.
   * @param signal - question cancellation.
   * @param cachePrompt - false evaluates the whole prompt and does not reuse the prefix cache.
   * @returns validated log probabilities and prompt timings.
   */
  complete(prompt: string, signal: AbortSignal, cachePrompt?: boolean): Promise<ReflexCompletion>
}

/** Startup failure with a message safe for clients; `diagnostics` holds the stderr tail for Host logs only. */
export class ReflexRunnerError extends Error {
  override name = 'ReflexRunnerError'

  constructor(message: string, readonly diagnostics: string, options?: ErrorOptions) {
    super(message, options)
  }
}

const positionSchema = z.object({ top_logprobs: z.array(z.object({ token: z.string(), logprob: z.number() })) })
const completionSchema = z.object({
  completion_probabilities: z.tuple([positionSchema], positionSchema),
  timings: z.object({
    prompt_n: z.number().int().nonnegative(), cache_n: z.number().int().nonnegative(), prompt_ms: z.number().nonnegative(),
  }),
})

const LISTENING = /listening on http:\/\/127\.0\.0\.1:(\d+)/
const STARTUP = 'REFLEX_RUNNER_STARTUP_TIMEOUT'
const DECISION = 'REFLEX_DECISION_TIMEOUT'
const HEALTH_RETRY_MS = 100

interface RunnerProcess {
  readonly handle: SubprocessHandle
  readonly url: string
  readonly key: string
  readonly log: StderrTail
  exited: boolean
}

/** Drain stderr for the process lifetime, keep a bounded tail, and report the listening port. */
class StderrTail {
  private tail = Buffer.alloc(0)
  private line = ''
  readonly port = Promise.withResolvers<number>()

  constructor(stream: Readable, private readonly limit: number) {
    stream.on('data', (chunk: Buffer) => { this.append(chunk) })
  }

  private append(chunk: Buffer): void {
    this.tail = Buffer.concat([this.tail, chunk])
    if (this.tail.length > this.limit) this.tail = this.tail.subarray(this.tail.length - this.limit)
    const lines = (this.line + chunk.toString('utf8')).split('\n')
    this.line = (lines.pop() as string).slice(-this.limit)
    for (const line of lines) {
      const match = LISTENING.exec(line)
      if (match !== null) this.port.resolve(Number(match[1]))
    }
  }

  /** @returns the retained diagnostic tail. */
  text(): string { return this.tail.toString('utf8') }
}

function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    // Abort reasons are Errors: DOMException by default, and every engine controller aborts with an Error.
    const abort = (): void => { reject(signal.reason as Error) }
    signal.addEventListener('abort', abort, { once: true })
    void pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

async function readBounded(response: Response, limit: number): Promise<string> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of response.body as ReadableStream<Uint8Array>) {
    length += chunk.length
    if (length > limit) throw new JevProviderError({ code: 'invalid-response', message: 'local Reflex runner response exceeded its byte limit' })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseCompletion(text: string): ReflexCompletion {
  const invalid = (cause: unknown): JevProviderError =>
    new JevProviderError({ code: 'invalid-response', message: 'local Reflex runner returned an invalid completion' }, { cause })
  let value: unknown
  try { value = JSON.parse(text) } catch (error) { throw invalid(error) }
  const parsed = completionSchema.safeParse(value)
  if (!parsed.success) throw invalid(parsed.error)
  const logprobs = new Map<string, number>()
  for (const { token, logprob } of parsed.data.completion_probabilities[0].top_logprobs) {
    if (!logprobs.has(token)) logprobs.set(token, logprob)
  }
  const { prompt_n: promptTokens, cache_n: cachedTokens, prompt_ms: promptMs } = parsed.data.timings
  return { logprobs, promptTokens, cachedTokens, promptMs }
}

/**
 * Owns at most one `llama-server` for one weights file. Startup is shared by concurrent callers; an exited process is
 * replaced on the next acquisition; disposal terminates the process and waits for its exit.
 */
export class ReflexRunner {
  private process: RunnerProcess | undefined
  private starting: Promise<RunnerProcess> | undefined
  private readonly lifetime = new AbortController()
  private idle: ReturnType<typeof setTimeout> | undefined
  private busy = 0

  /**
   * @param ctx - Host context owning the subprocess and logger.
   * @param config - process limits and deadlines.
   * @param executable - absolute `llama-server` path.
   * @param model - absolute verified weights path.
   */
  constructor(
    private readonly ctx: Context, private readonly config: Config, private readonly executable: string, readonly model: string,
  ) {}

  /**
   * Start the runner when it is not running and return a client bound to that process.
   * @param signal - caller cancellation; startup continues for other callers when one caller stops waiting.
   * @returns a client whose calls fail with `transport` after the process exits.
   */
  async acquire(signal: AbortSignal): Promise<ManagedRunnerClient> {
    this.lifetime.signal.throwIfAborted()
    signal.throwIfAborted()
    const current = this.process
    const process = current !== undefined && !current.exited ? current
      : await waitFor(this.starting ??= this.restart().finally(() => { this.starting = undefined }), signal)
    this.scheduleIdle()
    return { complete: async (prompt, callSignal, cachePrompt = true) => await this.complete(process, prompt, callSignal, cachePrompt) }
  }

  private async restart(): Promise<RunnerProcess> {
    await this.stop()
    const process = await this.spawn()
    this.process = process
    return process
  }

  private async spawn(): Promise<RunnerProcess> {
    using startup = deadline(this.lifetime.signal, this.config.startupTimeoutMs, STARTUP)
    await mkdir(this.config.dataRoot, { recursive: true })
    const key = randomBytes(32).toString('hex')
    const handle = this.ctx.subprocess.spawn({
      argv: [this.executable, '-m', this.model, '--host', '127.0.0.1', '--port', '0',
        '-c', String(this.config.contextTokens), '-np', '1', '--no-webui', '--offline', '--log-colors', 'off'],
      cwd: this.config.dataRoot, graceMs: this.config.graceMs,
      // b11118 reads the key from LLAMA_API_KEY; the environment keeps it out of the process list.
      env: { LLAMA_API_KEY: key },
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxLogBytes }, stderr: 'pipe' },
    })
    const log = new StderrTail(handle.stderr as Readable, this.config.maxLogBytes)
    const exited = handle.done.then(
      outcome => `Reflex runner exited before readiness (exit code ${outcome.exitCode}, signal ${outcome.signal})`,
      (_spawnFailure: unknown) => 'Reflex runner could not be started',
    )
    void exited.then((message) => { log.port.reject(new Error(message)) })
    try {
      const port = await waitFor(log.port.promise, startup.signal)
      const url = `http://127.0.0.1:${port}`
      await waitHealthy(url, key, startup.signal)
      const process: RunnerProcess = { handle, url, key, log, exited: false }
      void exited.then(() => {
        if (process.exited) return
        process.exited = true
        this.ctx.logger.warn('Reflex runner exited; the next decision restarts it', log.text())
      })
      return process
    } catch (error) {
      handle.terminate()
      await handle.waitForExit()
      if (this.lifetime.signal.aborted) throw error
      const message = timeoutOf(startup.signal, STARTUP) ? 'Reflex runner did not become ready before its deadline'
        : error instanceof Error && error.message.startsWith('Reflex runner') ? error.message : 'Reflex runner failed its readiness check'
      throw new ReflexRunnerError(message, log.text(), { cause: error })
    }
  }

  private async complete(process: RunnerProcess, prompt: string, signal: AbortSignal, cachePrompt: boolean): Promise<ReflexCompletion> {
    if (process.exited) throw new JevProviderError({ code: 'transport', message: 'local Reflex runner is not running' })
    this.busy++
    clearTimeout(this.idle)
    using call = deadline(signal, this.config.decisionTimeoutMs, DECISION)
    try {
      const response = await fetch(`${process.url}/completion`, {
        method: 'POST', headers: { authorization: `Bearer ${process.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, n_predict: 1, n_probs: 1024, temperature: 0, cache_prompt: cachePrompt }),
        signal: call.signal,
      })
      const text = await readBounded(response, this.config.maxResponseBytes)
      if (!response.ok) {
        throw new JevProviderError({ code: 'transport', message: `local Reflex runner returned HTTP ${response.status}`, status: response.status })
      }
      return parseCompletion(text)
    } catch (error) {
      if (timeoutOf(call.signal, DECISION)) throw new JevProviderError({ code: 'timeout', message: 'local Reflex decision timed out' }, { cause: error })
      if (signal.aborted || error instanceof JevProviderError) throw error
      // The next acquisition replaces a process whose request failed below the HTTP layer.
      process.exited = true
      throw new JevProviderError({ code: 'transport', message: 'local Reflex runner request failed' }, { cause: error })
    } finally {
      this.busy--
      this.scheduleIdle()
    }
  }

  private scheduleIdle(): void {
    clearTimeout(this.idle)
    if (this.config.idleTimeoutMs === 0 || this.busy > 0 || this.process === undefined) return
    this.idle = setTimeout(() => {
      void this.stop().catch((error: unknown) => { this.ctx.logger.warn('Reflex runner idle cleanup failed', error) })
    }, this.config.idleTimeoutMs)
  }

  /** Terminate the running process. @returns after the managed process range is empty. */
  async stop(): Promise<void> {
    clearTimeout(this.idle)
    const process = this.process
    this.process = undefined
    if (process === undefined) return
    process.exited = true
    process.handle.terminate()
    await process.handle.waitForExit()
  }

  /** Refuse new acquisitions, abort startup, and stop the process. @returns after the process exits. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('Reflex runner disposed'))
    await this.starting?.catch((_startupFailure: unknown) => {
      // The aborted startup already terminated its own process; disposal only needs it settled.
    })
    await this.stop()
  }
}

/** Wait for the public `/health`, then require `/props` to refuse a request without the key and accept one with it. */
async function waitHealthy(url: string, key: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    const response = await fetch(`${url}/health`, { signal })
    await response.body?.cancel()
    if (response.status === 200) break
    if (response.status !== 503) throw new Error(`Reflex runner health check returned HTTP ${response.status}`)
    await sleep(HEALTH_RETRY_MS, undefined, { signal })
  }
  for (const [authorization, expected] of [[undefined, 401], [`Bearer ${key}`, 200]] as const) {
    const response = await fetch(`${url}/props`, { headers: authorization === undefined ? {} : { authorization }, signal })
    await response.body?.cancel()
    if (response.status !== expected) throw new Error(`Reflex runner API key check returned HTTP ${response.status}`)
  }
}
