/** Preparation state machine with a real subprocess provider, loopback weights server, and protocol runner fixture. */
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { JevProviderError } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { inspectDevice } from '../src/device.ts'
import { JEV_ENTRY_ID, ReflexEngine, ReflexLifecycleError, type RoutingEditor, type RoutingEntry } from '../src/engine.ts'
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
const writes = vi.hoisted(() => ({ fail: undefined as RegExp | undefined }))
vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...actual, writeFileAtomic: async (...args: Parameters<typeof actual.writeFileAtomic>) => {
    if (typeof args[1] === 'string' && writes.fail?.test(args[1]) === true) throw new Error('state volume full')
    await actual.writeFileAtomic(...args)
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

const noDrain = async (): Promise<void> => {}

interface Options {
  /** Stand-in for the provider's request queue. */
  drain?: () => Promise<void>
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
  const markers = { crash: join(root, 'crash'), startFail: join(root, 'start-fail'), delay: join(root, 'delay') }
  const runner = await fakeRunner(root, { FAKE_CRASH_FILE: markers.crash, FAKE_START_FAIL_FILE: markers.startFail,
    FAKE_DELAY_FILE: markers.delay, ...options.env })
  const server = options.origin === undefined ? await weightsServer(files) : undefined
  const origin = options.origin ?? server!.origin
  vi.mocked(inspectDevice).mockReturnValue({ supported: true, memoryBytes: options.memory ?? 24 * GIB })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  const warn = vi.spyOn(ctx.logger, 'warn')
  const config = Config({ dataRoot: join(root, 'data'), runnerPath: runner.path, modelOrigins: [origin], diskMarginBytes: 0,
    minPrefillTokensPerSecond: 100, startupTimeoutMs: 10_000, graceMs: 500, progressIntervalMs: 1, ...options.config })
  const routing = editor(options.jev === undefined ? {} : options.jev)
  const create = (): ReflexEngine => {
    const engine = new ReflexEngine(ctx, config, routing.routing, options.drain ?? noDrain)
    onTestFinished(async () => { await engine.dispose() })
    return engine
  }
  const mark = async (name: keyof typeof markers, on = true): Promise<void> => {
    if (on) await writeFile(markers[name], '')
    else await rm(markers[name], { force: true })
  }
  return { root, data: join(root, 'data'), origin, server, runner, ctx, warn, config, create, routing, mark }
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

async function untilSnapshot(engine: ReflexEngine, accept: (snapshot: ReflexSnapshot) => boolean): Promise<ReflexSnapshot> {
  const abort = new AbortController()
  try {
    for await (const snapshot of engine.follow(abort.signal)) if (accept(snapshot)) return snapshot
  } finally { abort.abort() }
  throw new Error('engine disposed')
}

/** Activate, then prepare the first model and wait until it is active, tested, and enabled. */
async function ready(engine: ReflexEngine, variant = Q9): Promise<void> {
  engine.activate()
  await until(engine, 'absent')
  engine.select(variant)
  await untilSnapshot(engine, snapshot => snapshot.enabled && snapshot.preparation.phase === 'ready')
}

const decide = async (engine: ReflexEngine): Promise<void> => {
  await (await engine.acquire(new AbortController().signal)).complete('decision', new AbortController().signal)
}

async function state(data: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(data, 'state.json'), 'utf8')) as Record<string, unknown>
}

