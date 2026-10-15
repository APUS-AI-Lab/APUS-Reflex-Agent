/** Preparation state machine, persisted choices, routing edits, and runner ownership of the local Reflex engine. */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JevProviderError } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import type { Config } from './index.ts'
import { CANDIDATE_LABELS, renderPrompt } from './contract.ts'
import { inspectDevice } from './device.ts'
import {
  availableBytes, classifyFailure, downloadModel, fileInfo, matchesAsset, orderSources, partialPath,
  ReflexDiskError, ReflexDownloadError,
} from './download.ts'
import { modelOptions, readCatalog, recommend, variantKey, variantOf, VARIANT_KEYS, type CatalogAsset, type VariantKey } from './models.ts'
import { ReflexRunner, ReflexRunnerError, type ReflexRunnerClient } from './runner.ts'
import type {
  ReflexDeviceSupport, ReflexFailure, ReflexInventory, ReflexLifecycleErrorCode, ReflexLifecycleErrorDetails, ReflexLocalService,
  ReflexModelOption, ReflexPreparation, ReflexPrepareOptions, ReflexRunnerStatus, ReflexSelectOptions, ReflexSelfTest, ReflexSnapshot,
  ReflexSwitch, ReflexVariant,
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
    /** Message of the last failed self-test of this file; a passing test clears it. */
    selfTestFailure: z.string().optional(),
  })),
  /** Model the provider answers with. */
  active: variantSchema.optional(),
  /** Epoch milliseconds of an automatic enablement no client has acknowledged. */
  autoEnabledAt: z.number().optional(),
  /** Background switch no client has acknowledged. */
  switched: z.object({ from: variantSchema, to: variantSchema, at: z.number() }).optional(),
  /** The user chose the local engine as the Reflex connection mode; absent when not chosen. */
  localChosen: z.literal(true).optional(),
})
type Persisted = z.infer<typeof stateSchema>
type ModelRecord = Persisted['models'][string]
const EMPTY_STATE: Persisted = { models: {} }

interface Task {
  readonly variant: ReflexVariant
  readonly source: string | undefined
  readonly abort: AbortController
  stop: 'pause' | 'cancel' | undefined
  /** Set once download and verification finished, so a later failure belongs to the self-test of this file. */
  testing: boolean
  settled: Promise<void>
}

/** A runner and the variant it serves. */
interface Serving {
  readonly runner: ReflexRunner
  readonly variant: ReflexVariant
}

/** A refused lifecycle request whose `code` and `details` clients use to offer the right next step. */
export class ReflexLifecycleError extends Error {
  override name = 'ReflexLifecycleError'

