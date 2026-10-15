/** Host-owned readiness of the local APUS Reflex decision engine, safe to send to clients. */

/** Published GGUF quantization of the pinned 4B weights. */
export type ReflexVariant = 'q8_0' | 'q4_k_m'

/** Download and size facts for one variant; sizes are exact pinned byte counts. */
export interface ReflexModelInfo {
  readonly variant: ReflexVariant
  readonly bytes: number
}

/** Whether this Host can run the bundled runner, decided once at activation. */
export type ReflexDeviceSupport =
  | { readonly supported: true; readonly memoryBytes: number; readonly recommended: ReflexVariant }
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

/** One consistent observation of device support, preparation, and the persisted enable choice. */
export interface ReflexSnapshot {
  readonly device: ReflexDeviceSupport
  readonly models: readonly ReflexModelInfo[]
  readonly preparation: ReflexPreparation
  /** Persisted user choice; the provider answers only when this is true and preparation is ready. */
  readonly enabled: boolean
  /** Jev registry id of the local provider. */
  readonly providerId: string
  /** Free bytes on the data volume at the last check; absent before the first check. */
  readonly availableDiskBytes?: number
  /** Origins a user may pick for an explicit download; empty when the deployment offers no choice. */
  readonly downloadSources: readonly string[]
  /** Provider restored by `disable()`; absent when the local provider is the only Jev provider. */
  readonly cloudProviderId?: string
  /**
   * Epoch milliseconds of an automatic enablement the user has not acknowledged. It persists across restarts so a
   * client that was closed when the self-test finished can still offer undo; `acknowledge()` and `disable()` clear it.
   */
  readonly unacknowledgedAutoEnableAt?: number
}

/** Options of one explicit preparation request. */
export interface ReflexPrepareOptions {
  /** Variant to prepare; omission uses the device recommendation. */
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
  /** Route Jev decisions to the local provider; requires `ready`. @returns after the profile change is applied. */
  enable(): Promise<void>
  /** Stop routing decisions locally and restore `cloudProviderId` when configured. @returns after the change is applied. */
  disable(): Promise<void>
  /** Clear `unacknowledgedAutoEnableAt` after a client showed it. @returns after the cleared state is persisted. */
  acknowledge(): Promise<void>
  /** Disable, stop the runner, and delete downloaded weights and partial files. @returns after deletion. */
  remove(): Promise<void>
}
