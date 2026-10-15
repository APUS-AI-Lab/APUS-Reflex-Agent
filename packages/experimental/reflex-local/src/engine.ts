/** Preparation state machine, persisted choices, routing edits, and runner ownership of the local Reflex engine. */
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JevProviderError } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import type { Config } from './index.ts'
import { CANDIDATE_LABELS, renderPrompt } from './contract.ts'
import { inspectDevice } from './device.ts'
import {
  availableBytes, classifyFailure, downloadModel, fileInfo, matchesAsset, orderSources, partialBytes, partialPath,
  ReflexDiskError, ReflexDownloadError,
} from './download.ts'
import { modelOptions, readCatalog, recommend, variantKey, variantOf, VARIANT_KEYS, type CatalogAsset, type VariantKey } from './models.ts'
import { ReflexRunner, ReflexRunnerError, type ReflexRunnerClient } from './runner.ts'
import type {
  ReflexDeviceSupport, ReflexFailure, ReflexLocalService, ReflexModelOption, ReflexPreparation, ReflexPrepareOptions, ReflexSelfTest,
  ReflexSnapshot, ReflexVariant,
} from './types.ts'

/**
 * Profile id of the required Jev entry whose `defaultProviderId` routing edits. Matched by id because the Jev bundle names
 * its plugin by a package-relative module path that resolves to a file URL.
 */
export const JEV_ENTRY_ID = 'jev'
/** Registry id Jev selects when `defaultProviderId` and `providerId` are both unset. */
const JEV_BUILTIN_PROVIDER = 'system-one'

/** The model card's reference decision; the first candidate is the expected answer. */
const REFERENCE = {
  state: 'Order 731 was delivered. The customer confirms that the issue is resolved.',
  instructions: 'Select the next support action.',
  descriptions: ['Close the ticket as resolved.', 'Escalate to a human agent.', 'Issue a refund.'],
} as const

const variantSchema = z.object({ model: z.enum(['4b', '9b', '35b-a3b']), quant: z.enum(['q8_0', 'q4_k_m']) })
const stateSchema = z.object({
  /** Preparation that was running when the Host stopped; activation resumes it. */
  preparing: z.object({ variant: variantSchema, source: z.string().optional() }).optional(),
  /** Per variant key: fingerprint of the last hash-verified weights file and its self-test. */
  models: z.record(z.string(), z.object({
    sha256: z.string(), size: z.number(), mtimeMs: z.number(),
    selfTest: z.object({ prefillTokensPerSecond: z.number(), decisionMs: z.number(), slow: z.boolean() }).optional(),
  })),
  /** Epoch milliseconds of an automatic enablement no client has acknowledged. */
  autoEnabledAt: z.number().optional(),
})
type Persisted = z.infer<typeof stateSchema>
type ModelRecord = Persisted['models'][string]
const EMPTY_STATE: Persisted = { models: {} }

interface Task {
  readonly variant: ReflexVariant
  readonly source: string | undefined
  readonly abort: AbortController
  stop: 'pause' | 'cancel' | undefined
  settled: Promise<void>
}

/** A profile row as read by routing; Loader entries satisfy it. */
export interface RoutingEntry {
  readonly options: { readonly id: string; readonly config?: unknown; readonly disabled?: unknown }
}

/** The part of the configuration editor used to route Jev decisions; `ConfigEditor` satisfies it. */
export interface RoutingEditor {
  /** @returns active profile rows. */
  entries(): RoutingEntry[]
  /**
   * Persist and apply a plugin's next raw configuration.
   * @param entry - row returned by `entries()`.
   * @param change - derive the next raw configuration from the current one.
   */
  edit(entry: RoutingEntry, change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}

class SelfTestError extends Error {}

function same(left: ReflexVariant, right: ReflexVariant): boolean {
  return left.model === right.model && left.quant === right.quant
}

/**
 * Host-owned engine. Activation inspects the device and local files without downloading, except that it resumes a
 * preparation the previous Host left running. Page and transport lifetimes own none of its work.
 */
export class ReflexEngine implements ReflexLocalService {
  private readonly device: ReflexDeviceSupport
  private readonly assets: Record<VariantKey, CatalogAsset>
  private readonly editor: RoutingEditor
  /** Bytes of each variant on disk, complete or partial, at the last disk check. */
  private readonly present = new Map<VariantKey, number>()
  private readonly origins: readonly string[]
  private readonly downloadSources: readonly string[]
  private readonly directory: string
  private preparation: ReflexPreparation
  private persisted: Persisted = EMPTY_STATE
  private availableDisk: number | undefined
  private task: Task | undefined
  private runner: ReflexRunner | undefined
  private activation: Promise<void> = Promise.resolve()
  /** True from activation until inspection publishes; preparation is refused meanwhile so the two never publish concurrently. */
  private inspecting = false
  private writes: Promise<void> = Promise.resolve()
  /** Wake-ups of `follow()` iterators; they never throw. */
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()

