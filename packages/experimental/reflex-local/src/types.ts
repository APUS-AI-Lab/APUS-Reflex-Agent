/** Host-owned readiness of the local APUS Reflex decision engine, safe to send to clients. */

/** Published APUS Reflex model size. */
export type ReflexModelId = '4b' | '9b' | '35b-a3b'

/** Published GGUF quantization. */
export type ReflexQuant = 'q8_0' | 'q4_k_m'

/** Identity of one downloadable weights file. */
export interface ReflexVariant {
  readonly model: ReflexModelId
  readonly quant: ReflexQuant
}

/** What this Host holds for one option. */
export interface ReflexInventory {
  /**
   * `downloaded` is a complete file of the pinned size; it is hash-verified when `selfTest` is present, and otherwise the
   * next preparation verifies and self-tests it without downloading. `partial` is a retained incomplete file.
   */
  readonly state: 'absent' | 'partial' | 'downloaded'
  /** Bytes on disk for `partial`. */
  readonly completedBytes?: number
  /** Last self-test of this exact downloaded file; absent before one ran. */
  readonly selfTest?: 'passed' | 'slow' | 'failed'
}

/** One weights file this deployment offers, judged against this Host. */
export interface ReflexModelOption extends ReflexVariant {
  /** Exact pinned file size. */
  readonly bytes: number
  /** Total memory this option requires on this deployment. */
  readonly minMemoryBytes: number
  /** Not yet measured on Mac; never recommended automatically, still selectable. */
  readonly experimental: boolean
  /** Whether memory and, after the first disk check, free space admit this option. */
  readonly fits: boolean
  /**
   * First unmet requirement when `fits` is false: total memory, then free disk space for the bytes still missing. A
   * `memory` option is informational: `select()` and `prepare()` accept it with `allowUnfit: true`.
   */
  readonly reason?: 'memory' | 'disk'
  readonly inventory: ReflexInventory
}

/** The managed `llama-server` process. */
export type ReflexRunnerStatus =
  | { readonly state: 'stopped' }
  | { readonly state: 'starting'; readonly model: ReflexVariant }
  | {
    readonly state: 'running'
    readonly model: ReflexVariant
    /** Weights file size, the dominant part of the process's memory. */
    readonly approxResidentBytes: number
    /** Epoch milliseconds when an idle runner stops; absent while a decision runs or when idle release is off. */
    readonly idleReleaseAt?: number
  }
  /** Consecutive runner failures reached the configured limit, so local decisions were turned off. */
  | { readonly state: 'failed'; readonly reason: string }

/** A completed background switch of the active model that no client has acknowledged; undo selects `from`. */
export interface ReflexSwitch {
  readonly from: ReflexVariant
  readonly to: ReflexVariant
  /** Epoch milliseconds of the switch. */
  readonly at: number
}

/** Typed refusals of lifecycle requests, keyed by code, with their details. */
export interface ReflexLifecycleErrorDetails {
  /** Another variant is being prepared; pause or cancel it before selecting `requested`. */
  'preparing-other': { readonly preparing: ReflexVariant; readonly requested: ReflexVariant }
  /** The variant's memory tier exceeds this Host's memory; repeat the request with `allowUnfit: true` after the user agrees. */
  unfit: { readonly variant: ReflexVariant; readonly requiredBytes: number; readonly deviceBytes: number }
}

/** Code of a typed lifecycle refusal. */
export type ReflexLifecycleErrorCode = keyof ReflexLifecycleErrorDetails

/** Whether this Host can run the bundled runner, decided once at activation. */
export type ReflexDeviceSupport =
  | { readonly supported: true; readonly memoryBytes: number }
  | { readonly supported: false; readonly reason: 'platform' | 'memory' | 'runner-missing' }

/** Safe download diagnostics; `source` is an origin without credentials, path, or query. */
export interface ReflexDownloadFailure {
  readonly reason: 'network' | 'dns' | 'timeout' | 'certificate' | 'http' | 'integrity' | 'storage' | 'unknown'
  readonly source: string
  readonly code?: string
  readonly status?: number
}

