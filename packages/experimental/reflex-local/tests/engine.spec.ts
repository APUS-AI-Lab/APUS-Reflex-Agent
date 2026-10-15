/** Preparation state machine with a real subprocess provider, loopback weights server, and protocol runner fixture. */
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { JevProviderError } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { inspectDevice } from '../src/device.ts'
import type { ModelAsset } from '../src/download.ts'
import { JEV_PLUGIN, ReflexEngine, SYSTEM3_PLUGIN, type RoutingEditor, type RoutingEntry } from '../src/engine.ts'
import type { ReflexPreparation, ReflexSnapshot } from '../src/types.ts'
import { assetOf, fakeRunner, runnerLog, serve, temporaryRoot, weightsServer } from './harness.ts'

const weights = { q8_0: Buffer.from('q8 weights fixture '.repeat(40)), q4_k_m: Buffer.from('q4 weights '.repeat(30)) }
const lock = vi.hoisted(() => ({ models: {} as Record<string, ModelAsset> }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (args[0] instanceof URL && args[0].pathname.endsWith('/runtime/assets.json')) return JSON.stringify(lock)
    return actual.readFileSync(...args)
  } }
})
vi.mock('../src/device.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/device.ts')>(), inspectDevice: vi.fn() }))
lock.models = { q8_0: assetOf('q8.gguf', weights.q8_0), q4_k_m: assetOf('q4.gguf', weights.q4_k_m) }
const GIB = 1024 ** 3

interface Options {
  env?: Record<string, string>
  config?: Partial<Config>
  editor?: RoutingEditor
  memory?: number
  origin?: string
  root?: string
}

async function fixture(options: Options = {}) {
  const root = options.root ?? await temporaryRoot()
  const runner = await fakeRunner(root, options.env)
  const server = options.origin === undefined ? await weightsServer(weights.q8_0) : undefined
  const origin = options.origin ?? server!.origin
  const memory = options.memory ?? 24 * GIB
  vi.mocked(inspectDevice).mockReturnValue({ supported: true, memoryBytes: memory, recommended: memory >= 16 * GIB ? 'q8_0' : 'q4_k_m' })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  const warn = vi.spyOn(ctx.logger, 'warn')
  const config = Config({ dataRoot: join(root, 'data'), runnerPath: runner.path, modelOrigins: [origin], idleTimeoutMs: 0, diskMarginBytes: 0,
    minPrefillTokensPerSecond: 100, startupTimeoutMs: 10_000, graceMs: 500, progressIntervalMs: 1, ...options.config })
  const create = (): ReflexEngine => {
    const engine = new ReflexEngine(ctx, config, options.editor)
    onTestFinished(async () => { await engine.dispose() })
    return engine
  }
  return { root, data: join(root, 'data'), origin, server, runner, ctx, warn, config, create }
}

async function until(engine: ReflexEngine, phase: ReflexPreparation['phase'], seen: string[] = []): Promise<ReflexSnapshot> {
  const abort = new AbortController()
  try {
    for await (const snapshot of engine.follow(abort.signal)) {
      seen.push(snapshot.preparation.phase)
      if (snapshot.preparation.phase === phase) return snapshot
    }
  } finally { abort.abort() }
  throw new Error('engine disposed')
}

async function state(data: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(data, 'state.json'), 'utf8')) as Record<string, unknown>
}

function editor(rows: Array<{ name: string; config: Record<string, unknown> }>) {
  const entries: RoutingEntry[] = rows.map(row => ({ options: { name: row.name, config: row.config } }))
  const edits: Array<[string, Record<string, unknown>]> = []
  const routing: RoutingEditor = {
    entries: () => entries,
    edit: async (entry, change) => {
      const next = change(entry.options.config as Record<string, unknown>)
      edits.push([entry.options.name, next]);
      (entry.options as { config?: unknown }).config = next
    },
  }
  return { routing, edits }
}