  /**
   * @param ctx - Host context owning subprocesses and logging.
   * @param config - checked engine configuration.
   * @param editor - profile editor; required, and its profile must contain an enabled jev entry.
   */
  constructor(private readonly ctx: Context, private readonly config: Config, editor: RoutingEditor | undefined) {
    if (editor === undefined) throw new Error('reflex-local requires the config-editor plugin to route Jev decisions')
    this.editor = editor
    if (this.jevEntry() === undefined) {
      throw new Error(`reflex-local requires an enabled '${JEV_ENTRY_ID}' entry; enable the Jev bundle beside the reflex-local bundle`)
    }
    this.assets = readCatalog()
    this.device = inspectDevice(config)
    this.origins = config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]
    this.downloadSources = [...new Set(this.origins.map(origin => new URL(origin).origin))]
    this.directory = join(config.dataRoot, 'models')
    this.preparation = this.device.supported ? { phase: 'checking' } : { phase: 'unsupported' }
  }

  /** Inspect state and weights once after construction; a supported device then leaves `checking`. */
  activate(): void {
    if (!this.device.supported) return
    this.inspecting = true
    this.activation = this.inspect().catch((error: unknown) => {
      if (this.lifetime.signal.aborted) return
      this.ctx.logger.warn('Reflex engine inspection failed', error)
      this.publish({ phase: 'failed', failure: this.failureOf(error) })
    }).finally(() => { this.inspecting = false })
  }

  private async inspect(): Promise<void> {
    this.persisted = await this.readState()
    await this.measureDisk()
    const { preparing } = this.persisted
    if (preparing !== undefined && this.offers(preparing.variant)
      && (preparing.source === undefined || this.downloadSources.includes(preparing.source))) {
      this.start(preparing.variant, preparing.source)
      return
    }
    // Tested variants first, then every other variant this Host can run, smallest first.
    const tested = VARIANT_KEYS.filter(key => this.persisted.models[key]?.selfTest !== undefined)
    const candidates = [...new Set([...tested, ...VARIANT_KEYS])].map(variantOf).filter(variant => this.offers(variant))
    for (const variant of candidates) {
      if (await this.verified(variant, this.lifetime.signal)) { this.publish(await this.resting(variant)); return }
    }
    for (const variant of candidates) {
      const resting = await this.resting(variant)
      if (resting.phase !== 'absent') { this.publish(resting); return }
    }
    this.publish({ phase: 'absent' })
  }

  /** @returns the latest consistent observation. */
  snapshot(): ReflexSnapshot {
    const recommended = this.recommended()
    return {
      device: this.device, options: this.options(), ...recommended === undefined ? {} : { recommended },
      preparation: this.preparation, enabled: this.enabled(), reflexEnabled: this.jevConfig().enabled !== false,
      providerId: this.config.providerId, downloadSources: this.downloadSources,
      ...this.availableDisk === undefined ? {} : { availableDiskBytes: this.availableDisk },
      ...this.persisted.autoEnabledAt === undefined ? {} : { unacknowledgedAutoEnableAt: this.persisted.autoEnabledAt },
    }
  }

