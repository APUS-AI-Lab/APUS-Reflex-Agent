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
import type { ReflexLocalService, ReflexPrepareOptions, ReflexSelectOptions, ReflexSnapshot, ReflexVariant } from './types.ts'

export type * from './types.ts'
export { ReflexLifecycleError } from './engine.ts'

export const name = 'experimental-reflex-local'

/** Model identity reported in Jev responses from the local provider. */
export const REFLEX_MODEL = 'APUS-OpenJev-v1-GGUF'

/** Device, download, process, and self-test settings of the local engine. */
export interface Config {
  /** Jev registry id of the local provider. */
  providerId: string
  /** Absolute directory owning downloaded weights, partial files, and `state.json`. */
  dataRoot: string
  /** Absolute path of the bundled `llama-server`; omission or a non-executable file reports `runner-missing`. */
  runnerPath?: string | undefined
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
  /**
   * Idle period after which the runner stops and frees the model's memory; absent keeps it resident while local
   * decisions are enabled. The next decision after a release waits for the model to load.
   */
  idleReleaseMs?: number | undefined
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
  /** Total memory each variant requires; options below their tier are greyed and never recommended. */
  minMemoryBytes: {
    /** 4B Q4_K_M. */
    '4b-q4_k_m': number
    /** 4B Q8_0. */
    '4b-q8_0': number
    /** 9B Q4_K_M. */
    '9b-q4_k_m': number
    /** 9B Q8_0. */
    '9b-q8_0': number
    /** 35B-A3B Q4_K_M; experimental. */
    '35b-a3b-q4_k_m': number
    /** 35B-A3B Q8_0; experimental. */
    '35b-a3b-q8_0': number
  }
  /** Free bytes left on the data volume after a download completes. */
  diskMarginBytes: number
  /** Consecutive runner start or request failures after which local decisions are turned off. */
  maxConsecutiveRunnerFailures: number
  /** Interval for reading the Jev entry's routing and master switch, so external changes publish and stop the runner. */
  routingPollMs: number
}

const origin = z.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/)
const timeout = z.natural().min(1).max(MAX_TIMER_DELAY_MS)
const GIB = 1024 ** 3

/** Validate deployment-varying engine choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('reflex-local'),
  dataRoot: z.string().min(1).required(),
  runnerPath: z.union([z.string().min(1), z.const(undefined)]),
  modelOrigin: z.union([origin, z.const(undefined)]),
  modelOrigins: z.array(origin).min(1).default(['https://huggingface.co', 'https://hf-mirror.com']),
  modelProbeTimeoutMs: timeout.default(3000),
  downloadStallTimeoutMs: timeout.default(60_000),
  contextTokens: z.natural().min(1).default(9216),
  startupTimeoutMs: timeout.default(120_000),
  decisionTimeoutMs: timeout.default(30_000),
  idleReleaseMs: z.union([timeout, z.const(undefined)]),
  graceMs: timeout.default(2000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  maxResponseBytes: z.natural().min(1).default(1024 * 1024),
  progressIntervalMs: timeout.default(250),
  minPrefillTokensPerSecond: z.number().min(0).default(150),
  minMemoryBytes: z.object({
    '4b-q4_k_m': z.natural().default(8 * GIB),
    '4b-q8_0': z.natural().default(16 * GIB),
    '9b-q4_k_m': z.natural().default(16 * GIB),
    '9b-q8_0': z.natural().default(24 * GIB),
    '35b-a3b-q4_k_m': z.natural().default(32 * GIB),
    '35b-a3b-q8_0': z.natural().default(64 * GIB),
  }),
  diskMarginBytes: z.natural().default(GIB),
  maxConsecutiveRunnerFailures: z.natural().min(1).default(3),
  routingPollMs: timeout.default(2000),
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
 * nested `jev` dependency, so a Jev reload re-registers it without stopping the engine.
 */
export default class ReflexLocal extends Service implements ReflexLocalService {
  static inject = ['subprocess']
  static Config = Config

  private readonly engine: ReflexEngine

  constructor(ctx: Context, config: Config) {
    super(ctx, 'reflexLocal')
    const provider: ReflexJevProvider = new ReflexJevProvider({
      id: config.providerId, model: REFLEX_MODEL, endpoint: 'http://127.0.0.1',
      acquire: async signal => await engine.acquire(signal),
      warm: async (signal) => { await engine.warm(signal) },
      ready: () => engine.ready(),
    })
    const engine: ReflexEngine = new ReflexEngine(ctx, checkConfig(config), ctx.get('configEditor'), provider.drain.bind(provider))
    this.engine = engine
    ctx.effect(() => {
      engine.activate()
      return async () => { await engine.dispose() }
    })
    ctx.inject(['jev'], (child) => {
      child.effect(() => child.jev.register(provider))
      // The Reflex master switch reaches dependents only through this event; the routing poll covers other Jev fields.
      child.on('jev/enabled', () => { engine.routingChanged() })
    })
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
   * Select the given variant, else the variant of a paused or failed preparation, else the recommendation.
   * @param options - variant and download source.
   */
  prepare(options?: ReflexPrepareOptions): void { this.engine.prepare(options) }

  /**
   * Make a tested downloaded variant active now, or prepare another one in the background while the active one serves.
   * @param variant - option to make active.
   * @param options - one advertised download origin used without fallback.
   */
  select(variant: ReflexVariant, options?: ReflexSelectOptions): void { this.engine.select(variant, options) }

  /** Stop active preparation and keep the partial download. @returns after the work settles. */
  async pause(): Promise<void> { await this.engine.pause() }

  /** Stop active preparation and delete the partial download. @returns after the work settles and the file is removed. */
  async cancel(): Promise<void> { await this.engine.cancel() }

  /**
   * Record the local engine as the chosen connection mode, removing a Jev `defaultProviderId` that names another provider.
   * @returns after the profile change and the choice are persisted.
   */
  async chooseLocal(): Promise<void> { await this.engine.chooseLocal() }

  /**
   * Start the active model's runner, then route Jev decisions to the local provider; requires an active model.
   * @returns after the runner answers and the profile change is applied.
   */
  async enable(): Promise<void> { await this.engine.enable() }

  /** Stop local routing, clear both notices, and stop the runner after the decisions in flight. @returns after it stopped. */
  async disable(): Promise<void> { await this.engine.disable() }

  /** Clear `unacknowledgedAutoEnableAt` after a client showed it. @returns after the cleared state is persisted. */
  async acknowledge(): Promise<void> { await this.engine.acknowledge() }

  /** Clear `unacknowledgedSwitch` after a client showed it. @returns after the cleared state is persisted. */
  async acknowledgeSwitch(): Promise<void> { await this.engine.acknowledgeSwitch() }

  /**
   * Delete one variant, disabling local decisions first when it is the active, enabled model.
   * @param variant - option to delete; omission deletes every model.
   * @returns after deletion.
   */
  async deleteModel(variant?: ReflexVariant): Promise<void> { await this.engine.deleteModel(variant) }

  /** Stop preparation and the runner, delete weights and partial files, then disable. @returns after deletion. */
  async remove(): Promise<void> { await this.engine.remove() }
}