/** Why preparation stopped; messages exclude paths, URLs with credentials, and model input. */
export type ReflexFailure =
  | { readonly kind: 'download'; readonly download: ReflexDownloadFailure }
  | { readonly kind: 'disk'; readonly requiredBytes: number; readonly availableBytes: number }
  | { readonly kind: 'runner'; readonly message: string }
  | { readonly kind: 'self-test'; readonly message: string }

/** Measured result of the bundled reference decision on this Host. */
export interface ReflexSelfTest {
  /** Prompt-processing throughput reported by the runner for the uncached reference prompt. */
  readonly prefillTokensPerSecond: number
  /** Wall time of the uncached reference decision, including HTTP. */
  readonly decisionMs: number
  /** True when throughput is below the configured minimum; such Hosts are never enabled automatically. */
  readonly slow: boolean
}

/**
 * Preparation work and its resting result. A running task reports its variant, which may differ from `active`; with no
 * task, `ready` reports the active model and `paused` a retained partial or untested file. Byte counts are exact.
 */
export type ReflexPreparation =
  | { readonly phase: 'unsupported' }
  | { readonly phase: 'checking' }
  | { readonly phase: 'absent' }
  | { readonly phase: 'downloading'; readonly variant: ReflexVariant; readonly completedBytes: number; readonly totalBytes: number; readonly source: string }
  | { readonly phase: 'paused'; readonly variant: ReflexVariant; readonly completedBytes: number; readonly totalBytes: number }
  | { readonly phase: 'verifying' | 'testing'; readonly variant: ReflexVariant }
  | { readonly phase: 'ready'; readonly variant: ReflexVariant; readonly selfTest: ReflexSelfTest }
  | { readonly phase: 'failed'; readonly variant?: ReflexVariant; readonly failure: ReflexFailure }

/** One consistent observation of device support, model options, preparation, and Jev routing. */
export interface ReflexSnapshot {
  readonly device: ReflexDeviceSupport
  /** Every offered option, smallest first; empty on an unsupported device. */
  readonly options: readonly ReflexModelOption[]
  /**
   * Largest non-experimental option that fits memory and free disk space; when free space admits none, the smallest
   * non-experimental option that fits memory (its `reason` is then `disk`). Absent on an unsupported device.
   */
  readonly recommended?: ReflexVariant
  readonly preparation: ReflexPreparation
  /** Model the provider answers with; preparing another variant leaves it serving until that variant passes. */
  readonly active?: ReflexVariant
  readonly runner: ReflexRunnerStatus
  /** Background switch awaiting `acknowledgeSwitch()`; `disable()`, deleting the active model, and a later switch replace or clear it. */
  readonly unacknowledgedSwitch?: ReflexSwitch
  /**
   * Whether local decisions are on: the Jev entry's effective `defaultProviderId` is `providerId` and they were turned on
   * by `enable()` or an automatic enable. `disable()`, repeated runner failures, and deleting the active model turn them
   * off without changing routing, so a chosen local mode keeps routing here and Jev consumers skip decisions through the
   * provider's `ready()`.
   */
  readonly enabled: boolean
  /**
   * Whether the user chose the local engine as the Reflex connection mode. While it is true, the Jev entry's
   * `defaultProviderId` names `providerId`, and activation restores that field when it is missing. It persists across
   * `disable()`, deletion, runner failures, and restarts, and clears only when `defaultProviderId` names another provider.
   */
  readonly localChosen: boolean
  /** The Jev master switch (`jev.enabled`); false stops every provider, including the local one. */
  readonly reflexEnabled: boolean
  /** Jev registry id of the local provider. */
  readonly providerId: string
  /** Free bytes on the data volume at the last check; absent before the first check. */
  readonly availableDiskBytes?: number
  /** Origins a user may pick for an explicit download; empty when the deployment offers no choice. */
  readonly downloadSources: readonly string[]
  /**
   * Epoch milliseconds of an automatic enablement the user has not acknowledged. It persists across restarts so a
   * client that was closed when the self-test finished can still offer undo; `acknowledge()`, `disable()`, and deleting
   * the active model clear it.
   */
  readonly unacknowledgedAutoEnableAt?: number
}

/** Options of one explicit preparation request. */
export interface ReflexPrepareOptions {
  /** Option to prepare; omission keeps the current or failed variant, else uses the recommendation. */
  readonly variant?: ReflexVariant
  /** One advertised origin used without fallback; omission probes the configured origins. */
  readonly downloadSource?: string
  /**
   * Accept a variant whose memory tier exceeds this Host's memory, after the user agreed. Free disk space is still
   * required, and such a variant is prepared and self-tested like any other.
   */
  readonly allowUnfit?: boolean
}