  /**
   * Observe readiness until the signal aborts or the engine is disposed; changes between reads coalesce.
   * @param signal - observer lifetime.
   * @returns the current snapshot followed by each later change.
   */
  async *follow(signal: AbortSignal): AsyncIterable<ReflexSnapshot> {
    const stop = AbortSignal.any([signal, this.lifetime.signal])
    let changed = true
    let wake: PromiseWithResolvers<void> | undefined
    const listener = (): void => { changed = true; wake?.resolve() }
    const abort = (): void => { wake?.resolve() }
    this.listeners.add(listener)
    stop.addEventListener('abort', abort, { once: true })
    try {
      while (!stop.aborted) {
        if (changed) {
          changed = false
          yield this.snapshot()
          continue
        }
        wake = Promise.withResolvers()
        await wake.promise
      }
    } finally {
      this.listeners.delete(listener)
      stop.removeEventListener('abort', abort)
    }
  }

  /**
   * Start or join download, verification, and self-test.
   * @param options - variant and source; changing either while work is active throws.
   */
  prepare(options: ReflexPrepareOptions = {}): void {
    this.lifetime.signal.throwIfAborted()
    if (!this.device.supported) throw new Error('This device cannot run the local Reflex engine')
    if (this.inspecting || this.preparation.phase === 'checking') throw new Error('The local Reflex engine is still checking its files')
    const source = options.downloadSource
    if (source !== undefined && !this.downloadSources.includes(source)) throw new Error('Reflex download source is unavailable')
    const current = 'variant' in this.preparation ? this.preparation.variant : undefined
    const variant = options.variant ?? this.task?.variant ?? current ?? this.recommended()
    if (variant === undefined || !this.offers(variant)) throw new Error('This Reflex model does not fit this device')
    if (this.task !== undefined) {
      if (!same(this.task.variant, variant) || source !== undefined && source !== this.task.source) {
        throw new Error('Cancel preparation before changing its variant or download source')
      }
      return
    }
    if (this.preparation.phase === 'ready' && same(this.preparation.variant, variant)) return
    this.start(variant, source)
  }

  private start(variant: ReflexVariant, source: string | undefined): void {
    const task: Task = { variant, source, abort: new AbortController(), stop: undefined, settled: Promise.resolve() }
    this.task = task
    task.settled = this.run(task).then((selfTest) => {
      this.task = undefined
      this.publish({ phase: 'ready', variant, selfTest })
      if (!selfTest.slow) {
        void this.route(true, true).catch((error: unknown) => { this.ctx.logger.warn('Reflex automatic enable failed', error) })
      }
    }, async (error: unknown) => { await this.settle(task, error) })
  }

  private async run(task: Task): Promise<ReflexSelfTest> {
    const { variant, source } = task
    const signal = AbortSignal.any([task.abort.signal, this.lifetime.signal])
    const key = variantKey(variant), asset = this.assets[key]
    await this.persist({ ...this.persisted, preparing: source === undefined ? { variant } : { variant, source } })
    if (!await this.verified(variant, signal)) {
      const urls = await orderSources(asset.url, source === undefined ? this.origins : [source], this.config.modelProbeTimeoutMs, signal)
      this.availableDisk = await availableBytes(this.directory)
      const path = await downloadModel({
        asset, directory: this.directory, urls, signal,
        stallTimeoutMs: this.config.downloadStallTimeoutMs, diskMarginBytes: this.config.diskMarginBytes,
        progressIntervalMs: this.config.progressIntervalMs,
        report: (completedBytes, origin) => {
          this.publish({ phase: 'downloading', variant, completedBytes, totalBytes: asset.bytes, source: origin })
        },
        verifying: () => { this.publish({ phase: 'verifying', variant }) },
      })
      const { mtimeMs } = await stat(path)
      this.present.set(key, asset.bytes)
      this.availableDisk = await availableBytes(this.directory)
      await this.record(key, { sha256: asset.sha256, size: asset.bytes, mtimeMs })
    }
    this.publish({ phase: 'testing', variant })
    const selfTest = await this.selfTest(variant, signal)
    const { preparing: _finished, ...rest } = this.persisted
    await this.persist({ ...rest, models: { ...rest.models, [key]: { ...rest.models[key] as ModelRecord, selfTest } } })
    return selfTest
  }