describe.skipIf(process.platform === 'win32')('ReflexEngine', () => {
  it('reports unsupported devices without files, work, or routing', async () => {
    const { create } = await fixture()
    vi.mocked(inspectDevice).mockReturnValue({ supported: false, reason: 'runner-missing' })
    const engine = create()
    engine.activate()
    expect(engine.snapshot()).toMatchObject({ device: { supported: false }, models: [], preparation: { phase: 'unsupported' }, enabled: false })
    expect(() => { engine.prepare() }).toThrow('cannot run')
    await expect(engine.acquire(new AbortController().signal)).rejects.toBeInstanceOf(JevProviderError)
    await engine.remove()
    expect(engine.snapshot().preparation).toEqual({ phase: 'unsupported' })
  })

  it('downloads, verifies, self-tests, and enables, then restores readiness on the next activation without hashing or a runner', async () => {
    const { create, data, runner, origin } = await fixture()
    const engine = create()
    expect(engine.snapshot()).toMatchObject({ preparation: { phase: 'checking' }, providerId: 'reflex-local', downloadSources: [origin] })
    expect(() => { engine.prepare() }).toThrow('still checking')
    engine.activate()
    const absent = await until(engine, 'absent')
    expect(absent.models).toEqual([{ variant: 'q8_0', bytes: weights.q8_0.length }, { variant: 'q4_k_m', bytes: weights.q4_k_m.length }])
    expect(absent.availableDiskBytes).toBeGreaterThan(0)
    const seen: string[] = []
    engine.prepare()
    engine.prepare()
    const ready = await until(engine, 'ready', seen)
    expect(seen).toEqual(expect.arrayContaining(['downloading', 'verifying', 'testing', 'ready']))
    expect(ready.preparation).toMatchObject({ phase: 'ready', variant: 'q8_0', selfTest: { slow: false } })
    await vi.waitFor(() => { expect(engine.snapshot().enabled).toBe(true) })
    await vi.waitFor(async () => { expect(await state(data)).toMatchObject({ enabled: true, model: { variant: 'q8_0', selfTest: { slow: false } } }) })
    const notice = engine.snapshot().unacknowledgedAutoEnableAt
    expect(notice).toBeGreaterThan(0)
    expect(await state(data)).toHaveProperty('autoEnabledAt', notice)
    await engine.enable()
    expect(engine.snapshot().unacknowledgedAutoEnableAt).toBe(notice)
    await engine.acknowledge()
    expect(engine.snapshot().unacknowledgedAutoEnableAt).toBeUndefined()
    expect(await state(data)).not.toHaveProperty('autoEnabledAt')
    expect(await state(data)).not.toHaveProperty('preparing')
    const completions = (await runnerLog(runner.log)).filter(entry => entry.event === 'completion')
    expect(completions.map(entry => entry.body?.cache_prompt)).toEqual([false, false])
    expect(completions[0]!.body?.prompt).toContain('Order 731 was delivered.')
    const client = await engine.acquire(new AbortController().signal)
    expect((await client.complete('decision', new AbortController().signal)).logprobs.get('A')).toBe(-0.01)
    await engine.warm()
    engine.prepare({ variant: 'q8_0' })
    await engine.dispose()

    const restored = create()
    restored.activate()
    expect((await until(restored, 'ready')).enabled).toBe(true)
    expect((await runnerLog(runner.log)).filter(entry => entry.event === 'start')).toHaveLength(1)
    await restored.disable()
    expect(restored.snapshot().enabled).toBe(false)
    await expect(restored.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex engine is not enabled' } })
  })

  it('keeps slow Hosts disabled until enabled explicitly and refuses enabling before readiness', async () => {
    const { create } = await fixture({ env: { FAKE_PROMPT_MS: '1000000' } })
    const engine = create()
    await expect(engine.enable()).rejects.toThrow('Prepare')
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    const ready = await until(engine, 'ready')
    expect(ready.preparation).toMatchObject({ selfTest: { slow: true } })
    expect(ready.enabled).toBe(false)
    await engine.enable()
    expect(engine.snapshot()).toMatchObject({ enabled: true })
    expect(engine.snapshot().unacknowledgedAutoEnableAt).toBeUndefined()
    await engine.enable()
  })

  it.each([
    [{ FAKE_MODE: 'wrong' }, { kind: 'self-test', message: 'The reference decision selected B instead of A' }],
    [{ FAKE_MODE: 'missing' }, { kind: 'self-test', message: 'The reference decision omitted a candidate label' }],
    [{ FAKE_MODE: 'exit-early' }, { kind: 'runner', message: 'Reflex runner exited before readiness (exit code 3, signal null)' }],
    [{ FAKE_MODE: 'http500' }, { kind: 'self-test', message: 'local Reflex runner returned HTTP 500' }],
  ])('fails preparation for runner behavior %j and keeps the weights for a retry', async (env, failure) => {
    const { create, data } = await fixture({ env })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    expect((await until(engine, 'failed')).preparation).toEqual({ phase: 'failed', variant: 'q8_0', failure })
    expect(await readFile(join(data, 'models', 'q8.gguf'))).toEqual(weights.q8_0)
    engine.prepare()
    await until(engine, 'failed')
  })

  it('reports download and disk failures with their safe details', async () => {
    const failing = await serve((_request, response) => { response.writeHead(404).end() })
    const http = await fixture({ origin: failing })
    const engine = http.create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    expect((await until(engine, 'failed')).preparation).toMatchObject({ failure: { kind: 'download', download: { reason: 'http', status: 404, source: failing } } })
    const disk = await fixture({ config: { diskMarginBytes: Number.MAX_SAFE_INTEGER } })
    const full = disk.create()
    full.activate()
    await until(full, 'absent')
    full.prepare()
    const { failure } = (await until(full, 'failed')).preparation as Extract<ReflexPreparation, { phase: 'failed' }>
    expect(failure.kind).toBe('disk')
    expect(failure).toHaveProperty('requiredBytes', Number.MAX_SAFE_INTEGER + weights.q8_0.length)
  })

  it('pauses a download keeping its partial file, cancels it deleting the file, and validates variant and source changes', async () => {
    const bytes = weights.q8_0
    const origin = await serve((request, response) => {
      if (request.method === 'HEAD') { response.writeHead(200).end(); return }
      response.writeHead(200)
      // The delay separates the body from the initial progress report, which the 1 ms throttle would otherwise absorb.
      setTimeout(() => { response.write(bytes.subarray(0, 100)) }, 20)
    })
    lock.models.q4_k_m = assetOf('q4.gguf', bytes)
    onTestFinished(() => { lock.models.q4_k_m = assetOf('q4.gguf', weights.q4_k_m) })
    const { create, data } = await fixture({ origin, memory: 8 * GIB })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    expect(() => { engine.prepare({ variant: 'q8_0' }) }).toThrow('unavailable on this device')
    expect(() => { engine.prepare({ downloadSource: 'https://elsewhere.example' }) }).toThrow('source is unavailable')
    engine.prepare({ downloadSource: origin })
    engine.prepare()
    await vi.waitFor(() => { expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', completedBytes: 100, source: origin }) })
    expect(await state(data)).toMatchObject({ preparing: { variant: 'q4_k_m', source: origin } })
    await engine.pause()
    expect(engine.snapshot().preparation).toEqual({ phase: 'paused', variant: 'q4_k_m', completedBytes: 100, totalBytes: bytes.length })
    expect(await state(data)).not.toHaveProperty('preparing')
    await engine.pause()
    await engine.cancel()
    expect(engine.snapshot().preparation).toEqual({ phase: 'absent' })
    engine.prepare()
    await vi.waitFor(() => { expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', completedBytes: 100 }) })
    await engine.cancel()
    expect(engine.snapshot().preparation).toEqual({ phase: 'absent' })
    await expect(readFile(join(data, 'models', 'q4.gguf.part'))).rejects.toThrow()
    await engine.cancel()
  })

  it('rejects a variant or source change while work is active', async () => {
    const origin = await serve((request, response) => { if (request.method === 'HEAD') response.writeHead(200).end() })
    const other = await serve((request, response) => { if (request.method === 'HEAD') response.writeHead(200).end() })
    const { create } = await fixture({ origin, config: { modelOrigins: [origin, other] } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    expect(() => { engine.prepare({ variant: 'q4_k_m' }) }).toThrow('Cancel preparation')
    expect(() => { engine.prepare({ downloadSource: other }) }).toThrow('Cancel preparation')
    await engine.cancel()
  })

  it('resumes an interrupted preparation on activation with a Range request', async () => {
    const { create, data, server } = await fixture()
    await mkdir(join(data, 'models'), { recursive: true })
    await writeFile(join(data, 'models', 'q8.gguf.part'), weights.q8_0.subarray(0, 64))
    await writeFile(join(data, 'state.json'), JSON.stringify({ enabled: false, preparing: { variant: 'q8_0', source: server!.origin } }))
    const engine = create()
    engine.activate()
    await until(engine, 'ready')
    expect(server!.ranges).toEqual(['bytes=64-'])
  })

  it('inspects untested, corrupt, and partial weights without downloads and ignores invalid state', async () => {
    const { create, data, server, warn } = await fixture()
    await mkdir(join(data, 'models'), { recursive: true })
    await writeFile(join(data, 'models', 'q8.gguf'), weights.q8_0)
    await writeFile(join(data, 'state.json'), '{"enabled":"yes"}')
    const untested = create()
    untested.activate()
    expect(() => { untested.prepare() }).toThrow('still checking')
    expect((await until(untested, 'paused')).preparation).toEqual({ phase: 'paused', variant: 'q8_0', completedBytes: weights.q8_0.length, totalBytes: weights.q8_0.length })
    expect(warn).toHaveBeenCalledWith('Ignoring invalid Reflex state', expect.anything())
    await untested.dispose()

    await writeFile(join(data, 'models', 'q8.gguf'), Buffer.alloc(weights.q8_0.length))
    await utimes(join(data, 'models', 'q8.gguf'), new Date(), new Date(Date.now() + 5000))
    await writeFile(join(data, 'models', 'q4.gguf.part'), weights.q4_k_m.subarray(0, 7))
    await writeFile(join(data, 'state.json'), 'not json')
    const partial = create()
    partial.activate()
    expect((await until(partial, 'paused')).preparation).toEqual({ phase: 'paused', variant: 'q4_k_m', completedBytes: 7, totalBytes: weights.q4_k_m.length })
    expect(warn).toHaveBeenCalledWith('Ignoring unreadable Reflex state', expect.anything())
    await partial.dispose()

    await rm(join(data, 'models', 'q4.gguf.part'))
    const corrupt = create()
    corrupt.activate()
    await until(corrupt, 'absent')
    expect(server!.ranges).toEqual([])
  })

  it('reports an unreadable data root as a failed inspection that preparation can retry', async () => {
    const { create, data, warn } = await fixture()
    await mkdir(join(data, 'state.json'), { recursive: true })
    const engine = create()
    engine.activate()
    expect((await until(engine, 'failed')).preparation).toMatchObject({ failure: { kind: 'download', download: { reason: 'unknown' } } })
    expect(warn).toHaveBeenCalledWith('Reflex engine inspection failed', expect.anything())
    await rm(join(data, 'state.json'), { recursive: true })
    engine.prepare()
    await until(engine, 'ready')
  })

  it('reports a failed state write after a stopped preparation', async () => {
    const origin = await serve((request, response) => { if (request.method === 'HEAD') response.writeHead(200).end() })
    const { create, data } = await fixture({ origin })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await vi.waitFor(async () => { expect(await state(data)).toHaveProperty('preparing') })
    await rm(join(data, 'state.json'))
    await mkdir(join(data, 'state.json'))
    await engine.pause()
    expect(engine.snapshot().preparation).toMatchObject({ phase: 'failed', variant: 'q8_0' })
  })

  it('removes weights during and after preparation, then disables', async () => {
    const { create, data } = await fixture()
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await until(engine, 'ready')
    await vi.waitFor(() => { expect(engine.snapshot().unacknowledgedAutoEnableAt).toBeGreaterThan(0) })
    await engine.acquire(new AbortController().signal)
    await engine.remove()
    expect(engine.snapshot().unacknowledgedAutoEnableAt).toBeUndefined()
    expect(engine.snapshot()).toMatchObject({ preparation: { phase: 'absent' }, enabled: false })
    await expect(readFile(join(data, 'models', 'q8.gguf'))).rejects.toThrow()
    expect(await state(data)).toEqual({ enabled: false })
    engine.prepare()
    await engine.remove()
    expect(engine.snapshot().preparation).toEqual({ phase: 'absent' })
  })

  it('switches variants by replacing the runner and maps runner failures for the provider', async () => {
    lock.models.q4_k_m = assetOf('q4.gguf', weights.q8_0)
    onTestFinished(() => { lock.models.q4_k_m = assetOf('q4.gguf', weights.q4_k_m) })
    const { create, data, root } = await fixture()
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await until(engine, 'ready')
    engine.prepare({ variant: 'q4_k_m' })
    await until(engine, 'testing')
    expect((await until(engine, 'ready')).preparation).toMatchObject({ variant: 'q4_k_m' })
    expect(await state(data)).toMatchObject({ model: { variant: 'q4_k_m' } })
    await writeFile(join(root, 'llama-server'), '#!/bin/sh\nexit 4\n')
    await engine.dispose()
    const broken = create()
    broken.activate()
    await until(broken, 'ready')
    const abort = new AbortController(), reason = new Error('caller left')
    abort.abort(reason)
    await expect(broken.acquire(abort.signal)).rejects.toBe(reason)
    await expect(broken.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex runner is unavailable' } })
  })

  it('keeps the resume record when disposed during a download and ends followers', async () => {
    const origin = await serve((request, response) => { if (request.method === 'HEAD') response.writeHead(200).end() })
    const { create, data } = await fixture({ origin })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await vi.waitFor(async () => { expect(await state(data)).toHaveProperty('preparing') })
    const follower = until(engine, 'ready')
    await engine.dispose()
    await expect(follower).rejects.toThrow('engine disposed')
    expect(await state(data)).toMatchObject({ preparing: { variant: 'q8_0' } })
    expect(() => { engine.prepare() }).toThrow('disposed')
    await expect(engine.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport' } })
    const relaunched = create()
    relaunched.activate()
    await vi.waitFor(() => { expect(relaunched.snapshot().preparation.phase).toBe('downloading') })
  })

  it('routes through the profile editor in privacy-safe order when a cloud provider is configured', async () => {
    const { routing, edits } = editor([
      { name: JEV_PLUGIN, config: { endpoint: 'https://jev.example', providerId: 'system-one' } },
      { name: SYSTEM3_PLUGIN, config: { jevExecutionDomain: 'network' } },
    ])
    const server = await weightsServer(weights.q8_0)
    const { create } = await fixture({ editor: routing, origin: server.origin, config: { cloudProviderId: 'system-one', modelOrigin: server.origin } })
    const engine = create()
    expect(engine.snapshot()).toMatchObject({ enabled: false, cloudProviderId: 'system-one', downloadSources: [server.origin] })
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await until(engine, 'ready')
    await vi.waitFor(() => { expect(engine.snapshot().unacknowledgedAutoEnableAt).toBeGreaterThan(0) })
    expect(engine.snapshot().enabled).toBe(true)
    expect(edits).toEqual([
      [JEV_PLUGIN, { endpoint: 'https://jev.example', providerId: 'system-one', defaultProviderId: 'reflex-local' }],
      [SYSTEM3_PLUGIN, { jevExecutionDomain: 'local' }],
    ])
    await engine.enable()
    expect(edits).toHaveLength(2)
    await engine.disable()
    expect(edits.slice(2)).toEqual([
      [SYSTEM3_PLUGIN, { jevExecutionDomain: 'network' }],
      [JEV_PLUGIN, { endpoint: 'https://jev.example', providerId: 'system-one', defaultProviderId: 'system-one' }],
    ])
    expect(engine.snapshot()).toMatchObject({ enabled: false })
    expect(engine.snapshot().unacknowledgedAutoEnableAt).toBeUndefined()
  })

  it('requires an editor and a jev entry for cloud routing and skips an absent System3 entry', async () => {
    const { config, ctx } = await fixture({ config: { cloudProviderId: 'system-one' } })
    expect(() => new ReflexEngine(ctx, config)).toThrow('config-editor')
    const lone = editor([{ name: JEV_PLUGIN, config: { defaultProviderId: 'reflex-local' } }])
    const withJev = new ReflexEngine(ctx, config, lone.routing)
    onTestFinished(async () => { await withJev.dispose() })
    expect(withJev.snapshot().enabled).toBe(true)
    await withJev.disable()
    expect(lone.edits).toEqual([[JEV_PLUGIN, { defaultProviderId: 'system-one' }]])
    const none = new ReflexEngine(ctx, config, editor([]).routing)
    onTestFinished(async () => { await none.dispose() })
    expect(none.snapshot().enabled).toBe(false)
    await expect(none.disable()).rejects.toThrow('jev plugin entry')
  })

  it('logs a failed automatic enable and keeps the engine ready', async () => {
    const rows = editor([{ name: JEV_PLUGIN, config: {} }])
    const refused = new Error('profile is overridden')
    rows.routing.edit = async () => { throw refused }
    const { create, warn } = await fixture({ editor: rows.routing, config: { cloudProviderId: 'system-one' } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await until(engine, 'ready')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex automatic enable failed', refused) })
    expect(engine.snapshot()).toMatchObject({ enabled: false, preparation: { phase: 'ready' } })
  })

  it('refuses decisions while enabled but not ready and stops inspection on disposal', async () => {
    const { create, data, warn } = await fixture()
    await mkdir(data, { recursive: true })
    await writeFile(join(data, 'state.json'), JSON.stringify({ enabled: true }))
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    await expect(engine.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex engine is not ready' } })
    await mkdir(join(data, 'models'), { recursive: true })
    await writeFile(join(data, 'models', 'q8.gguf'), weights.q8_0)
    const disposed = create()
    disposed.activate()
    await disposed.dispose()
    expect(warn).not.toHaveBeenCalledWith('Reflex engine inspection failed', expect.anything())
  })
})
