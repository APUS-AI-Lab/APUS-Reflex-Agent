/** Preparation state machine with a real subprocess provider, loopback weights server, and protocol runner fixture. */
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { JevProviderError } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { inspectDevice } from '../src/device.ts'
import { JEV_ENTRY_ID, ReflexEngine, type RoutingEditor, type RoutingEntry } from '../src/engine.ts'
import { VARIANT_KEYS, variantOf, type CatalogAsset, type VariantKey } from '../src/models.ts'
import type { ReflexPreparation, ReflexSnapshot } from '../src/types.ts'
import { assetOf, fakeRunner, runnerLog, serve, temporaryRoot, weightsServer } from './harness.ts'

const weights = Object.fromEntries(VARIANT_KEYS.map((key, index) => [key, Buffer.from(`${key} weights `.repeat(20 + index))])) as Record<VariantKey, Buffer>
const fileOf = (key: VariantKey): string => `${key}.gguf`
const files = Object.fromEntries(VARIANT_KEYS.map(key => [fileOf(key), weights[key]]))
const lock = vi.hoisted(() => ({ models: {} as Record<string, CatalogAsset> }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (args[0] instanceof URL && args[0].pathname.endsWith('/runtime/assets.json')) return JSON.stringify(lock)
    return actual.readFileSync(...args)
  } }
})
vi.mock('../src/device.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/device.ts')>(), inspectDevice: vi.fn() }))
function catalog(overrides: Partial<Record<VariantKey, Buffer>> = {}): void {
  lock.models = Object.fromEntries(VARIANT_KEYS.map(key => [key,
    { ...assetOf(fileOf(key), overrides[key] ?? weights[key]), experimental: key.startsWith('35b') }]))
}
catalog()
const GIB = 1024 ** 3
const Q9 = variantOf('9b-q8_0'), Q4 = variantOf('4b-q4_k_m')

interface Options {
  env?: Record<string, string>
  config?: Partial<Config>
  /** Raw jev entry configuration; null mounts no jev entry. */
  jev?: Record<string, unknown> | null
  memory?: number
  origin?: string
}

function editor(jev: Record<string, unknown> | null) {
  const entries: RoutingEntry[] = jev === null ? [] : [{ options: { id: JEV_ENTRY_ID, config: jev } }]
  const edits: Array<Record<string, unknown>> = []
  const routing: RoutingEditor = {
    entries: () => entries,
    edit: async (entry, change) => {
      const next = change(entry.options.config as Record<string, unknown>)
      edits.push(next);
      (entry.options as { config?: unknown }).config = next
    },
  }
  return { routing, edits }
}