  private async settle(task: Task, error: unknown): Promise<void> {
    if (this.lifetime.signal.aborted) return
    this.task = undefined
    try {
      const { preparing: _stopped, ...rest } = this.persisted
      await this.persist(rest)
      if (task.stop === undefined) {
        this.ctx.logger.warn('Reflex preparation failed', error)
        this.publish({ phase: 'failed', variant: task.variant, failure: this.failureOf(error, task.source) })
        return
      }
      if (task.stop === 'cancel') await rm(partialPath(this.directory, this.assets[variantKey(task.variant)]), { force: true })
      await this.measureDisk()
      this.publish(await this.resting(task.variant))
    } catch (cleanupError) {
      this.ctx.logger.warn('Reflex preparation cleanup failed', cleanupError)
      this.publish({ phase: 'failed', variant: task.variant, failure: this.failureOf(cleanupError, task.source) })
    }
  }

  /** Hash-verify weights unless their size and modification time match the last verified fingerprint. */
  private async verified(variant: ReflexVariant, signal: AbortSignal): Promise<boolean> {
    const key = variantKey(variant), asset = this.assets[key], path = join(this.directory, asset.name)
    const info = await fileInfo(path)
    if (info === undefined) return false
    if (this.fingerprinted(key, info.size, info.mtimeMs)) return true
    this.publish({ phase: 'verifying', variant })
    if (!await matchesAsset(path, asset, signal)) return false
    await this.record(key, { sha256: asset.sha256, size: info.size, mtimeMs: info.mtimeMs })
    return true
  }

  /** Replace a variant's fingerprint; a changed file loses its self-test. */
  private async record(key: VariantKey, fingerprint: Omit<ModelRecord, 'selfTest'>): Promise<void> {
    await this.persist({ ...this.persisted, models: { ...this.persisted.models, [key]: fingerprint } })
  }

  private fingerprinted(key: VariantKey, size: number, mtimeMs: number): boolean {
    const model = this.persisted.models[key]
    return model?.sha256 === this.assets[key].sha256 && model.size === size && model.mtimeMs === mtimeMs
  }

  /** Phase of a variant without active work: tested weights are ready; untested weights and partial files are paused. */
  private async resting(variant: ReflexVariant): Promise<ReflexPreparation> {
    const key = variantKey(variant), asset = this.assets[key]
    const info = await fileInfo(join(this.directory, asset.name))
    const selfTest = this.persisted.models[key]?.selfTest
    if (info !== undefined && this.fingerprinted(key, info.size, info.mtimeMs)) {
      return selfTest === undefined ? { phase: 'paused', variant, completedBytes: asset.bytes, totalBytes: asset.bytes } : { phase: 'ready', variant, selfTest }
    }
    const completedBytes = await partialBytes(partialPath(this.directory, asset))
    return completedBytes > 0 ? { phase: 'paused', variant, completedBytes, totalBytes: asset.bytes } : { phase: 'absent' }
  }

  private async selfTest(variant: ReflexVariant, signal: AbortSignal): Promise<ReflexSelfTest> {
    const runner = await this.runnerFor(variant)
    await runner.stop()
    const client = await runner.acquire(signal)
    const prompt = renderPrompt(REFERENCE.state, 'choice', REFERENCE.instructions, REFERENCE.descriptions)
    // The first evaluation on a fresh process includes one-time GPU setup; the second measures steady uncached prefill.
    await client.complete(prompt, signal, false)
    const started = performance.now()
    const completion = await client.complete(prompt, signal, false)
    const decisionMs = Math.round(performance.now() - started)
    const labels = REFERENCE.descriptions.map((_description, index) => CANDIDATE_LABELS.charAt(index))
    const scored = labels.map(label => [label, completion.logprobs.get(label)] as const)
    if (scored.some(([, logprob]) => logprob === undefined)) throw new SelfTestError('The reference decision omitted a candidate label')
    const [best] = scored.reduce((top, entry) => (entry[1] as number) > (top[1] as number) ? entry : top)
    if (best !== labels[0]) throw new SelfTestError(`The reference decision selected ${best} instead of ${labels[0]}`)
    const prefillTokensPerSecond = Math.round(completion.promptTokens * 1000 / Math.max(completion.promptMs, 1))
    const slow = prefillTokensPerSecond < this.config.minPrefillTokensPerSecond
    if (slow) await runner.stop()
    return { prefillTokensPerSecond, decisionMs, slow }
  }

