/** Process-local route health: first-token latency, output rate, and failure rate per model route. */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, isTokenDelta, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Thresholds and sampling for route health; deployment-owned. */
export interface System3RouteHealthConfig {
  /** Most recent samples kept per route. */
  readonly window: number
  /** Samples older than this many milliseconds are ignored, so an avoided route is offered again after it. */
  readonly sampleTtlMs: number
  /** Samples a metric needs before it can mark a route degraded. */
  readonly minSamples: number
  /** Median milliseconds from request start to the first token above which a route is slow. */
  readonly maxFirstTokenMs: number
  /** Median output tokens per second, after the first token, below which a route is slow. */
  readonly minTokensPerSecond: number
  /** Output tokens a sample needs before its rate counts; short outputs distort the rate. */
  readonly minOutputTokens: number
  /** Share of failed samples, from 0 to 1, above which a route is failing. */
  readonly maxErrorRate: number
  /** Small requests to routes without a recent sample; `false` samples only real requests. */
  readonly probe: false | {
    /** Milliseconds without a sample before a route is probed; also the probe check interval. */
    readonly idleMs: number
    /** Output token limit of each probe. */
    readonly maxTokens: number
  }
}

/** Why a route is degraded. */
export type System3RouteHealthReason = 'errors' | 'slow-first-token' | 'slow-output'

/** Current measurements of one route. */
export interface System3RouteHealthStatus {
  /** Fresh samples, including failures. */
  readonly samples: number
  /** Median first-token latency in milliseconds, or null without enough samples. */
  readonly firstTokenMs: number | null
  /** Median output tokens per second, or null without enough samples. */
  readonly tokensPerSecond: number | null
  /** Share of failed samples, or null without enough samples. */
  readonly errorRate: number | null
  /** The first threshold the route breaks, checked in the order errors, first token, output rate. */
  readonly degraded?: System3RouteHealthReason
}

/** Read access to route health for routing decisions. */
export interface System3RouteHealth {
  /**
   * Measure one route from its fresh samples.
   * @param provider - Registered provider route.
   * @param model - Model id on that provider.
   * @returns The route's current measurements and any degradation.
   */
  statusOf(provider: string, model: string): System3RouteHealthStatus
}

interface Sample {
  readonly at: number
  readonly failed: boolean
  readonly firstTokenMs?: number
  readonly tokensPerSecond?: number
}

/** Fixed probe text; it carries no Session data. */
const PROBE_TEXT = 'Reply with OK.'

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const centre = sorted.length % 2 === 1 ? sorted.slice(middle, middle + 1) : sorted.slice(middle - 1, middle + 1)
  return centre.reduce((sum, value) => sum + value, 0) / centre.length
}

/**
 * Sample every model stream on this context and probe idle routes.
 * @param ctx - Plugin context; listeners and timers are disposed with it.
 * @param config - Thresholds and probe settings.
 * @param routes - Routes to probe when idle.
 * @returns Route health reads for routing decisions.
 */
export function installSystem3RouteHealth(ctx: Context, config: System3RouteHealthConfig,
  routes: readonly { readonly provider: string; readonly model: string }[]): System3RouteHealth {
  const counts = { window: config.window, minSamples: config.minSamples, minOutputTokens: config.minOutputTokens }
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`routeHealth ${key} must be a positive integer`)
  }
  if (!(config.maxErrorRate >= 0 && config.maxErrorRate < 1)) throw new Error('routeHealth maxErrorRate must be at least 0 and below 1')
  const samples = new Map<string, Sample[]>()
  const keyOf = (provider: string, model: string): string => `${provider}\u0000${model}`
  const fresh = (key: string): Sample[] => {
    const cutoff = Date.now() - config.sampleTtlMs
    return (samples.get(key) ?? []).filter(sample => sample.at > cutoff)
  }
  const record = (options: GenerateOptions, sample: Sample): void => {
    const key = keyOf(options.provider, options.model)
    samples.set(key, [...fresh(key), sample].slice(-config.window))
  }

  async function* measure(options: GenerateOptions, source: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const started = Date.now()
    let first: number | undefined
    let outputTokens = 0
    let outcome: 'ok' | 'failed' | 'aborted' = 'aborted'
    try {
      for await (const chunk of source) {
        if (first === undefined && isTokenDelta(chunk)) first = Date.now()
        if (chunk.type === 'usage') outputTokens = chunk.usage.outputTokens
        if (chunk.type === 'finish') outcome = chunk.reason.kind === 'error' ? 'failed' : chunk.reason.kind === 'aborted' ? 'aborted' : 'ok'
        yield chunk
      }
    } finally {
      // A cancelled or abandoned stream says nothing about the route.
      if (outcome !== 'aborted') {
        const ended = Date.now()
        const elapsed = first === undefined ? 0 : ended - first
        record(options, { at: ended, failed: outcome === 'failed',
          ...first === undefined ? {} : { firstTokenMs: first - started },
          ...outcome === 'ok' && outputTokens >= config.minOutputTokens && elapsed > 0
            ? { tokensPerSecond: outputTokens / (elapsed / 1000) } : {} })
      }
    }
  }
  ctx.on('llm/stream', (options, next) => measure(options, next()))

  if (config.probe !== false) {
    const probe = config.probe
    const pending = new Set<string>()
    const controller = new AbortController()
    const tick = async (): Promise<void> => {
      const llm = ctx.get('llm')
      if (llm === undefined) return
      for (const route of routes) {
        const key = keyOf(route.provider, route.model)
        const latest = samples.get(key)?.at(-1)?.at ?? 0
        if (pending.has(key) || Date.now() - latest < probe.idleMs) continue
        pending.add(key)
        try {
          for await (const _chunk of llm.stream({ provider: route.provider, model: route.model, maxTokens: probe.maxTokens,
            messages: [createUserMessage({ content: [{ type: 'text', text: PROBE_TEXT }], source: { kind: 'user' } })],
            signal: controller.signal })) { /* consumed only so the llm/stream listener measures the probe */ }
        } catch (error) {
          // A thrown probe is middleware or cancellation, not a route sample; the next tick probes again.
          void error
        } finally {
          pending.delete(key)
        }
      }
    }
    ctx.effect(() => {
      const timer = setInterval(() => { void tick() }, probe.idleMs)
      return () => { clearInterval(timer); controller.abort() }
    }, 'system3.routeHealth.probe()')
  }

  return {
    statusOf(provider, model) {
      const current = fresh(keyOf(provider, model))
      const firstTokens = current.flatMap(sample => sample.firstTokenMs === undefined ? [] : [sample.firstTokenMs])
      const rates = current.flatMap(sample => sample.tokensPerSecond === undefined ? [] : [sample.tokensPerSecond])
      const errorRate = current.length >= config.minSamples ? current.filter(sample => sample.failed).length / current.length : null
      const firstTokenMs = firstTokens.length >= config.minSamples ? median(firstTokens) : null
      const tokensPerSecond = rates.length >= config.minSamples ? median(rates) : null
      const degraded: System3RouteHealthReason | undefined = errorRate !== null && errorRate > config.maxErrorRate ? 'errors'
        : firstTokenMs !== null && firstTokenMs > config.maxFirstTokenMs ? 'slow-first-token'
          : tokensPerSecond !== null && tokensPerSecond < config.minTokensPerSecond ? 'slow-output' : undefined
      return { samples: current.length, firstTokenMs, tokensPerSecond, errorRate, ...degraded === undefined ? {} : { degraded } }
    },
  }
}
