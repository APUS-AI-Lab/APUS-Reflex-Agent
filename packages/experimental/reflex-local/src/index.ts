/** Optional local APUS Reflex decision engine; activation downloads nothing unless it resumes an interrupted preparation. */
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type {} from '@deepseek-ai/dsh-subprocess'
import { ReflexEngine } from './engine.ts'
import { ReflexJevProvider } from './provider.ts'
import type { ReflexLocalService, ReflexPrepareOptions, ReflexSnapshot, ReflexVariant } from './types.ts'

export type * from './types.ts'

export const name = 'experimental-reflex-local'

/** Model identity reported in Jev responses from the local provider. */
export const REFLEX_MODEL = 'APUS-OpenJev-v1-4B-GGUF'

/** Device, download, process, and self-test settings of the local engine. */
export interface Config {
  /** Jev registry id of the local provider. */
  providerId: string
  /** Absolute directory owning downloaded weights, partial files, and `state.json`. */
  dataRoot: string
  /** Absolute path of the bundled `llama-server`; omission or a non-executable file reports `runner-missing`. */
  runnerPath?: string | undefined
  /** Quantization to prepare; `auto` follows the device memory recommendation. */
  variant: 'auto' | ReflexVariant
  /** Explicit Hugging Face-compatible origin; bypasses probing and public fallback. */
  modelOrigin?: string | undefined
  /** Hugging Face-compatible origins compared before each download. */
  modelOrigins: string[]
  /** Deadline for concurrent HEAD probes, including redirects. */
  modelProbeTimeoutMs: number
  /** Longest interval without response bytes before a download attempt fails with `timeout`. */
  downloadStallTimeoutMs: number
  /** Runner context window in tokens (`-c`). */
  contextTokens: number
  /** Deadline from spawn until the runner answers `GET /health` with 200. */
  startupTimeoutMs: number
  /** Deadline of one runner completion, which answers one question. */
  decisionTimeoutMs: number
  /** Idle period before stopping the runner; zero keeps it running until disposal. */
  idleTimeoutMs: number
  /** Managed process termination grace period. */
  graceMs: number
  /** Maximum retained runner diagnostic bytes. */
  maxLogBytes: number
  /** Maximum runner completion response bytes. */
  maxResponseBytes: number
  /** Minimum interval between intermediate download progress notifications. */
  progressIntervalMs: number
  /**
   * Self-test prompt-processing throughput below which a Host is reported slow and never enabled automatically. The
   * default sits between an Apple M5 with Metal (about 400 tokens per second on the 118-token reference prompt) and
   * CPU-only inference (about 100).
   */
  minPrefillTokensPerSecond: number
  /** Total memory each variant requires. */
  minMemoryBytes: Record<ReflexVariant, number>
  /** Free bytes left on the data volume after a download completes. */
  diskMarginBytes: number
  /** Cloud Jev provider restored by `disable()`; omission persists the enable choice in `state.json` instead of editing the profile. */
  cloudProviderId?: string | undefined
}

const origin = z.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/)
const timeout = z.natural().min(1).max(MAX_TIMER_DELAY_MS)
const GIB = 1024 ** 3

/** Validate deployment-varying engine choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('reflex-local'),
  dataRoot: z.string().min(1).required(),
  runnerPath: z.union([z.string().min(1), z.const(undefined)]),
  variant: z.union(['auto', 'q8_0', 'q4_k_m']).default('auto'),
  modelOrigin: z.union([origin, z.const(undefined)]),
  modelOrigins: z.array(origin).min(1).default(['https://huggingface.co', 'https://hf-mirror.com']),
  modelProbeTimeoutMs: timeout.default(3000),
  downloadStallTimeoutMs: timeout.default(60_000),
  contextTokens: z.natural().min(1).default(9216),
  startupTimeoutMs: timeout.default(120_000),
  decisionTimeoutMs: timeout.default(30_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(600_000),
  graceMs: timeout.default(2000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  maxResponseBytes: z.natural().min(1).default(1024 * 1024),
  progressIntervalMs: timeout.default(250),
  minPrefillTokensPerSecond: z.number().min(0).default(150),
  minMemoryBytes: z.object({
    q8_0: z.natural().default(16 * GIB),
    q4_k_m: z.natural().default(8 * GIB),
  }),
  diskMarginBytes: z.natural().default(GIB),
  cloudProviderId: z.union([z.string().min(1), z.const(undefined)]),
})

/**
 * Reject relative paths and unparsable origins that the schema admits.
 * @param config - schema-validated configuration.
 * @returns the same configuration.
 */
