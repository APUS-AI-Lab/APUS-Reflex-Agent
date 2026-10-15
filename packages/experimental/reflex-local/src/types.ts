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

/** One weights file this deployment offers, judged against this Host. */
export interface ReflexModelOption extends ReflexVariant {
  /** Exact pinned file size. */
  readonly bytes: number
  /** Total memory this option requires on this deployment. */
  readonly minMemoryBytes: number
  /** Not yet measured on Mac; never recommended automatically, still selectable when it fits. */
  readonly experimental: boolean
  /** Whether memory and, after the first disk check, free space admit this option. */
  readonly fits: boolean
  /** First unmet requirement when `fits` is false: total memory, then free disk space for the bytes still missing. */
  readonly reason?: 'memory' | 'disk'
}

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

/** Preparation phase of the selected variant. Byte counts are exact; no phase reports an estimated percentage. */
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
  /** Whether the Jev entry's effective `defaultProviderId` is `providerId`. */
  readonly enabled: boolean
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
   * client that was closed when the self-test finished can still offer undo; `acknowledge()` and `disable()` clear it.
   */
  readonly unacknowledgedAutoEnableAt?: number
}

/** Options of one explicit preparation request. */
export interface ReflexPrepareOptions {
  /** Option to prepare; omission keeps the current or failed variant, else uses the recommendation. */
  readonly variant?: ReflexVariant
  /** One advertised origin used without fallback; omission probes the configured origins. */
  readonly downloadSource?: string
}

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
   * Start or join download, verification, and self-test; a passing, fast self-test enables local decisions.
   * Resumes a paused or interrupted download from its retained partial file.
   * @param options - variant and source selection; changing either while work is active throws.
   */
  prepare(options?: ReflexPrepareOptions): void
  /** Stop active work and keep the partial download for a later `prepare()`. @returns after the work settles. */
  pause(): Promise<void>
  /** Stop active work and delete the partial download. @returns after the work settles and the file is removed. */
  cancel(): Promise<void>
  /** Set the Jev entry's `defaultProviderId` to the local provider; requires `ready`. @returns after the profile change is applied. */
  enable(): Promise<void>
  /**
   * Remove the Jev entry's `defaultProviderId`, restoring the built-in default, and clear the automatic-enable notice.
   * @returns after the change is applied.
   */
  disable(): Promise<void>
  /** Clear `unacknowledgedAutoEnableAt` after a client showed it. @returns after the cleared state is persisted. */
  acknowledge(): Promise<void>
  /** Disable, stop the runner, and delete downloaded weights and partial files. @returns after deletion. */
  remove(): Promise<void>
}
