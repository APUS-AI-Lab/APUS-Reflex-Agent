import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { RemoteSubprocessRuntime } from '../src/index.ts'
import { processService } from './process-service.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop()
})

async function fixture() {
  const service = await processService()
  cleanup.push(() => service.close())
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(RemoteSubprocessRuntime, {
    endpoint: service.endpoint, pollIntervalMs: 5, requestTimeoutMs: 500, maxRecoveryMs: 1000,
  })
  return { service, ctx, runtime: ctx.subprocess as RemoteSubprocessRuntime }
}

function spec(argv: string[], overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv, cwd: process.cwd(), agentId: 'case-7', graceMs: 100,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 65_536 } },
    ...overrides,
  }
}

describe('remote subprocess runtime', () => {
  it('reports the shell available in the task environment', async () => {
    const { runtime } = await fixture()
    await expect(runtime.terminalEnvironment()).resolves.toEqual({ platform: 'posix', defaultShell: '/bin/sh' })
  })

  it('routes child-session commands through the native root session', async () => {
    const { runtime, service, ctx } = await fixture()
    await ctx.plugin(SessionStore)
    ctx.sessions.create(SessionId('root-case'))
    ctx.sessions.create(SessionId('child-case'), { meta: { parentSession: SessionId('root-case') } })
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdout.write("child")'], { agentId: 'child-case' }))
    await handle.done
    expect(service.requests.every(request => request.path === '/jobs/by-session/root-case/process')).toBe(true)
    expect(handle.collected.stdout!.readFrom(0).text).toBe('child')
  })

  it('returns a live handle, preserves argv, stdin and env, and reads byte offsets', async () => {
    const { runtime, service } = await fixture()
    const literal = "it's a $(literal) value"
    const handle = runtime.spawn(spec([process.execPath, '-e',
      'process.stdin.on("data",d=>process.stdout.write(d));process.stdin.on("end",()=>process.stdout.write(process.env.REMOTE_VALUE+process.argv[1]))', literal,
    ], { env: { REMOTE_VALUE: '中文🙂' }, stdio: { stdin: { data: 'prefix:' }, stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 65_536 } } }))
    const outcome = await handle.done
    expect(outcome).toEqual({ exitCode: 0, signal: null })
    const output = handle.collected.stdout!.readFrom(0)
    expect(output.text).toBe('prefix:中文🙂' + literal)
    expect(output.nextOffset).toBe(Buffer.byteLength(output.text))
    expect(handle.collected.stdout!.readFrom(output.nextOffset).text).toBe('')
    expect(await handle.waitForExit()).toBe(true)
    expect(service.requests.filter(r => r.body.op === 'spawn')).toHaveLength(1)
    expect(service.requests[0]!.path).toBe('/jobs/by-session/case-7/process')
  })

  it('retains byte-exact tails and exposes only the worker-owned spill path', async () => {
    const { runtime, service } = await fixture()
    const text = 'prefix:中文🙂:tail'
    const handle = runtime.spawn(spec([process.execPath, '-e', `process.stdout.write(${JSON.stringify(text)})`], {
      stdio: { stdin: 'ignore', stdout: { maxBytes: 5, spill: { maxBytes: 1024 } }, stderr: { maxBytes: 100 } },
    }))
    await handle.done
    const output = handle.collected.stdout!.readFrom(0)
    expect(output.lossy).toBe(true)
    expect(output.nextOffset).toBe(Buffer.byteLength(text))
    expect(output.text).toBe(Buffer.from(text).subarray(-5).toString('utf8'))
    const path = [...service.jobs.values()][0]!.stdoutPath
    expect(output.spillPath).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(text)
  })

  it('retries a lost stdin receipt with the same input sequence', async () => {
    const { runtime, service } = await fixture()
    service.dropInputResponse()
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdin.pipe(process.stdout)'], {
      stdio: { stdin: 'pipe', stdout: { maxBytes: 100 }, stderr: { maxBytes: 100 } },
    }))
    handle.stdin!.end('exactly once')
    await handle.done
    expect(handle.collected.stdout!.readFrom(0).text).toBe('exactly once')
    const inputs = service.requests.filter(r => r.body.op === 'stdin')
    expect(inputs[0]!.body.input_seq).toBe(inputs[1]!.body.input_seq)
  })

  it('deletes explicitly unset environment entries without forwarding host ambient state', async () => {
    const { runtime, service } = await fixture()
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdout.write(String(process.env.PATH))'], { env: { PATH: undefined } }))
    await handle.done
    expect(handle.collected.stdout!.readFrom(0).text).toBe('undefined')
    expect(service.requests.find(request => request.body.op === 'spawn')!.body.env).toEqual({ PATH: null })
  })

  it('does not report success when the worker stays unknown past the recovery budget', async () => {
    const { runtime, service } = await fixture()
    service.failReads(Infinity)
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdout.write("retained")']))
    await expect(handle.done).rejects.toThrow(/unknown after recovery budget/)
    expect(service.requests.filter(r => r.body.op === 'spawn')).toHaveLength(1)
  })

  it('does not spawn twice when the acceptance response is lost', async () => {
    const { runtime, service } = await fixture()
    service.dropSpawnResponse()
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdout.write("once")']))
    await handle.done
    expect(handle.collected.stdout!.readFrom(0).text).toBe('once')
    expect(service.requests.filter(r => r.body.op === 'spawn')).toHaveLength(1)
  })

  it('exposes actual stdin and output pipes', async () => {
    const { runtime } = await fixture()
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdin.pipe(process.stdout)'], {
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    }))
    const chunks: Buffer[] = []
    handle.stdout!.on('data', (bytes: Buffer) => chunks.push(bytes))
    const ended = once(handle.stdout!, 'end')
    handle.stdin!.write('hello ')
    handle.stdin!.end('中文🙂')
    expect((await handle.done).exitCode).toBe(0)
    await ended
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello 中文🙂')
  })

  it('cancels only the signalled process and awaits real termination', async () => {
    const { runtime, service } = await fixture()
    const cancellation = new AbortController()
    const first = runtime.spawn(spec([process.execPath, '-e', 'setInterval(()=>{},1000)'], { signal: cancellation.signal }))
    const second = runtime.spawn(spec([process.execPath, '-e', 'process.stdout.write("other")']))
    await second.done
    cancellation.abort()
    expect((await first.done).signal).toBe('SIGTERM')
    expect(await first.waitForExit()).toBe(true)
    expect(second.collected.stdout!.readFrom(0).text).toBe('other')
    expect(service.requests.filter(r => r.body.op === 'terminate')).toHaveLength(1)
  })

  it('waits for the managed range separately from child exit', async () => {
    const { runtime, service } = await fixture()
    service.holdRange(true)
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdout.write("child done")']))
    await handle.done
    expect(await handle.waitForExit(AbortSignal.abort())).toBe(false)
    service.holdRange(false)
    expect(await handle.waitForExit()).toBe(true)
  })

  it('contains temporary read failures without re-executing the command', async () => {
    const { runtime, service } = await fixture()
    service.failReads(2)
    const handle = runtime.spawn(spec([process.execPath, '-e', 'process.stdout.write("retained")']))
    await handle.done
    expect(handle.collected.stdout!.readFrom(0).text).toBe('retained')
    expect(service.requests.filter(r => r.body.op === 'spawn')).toHaveLength(1)
  })

  it('terminates outstanding work before the provider unloads', async () => {
    const { runtime, service, ctx } = await fixture()
    const handle = runtime.spawn(spec([process.execPath, '-e', 'setInterval(()=>{},1000)']))
    await ctx.fiber.dispose()
    expect(await handle.waitForExit()).toBe(true)
    expect([...service.jobs.values()].every(job => job.status !== 'running')).toBe(true)
  })
})