  private async runnerFor(variant: ReflexVariant): Promise<ReflexRunner> {
    const model = join(this.directory, this.assets[variantKey(variant)].name)
    if (this.runner?.model === model) return this.runner
    await this.runner?.dispose()
    this.lifetime.signal.throwIfAborted()
    // The device gate reports `runner-missing` unless runnerPath names an executable file.
    this.runner = new ReflexRunner(this.ctx, this.config, this.config.runnerPath as string, model)
    return this.runner
  }

  /**
   * Return the ready runner for one Jev request.
   * @param signal - decision cancellation.
   * @returns a started runner client.
   */
  async acquire(signal: AbortSignal): Promise<ReflexRunnerClient> {
    const preparation = this.preparation
    if (this.lifetime.signal.aborted || !this.enabled()) throw new JevProviderError({ code: 'transport', message: 'local Reflex engine is not enabled' })
    if (preparation.phase !== 'ready') throw new JevProviderError({ code: 'transport', message: 'local Reflex engine is not ready' })
    try {
      return await (await this.runnerFor(preparation.variant)).acquire(signal)
    } catch (error) {
      if (signal.aborted) throw error
      throw new JevProviderError({ code: 'transport', message: 'local Reflex runner is unavailable' }, { cause: error })
    }
  }

  /**
   * Start the runner of an enabled, ready engine.
   * @param signal - caller cancellation.
   */
  async warm(signal?: AbortSignal): Promise<void> {
    await this.acquire(signal ?? new AbortController().signal)
  }

  /** Raw configuration of the jev entry as the Loader holds it; volatile edits update it in place. */
  private jevConfig(): { readonly enabled?: unknown; readonly defaultProviderId?: unknown; readonly providerId?: unknown } {
    const config = this.jevEntry()?.options.config
    return typeof config === 'object' && config !== null ? config : {}
  }

  private enabled(): boolean {
    const config = this.jevConfig()
    return (config.defaultProviderId ?? config.providerId ?? JEV_BUILTIN_PROVIDER) === this.config.providerId
  }

  private jevEntry(): RoutingEntry | undefined {
    return this.editor.entries().find(entry => entry.options.id === JEV_ENTRY_ID && entry.options.disabled !== true)
  }

  /** Route Jev decisions to the local provider. @returns after the state or profile change is applied. */
  async enable(): Promise<void> {
    if (this.preparation.phase !== 'ready') throw new Error('Prepare the local Reflex engine before enabling it')
    await this.route(true)
  }

  /** Remove the jev `defaultProviderId`, restoring the built-in default. @returns after the change is applied. */
  async disable(): Promise<void> {
    await this.route(false)
  }

  /** Clear the unacknowledged automatic enablement. @returns after the cleared state is persisted. */
  async acknowledge(): Promise<void> {
    const { autoEnabledAt: _acknowledged, ...rest } = this.persisted
    await this.persist(rest)
    this.publish()
  }

  /**
   * Edit only the volatile jev `defaultProviderId`, so Jev switches providers without reloading, then record, keep, or
   * clear the automatic-enable notice.
   */
  private async route(local: boolean, automatic = false): Promise<void> {
    const entry = this.jevEntry()
    if (entry === undefined) throw new Error('reflex-local requires an enabled jev entry')
    if (this.enabled() !== local) {
      await this.editor.edit(entry, (raw) => {
        const { defaultProviderId: _previous, ...rest } = raw
        return local ? { ...rest, defaultProviderId: this.config.providerId } : rest
      })
    }
    const { autoEnabledAt, ...rest } = this.persisted
    const notice = !local ? undefined : automatic ? Date.now() : autoEnabledAt
    await this.persist(notice === undefined ? rest : { ...rest, autoEnabledAt: notice })
    this.publish()
  }

  /** Stop preparation and the runner, delete weights and partial files, then disable. @returns after deletion. */
  async remove(): Promise<void> {
    await this.activation
    const task = this.task
    if (task !== undefined) {
      task.stop = 'cancel'
      task.abort.abort(new Error('Reflex preparation cancelled'))
      await task.settled
    }
    await this.runner?.dispose()
    this.runner = undefined
    for (const asset of Object.values(this.assets)) {
      await rm(join(this.directory, asset.name), { force: true })
      await rm(partialPath(this.directory, asset), { force: true })
    }
    await this.persist({ ...this.persisted, models: {} })
    await this.measureDisk()
    if (this.device.supported) this.publish({ phase: 'absent' })
    await this.disable()
  }