export function checkConfig(config: Config): Config {
  for (const path of [config.dataRoot, config.runnerPath]) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`Reflex paths must be absolute: ${path}`)
  }
  for (const value of config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]) new URL(value)
  if (config.cloudProviderId === config.providerId) throw new Error('Reflex cloudProviderId must differ from providerId')
  return config
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Preparation and routing of the local APUS Reflex decision engine. */
    reflexLocal: ReflexLocal
  }
}

/**
 * Host service exposing engine preparation; its Fiber owns the engine and runner. The provider registration lives in a
 * nested `jev` dependency, so a Jev reload caused by `enable()` or `disable()` re-registers it without stopping the engine.
 */
export default class ReflexLocal extends Service implements ReflexLocalService {
  static inject = ['subprocess']
  static Config = Config

  private readonly engine: ReflexEngine

  constructor(ctx: Context, config: Config) {
    super(ctx, 'reflexLocal')
    const engine = new ReflexEngine(ctx, checkConfig(config), ctx.get('configEditor'))
    this.engine = engine
    const provider = new ReflexJevProvider({
      id: config.providerId, model: REFLEX_MODEL, endpoint: 'http://127.0.0.1',
      acquire: async signal => await engine.acquire(signal),
      warm: async (signal) => { await engine.warm(signal) },
    })
    ctx.effect(() => {
      engine.activate()
      return async () => { await engine.dispose() }
    })
    ctx.inject(['jev'], (child) => { child.effect(() => child.jev.register(provider)) })
  }

  /**
   * Read device support, preparation, and routing in one observation.
   * @returns the latest consistent snapshot.
   */
  snapshot(): ReflexSnapshot { return this.engine.snapshot() }

  /**
   * Observe readiness until the signal aborts or the plugin unloads; changes between reads coalesce.
   * @param signal - observer lifetime.
   * @returns the current snapshot followed by each later change.
   */
  follow(signal: AbortSignal): AsyncIterable<ReflexSnapshot> { return this.engine.follow(signal) }

  /**
   * Start or join download, verification, and self-test; a passing, fast self-test enables local decisions.
   * @param options - variant and download source; changing either while work is active throws.
   */
  prepare(options?: ReflexPrepareOptions): void { this.engine.prepare(options) }

  /** Stop active preparation and keep the partial download. @returns after the work settles. */
  async pause(): Promise<void> { await this.engine.pause() }

  /** Stop active preparation and delete the partial download. @returns after the work settles and the file is removed. */
  async cancel(): Promise<void> { await this.engine.cancel() }

  /** Route Jev decisions to the local provider; requires `ready`. @returns after the state or profile change is applied. */
  async enable(): Promise<void> { await this.engine.enable() }

  /** Stop local routing, restore `cloudProviderId` when configured, and clear the auto-enable notice. @returns after it applies. */
  async disable(): Promise<void> { await this.engine.disable() }

  /** Clear `unacknowledgedAutoEnableAt` after a client showed it. @returns after the cleared state is persisted. */
  async acknowledge(): Promise<void> { await this.engine.acknowledge() }

  /** Stop preparation and the runner, delete weights and partial files, then disable. @returns after deletion. */
  async remove(): Promise<void> { await this.engine.remove() }
}