/** Options of one model selection. */
export type ReflexSelectOptions = Pick<ReflexPrepareOptions, 'downloadSource' | 'allowUnfit'>

/** Host service controlling preparation and use of the local engine. Page and transport lifetimes own none of its work. */
export interface ReflexLocalService {
  /** @returns the latest consistent observation. */
  snapshot(): ReflexSnapshot
  /**
   * Observe readiness until the signal aborts.
   * @param signal - observer lifetime.
   * @returns the current snapshot followed by each later change.
   */
  follow(signal: AbortSignal): AsyncIterable<ReflexSnapshot>
  /**
   * Make a variant active. A downloaded variant whose file passed (or was measured slow by) its self-test becomes active
   * at once: the in-flight decision finishes on the old runner, which then stops, and the next decision starts the new
   * one. Any other variant is prepared in the background while the current active model keeps answering; a passing,
   * fast self-test then switches to it and records `unacknowledgedSwitch`, while a slow one leaves the active model.
   * The first passing, fast model also enables local decisions that are off. Selecting also performs `chooseLocal()`.
   * @param variant - option to make active.
   * @param options - one advertised download origin used without fallback, and consent to a variant above this Host's
   * memory tier.
   * @throws ReflexLifecycleError `preparing-other` while another variant is being prepared, and `unfit` for a variant
   * above this Host's memory tier without `allowUnfit`.
   */
  select(variant: ReflexVariant, options?: ReflexSelectOptions): void
  /**
   * `select()` the given variant, else the variant of a paused or failed preparation, else the recommendation; joins
   * matching work and resumes a retained partial file.
   * @param options - variant and source selection, and consent to a variant above this Host's memory tier.
   * @throws ReflexLifecycleError `preparing-other` while another variant is being prepared, and `unfit` for a variant
   * above this Host's memory tier without `allowUnfit`.
   */
  prepare(options?: ReflexPrepareOptions): void
  /** Stop active work and keep the partial download for a later `prepare()`. @returns after the work settles. */
  pause(): Promise<void>
  /** Stop active work and delete the partial download. @returns after the work settles and the file is removed. */
  cancel(): Promise<void>
  /**
   * Record the local engine as the chosen Reflex connection mode and set the Jev entry's `defaultProviderId` to the local
   * provider, so Jev never answers with its built-in provider in local mode. Local decisions stay off until `enable()` or
   * an automatic enable; until then Jev consumers skip them through the provider's `ready()`.
   * @returns after the profile change and the choice are persisted.
   */
  chooseLocal(): Promise<void>
  /**
   * Start the active model's runner while the Jev master switch is on, then turn local decisions on and set the Jev
   * entry's `defaultProviderId` to the local provider; requires an active model. A runner that cannot start is reported as
   * `failed` and leaves local decisions off.
   * @returns after the runner answers and the change is applied.
   */
  enable(): Promise<void>
  /**
   * Turn local decisions off, clear the automatic-enable and switch notices, and stop the runner after the in-flight
   * decision; routing and downloaded models stay, so Jev consumers skip decisions instead of using the built-in provider.
   * @returns after the change is persisted and the runner stopped.
   */
  disable(): Promise<void>
  /** Clear `unacknowledgedAutoEnableAt` after a client showed it. @returns after the cleared state is persisted. */
  acknowledge(): Promise<void>
  /** Clear `unacknowledgedSwitch` after a client showed it. @returns after the cleared state is persisted. */
  acknowledgeSwitch(): Promise<void>
  /**
   * Delete one variant's weights, partial file, and records. Deleting the active variant stops the runner, clears `active`
   * and the notices about it, and turns local decisions off; routing and the local mode are unchanged.
   * @param variant - option to delete; omission deletes every model like `remove()`.
   * @returns after deletion.
   */
  deleteModel(variant?: ReflexVariant): Promise<void>
  /**
   * Stop preparation and the runner, delete downloaded weights and partial files, and turn local decisions off; routing is
   * unchanged.
   * @returns after deletion.
   */
  remove(): Promise<void>
}