  /** Stop active work and keep the partial download. @returns after the work settles. */
  async pause(): Promise<void> {
    const task = this.task
    if (task === undefined) return
    task.stop ??= 'pause'
    task.abort.abort(new Error('Reflex preparation paused'))
    await task.settled
  }

  /** Stop active work and delete the partial download. @returns after the work settles and the file is removed. */
  async cancel(): Promise<void> {
    const task = this.task
    if (task !== undefined) {
      task.stop = 'cancel'
      task.abort.abort(new Error('Reflex preparation cancelled'))
      await task.settled
      return
    }
    const preparation = this.preparation
    if (preparation.phase !== 'paused' && preparation.phase !== 'failed' || preparation.variant === undefined) return
    await rm(partialPath(this.directory, this.assets[variantKey(preparation.variant)]), { force: true })
    await this.measureDisk()
    this.publish(await this.resting(preparation.variant))
  }

  /** Unclassified local failures are reported against the source the work would download from. */
  private failureOf(error: unknown, source = this.downloadSources[0] as string): ReflexFailure {
    if (error instanceof ReflexDiskError) return { kind: 'disk', requiredBytes: error.requiredBytes, availableBytes: error.availableBytes }
    if (error instanceof ReflexDownloadError) return { kind: 'download', download: error.download }
    if (error instanceof ReflexRunnerError) return { kind: 'runner', message: error.message }
    if (error instanceof SelfTestError || error instanceof JevProviderError) return { kind: 'self-test', message: error.message }
    return { kind: 'download', download: { source, ...classifyFailure(error) } }
  }

  private options(): ReflexModelOption[] {
    if (!this.device.supported) return []
    return modelOptions(this.assets, this.config.minMemoryBytes, {
      memoryBytes: this.device.memoryBytes, availableBytes: this.availableDisk, diskMarginBytes: this.config.diskMarginBytes,
      presentBytes: key => this.present.get(key) ?? 0,
    })
  }

  private recommended(): ReflexVariant | undefined {
    return recommend(this.options())
  }

  /** Whether this Host has the memory for a variant; free disk space is checked when the download starts. */
  private offers(variant: ReflexVariant): boolean {
    return this.options().some(option => same(option, variant) && option.reason !== 'memory')
  }

  /** Refresh free space and the bytes each variant already holds, complete or partial. */
  private async measureDisk(): Promise<void> {
    this.availableDisk = await availableBytes(this.config.dataRoot)
    for (const key of VARIANT_KEYS) {
      const asset = this.assets[key]
      const complete = await fileInfo(join(this.directory, asset.name))
      this.present.set(key, complete?.isFile() === true ? complete.size : await partialBytes(partialPath(this.directory, asset)))
    }
  }

  private publish(preparation: ReflexPreparation = this.preparation): void {
    this.preparation = preparation
    for (const listener of this.listeners) listener()
  }

  private get statePath(): string { return join(this.config.dataRoot, 'state.json') }

  private async readState(): Promise<Persisted> {
    const text = await readFile(this.statePath, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return undefined
    })
    if (text === undefined) return EMPTY_STATE
    let value: unknown
    try { value = JSON.parse(text) } catch (error) {
      this.ctx.logger.warn('Ignoring unreadable Reflex state', error)
      return EMPTY_STATE
    }
    const parsed = stateSchema.safeParse(value)
    if (parsed.success) return parsed.data
    this.ctx.logger.warn('Ignoring invalid Reflex state', parsed.error)
    return EMPTY_STATE
  }

  private async persist(next: Persisted): Promise<void> {
    this.persisted = next
    const write = this.writes.then(async () => {
      await writeFileAtomic(this.statePath, `${JSON.stringify(next)}\n`, { mode: 0o600, dirMode: 0o700 })
    })
    this.writes = write.catch((_reported: unknown) => {
      // The caller awaiting `write` receives this failure; later writes still run.
    })
    await write
  }

  /** Close observers, stop preparation without clearing its resume record, and stop the runner. @returns after all work settles. */
  async dispose(): Promise<void> {
    this.listeners.clear()
    this.lifetime.abort(new Error('Reflex engine disposed'))
    await this.activation
    await this.task?.settled
    await this.runner?.dispose()
    await this.writes
  }
}
