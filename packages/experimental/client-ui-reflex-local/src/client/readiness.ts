/** One reconnecting Host readiness mirror shared by the card, the activation prompt, and the enablement notice. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type {} from '@deepseek-ai/dsh-experimental-api-reflex-local/remote'

/** The latest Host snapshot, with a separate transport failure that never rewrites Host readiness. */
export interface ReflexReadiness {
  readonly snapshot: ReflexSnapshot | null
  readonly connected: boolean
  readonly error: string | null
}

/** One plugin-lifetime observation of the Host engine. */
export interface ReflexReadinessMirror {
  readonly state: SnapshotStore<ReflexReadiness>
  /** Stop observing; Host-owned preparation continues. @returns after the stream and its reader settle. */
  readonly dispose: () => Promise<void>
}

/**
 * Subscribe once per Client plugin, independent of rendered pages and Sessions.
 * @param ctx - mounted Remote owner.
 * @param onSnapshot - called with each accepted snapshot after the mirror publishes it.
 * @returns the shared readiness store and joined observation cleanup.
 */
export function observeReadiness(ctx: Context, onSnapshot: (snapshot: ReflexSnapshot) => void): ReflexReadinessMirror {
  const state = createSnapshotStore<ReflexReadiness>({ snapshot: null, connected: false, error: null })
  const lost = (reason: unknown): void => {
    const { snapshot } = state.getSnapshot()
    state.set({ snapshot, connected: false, error: reason instanceof Error ? reason.message : String(reason) })
  }
  const stream = ctx.remote.$stream<ReflexSnapshot>({
    name: 'Local decision engine readiness',
    open: signal => ctx.remote.reflexLocal.follow(signal),
    carrierFailed: lost,
    ended: () => new RemoteStreamCarrierError('Local decision engine readiness stream ended'),
  })
  const lifetime = new AbortController()
  const reading = (async () => {
    try {
      for await (const item of stream) {
        state.set({ snapshot: item.value, connected: true, error: null })
        item.accept()
        onSnapshot(item.value)
      }
    } catch (reason) {
      if (!lifetime.signal.aborted) lost(reason)
    }
  })()
  return { state, dispose: async () => { lifetime.abort(); await stream.dispose(); await reading } }
}