async function fixture(options: Options = {}) {
  const root = await temporaryRoot()
  const runner = await fakeRunner(root, options.env)
  const server = options.origin === undefined ? await weightsServer(files) : undefined
  const origin = options.origin ?? server!.origin
  vi.mocked(inspectDevice).mockReturnValue({ supported: true, memoryBytes: options.memory ?? 24 * GIB })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  const warn = vi.spyOn(ctx.logger, 'warn')
  const config = Config({ dataRoot: join(root, 'data'), runnerPath: runner.path, modelOrigins: [origin], idleTimeoutMs: 0, diskMarginBytes: 0,
    minPrefillTokensPerSecond: 100, startupTimeoutMs: 10_000, graceMs: 500, progressIntervalMs: 1, ...options.config })
  const routing = editor(options.jev === undefined ? {} : options.jev)
  const create = (): ReflexEngine => {
    const engine = new ReflexEngine(ctx, config, routing.routing)
    onTestFinished(async () => { await engine.dispose() })
    return engine
  }
  return { root, data: join(root, 'data'), origin, server, runner, ctx, warn, config, create, routing }
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

describe.skipIf(process.platform === 'win32')('ReflexEngine', () => {
  it('fails loud without the configuration editor or an enabled jev entry', async () => {
    const { ctx, config } = await fixture()
    expect(() => new ReflexEngine(ctx, config, undefined)).toThrow('config-editor')
    expect(() => new ReflexEngine(ctx, config, editor(null).routing)).toThrow('requires an enabled')
    const disabled: RoutingEditor = { entries: () => [{ options: { id: JEV_ENTRY_ID, disabled: true } }], edit: async () => {} }
    expect(() => new ReflexEngine(ctx, config, disabled)).toThrow('requires an enabled')
  })

  it('reports unsupported devices without options, work, or routing', async () => {
    const { create } = await fixture()
    vi.mocked(inspectDevice).mockReturnValue({ supported: false, reason: 'runner-missing' })
    const engine = create()
    engine.activate()
    expect(engine.snapshot()).toMatchObject({ device: { supported: false }, options: [], preparation: { phase: 'unsupported' }, enabled: false, reflexEnabled: true })
    expect(engine.snapshot().recommended).toBeUndefined()
    expect(() => { engine.prepare() }).toThrow('cannot run')
    await expect(engine.acquire(new AbortController().signal)).rejects.toBeInstanceOf(JevProviderError)
    await engine.remove()
    expect(engine.snapshot().preparation).toEqual({ phase: 'unsupported' })
  })

  it('lists every option with fitness and recommends the largest stable option that fits memory and disk', async () => {
    const { create } = await fixture({ memory: 64 * GIB })
    const engine = create()
    expect(engine.snapshot().options.map(option => [option.model, option.quant, option.fits, option.experimental])).toEqual([
      ['4b', 'q4_k_m', true, false], ['4b', 'q8_0', true, false], ['9b', 'q4_k_m', true, false], ['9b', 'q8_0', true, false],
      ['35b-a3b', 'q4_k_m', true, true], ['35b-a3b', 'q8_0', true, true],
    ])
    expect(engine.snapshot().recommended).toEqual(Q9)
    engine.activate()
    await until(engine, 'absent')
    expect(engine.snapshot().options[0]).toEqual({ model: '4b', quant: 'q4_k_m', bytes: weights['4b-q4_k_m'].length,
      minMemoryBytes: 8 * GIB, experimental: false, fits: true })
    const small = await fixture({ memory: 12 * GIB, config: { diskMarginBytes: Number.MAX_SAFE_INTEGER } })
    const tight = small.create()
    tight.activate()
    const absent = await until(tight, 'absent')
    expect(absent.options.map(option => option.reason)).toEqual(['disk', 'memory', 'memory', 'memory', 'memory', 'memory'])
    expect(absent.recommended).toEqual(Q4)
    expect(() => { tight.prepare({ variant: Q9 }) }).toThrow('does not fit')
  })

  it('downloads, verifies, self-tests, and enables, then restores readiness on the next activation without hashing or a runner', async () => {
    const { create, data, runner, origin, routing } = await fixture({ jev: { providerId: 'system-one', enabled: true } })
    const engine = create()
    expect(engine.snapshot()).toMatchObject({ preparation: { phase: 'checking' }, providerId: 'reflex-local', downloadSources: [origin] })
    expect(() => { engine.prepare() }).toThrow('still checking')
    engine.activate()
    const absent = await until(engine, 'absent')
    expect(absent.availableDiskBytes).toBeGreaterThan(0)
    const seen: string[] = []
    engine.prepare()
    engine.prepare()
    const ready = await until(engine, 'ready', seen)
    expect(seen).toEqual(expect.arrayContaining(['downloading', 'verifying', 'testing', 'ready']))
    expect(ready.preparation).toMatchObject({ phase: 'ready', variant: Q9, selfTest: { slow: false } })
    await vi.waitFor(() => { expect(engine.snapshot().unacknowledgedAutoEnableAt).toBeGreaterThan(0) })
    expect(engine.snapshot().enabled).toBe(true)
    expect(routing.edits).toEqual([{ providerId: 'system-one', enabled: true, defaultProviderId: 'reflex-local' }])
    const notice = engine.snapshot().unacknowledgedAutoEnableAt
    await vi.waitFor(async () => { expect(await state(data)).toMatchObject({ autoEnabledAt: notice, models: { '9b-q8_0': { selfTest: { slow: false } } } }) })
    await engine.enable()
    expect(routing.edits).toHaveLength(1)
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
    engine.prepare({ variant: Q9 })
    await engine.dispose()

    const restored = create()
    restored.activate()
    expect((await until(restored, 'ready')).enabled).toBe(true)
    expect((await runnerLog(runner.log)).filter(entry => entry.event === 'start')).toHaveLength(1)
    await restored.disable()
    expect(routing.edits.at(-1)).toEqual({ providerId: 'system-one', enabled: true })
    expect(restored.snapshot().enabled).toBe(false)
    await restored.disable()
    expect(routing.edits).toHaveLength(2)
    await expect(restored.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex engine is not enabled' } })
  })

  it('reports the Jev master switch and a default provider set elsewhere', async () => {
    const { create } = await fixture({ jev: { enabled: false, defaultProviderId: 'reflex-local' } })
    expect(create().snapshot()).toMatchObject({ enabled: true, reflexEnabled: false })
    const other = await fixture({ jev: { providerId: 'reflex-local' } })
    expect(other.create().snapshot()).toMatchObject({ enabled: true, reflexEnabled: true })
    const plain: RoutingEditor = { entries: () => [{ options: { id: JEV_ENTRY_ID } }], edit: async () => {} }
    const bare = await fixture()
    expect(new ReflexEngine(bare.ctx, bare.config, plain).snapshot()).toMatchObject({ enabled: false, reflexEnabled: true })
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
    expect((await until(engine, 'failed')).preparation).toEqual({ phase: 'failed', variant: Q9, failure })
    expect(await readFile(join(data, 'models', fileOf('9b-q8_0')))).toEqual(weights['9b-q8_0'])
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
    // No option fits the disk, so the recommendation falls back to the smallest stable option.
    expect(failure).toHaveProperty('requiredBytes', Number.MAX_SAFE_INTEGER + weights['4b-q4_k_m'].length)
  })

  it('pauses a download keeping its partial file, cancels it deleting the file, and validates sources', async () => {
    const bytes = weights['4b-q4_k_m']
    const origin = await serve((request, response) => {
      if (request.method === 'HEAD') { response.writeHead(200).end(); return }
      response.writeHead(200)
      // The delay separates the body from the initial progress report, which the 1 ms throttle would otherwise absorb.
      setTimeout(() => { response.write(bytes.subarray(0, 100)) }, 20)
    })
    const { create, data } = await fixture({ origin, memory: 8 * GIB })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    expect(() => { engine.prepare({ variant: Q9 }) }).toThrow('does not fit')
    expect(() => { engine.prepare({ downloadSource: 'https://elsewhere.example' }) }).toThrow('source is unavailable')
    engine.prepare({ downloadSource: origin })
    engine.prepare()
    await vi.waitFor(() => { expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', completedBytes: 100, source: origin }) })
    expect(await state(data)).toMatchObject({ preparing: { variant: Q4, source: origin } })
    await engine.pause()
    expect(engine.snapshot().preparation).toEqual({ phase: 'paused', variant: Q4, completedBytes: 100, totalBytes: bytes.length })
    expect(await state(data)).not.toHaveProperty('preparing')
    await engine.pause()
    await engine.cancel()
    expect(engine.snapshot().preparation).toEqual({ phase: 'absent' })
    engine.prepare()
    await vi.waitFor(() => { expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', completedBytes: 100 }) })
    await engine.cancel()
    expect(engine.snapshot().preparation).toEqual({ phase: 'absent' })
    await expect(readFile(join(data, 'models', `${fileOf('4b-q4_k_m')}.part`))).rejects.toThrow()
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
    expect(() => { engine.prepare({ variant: Q4 }) }).toThrow('Cancel preparation')
    expect(() => { engine.prepare({ downloadSource: other }) }).toThrow('Cancel preparation')
    await engine.cancel()
  })

  it('resumes an interrupted preparation on activation with a Range request', async () => {
    const { create, data, server } = await fixture()
    await mkdir(join(data, 'models'), { recursive: true })
    await writeFile(join(data, 'models', `${fileOf('9b-q8_0')}.part`), weights['9b-q8_0'].subarray(0, 64))
    await writeFile(join(data, 'state.json'), JSON.stringify({ models: {}, preparing: { variant: Q9, source: server!.origin } }))
    const engine = create()
    engine.activate()
    await until(engine, 'ready')
    expect(server!.ranges).toEqual(['bytes=64-'])
  })

  it('inspects untested, corrupt, and partial weights without downloads and ignores invalid state', async () => {
    const { create, data, server, warn } = await fixture()
    await mkdir(join(data, 'models'), { recursive: true })
    await writeFile(join(data, 'models', fileOf('4b-q8_0')), weights['4b-q8_0'])
    await writeFile(join(data, 'state.json'), '{"models":"none"}')
    const untested = create()
    untested.activate()
    expect(() => { untested.prepare() }).toThrow('still checking')
    const paused = await until(untested, 'paused')
    expect(paused.preparation).toEqual({ phase: 'paused', variant: variantOf('4b-q8_0'), completedBytes: weights['4b-q8_0'].length, totalBytes: weights['4b-q8_0'].length })
    expect(warn).toHaveBeenCalledWith('Ignoring invalid Reflex state', expect.anything())
    await untested.dispose()

    await writeFile(join(data, 'models', fileOf('4b-q8_0')), Buffer.alloc(weights['4b-q8_0'].length))
    await utimes(join(data, 'models', fileOf('4b-q8_0')), new Date(), new Date(Date.now() + 5000))
    await writeFile(join(data, 'models', `${fileOf('4b-q4_k_m')}.part`), weights['4b-q4_k_m'].subarray(0, 7))
    await writeFile(join(data, 'state.json'), 'not json')
    const partial = create()
    partial.activate()
    expect((await until(partial, 'paused')).preparation).toEqual({ phase: 'paused', variant: Q4, completedBytes: 7, totalBytes: weights['4b-q4_k_m'].length })
    expect(warn).toHaveBeenCalledWith('Ignoring unreadable Reflex state', expect.anything())
    await partial.dispose()

    await rm(join(data, 'models', `${fileOf('4b-q4_k_m')}.part`))
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
    expect(engine.snapshot().preparation).toMatchObject({ phase: 'failed', variant: Q9 })
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
    await expect(readFile(join(data, 'models', fileOf('9b-q8_0')))).rejects.toThrow()
    expect(await state(data)).toEqual({ models: {} })
    engine.prepare()
    await engine.remove()
    expect(engine.snapshot().preparation).toEqual({ phase: 'absent' })
  })

  it('self-tests each selected model, keeps per-model results, and maps runner failures for the provider', async () => {
    const { create, data, root } = await fixture()
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await until(engine, 'ready')
    engine.prepare({ variant: Q4 })
    await until(engine, 'testing')
    expect((await until(engine, 'ready')).preparation).toMatchObject({ variant: Q4 })
    expect(Object.keys((await state(data)).models as object).sort()).toEqual(['4b-q4_k_m', '9b-q8_0'])
    await writeFile(join(root, 'llama-server'), '#!/bin/sh\nexit 4\n')
    await engine.dispose()
    const broken = create()
    broken.activate()
    expect((await until(broken, 'ready')).preparation).toMatchObject({ variant: variantOf('4b-q4_k_m') })
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
    expect(await state(data)).toMatchObject({ preparing: { variant: Q9 } })
    expect(() => { engine.prepare() }).toThrow('disposed')
    await expect(engine.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport' } })
    const relaunched = create()
    relaunched.activate()
    await vi.waitFor(() => { expect(relaunched.snapshot().preparation.phase).toBe('downloading') })
  })

  it('uses an explicit model origin and logs a failed automatic enable while staying ready', async () => {
    const server = await weightsServer(files)
    const { create, warn, routing } = await fixture({ origin: server.origin, config: { modelOrigin: server.origin } })
    const refused = new Error('profile is overridden')
    routing.routing.edit = async () => { throw refused }
    const engine = create()
    expect(engine.snapshot().downloadSources).toEqual([server.origin])
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    await until(engine, 'ready')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex automatic enable failed', refused) })
    expect(engine.snapshot()).toMatchObject({ enabled: false, preparation: { phase: 'ready' } })
  })

  it('refuses decisions while enabled but not ready, and stops inspection on disposal', async () => {
    const { create, data, warn, routing } = await fixture({ jev: { defaultProviderId: 'reflex-local' } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    await expect(engine.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex engine is not ready' } })
    await mkdir(join(data, 'models'), { recursive: true })
    await writeFile(join(data, 'models', fileOf('9b-q8_0')), weights['9b-q8_0'])
    const disposed = create()
    disposed.activate()
    await disposed.dispose()
    expect(warn).not.toHaveBeenCalledWith('Reflex engine inspection failed', expect.anything())
    routing.routing.entries = () => []
    await expect(engine.disable()).rejects.toThrow('requires an enabled')
  })
})