  /**
   * @param code - refusal code.
   * @param message - diagnostic text.
   * @param details - structured payload of the code.
   */
  constructor(
    readonly code: ReflexLifecycleErrorCode, message: string, readonly details: ReflexLifecycleErrorDetails[ReflexLifecycleErrorCode],
  ) {
    super(message)
  }
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
  /** Total memory of a supported device; zero otherwise. */
  private readonly memoryBytes: number
  private readonly assets: Record<VariantKey, CatalogAsset>
  private readonly editor: RoutingEditor
  /** The complete or partial file of each variant on disk at the last disk check; absent variants have no entry. */
  private readonly present = new Map<VariantKey, { readonly complete: boolean; readonly size: number; readonly mtimeMs: number }>()
  private readonly origins: readonly string[]
  private readonly downloadSources: readonly string[]
  private readonly directory: string
  private preparation: ReflexPreparation
  private persisted: Persisted = EMPTY_STATE
  private availableDisk: number | undefined
  private task: Task | undefined
  /** Runner of the active model; decisions use it. */
  private serving: Serving | undefined
  /** Runners replaced by a switch or a stop, kept until the decisions in flight finish. */
  private readonly retiring = new Set<ReflexRunner>()
  private consecutiveFailures = 0
  private runnerFailure: string | undefined
  /** Disablement started by repeated runner failures; `enable()` waits for it so it never starts a runner that disablement stops. */
  private disabling: Promise<void> = Promise.resolve()
  private routingSeen = ''
  private poll: ReturnType<typeof setInterval> | undefined
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
   * @param drain - wait for the local provider's accepted decisions before a replaced runner stops.
   */
  constructor(
    private readonly ctx: Context, private readonly config: Config, editor: RoutingEditor | undefined,
    private readonly drain: () => Promise<void>,
  ) {
    if (editor === undefined) throw new Error('reflex-local requires the config-editor plugin to route Jev decisions')
    this.editor = editor
    if (this.jevEntry() === undefined) {
      throw new Error(`reflex-local requires an enabled '${JEV_ENTRY_ID}' entry; enable the Jev bundle beside the reflex-local bundle`)
    }
    this.assets = readCatalog()
    this.device = inspectDevice(config)
    this.memoryBytes = this.device.supported ? this.device.memoryBytes : 0
    this.origins = config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]
    this.downloadSources = [...new Set(this.origins.map(origin => new URL(origin).origin))]
    this.directory = join(config.dataRoot, 'models')
    this.preparation = this.device.supported ? { phase: 'checking' } : { phase: 'unsupported' }
  }

  /** Inspect state and weights once after construction; a supported device then leaves `checking`. */
  activate(): void {
    if (!this.device.supported) return
    this.routingSeen = this.routingSignature()
    this.poll = setInterval(() => { this.watchRouting() }, this.config.routingPollMs)
    this.inspecting = true
    this.activation = this.inspect().then(() => { this.keepWarm() }, (error: unknown) => {
      if (this.lifetime.signal.aborted) return
      this.ctx.logger.warn('Reflex engine inspection failed', error)
      this.publish({ phase: 'failed', failure: this.failureOf(error) })
    }).finally(() => { this.inspecting = false })
  }

  private async inspect(): Promise<void> {
    this.persisted = await this.readState()
    await this.reconcileChoice()
    await this.measureDisk()
    // An active model must still be a tested, verified file; a missing one is cleared. The user accepted its memory tier.
    const active = this.persisted.active
    const usable = active !== undefined && this.tested(variantKey(active))
      && await this.verified(active, this.lifetime.signal)
    if (active !== undefined && !usable) {
      const { active: _gone, ...rest } = this.persisted
      await this.persist(rest)
    }
    const { preparing } = this.persisted
    if (preparing !== undefined && (preparing.source === undefined || this.downloadSources.includes(preparing.source))) {
      this.start(preparing.variant, preparing.source)
      return
    }
    // Tested variants first, then every other variant, smallest first.
    const tested = VARIANT_KEYS.filter(key => this.tested(key))
    const candidates = [...new Set([...tested, ...VARIANT_KEYS])].map(variantOf)
    // Only the first complete file is hashed now; others are verified when prepared. No file becomes active here.
    for (const variant of candidates) if (await this.verified(variant, this.lifetime.signal)) break
    await this.measureDisk()
    this.publish(await this.idle(candidates))
  }

  /** Resting phase without a task: the active model is ready; otherwise the first retained file or nothing. */
  private async idle(candidates: readonly ReflexVariant[] = VARIANT_KEYS.map(variantOf)): Promise<ReflexPreparation> {
    const active = this.persisted.active
    if (active !== undefined) return await this.resting(active)
    for (const variant of candidates) {
      const resting = await this.resting(variant)
      if (resting.phase !== 'absent') return resting
    }
    return { phase: 'absent' }
  }

  private tested(key: VariantKey): boolean {
    return this.persisted.models[key]?.selfTest !== undefined
  }

  /** @returns the latest consistent observation. */
  snapshot(): ReflexSnapshot {
    const recommended = this.recommended()
    const { active, autoEnabledAt, switched } = this.persisted
    return {
      device: this.device, options: this.options(), ...recommended === undefined ? {} : { recommended },
      preparation: this.preparation, ...active === undefined ? {} : { active }, runner: this.runnerStatus(),
      ...switched === undefined ? {} : { unacknowledgedSwitch: switched satisfies ReflexSwitch },
      enabled: this.enabled(), localChosen: this.persisted.localChosen === true, reflexEnabled: this.reflexEnabled(),
      providerId: this.config.providerId, downloadSources: this.downloadSources,
      ...this.availableDisk === undefined ? {} : { availableDiskBytes: this.availableDisk },
      ...autoEnabledAt === undefined ? {} : { unacknowledgedAutoEnableAt: autoEnabledAt },
    }
  }

  private runnerStatus(): ReflexRunnerStatus {
    if (this.runnerFailure !== undefined) return { state: 'failed', reason: this.runnerFailure }
    if (this.serving === undefined) return { state: 'stopped' }
    const status = this.serving.runner.status(), model = this.serving.variant
    if (status.state !== 'running') return status.state === 'starting' ? { state: 'starting', model } : { state: 'stopped' }
    return { state: 'running', model, approxResidentBytes: this.assets[variantKey(model)].bytes,
      ...status.idleReleaseAt === undefined ? {} : { idleReleaseAt: status.idleReleaseAt } }
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
   * Select the given variant, else the variant of a paused or failed preparation, else the recommendation.
   * @param options - variant and source.
   */
  prepare(options: ReflexPrepareOptions = {}): void {
    this.admit(options.downloadSource)
    const current = 'variant' in this.preparation && this.preparation.phase !== 'ready' ? this.preparation.variant : undefined
    const variant = options.variant ?? this.task?.variant ?? current ?? this.recommended()
    if (variant === undefined) throw new Error('This Reflex model does not fit this device')
    this.select(variant, options)
  }

  /**
   * Make a variant active now when its file passed or was measured by a self-test; otherwise prepare it in the background.
   * @param variant - option to make active.
   * @param options - one advertised download origin used without fallback, and consent to a variant above this Host's
   * memory tier.
   */
  select(variant: ReflexVariant, options: ReflexSelectOptions = {}): void {
    const source = options.downloadSource
    this.admit(source)
    if (this.task !== undefined) {
      if (!same(this.task.variant, variant)) {
        throw new ReflexLifecycleError('preparing-other', 'Pause or cancel the current preparation before selecting another model',
          { preparing: this.task.variant, requested: variant })
      }
      if (source !== undefined && source !== this.task.source) throw new Error('Cancel preparation before changing its download source')
      return
    }
    const active = this.persisted.active
    const isActive = active !== undefined && same(active, variant)
    if (!isActive && options.allowUnfit !== true) this.requireMemory(variant)
    if (this.persisted.localChosen !== true || this.foreignRouting()) {
      void this.chooseLocal().catch((error: unknown) => { this.ctx.logger.warn('Reflex connection mode update failed', error) })
    }
    if (isActive) return
    const { selfTest } = this.inventory(variantKey(variant))
    if (selfTest === 'passed' || selfTest === 'slow') {
      void this.switchTo(variant).catch((error: unknown) => { this.ctx.logger.warn('Reflex model switch failed', error) })
      return
    }
    this.start(variant, source)
  }

  /** Refuse a variant above this Host's memory tier; the caller repeats the request with `allowUnfit` after the user agrees. */
  private requireMemory(variant: ReflexVariant): void {
    const option = this.options().find(candidate => same(candidate, variant)) as ReflexModelOption
    if (option.reason !== 'memory') return
    throw new ReflexLifecycleError('unfit', 'This Reflex model needs more memory than this device has',
      { variant, requiredBytes: option.minMemoryBytes, deviceBytes: this.memoryBytes })
  }

  /** Refuse requests the engine cannot take now. */
  private admit(source: string | undefined): void {
    this.lifetime.signal.throwIfAborted()
    if (!this.device.supported) throw new Error('This device cannot run the local Reflex engine')
    if (this.inspecting || this.preparation.phase === 'checking') throw new Error('The local Reflex engine is still checking its files')
    if (source !== undefined && !this.downloadSources.includes(source)) throw new Error('Reflex download source is unavailable')
  }

  private start(variant: ReflexVariant, source: string | undefined): void {
    const task: Task = { variant, source, abort: new AbortController(), stop: undefined, testing: false, settled: Promise.resolve() }
    this.task = task
    task.settled = this.run(task).then(async ({ selfTest, runner }) => {
      this.task = undefined
      await this.finish(variant, selfTest, runner)
    }, async (error: unknown) => { await this.settle(task, error) })
  }

  /**
   * Adopt a tested variant. A fast first model becomes active and enables local decisions that are off; a fast later model replaces
   * the active one and records the switch; a slow model becomes active only when nothing else is.
   */
  private async finish(variant: ReflexVariant, selfTest: ReflexSelfTest, runner: ReflexRunner): Promise<void> {
    const previous = this.persisted.active
    if (selfTest.slow && previous !== undefined) {
      await runner.dispose()
      await this.measureDisk()
      this.publish(await this.idle())
      return
    }
    // Decided before the switch publishes, so a client's disable after seeing the ready model is not undone.
    const automatic = previous === undefined && !selfTest.slow && !this.enabled()
    await this.switchTo(variant, selfTest.slow ? undefined : runner, previous === undefined || selfTest.slow ? undefined : previous)
    if (selfTest.slow) await runner.dispose()
    if (automatic) {
      await this.route(true, true).catch((error: unknown) => { this.ctx.logger.warn('Reflex automatic enable failed', error) })
    }
  }

  /**
   * Make a variant active: decisions accepted so far finish on the old runner, which then stops; later decisions use
   * `runner` when given, else a runner that starts at once when local decisions are enabled and otherwise on first use.
   * @param from - previous active variant to record as an unacknowledged background switch.
   */
  private async switchTo(variant: ReflexVariant, runner?: ReflexRunner, from?: ReflexVariant): Promise<void> {
    const { switched: _replaced, ...rest } = this.persisted
    const retired = this.serving
    this.serving = runner === undefined ? undefined : { runner, variant }
    this.runnerFailure = undefined
    this.consecutiveFailures = 0
    const switched = from === undefined ? {} : { switched: { from, to: variant, at: Date.now() } }
    const written = this.persist({ ...rest, active: variant, ...switched })
    // Only tested variants become active, so the record carries a self-test; publishing now keeps phase and `active` in step.
    const { selfTest } = this.persisted.models[variantKey(variant)] as ModelRecord
    this.publish({ phase: 'ready', variant, selfTest: selfTest as ReflexSelfTest })
    await written
    if (runner === undefined) this.keepWarm()
    await this.retire(retired?.runner)
  }

  /** Stop a replaced runner after the decisions accepted so far finish. */
  private async retire(runner: ReflexRunner | undefined): Promise<void> {
    if (runner === undefined) return
    this.retiring.add(runner)
    try {
      await this.drain()
      await runner.dispose()
    } finally {
      this.retiring.delete(runner)
      this.publish()
    }
  }

  /** Stop serving: the runner of the active model stops after the decisions in flight. */
  private async stopServing(): Promise<void> {
    const retired = this.serving
    this.serving = undefined
    this.publish()
    await this.retire(retired?.runner)
  }

  private async run(task: Task): Promise<{ selfTest: ReflexSelfTest; runner: ReflexRunner }> {
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
      await this.record(key, { sha256: asset.sha256, size: asset.bytes, mtimeMs })
      await this.measureDisk()
    }
    task.testing = true
    this.publish({ phase: 'testing', variant })
    // A separate process keeps the active model answering while this variant is tested.
    const runner = new ReflexRunner(this.ctx, this.config, this.config.runnerPath as string, join(this.directory, asset.name),
      () => { this.publish() })
    try {
      const selfTest = await this.selfTest(runner, signal)
      const { preparing: _finished, ...rest } = this.persisted
      const { selfTestFailure: _passed, ...record } = rest.models[key] as ModelRecord
      await this.persist({ ...rest, models: { ...rest.models, [key]: { ...record, selfTest } } })
      return { selfTest, runner }
    } catch (error) {
      await runner.dispose()
      throw error
    }
  }

  private async settle(task: Task, error: unknown): Promise<void> {
    if (this.lifetime.signal.aborted) return
    this.task = undefined
    try {
      const { preparing: _stopped, ...rest } = this.persisted
      await this.persist(rest)
      if (task.stop === undefined) {
        this.ctx.logger.warn('Reflex preparation failed', error)
        const failure = this.failureOf(error, task.source), key = variantKey(task.variant)
        const record = this.persisted.models[key]
        if (task.testing && record !== undefined && (failure.kind === 'self-test' || failure.kind === 'runner')) {
          const { selfTest: _stale, ...fingerprint } = record
          const models = { ...this.persisted.models, [key]: { ...fingerprint, selfTestFailure: failure.message } }
          await this.persist({ ...this.persisted, models })
        }
        this.publish({ phase: 'failed', variant: task.variant, failure })
        return
      }
      const asset = this.assets[variantKey(task.variant)]
      if (task.stop === 'cancel') await rm(partialPath(this.directory, asset), { force: true })
      else await this.markPaused(asset)
      await this.measureDisk()
      this.publish(this.persisted.active === undefined ? await this.resting(task.variant) : await this.idle())
    } catch (cleanupError) {
      this.ctx.logger.warn('Reflex preparation cleanup failed', cleanupError)
      this.publish({ phase: 'failed', variant: task.variant, failure: this.failureOf(cleanupError, task.source) })
    }
  }

  /**
   * Keep a variant paused before its first byte resumable: an empty partial file marks it like any partial download. A
   * complete file needs no marker.
   */
  private async markPaused(asset: CatalogAsset): Promise<void> {
    if (await fileInfo(join(this.directory, asset.name)) !== undefined) return
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await writeFile(partialPath(this.directory, asset), '', { flag: 'a', mode: 0o600 })
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

  /** Phase of a variant without active work: tested weights are ready; untested weights and partial files, even empty ones, are paused. */
  private async resting(variant: ReflexVariant): Promise<ReflexPreparation> {
    const key = variantKey(variant), asset = this.assets[key]
    const info = await fileInfo(join(this.directory, asset.name))
    const selfTest = this.persisted.models[key]?.selfTest
    if (info !== undefined && this.fingerprinted(key, info.size, info.mtimeMs)) {
      return selfTest === undefined ? { phase: 'paused', variant, completedBytes: asset.bytes, totalBytes: asset.bytes } : { phase: 'ready', variant, selfTest }
    }
    const partial = await fileInfo(partialPath(this.directory, asset))
    return partial?.isFile() === true ? { phase: 'paused', variant, completedBytes: partial.size, totalBytes: asset.bytes } : { phase: 'absent' }
  }

  private async selfTest(runner: ReflexRunner, signal: AbortSignal): Promise<ReflexSelfTest> {
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
    return { prefillTokensPerSecond, decisionMs, slow }
  }

  /** Runner of the active model, created on first use. */
  private servingRunner(active: ReflexVariant): ReflexRunner {
    if (this.serving === undefined || !same(this.serving.variant, active)) {
      // The device gate reports `runner-missing` unless runnerPath names an executable file.
      const runner = new ReflexRunner(this.ctx, this.config, this.config.runnerPath as string,
        join(this.directory, this.assets[variantKey(active)].name), () => { this.publish() })
      this.serving = { runner, variant: active }
    }
    return this.serving.runner
  }

  /**
   * Return the active model's runner for one Jev request. Start failures and transport failures count toward
   * `maxConsecutiveRunnerFailures`; a successful completion resets the count.
   * @param signal - decision cancellation.
   * @returns a started runner client.
   */
  async acquire(signal: AbortSignal): Promise<ReflexRunnerClient> {
    const active = this.persisted.active
    if (this.lifetime.signal.aborted || !this.enabled()) throw new JevProviderError({ code: 'transport', message: 'local Reflex engine is not enabled' })
    if (active === undefined) throw new JevProviderError({ code: 'transport', message: 'local Reflex engine is not ready' })
    let client: ReflexRunnerClient
    try {
      client = await this.servingRunner(active).acquire(signal)
    } catch (error) {
      if (signal.aborted) throw error
      // Runner startup rejects only with Errors, whose messages exclude paths and keys.
      this.runnerFailed(error as Error)
      throw new JevProviderError({ code: 'transport', message: 'local Reflex runner is unavailable' }, { cause: error })
    }
    return {
      complete: async (prompt, callSignal) => {
        try {
          const completion = await client.complete(prompt, callSignal)
          this.consecutiveFailures = 0
          return completion
        } catch (error) {
          if (error instanceof JevProviderError && error.failure.code === 'transport') this.runnerFailed(error)
          throw error
        }
      },
    }
  }

  /** Count a runner failure; at the limit, turn local decisions off without waiting inside the failing request. */
  private runnerFailed(error: Error): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures < this.config.maxConsecutiveRunnerFailures) return
    this.consecutiveFailures = 0
    this.runnerFailure = error.message
    this.ctx.logger.warn('Reflex runner failed repeatedly; local decisions are turned off', error)
    this.disabling = this.disable().catch((routeError: unknown) => { this.ctx.logger.warn('Reflex routing after runner failures failed', routeError) })
  }

  /**
   * Start the runner of an enabled, ready engine.
   * @param signal - caller cancellation.
   */
  async warm(signal?: AbortSignal): Promise<void> {
    await this.acquire(signal ?? new AbortController().signal)
  }

  /** Start the active model's runner in the background while local decisions and Reflex are on; failures are logged and counted. */
  private keepWarm(): void {
    if (this.persisted.active === undefined || !this.enabled() || !this.reflexEnabled()) return
    void this.warm().catch((error: unknown) => { this.ctx.logger.warn('Reflex runner warm-up failed', error) })
  }

  /** React to a routing or Reflex master switch change announced by Jev at once instead of at the next poll. */
  routingChanged(): void {
    this.watchRouting()
  }

  /**
   * Publish external routing changes; start the runner once local decisions and Reflex are both on, and stop it once
   * either is off.
   */
  private watchRouting(): void {
    // Before inspection publishes, the persisted state is not loaded; the poll after it observes any change made meanwhile.
    if (this.preparation.phase === 'checking' || this.preparation.phase === 'unsupported') return
    const signature = this.routingSignature()
    if (signature === this.routingSeen) return
    this.routingSeen = signature
    this.publish()
    void this.reconcileChoice().catch((error: unknown) => { this.ctx.logger.warn('Reflex connection mode update failed', error) })
    if (this.enabled() && this.reflexEnabled()) this.keepWarm()
    else void this.stopServing().catch((error: unknown) => { this.ctx.logger.warn('Reflex runner stop failed', error) })
  }

  private routingSignature(): string {
    return `${this.enabled()}:${this.reflexEnabled()}:${this.foreignRouting()}`
  }

  /** Whether the jev `defaultProviderId` names another provider, which a client writes when it saves a non-local mode. */
  private foreignRouting(): boolean {
    const id = this.jevConfig().defaultProviderId
    return typeof id === 'string' && id !== '' && id !== this.config.providerId
  }

  /** Align `localChosen` with routing: routing to this provider implies it, and routing to another provider clears it. */
  private async reconcileChoice(): Promise<void> {
    const { localChosen, ...rest } = this.persisted
    const chosen = !this.foreignRouting() && (localChosen === true || this.enabled())
    if (chosen === (localChosen === true)) return
    await this.persist(chosen ? { ...rest, localChosen: true } : rest)
    this.publish()
  }

  /**
   * Record the local connection mode, first removing a jev `defaultProviderId` that names another provider.
   * @returns after the profile change and the choice are persisted.
   */
  async chooseLocal(): Promise<void> {
    if (this.foreignRouting()) {
      await this.editJev((raw) => {
        const { defaultProviderId: _other, ...rest } = raw
        return rest
      })
    }
    await this.persist({ ...this.persisted, localChosen: true })
    this.routingSeen = this.routingSignature()
    this.publish()
  }

  private requireJev(): RoutingEntry {
    const entry = this.jevEntry()
    if (entry === undefined) throw new Error('reflex-local requires an enabled jev entry')
    return entry
  }

  /** Apply a raw configuration change to the jev entry. */
  private async editJev(change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    await this.editor.edit(this.requireJev(), change)
  }

  private reflexEnabled(): boolean {
    return this.jevConfig().enabled !== false
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

  /**
   * Start the active model's runner, then route Jev decisions to the local provider, so the first local decision does not
   * wait for the model to load. While the Reflex master switch is off, only routing changes and the runner starts when
   * the switch turns on. A runner that cannot start is reported as `failed` and leaves routing unchanged.
   * @returns after the runner answers and the profile change is applied.
   */
  async enable(): Promise<void> {
    const active = this.persisted.active
    if (active === undefined) throw new Error('Prepare the local Reflex engine before enabling it')
    await this.disabling
    this.runnerFailure = undefined
    this.consecutiveFailures = 0
    if (this.reflexEnabled()) {
      try {
        await this.servingRunner(active).acquire(this.lifetime.signal)
      } catch (error) {
        // Runner startup rejects only with Errors, whose messages exclude paths and keys.
        this.runnerFailure = (error as Error).message
        this.publish()
        throw error
      }
    }
    await this.route(true)
  }

  /**
   * Remove the jev `defaultProviderId`, restoring the built-in default, clear both notices, and stop the runner after the
   * decisions in flight. @returns after the runner stopped.
   */
  async disable(): Promise<void> {
    await this.route(false)
    await this.stopServing()
  }

  /** Clear the unacknowledged background switch. @returns after the cleared state is persisted. */
  async acknowledgeSwitch(): Promise<void> {
    const { switched: _acknowledged, ...rest } = this.persisted
    await this.persist(rest)
    this.publish()
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
    this.requireJev()
    if (this.enabled() !== local) {
      await this.editJev((raw) => {
        const { defaultProviderId: _previous, ...rest } = raw
        return local ? { ...rest, defaultProviderId: this.config.providerId } : rest
      })
    }
    const { autoEnabledAt, switched, ...rest } = this.persisted
    const notice = !local ? undefined : automatic ? Date.now() : autoEnabledAt
    await this.persist({
      ...rest, ...local ? { localChosen: true as const } : {}, ...notice === undefined ? {} : { autoEnabledAt: notice },
      ...local && switched !== undefined ? { switched } : {},
    })
    this.routingSeen = this.routingSignature()
    this.publish()
  }

  /**
   * Stop preparation and the runner, then delete weights, partial files, and the notices about them. Routing is unchanged.
   * @returns after deletion.
   */
  async remove(): Promise<void> {
    await this.activation
    const task = this.task
    if (task !== undefined) await this.stopTask(task, 'cancel')
    await this.stopServing()
    for (const asset of Object.values(this.assets)) {
      await rm(join(this.directory, asset.name), { force: true })
      await rm(partialPath(this.directory, asset), { force: true })
    }
    const { active: _deleted, autoEnabledAt: _enabled, switched: _switched, ...rest } = this.persisted
    await this.persist({ ...rest, models: {} })
    await this.measureDisk()
    if (this.device.supported) this.publish({ phase: 'absent' })
  }

  /**
   * Delete one variant. Deleting the active model stops its runner after the decisions in flight and clears `active` and
   * the notices about it; routing is unchanged, so enabled local decisions fail with `transport` until another model
   * becomes active.
   * @param variant - option to delete; omission deletes every model.
   * @returns after deletion.
   */
  async deleteModel(variant?: ReflexVariant): Promise<void> {
    if (variant === undefined) {
      await this.remove()
      return
    }
    await this.activation
    const task = this.task
    if (task !== undefined && same(task.variant, variant)) await this.stopTask(task, 'cancel')
    const key = variantKey(variant), asset = this.assets[key], active = this.persisted.active
    if (active !== undefined && same(active, variant)) {
      await this.stopServing()
      const { active: _deleted, autoEnabledAt: _enabled, switched: _switched, ...rest } = this.persisted
      await this.persist(rest)
    }
    await rm(join(this.directory, asset.name), { force: true })
    await rm(partialPath(this.directory, asset), { force: true })
    const { [key]: _record, ...models } = this.persisted.models
    await this.persist({ ...this.persisted, models })
    await this.measureDisk()
    if (this.task === undefined) this.publish(await this.idle())
    else this.publish()
  }

  private async stopTask(task: Task, stop: 'pause' | 'cancel'): Promise<void> {
    task.stop = stop === 'cancel' ? 'cancel' : task.stop ?? 'pause'
    task.abort.abort(new Error(stop === 'cancel' ? 'Reflex preparation cancelled' : 'Reflex preparation paused'))
    await task.settled
  }

  /** Stop active work and keep the partial download. @returns after the work settles. */
  async pause(): Promise<void> {
    const task = this.task
    if (task === undefined) return
    await this.stopTask(task, 'pause')
  }

  /** Stop active work and delete the partial download. @returns after the work settles and the file is removed. */
  async cancel(): Promise<void> {
    const task = this.task
    if (task !== undefined) {
      await this.stopTask(task, 'cancel')
      return
    }
    const preparation = this.preparation
    if (preparation.phase !== 'paused' && preparation.phase !== 'failed' || preparation.variant === undefined) return
    await rm(partialPath(this.directory, this.assets[variantKey(preparation.variant)]), { force: true })
    await this.measureDisk()
    this.publish(this.persisted.active === undefined ? await this.resting(preparation.variant) : await this.idle())
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
      inventory: key => this.inventory(key),
    })
  }

  /** What is on disk for a variant at the last disk check, with the self-test of a verified file. */
  private inventory(key: VariantKey): ReflexInventory {
    const disk = this.present.get(key)
    if (disk === undefined) return { state: 'absent' }
    if (disk.complete && this.fingerprinted(key, disk.size, disk.mtimeMs)) {
      const record = this.persisted.models[key] as ModelRecord
      const selfTest = record.selfTest === undefined ? record.selfTestFailure === undefined ? undefined : 'failed' as const
        : record.selfTest.slow ? 'slow' as const : 'passed' as const
      return { state: 'downloaded', ...selfTest === undefined ? {} : { selfTest } }
    }
    // A complete file of the pinned size without a matching record, e.g. after lost state, is hashed by its preparation.
    if (disk.complete && disk.size === this.assets[key].bytes) return { state: 'downloaded' }
    return { state: 'partial', completedBytes: disk.size }
  }

  private recommended(): ReflexVariant | undefined {
    return recommend(this.options())
  }

  /** Refresh free space and the bytes each variant already holds, complete or partial. */
  private async measureDisk(): Promise<void> {
    this.availableDisk = await availableBytes(this.config.dataRoot)
    for (const key of VARIANT_KEYS) {
      const asset = this.assets[key]
      const complete = await fileInfo(join(this.directory, asset.name))
      const partial = complete?.isFile() === true ? undefined : await fileInfo(partialPath(this.directory, asset))
      if (complete?.isFile() === true) this.present.set(key, { complete: true, size: complete.size, mtimeMs: complete.mtimeMs })
      else if (partial?.isFile() === true) this.present.set(key, { complete: false, size: partial.size, mtimeMs: 0 })
      else this.present.delete(key)
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
    clearInterval(this.poll)
    this.lifetime.abort(new Error('Reflex engine disposed'))
    await this.activation
    await this.task?.settled
    await this.serving?.runner.dispose()
    for (const runner of this.retiring) await runner.dispose()
    await this.writes
  }
}