describe.skipIf(process.platform === 'win32')('ReflexEngine', () => {
  it('fails loud without the configuration editor or an enabled jev entry', async () => {
    const { ctx, config } = await fixture()
    expect(() => new ReflexEngine(ctx, config, undefined, noDrain)).toThrow('config-editor')
    expect(() => new ReflexEngine(ctx, config, editor(null).routing, noDrain)).toThrow('requires an enabled')
    const disabled: RoutingEditor = { entries: () => [{ options: { id: JEV_ENTRY_ID, disabled: true } }], edit: async () => {} }
    expect(() => new ReflexEngine(ctx, config, disabled, noDrain)).toThrow('requires an enabled')
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
    engine.routingChanged()
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
      minMemoryBytes: 8 * GIB, experimental: false, fits: true, inventory: { state: 'absent' } })
    const small = await fixture({ memory: 12 * GIB, config: { diskMarginBytes: Number.MAX_SAFE_INTEGER } })
    const tight = small.create()
    tight.activate()
    const absent = await until(tight, 'absent')
    expect(absent.options.map(option => option.reason)).toEqual(['disk', 'memory', 'memory', 'memory', 'memory', 'memory'])
    expect(absent.recommended).toEqual(Q4)
    const refusal = (() => { try { tight.prepare({ variant: Q9 }) } catch (error) { return error } })()
    expect(refusal).toBeInstanceOf(ReflexLifecycleError)
    expect(refusal).toMatchObject({ code: 'unfit', details: { variant: Q9, requiredBytes: 24 * GIB, deviceBytes: 12 * GIB } })
    // Consent relaxes only the memory tier; the download still needs the free space.
    tight.prepare({ variant: Q9, allowUnfit: true })
    expect((await until(tight, 'failed')).preparation).toMatchObject({ variant: Q9, failure: { kind: 'disk' } })
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
    // Disabling keeps routing on this provider; only the automatic enable edited the profile.
    expect(routing.edits).toEqual([{ providerId: 'system-one', enabled: true, defaultProviderId: 'reflex-local' }])
    expect(restored.snapshot()).toMatchObject({ enabled: false, localChosen: true })
    expect(restored.ready()).toBe(false)
    await restored.disable()
    expect(routing.edits).toHaveLength(1)
    await expect(restored.acquire(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex engine is not enabled' } })
  })

  it('reports the Jev master switch and reads routing set elsewhere as enabled in state from before local enablement existed', async () => {
    const { create } = await fixture({ jev: { enabled: false, defaultProviderId: 'reflex-local' } })
    const master = create()
    expect(master.snapshot()).toMatchObject({ enabled: false, reflexEnabled: false })
    master.activate()
    expect(await until(master, 'absent')).toMatchObject({ enabled: true, reflexEnabled: false, localChosen: true })
    const other = await fixture({ jev: { providerId: 'reflex-local' } })
    const builtin = other.create()
    builtin.activate()
    expect(await until(builtin, 'absent')).toMatchObject({ enabled: true, reflexEnabled: true })
    const plain: RoutingEditor = { entries: () => [{ options: { id: JEV_ENTRY_ID } }], edit: async () => {} }
    const bare = await fixture()
    expect(new ReflexEngine(bare.ctx, bare.config, plain, noDrain).snapshot()).toMatchObject({ enabled: false, reflexEnabled: true })
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
    expect(() => { engine.prepare({ variant: Q9 }) }).toThrow('more memory')
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

  it('keeps a variant paused before its first byte resumable across restarts until cancelled', async () => {
    let requests = 0
    // The origin never answers, so no byte arrives.
    const origin = await serve(() => { requests++ })
    const { create, data } = await fixture({ origin, memory: 8 * GIB })
    const inventory = (snapshot: ReflexSnapshot) => snapshot.options.find(option => option.model === '4b' && option.quant === 'q4_k_m')?.inventory
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.select(Q4)
    await vi.waitFor(() => { expect(requests).toBeGreaterThan(0) })
    await engine.pause()
    const empty = { phase: 'paused', variant: Q4, completedBytes: 0, totalBytes: weights['4b-q4_k_m'].length }
    expect(engine.snapshot().preparation).toEqual(empty)
    expect(inventory(engine.snapshot())).toEqual({ state: 'partial', completedBytes: 0 })
    await engine.dispose()
    const restarted = create()
    restarted.activate()
    expect((await until(restarted, 'paused')).preparation).toEqual(empty)
    restarted.prepare()
    await vi.waitFor(async () => { expect(await state(data)).toMatchObject({ preparing: { variant: Q4 } }) })
    await restarted.pause()
    await restarted.cancel()
    expect(restarted.snapshot().preparation).toEqual({ phase: 'absent' })
    expect(inventory(restarted.snapshot())).toEqual({ state: 'absent' })
    await expect(readFile(join(data, 'models', `${fileOf('4b-q4_k_m')}.part`))).rejects.toThrow()
  })

  it('pauses a self-test leaving the complete file untested and no partial file', async () => {
    const { create, data, mark } = await fixture()
    await mark('delay')
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.select(Q4)
    await until(engine, 'testing')
    await engine.pause()
    const bytes = weights['4b-q4_k_m'].length
    expect(engine.snapshot().preparation).toEqual({ phase: 'paused', variant: Q4, completedBytes: bytes, totalBytes: bytes })
    await expect(readFile(join(data, 'models', `${fileOf('4b-q4_k_m')}.part`))).rejects.toThrow()
  })

  it('rejects a variant or source change while work is active', async () => {
    const origin = await serve((request, response) => { if (request.method === 'HEAD') response.writeHead(200).end() })
    const other = await serve((request, response) => { if (request.method === 'HEAD') response.writeHead(200).end() })
    const { create } = await fixture({ origin, config: { modelOrigins: [origin, other] } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.prepare()
    const refusal = (() => { try { engine.select(Q4) } catch (error) { return error } })()
    expect(refusal).toBeInstanceOf(ReflexLifecycleError)
    expect(refusal).toMatchObject({ code: 'preparing-other', details: { preparing: Q9, requested: Q4 } })
    expect(() => { engine.prepare({ downloadSource: other }) }).toThrow('Cancel preparation')
    engine.select(Q9)
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

  it('removes weights during and after preparation, turning local decisions off without changing routing', async () => {
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
    expect(engine.snapshot()).toMatchObject({ preparation: { phase: 'absent' }, enabled: false, localChosen: true, runner: { state: 'stopped' } })
    await expect(readFile(join(data, 'models', fileOf('9b-q8_0')))).rejects.toThrow()
    expect(await state(data)).toEqual({ models: {}, localChosen: true, localEnabled: false })
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
    await expect(engine.chooseLocal()).rejects.toThrow('requires an enabled')
  })
})

describe.skipIf(process.platform === 'win32')('ReflexEngine model lifecycle', () => {
  it('prepares another model in the background while the active one answers, then switches and records the switch', async () => {
    const release = Promise.withResolvers<undefined>()
    const origin = await serve((request, response) => {
      if (request.method === 'HEAD') { response.writeHead(200).end(); return }
      const name = (request.url ?? '').split('/').at(-1) as string
      const bytes = files[name] as Buffer
      if (name === fileOf('4b-q4_k_m')) void release.promise.then(() => { response.writeHead(200).end(bytes) })
      else response.writeHead(200).end(bytes)
    })
    const { create, runner } = await fixture({ origin })
    const engine = create()
    await ready(engine)
    engine.select(Q4)
    await vi.waitFor(() => { expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', variant: Q4 }) })
    expect(engine.snapshot()).toMatchObject({ active: Q9, enabled: true })
    await decide(engine)
    const served = (await runnerLog(runner.log)).filter(entry => entry.event === 'completion').at(-1)
    expect(served?.model).toContain(fileOf('9b-q8_0'))
    expect(engine.snapshot().runner).toMatchObject({ state: 'running', model: Q9, approxResidentBytes: weights['9b-q8_0'].length })
    engine.select(Q4)
    release.resolve(undefined)
    const switched = await untilSnapshot(engine, snapshot => snapshot.active?.model === '4b')
    expect(switched.unacknowledgedSwitch).toMatchObject({ from: Q9, to: Q4 })
    expect(switched.options.find(option => option.model === '4b' && option.quant === 'q4_k_m')?.inventory)
      .toEqual({ state: 'downloaded', selfTest: 'passed' })
    await vi.waitFor(() => { expect(engine.snapshot().runner).toMatchObject({ state: 'running', model: Q4 }) })
    await decide(engine)
    expect((await runnerLog(runner.log)).filter(entry => entry.event === 'completion').at(-1)?.model).toContain(fileOf('4b-q4_k_m'))
    await engine.acknowledgeSwitch()
    expect(engine.snapshot().unacknowledgedSwitch).toBeUndefined()
    engine.select(Q9)
    await vi.waitFor(() => { expect(engine.snapshot()).toMatchObject({ active: Q9, preparation: { phase: 'ready', variant: Q9 } }) })
    expect(engine.snapshot().unacknowledgedSwitch).toBeUndefined()
    await vi.waitFor(() => { expect(engine.snapshot().runner).toMatchObject({ state: 'running', model: Q9 }) })
    engine.select(Q9)
  })

  it('PROBE undoes a background switch at once through select and acknowledgeSwitch', async () => {
    const { create, data } = await fixture()
    const engine = create()
    await ready(engine, variantOf('4b-q8_0'))
    await writeFile(join(data, 'models', fileOf('9b-q8_0')), weights['9b-q8_0'])
    engine.prepare({ variant: Q9 })
    const switched = await untilSnapshot(engine, snapshot => snapshot.unacknowledgedSwitch !== undefined)
    expect(switched.active).toEqual(Q9)
    void engine.acknowledgeSwitch()
    engine.select(switched.unacknowledgedSwitch!.from)
    expect(engine.snapshot().active).toEqual(variantOf('4b-q8_0'))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(engine.snapshot().active).toEqual(variantOf('4b-q8_0'))
  })

  it('finishes the decision in flight on the old runner before stopping it for a switch', async () => {
    const inFlight: Array<Promise<unknown>> = []
    const { create, mark } = await fixture({ drain: async () => { await Promise.allSettled(inFlight) } })
    const engine = create()
    await ready(engine, Q4)
    engine.select(Q9)
    await untilSnapshot(engine, snapshot => snapshot.active?.model === '9b')
    engine.select(Q4)
    await vi.waitFor(() => { expect(engine.snapshot().runner).toMatchObject({ state: 'running', model: Q4 }) })
    await mark('delay')
    const client = await engine.acquire(new AbortController().signal)
    const pending = client.complete('slow decision', new AbortController().signal)
    inFlight.push(pending)
    engine.select(Q9)
    expect(engine.snapshot().active).toEqual(Q9)
    await expect(pending).resolves.toMatchObject({ promptTokens: 13 })
    await vi.waitFor(() => { expect(engine.snapshot().runner).toMatchObject({ state: 'running', model: Q9 }) })
  })

  it('keeps the active model when a background model is slow, and switches when it is selected again', async () => {
    const { create } = await fixture({ env: { FAKE_SLOW_MODEL: fileOf('4b-q4_k_m') } })
    const engine = create()
    await ready(engine)
    engine.select(Q4)
    const slow = await untilSnapshot(engine, snapshot => snapshot.preparation.phase === 'ready'
      && snapshot.options.some(option => option.model === '4b' && option.quant === 'q4_k_m' && option.inventory.selfTest === 'slow'))
    expect(slow).toMatchObject({ active: Q9, preparation: { phase: 'ready', variant: Q9 } })
    expect(slow.unacknowledgedSwitch).toBeUndefined()
    engine.select(Q4)
    await vi.waitFor(() => { expect(engine.snapshot()).toMatchObject({ active: Q4, preparation: { phase: 'ready', variant: Q4, selfTest: { slow: true } } }) })
    expect(engine.snapshot().unacknowledgedSwitch).toBeUndefined()
  })

  it('makes a slow first model active without enabling it', async () => {
    const { create } = await fixture({ env: { FAKE_SLOW_MODEL: fileOf('9b-q8_0') } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.select(Q9)
    const ready = await untilSnapshot(engine, snapshot => snapshot.preparation.phase === 'ready')
    expect(ready).toMatchObject({ active: Q9, enabled: false, runner: { state: 'stopped' } })
  })

  it('records a failed self-test in the inventory and retests on the next selection', async () => {
    const { create } = await fixture({ env: { FAKE_MODE: 'wrong' } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    engine.select(Q9)
    const failed = await until(engine, 'failed')
    expect(failed.options.find(option => option.model === '9b' && option.quant === 'q8_0')?.inventory).toEqual({ state: 'downloaded', selfTest: 'failed' })
    expect(failed.active).toBeUndefined()
    engine.select(Q9)
    await until(engine, 'testing')
  })

  it('stops the runner on disable while keeping models, and starts it before routing on enable', async () => {
    const { create } = await fixture()
    const engine = create()
    await ready(engine)
    await decide(engine)
    expect(engine.snapshot().runner.state).toBe('running')
    await engine.disable()
    expect(engine.snapshot()).toMatchObject({ enabled: false, active: Q9, runner: { state: 'stopped' } })
    await engine.enable()
    expect(engine.snapshot()).toMatchObject({ enabled: true, runner: { state: 'running', model: Q9 } })
    await decide(engine)
  })

  it('starts the runner of an enabled active model at activation, and on enable once Reflex is on', async () => {
    const { create, routing } = await fixture({ config: { routingPollMs: 10 } })
    const first = create()
    await ready(first)
    await first.dispose()
    const launched = create()
    launched.activate()
    const warm = await untilSnapshot(launched, snapshot => snapshot.runner.state === 'running')
    expect(warm.runner).toEqual({ state: 'running', model: Q9, approxResidentBytes: weights['9b-q8_0'].length })
    await launched.disable()
    await launched.dispose()
    const disabled = create()
    disabled.activate()
    await until(disabled, 'ready')
    expect(disabled.snapshot()).toMatchObject({ enabled: false, runner: { state: 'stopped' } })
    const jev = routing.routing.entries()[0]!.options as { config?: unknown }
    jev.config = { ...jev.config as object, enabled: false }
    await untilSnapshot(disabled, snapshot => !snapshot.reflexEnabled)
    await disabled.enable()
    expect(disabled.snapshot()).toMatchObject({ enabled: true, reflexEnabled: false, runner: { state: 'stopped' } })
    jev.config = { ...jev.config as object, enabled: true }
    await untilSnapshot(disabled, snapshot => snapshot.runner.state === 'running')
  })

  it('reports a runner that cannot start on enable and leaves routing off', async () => {
    const { create, mark } = await fixture()
    const engine = create()
    await ready(engine)
    await engine.disable()
    await mark('startFail')
    await expect(engine.enable()).rejects.toThrow('exited before readiness')
    expect(engine.snapshot()).toMatchObject({ enabled: false, runner: { state: 'failed' } })
    await mark('startFail', false)
    await engine.enable()
    expect(engine.snapshot()).toMatchObject({ enabled: true, runner: { state: 'running' } })
  })

  it('publishes external routing changes and stops the runner when Reflex or local routing is turned off elsewhere', async () => {
    const { create, routing } = await fixture({ config: { routingPollMs: 10 } })
    const engine = create()
    await ready(engine)
    await decide(engine)
    const jev = routing.routing.entries()[0]!.options as { config?: unknown }
    jev.config = { ...jev.config as object, enabled: false }
    await untilSnapshot(engine, snapshot => !snapshot.reflexEnabled && snapshot.runner.state === 'stopped')
    jev.config = { ...jev.config as object, enabled: true }
    // The poll alone restarts the resident runner once Reflex is back on, before any decision.
    await untilSnapshot(engine, snapshot => snapshot.reflexEnabled && snapshot.runner.state === 'running')
    await decide(engine)
    // A default provider removed elsewhere is restored while the local mode is chosen, so Jev never uses its built-in one.
    jev.config = { enabled: true }
    await vi.waitFor(() => { expect(jev.config).toMatchObject({ defaultProviderId: 'reflex-local' }) })
    expect(engine.snapshot()).toMatchObject({ enabled: true, localChosen: true })
    jev.config = { enabled: true, defaultProviderId: 'system-one' }
    await untilSnapshot(engine, snapshot => !snapshot.enabled && !snapshot.localChosen && snapshot.runner.state === 'stopped')
  })

  it('reacts to an announced routing change at once and ignores announcements before inspection publishes', async () => {
    const { create, routing, data } = await fixture({ config: { routingPollMs: 600_000 } })
    const early = create()
    early.routingChanged()
    expect(early.snapshot().preparation.phase).toBe('checking')
    await early.dispose()
    await expect(readFile(join(data, 'state.json'))).rejects.toThrow()
    const engine = create()
    await ready(engine)
    const jev = routing.routing.entries()[0]!.options as { config?: unknown }
    jev.config = { ...jev.config as object, enabled: false }
    engine.routingChanged()
    await untilSnapshot(engine, snapshot => !snapshot.reflexEnabled && snapshot.runner.state === 'stopped')
    jev.config = { ...jev.config as object, enabled: true }
    engine.routingChanged()
    await untilSnapshot(engine, snapshot => snapshot.reflexEnabled && snapshot.runner.state === 'running')
  })

  it('logs a failed runner stop after an external change', async () => {
    const { create, routing, warn } = await fixture({ config: { routingPollMs: 10 }, drain: async () => { throw new Error('drain failed') } })
    const engine = create()
    await ready(engine)
    await decide(engine)
    const jev = routing.routing.entries()[0]!.options as { config?: unknown }
    jev.config = { enabled: false }
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex runner stop failed', expect.objectContaining({ message: 'drain failed' })) })
  })

  it('deletes inactive, active, and in-progress models, turning local decisions off without changing routing', async () => {
    const hold = await serve((request, response) => { if (request.method === 'HEAD') response.writeHead(200).end() })
    const { create, data, server, routing } = await fixture()
    const engine = create()
    await ready(engine, Q4)
    engine.select(Q9)
    await untilSnapshot(engine, snapshot => snapshot.active?.model === '9b')
    await engine.deleteModel(Q4)
    await expect(readFile(join(data, 'models', fileOf('4b-q4_k_m')))).rejects.toThrow()
    expect(engine.snapshot()).toMatchObject({ active: Q9, enabled: true })
    await engine.deleteModel(Q9)
    const deleted = engine.snapshot()
    expect(deleted).toMatchObject({ enabled: false, localChosen: true, runner: { state: 'stopped' }, preparation: { phase: 'absent' } })
    expect(routing.routing.entries()[0]!.options.config).toMatchObject({ defaultProviderId: 'reflex-local' })
    expect(engine.ready()).toBe(false)
    expect(deleted.active).toBeUndefined()
    expect(deleted.unacknowledgedSwitch).toBeUndefined()
    expect(deleted.options.find(option => option.model === '9b' && option.quant === 'q8_0')?.inventory).toEqual({ state: 'absent' })
    await expect(decide(engine)).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex engine is not enabled' } })
    expect(server!.ranges.length).toBeGreaterThan(0)
    void hold
    engine.select(Q4)
    const reprepared = await untilSnapshot(engine, snapshot => snapshot.active?.model === '4b' && snapshot.preparation.phase === 'ready'
      && snapshot.enabled && snapshot.runner.state === 'running')
    expect(reprepared).toMatchObject({ enabled: true, runner: { state: 'running', model: Q4 } })
    // Local decisions were off after the deletion, so the next passing model turns them on with the usual notice.
    expect(reprepared.unacknowledgedAutoEnableAt).toBeGreaterThan(0)
    await engine.disable()
    await engine.deleteModel(Q4)
    expect(engine.snapshot().active).toBeUndefined()
    expect(engine.snapshot().enabled).toBe(false)
    await engine.deleteModel()
    expect(engine.snapshot().preparation).toEqual({ phase: 'absent' })
  })

  it('deletes a model that is being prepared by cancelling its preparation', async () => {
    const origin = await serve((request, response) => {
      if (request.method === 'HEAD') { response.writeHead(200).end(); return }
      const name = (request.url ?? '').split('/').at(-1) as string
      if (name === fileOf('4b-q4_k_m')) { response.writeHead(200); response.write((files[name] as Buffer).subarray(0, 50)); return }
      response.writeHead(200).end(files[name])
    })
    const { create, data } = await fixture({ origin })
    const engine = create()
    await ready(engine)
    engine.select(Q4)
    await vi.waitFor(() => { expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', variant: Q4 }) })
    await engine.deleteModel(variantOf('35b-a3b-q8_0'))
    expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', variant: Q4 })
    await engine.deleteModel(Q4)
    await expect(readFile(join(data, 'models', `${fileOf('4b-q4_k_m')}.part`))).rejects.toThrow()
    expect(engine.snapshot()).toMatchObject({ active: Q9, preparation: { phase: 'ready', variant: Q9 } })
    engine.select(Q4)
    await vi.waitFor(() => { expect(engine.snapshot().preparation).toMatchObject({ phase: 'downloading', variant: Q4, completedBytes: 50 }) })
    await engine.pause()
    expect(engine.snapshot().preparation).toMatchObject({ phase: 'ready', variant: Q9 })
    expect(engine.snapshot().options.find(option => option.model === '4b' && option.quant === 'q4_k_m')?.inventory)
      .toEqual({ state: 'partial', completedBytes: 50 })
  })

  it('prepares an unfit model only with consent, and keeps the active model serving when its runner cannot load', async () => {
    const { create, mark } = await fixture({ memory: 16 * GIB, config: { maxConsecutiveRunnerFailures: 1 } })
    const engine = create()
    await ready(engine, Q4)
    await decide(engine)
    expect(() => { engine.select(Q9) }).toThrow(ReflexLifecycleError)
    expect(engine.snapshot().preparation).toMatchObject({ phase: 'ready', variant: Q4 })
    await mark('startFail')
    engine.select(Q9, { allowUnfit: true })
    const failed = await untilSnapshot(engine, snapshot => snapshot.preparation.phase === 'failed')
    expect(failed.preparation).toMatchObject({ variant: Q9, failure: { kind: 'runner' } })
    expect(JSON.stringify(failed.preparation)).toContain('exited before readiness')
    expect(failed).toMatchObject({ active: Q4, enabled: true, runner: { state: 'running', model: Q4 } })
    await decide(engine)
    expect(engine.snapshot()).toMatchObject({ enabled: true, runner: { state: 'running', model: Q4 } })
    engine.select(Q4)
    expect(engine.snapshot().active).toEqual(Q4)
  })

  it('keeps the active model when another model fails to download, and clears that failure on cancel', async () => {
    const origin = await serve((request, response) => {
      const name = (request.url ?? '').split('/').at(-1) as string
      if (name === fileOf('4b-q4_k_m')) { response.writeHead(404).end(); return }
      response.writeHead(200).end(request.method === 'HEAD' ? undefined : files[name])
    })
    const { create } = await fixture({ origin })
    const engine = create()
    await ready(engine)
    engine.select(Q4)
    expect((await until(engine, 'failed')).preparation).toMatchObject({ variant: Q4, failure: { kind: 'download' } })
    expect(engine.snapshot()).toMatchObject({ active: Q9, enabled: true })
    await decide(engine)
    await engine.cancel()
    expect(engine.snapshot().preparation).toMatchObject({ phase: 'ready', variant: Q9 })
  })

  it('keeps the local connection mode across disable, deletion, and restarts until routing names another provider', async () => {
    const { create, routing, data } = await fixture({ config: { routingPollMs: 10 }, jev: { defaultProviderId: 'system-one' } })
    const jev = routing.routing.entries()[0]!.options as { config?: Record<string, unknown> }
    const engine = create()
    engine.activate()
    expect((await until(engine, 'absent')).localChosen).toBe(false)
    await engine.chooseLocal()
    expect(jev.config).toEqual({ defaultProviderId: 'reflex-local' })
    expect(engine.snapshot()).toMatchObject({ localChosen: true, enabled: false })
    expect(engine.ready()).toBe(false)
    await engine.chooseLocal()
    engine.select(Q9)
    await untilSnapshot(engine, snapshot => snapshot.enabled && snapshot.preparation.phase === 'ready')
    await engine.disable()
    await engine.deleteModel(Q9)
    expect(engine.snapshot()).toMatchObject({ localChosen: true, enabled: false })
    await engine.dispose()
    const restarted = create()
    restarted.activate()
    expect((await until(restarted, 'absent')).localChosen).toBe(true)
    jev.config = { defaultProviderId: 'system-one' }
    await untilSnapshot(restarted, snapshot => !snapshot.localChosen)
    await vi.waitFor(async () => { expect(await state(data)).not.toHaveProperty('localChosen') })
    restarted.select(Q4)
    expect(jev.config).toEqual({ defaultProviderId: 'reflex-local' })
    await untilSnapshot(restarted, snapshot => snapshot.localChosen && snapshot.enabled && snapshot.active?.model === '4b')
  })

  it('records the local connection mode for routing enabled before the mode existed, and clears it for other routing at launch', async () => {
    const { create, routing } = await fixture({ jev: { defaultProviderId: 'reflex-local' } })
    const engine = create()
    engine.activate()
    expect((await until(engine, 'absent')).localChosen).toBe(true)
    await engine.dispose()
    const jev = routing.routing.entries()[0]!.options as { config?: Record<string, unknown> }
    jev.config = { defaultProviderId: 'cloud' }
    const other = create()
    other.activate()
    expect((await until(other, 'absent')).localChosen).toBe(false)
  })

  it('restores local routing at launch only for a chosen local mode, reading the removed routing as off', async () => {
    const chosen = await fixture({ jev: {} })
    await mkdir(chosen.data, { recursive: true })
    await writeFile(join(chosen.data, 'state.json'), JSON.stringify({ models: {}, localChosen: true }))
    const restored = chosen.create()
    restored.activate()
    expect(await until(restored, 'absent')).toMatchObject({ localChosen: true, enabled: false })
    expect(chosen.routing.edits).toEqual([{ defaultProviderId: 'reflex-local' }])
    expect(await state(chosen.data)).toMatchObject({ localChosen: true, localEnabled: false })
    const never = await fixture({ jev: {} })
    const untouched = never.create()
    untouched.activate()
    expect(await until(untouched, 'absent')).toMatchObject({ localChosen: false, enabled: false })
    expect(never.routing.edits).toEqual([])
    const locked = await fixture({ jev: {} })
    locked.routing.routing.edit = async () => { throw new Error('profile locked') }
    await mkdir(locked.data, { recursive: true })
    await writeFile(join(locked.data, 'state.json'), JSON.stringify({ models: {}, localChosen: true }))
    const failing = locked.create()
    failing.activate()
    await until(failing, 'absent')
    expect(locked.warn).toHaveBeenCalledWith('Reflex local routing restore failed', expect.objectContaining({ message: 'profile locked' }))
  })

  it('does not count a runner that a switch retired while it started, nor a warm-up, and reports a failed enable as not ready', async () => {
    const { create, routing, mark, warn } = await fixture({ config: { routingPollMs: 600_000, maxConsecutiveRunnerFailures: 1 } })
    const engine = create()
    await ready(engine, Q4)
    engine.select(Q9)
    await untilSnapshot(engine, snapshot => snapshot.active?.model === '9b' && snapshot.runner.state === 'running')
    engine.select(Q4)
    await untilSnapshot(engine, snapshot => snapshot.active?.model === '4b' && snapshot.runner.state === 'running')
    const jev = routing.routing.entries()[0]!.options as { config?: unknown }
    const master = async (enabled: boolean): Promise<void> => {
      jev.config = { ...jev.config as object, enabled }
      engine.routingChanged()
      if (!enabled) await untilSnapshot(engine, snapshot => snapshot.runner.state === 'stopped')
    }
    await master(false)
    await master(true)
    // The decision joins the starting warm-up; the switch retires that runner before it answers.
    const pending = decide(engine)
    engine.select(Q9)
    await expect(pending).rejects.toMatchObject({ failure: { code: 'transport', message: 'local Reflex runner is unavailable' } })
    expect(engine.snapshot()).toMatchObject({ enabled: true, active: Q9 })
    expect(engine.ready()).toBe(true)
    await untilSnapshot(engine, snapshot => snapshot.runner.state === 'running')
    await master(false)
    await mark('startFail')
    await master(true)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex runner warm-up failed', expect.anything()) })
    expect(engine.ready()).toBe(true)
    await expect(engine.enable()).rejects.toThrow('exited before readiness')
    // Local decisions stay on, but the failed runner makes the provider report that it cannot answer.
    expect(engine.snapshot()).toMatchObject({ enabled: true, runner: { state: 'failed' } })
    expect(engine.ready()).toBe(false)
    expect(warn).not.toHaveBeenCalledWith('Reflex runner failed repeatedly; local decisions are turned off', expect.anything())
  })

  it('reports a state write that fails while adopting a tested model', async () => {
    const { create, warn } = await fixture()
    const engine = create()
    await ready(engine, Q4)
    writes.fail = /"active":\{"model":"9b"/
    onTestFinished(() => { writes.fail = undefined })
    engine.select(Q9)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex model adoption failed', expect.objectContaining({ message: 'state volume full' })) })
  })

  it('logs connection mode updates that fail', async () => {
    const { create, routing, warn, data } = await fixture({ config: { routingPollMs: 10 }, jev: { defaultProviderId: 'system-one' } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    const edit = routing.routing.edit.bind(routing.routing)
    routing.routing.edit = async () => { throw new Error('profile locked') }
    engine.select(Q4)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex connection mode update failed', expect.objectContaining({ message: 'profile locked' })) })
    await engine.cancel()
    routing.routing.edit = edit
    await engine.chooseLocal()
    await rm(join(data, 'state.json'))
    await mkdir(join(data, 'state.json'))
    const jev = routing.routing.entries()[0]!.options as { config?: Record<string, unknown> }
    jev.config = { defaultProviderId: 'system-one' }
    await vi.waitFor(() => {
      expect(warn.mock.calls.filter(([message]) => message === 'Reflex connection mode update failed')).toHaveLength(2)
    })
  })

  it('reports a full-size file without a record as downloaded and prepares it without downloading', async () => {
    const { create, data, server } = await fixture()
    await mkdir(join(data, 'models'), { recursive: true })
    await writeFile(join(data, 'models', fileOf('4b-q4_k_m')), weights['4b-q4_k_m'])
    await writeFile(join(data, 'models', fileOf('9b-q8_0')), weights['9b-q8_0'])
    await writeFile(join(data, 'models', fileOf('4b-q8_0')), weights['4b-q8_0'].subarray(1))
    const engine = create()
    engine.activate()
    const inspected = await until(engine, 'paused')
    const inventory = (key: VariantKey) => inspected.options.find(option => `${option.model}-${option.quant}` === key)?.inventory
    expect(inventory('4b-q4_k_m')).toEqual({ state: 'downloaded' })
    expect(inventory('9b-q8_0')).toEqual({ state: 'downloaded' })
    expect(inventory('4b-q8_0')).toEqual({ state: 'partial', completedBytes: weights['4b-q8_0'].length - 1 })
    engine.select(Q9)
    await untilSnapshot(engine, snapshot => snapshot.active?.model === '9b')
    expect(server!.ranges).toEqual([])
  })

  it('reports running state with the idle release time', async () => {
    const { create } = await fixture({ config: { idleReleaseMs: 60_000 } })
    const engine = create()
    await ready(engine)
    const before = Date.now()
    await decide(engine)
    const status = engine.snapshot().runner
    expect(status).toMatchObject({ state: 'running', model: Q9 })
    expect(status.state === 'running' ? status.idleReleaseAt : 0).toBeGreaterThanOrEqual(before + 60_000)
  })

  it('turns local decisions off after consecutive runner failures and recovers on enable', async () => {
    const { create, mark, warn } = await fixture({ config: { maxConsecutiveRunnerFailures: 2 } })
    const engine = create()
    await ready(engine)
    await decide(engine)
    await mark('crash')
    await expect(decide(engine)).rejects.toMatchObject({ failure: { code: 'transport' } })
    await untilSnapshot(engine, snapshot => snapshot.runner.state === 'stopped' && snapshot.enabled)
    await mark('crash', false)
    const aborted = new AbortController()
    aborted.abort(new Error('caller left'))
    await expect((await engine.acquire(new AbortController().signal)).complete('x', aborted.signal)).rejects.toThrow('caller left')
    await decide(engine)
    await mark('crash')
    await expect(decide(engine)).rejects.toMatchObject({ failure: { code: 'transport' } })
    await mark('crash', false)
    await mark('startFail')
    await expect(decide(engine)).rejects.toMatchObject({ failure: { message: 'local Reflex runner is unavailable' } })
    const failed = await untilSnapshot(engine, snapshot => snapshot.runner.state === 'failed' && !snapshot.enabled)
    expect(failed.runner.state === 'failed' ? failed.runner.reason : '').toContain('exited before readiness')
    expect(warn).toHaveBeenCalledWith('Reflex runner failed repeatedly; local decisions are turned off', expect.anything())
    await mark('startFail', false)
    await engine.enable()
    expect(engine.snapshot().runner.state).toBe('running')
    await decide(engine)
  })

  it('logs disable and warm-up failures around runner failures and immediate switches', async () => {
    const { create, mark, warn, root, data } = await fixture({ config: { maxConsecutiveRunnerFailures: 1 } })
    const engine = create()
    await ready(engine, Q4)
    engine.select(Q9)
    await vi.waitFor(async () => { expect((await state(data)).active).toEqual(Q9) })
    await rm(join(data, 'state.json'))
    await mkdir(join(data, 'state.json'))
    await mark('crash')
    await expect(decide(engine)).rejects.toMatchObject({ failure: { code: 'transport' } })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex disable after runner failures failed', expect.anything()) })
    await rm(join(data, 'state.json'), { recursive: true })
    await mark('crash', false)
    await engine.enable()
    await writeFile(join(root, 'llama-server'), '#!/bin/sh\nexit 4\n')
    engine.select(Q4)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex runner warm-up failed', expect.anything()) })
    await rm(join(data, 'state.json'))
    await mkdir(join(data, 'state.json'))
    engine.select(Q9)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Reflex model switch failed', expect.anything()) })
  })

  it('never activates a tested model without an active record, and drops an active model whose file is gone', async () => {
    const { create, data } = await fixture()
    const engine = create()
    await ready(engine, Q4)
    const { autoEnabledAt: _notice, active: _active, ...deleted } = await state(data)
    await engine.dispose()
    await writeFile(join(data, 'state.json'), JSON.stringify(deleted))
    const relaunched = create()
    relaunched.activate()
    const inactive = await until(relaunched, 'ready')
    expect(inactive.preparation).toMatchObject({ variant: Q4 })
    expect(inactive.active).toBeUndefined()
    relaunched.select(Q4)
    expect(relaunched.snapshot().active).toEqual(Q4)
    await relaunched.dispose()
    await rm(join(data, 'models', fileOf('4b-q4_k_m')))
    const gone = create()
    gone.activate()
    expect((await until(gone, 'absent')).active).toBeUndefined()
  })

  it('keeps the model 0.1.3 served active after an upgrade, on or off as that release routed it', async () => {
    for (const routedHere of [true, false]) {
      const { create, data, routing } = await fixture()
      const engine = create()
      await ready(engine, Q4)
      // 0.1.3 persisted only preparation, verified files with their self-tests, and the automatic-enable notice.
      const { models } = await state(data)
      await engine.dispose()
      await writeFile(join(data, 'state.json'), JSON.stringify({ models }))
      const jev = routing.routing.entries()[0]!.options as { config?: Record<string, unknown> }
      jev.config = routedHere ? { defaultProviderId: 'reflex-local' } : {}
      const upgraded = create()
      upgraded.activate()
      const snapshot = await until(upgraded, 'ready')
      expect(snapshot).toMatchObject({ active: Q4, enabled: routedHere, localChosen: routedHere })
      expect(await state(data)).toMatchObject({ active: Q4, localEnabled: routedHere })
      await upgraded.dispose()
    }
  })

  it('refuses a preparation without a recommendation and treats selecting the active model as done', async () => {
    const tiers = { '4b-q4_k_m': 64 * GIB, '4b-q8_0': 64 * GIB, '9b-q4_k_m': 64 * GIB, '9b-q8_0': 64 * GIB, '35b-a3b-q4_k_m': 8 * GIB, '35b-a3b-q8_0': 64 * GIB }
    const { create } = await fixture({ config: { minMemoryBytes: tiers } })
    const engine = create()
    engine.activate()
    await until(engine, 'absent')
    expect(engine.snapshot().recommended).toBeUndefined()
    expect(() => { engine.prepare() }).toThrow('does not fit')
  })
})
