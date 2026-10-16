/** Keep the Jev transport open while a person is likely to send the next entry input. */
import type { Context } from '@deepseek-ai/cordis'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** How long after activity, and how often, the Jev connection is kept open. */
export interface System3KeepWarmConfig {
  /** Time after plugin start or the latest turn end during which the connection is kept open. */
  readonly windowMs: number
  /** Interval between warm-up requests; shorter than the gateway's idle connection timeout. */
  readonly intervalMs: number
}

/**
 * Send periodic Jev warm-up requests during the window after plugin start and after each turn ends.
 * Warm-up failures are ignored: the next decision opens a connection as it would without warming.
 * @param ctx - Plugin context owning the timer; the loop stops when it is disposed.
 * @param config - Window and interval, each within the Node timer range.
 * @param frontLoaded - Whether entry decisions run; while false the loop keeps its schedule but sends nothing.
 */
export function installSystem3KeepWarm(ctx: Context, config: System3KeepWarmConfig, frontLoaded: () => boolean = () => true): void {
  for (const key of ['windowMs', 'intervalMs'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > MAX_TIMER_DELAY_MS) {
      throw new Error(`entryRouting keepWarm ${key} must be a positive integer within the timer range`)
    }
  }
  const lifetime = new AbortController()
  const stopped = (): boolean => lifetime.signal.aborted
  let until = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async (): Promise<void> => {
    timer = undefined
    if (lifetime.signal.aborted || Date.now() >= until) return
    if (frontLoaded()) await ctx.get('jev')?.warm(undefined, lifetime.signal).catch((error: unknown) => {
      // Only plugin disposal rejects here; Jev reports transport failures as false.
      if (!stopped()) throw error
    })
    if (!stopped()) timer = setTimeout(() => { void tick() }, config.intervalMs)
  }
  const extend = (): void => {
    until = Date.now() + config.windowMs
    if (timer === undefined) timer = setTimeout(() => { void tick() }, 0)
  }
  ctx.effect(() => () => {
    lifetime.abort(new DOMException('System3 keep-warm removed', 'AbortError'))
    clearTimeout(timer)
  }, 'system3.keepWarm()')
  ctx.on('agent/turn-stopping', extend)
  extend()
}
