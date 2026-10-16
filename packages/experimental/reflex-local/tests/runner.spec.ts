/** Runner lifecycle through the real local subprocess provider and a protocol fixture standing in for llama-server. */
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { JevProviderError } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { ReflexRunner, ReflexRunnerError } from '../src/runner.ts'
import { fakeRunner, runnerLog, temporaryRoot } from './harness.ts'

async function fixture(env: Record<string, string> = {}, overrides: Partial<Config> = {}) {
  const root = await temporaryRoot()
  const { path, log } = await fakeRunner(root, env)
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  const spawn = vi.spyOn(ctx.get('subprocess')!, 'spawn')
  const warn = vi.spyOn(ctx.logger, 'warn')
  const config = Config({
    dataRoot: root, startupTimeoutMs: 10_000, graceMs: 500, maxLogBytes: 100, maxResponseBytes: 2048, ...overrides,
  })
  const runner = new ReflexRunner(ctx, config, path, `${root}/model.gguf`)
  onTestFinished(async () => { await runner.dispose() })
  return { root, runner, spawn, log, warn, ctx }
}

const signal = (): AbortSignal => new AbortController().signal

describe.skipIf(process.platform === 'win32')('ReflexRunner', () => {
  it('starts one authenticated loopback runner per process and returns validated completions', async () => {
    const { runner, spawn, log, root } = await fixture()
    const [first, second] = await Promise.all([runner.acquire(signal()), runner.acquire(signal())])
    expect(spawn).toHaveBeenCalledOnce()
    const completion = await first.complete('prompt', signal())
    expect(completion).toEqual({ logprobs: new Map([['A', -0.01], ['B', -6], ['C', -7]]), promptTokens: 6, cachedTokens: 0, promptMs: 10 })
    await second.complete('again', signal(), false)
    const entries = await runnerLog(log)
    const argv = entries[0]!.argv!
    expect(entries[0]!.key).toMatch(/^[0-9a-f]{64}$/)
    expect(argv).toEqual(['-m', `${root}/model.gguf`, '--host', '127.0.0.1', '--port', '0',
      '-c', '9216', '-np', '1', '--no-webui', '--offline', '--log-colors', 'off'])
    expect(entries.filter(entry => entry.event === 'completion').map(entry => entry.body)).toEqual([
      { prompt: 'prompt', n_predict: 1, n_probs: 1024, temperature: 0, cache_prompt: true },
      { prompt: 'again', n_predict: 1, n_probs: 1024, temperature: 0, cache_prompt: false },
    ])
    const handle = spawn.mock.results[0]!.value as SubprocessHandle
    await runner.dispose()
    expect(await handle.waitForExit()).toBe(true)
    await expect(runner.acquire(signal())).rejects.toThrow('disposed')
  })

  it('waits for health after the listening line and uses a fresh key per process', async () => {
    const { runner, log } = await fixture({ FAKE_HEALTH_503: '2' })
    await (await runner.acquire(signal())).complete('p', signal())
    await runner.stop()
    await runner.stop()
    await (await runner.acquire(signal())).complete('p', signal())
    const keys = (await runnerLog(log)).filter(entry => entry.event === 'start').map(entry => entry.key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it.each([
    [{ FAKE_MODE: 'exit-early' }, {}, 'exited before readiness (exit code 3', 'failed to load model'],
    [{ FAKE_HEALTH_STATUS: '500' }, {}, 'health check returned HTTP 500', 'listening on'],
    [{ FAKE_MODE: 'wrong-port' }, {}, 'failed its readiness check', 'listening on'],
    [{ FAKE_MODE: 'no-auth' }, {}, 'API key check returned HTTP 200', 'listening on'],
    [{ FAKE_MODE: 'silent' }, { startupTimeoutMs: 2000 }, 'did not become ready before its deadline', 'loading model'],
  ] as const)('rejects startup %j with a safe message and keeps a bounded stderr tail', async (env, overrides, message, tail) => {
    const { runner } = await fixture(env, overrides)
    const failure = await runner.acquire(signal()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ReflexRunnerError)
    expect((failure as ReflexRunnerError).message).toContain(message)
    expect((failure as ReflexRunnerError).diagnostics).toContain(tail)
    expect((failure as ReflexRunnerError).diagnostics.length).toBeLessThanOrEqual(100)
  })

  it('reports a runner that cannot be spawned', async () => {
    const { ctx, root } = await fixture()
    const missing = new ReflexRunner(ctx, Config({ dataRoot: root, graceMs: 100 }), `${root}/absent`, 'model')
    onTestFinished(async () => { await missing.dispose() })
    await expect(missing.acquire(signal())).rejects.toThrow('could not be started')
  })

  it.each([
    ['http500', 'transport', 'returned HTTP 500'],
    ['invalid-json', 'invalid-response', 'invalid completion'],
    ['invalid-fields', 'invalid-response', 'invalid completion'],
    ['large', 'invalid-response', 'byte limit'],
  ])('maps a %s completion to %s and keeps the process', async (mode, code, message) => {
    const { runner, spawn } = await fixture({ FAKE_MODE: mode })
    const client = await runner.acquire(signal())
    const failure = await client.complete('p', signal()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(JevProviderError)
    expect((failure as JevProviderError).failure.code).toBe(code)
    expect((failure as JevProviderError).failure.message).toContain(message)
    await runner.acquire(signal())
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('times out a held completion, rethrows caller aborts, and leaves the process running', async () => {
    const { runner, spawn } = await fixture({ FAKE_MODE: 'hold' }, { decisionTimeoutMs: 100 })
    const client = await runner.acquire(signal())
    await expect(client.complete('p', signal())).rejects.toMatchObject({ failure: { code: 'timeout' } })
    const abort = new AbortController(), reason = new Error('caller left')
    const pending = client.complete('p', abort.signal)
    abort.abort(reason)
    await expect(pending).rejects.toBe(reason)
    await runner.acquire(signal())
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('restarts a process that crashed during a completion on the next acquisition', async () => {
    const { runner, spawn } = await fixture({ FAKE_MODE: 'crash' })
    const client = await runner.acquire(signal())
    await expect(client.complete('p', signal())).rejects.toMatchObject({ failure: { code: 'transport' } })
    await expect(client.complete('p', signal())).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex runner is not running' } })
    await runner.acquire(signal())
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('logs an unexpected exit of a ready process and restarts it on the next acquisition', async () => {
    const { runner, spawn, warn } = await fixture({ FAKE_EXIT_AFTER_MS: '300' })
    const client = await runner.acquire(signal())
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('exited'), expect.stringContaining('listening')) })
    await expect(client.complete('p', signal())).rejects.toMatchObject({ failure: { message: 'local Reflex runner is not running' } })
    await runner.acquire(signal())
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('stops an idle runner and lets a waiting caller stop waiting for a shared startup', async () => {
    const { runner, spawn, warn } = await fixture({}, { idleReleaseMs: 50 })
    const abort = new AbortController(), reason = new Error('not waiting')
    const waiting = runner.acquire(abort.signal)
    abort.abort(reason)
    await expect(waiting).rejects.toBe(reason)
    const client = await runner.acquire(signal())
    await client.complete('p', signal())
    const handle = spawn.mock.results[0]!.value as SubprocessHandle
    expect(await handle.waitForExit(AbortSignal.timeout(5000))).toBe(true)
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('exited'), expect.anything())
    await expect(client.complete('p', signal())).rejects.toMatchObject({ failure: { code: 'transport' } })
    await runner.acquire(signal())
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('logs an idle cleanup whose exit can no longer be observed', async () => {
    const { runner, spawn, warn } = await fixture({}, { idleReleaseMs: 50 })
    await runner.acquire(signal())
    const handle = spawn.mock.results[0]!.value as SubprocessHandle
    const lost = new Error('process range lost')
    const wait = handle.waitForExit.bind(handle)
    vi.spyOn(handle, 'waitForExit').mockRejectedValueOnce(lost)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex runner idle cleanup failed', lost) })
    expect(await wait()).toBe(true)
  })

  it('aborts a pending startup on disposal', async () => {
    const { runner, spawn } = await fixture({ FAKE_MODE: 'silent' })
    const pending = runner.acquire(signal())
    await vi.waitFor(() => { expect(spawn).toHaveBeenCalledOnce() })
    await runner.dispose()
    await expect(pending).rejects.toThrow('disposed')
    expect(await (spawn.mock.results[0]!.value as SubprocessHandle).waitForExit()).toBe(true)
  })
})
