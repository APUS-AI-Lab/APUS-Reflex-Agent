/** Data and callbacks the local decision engine plugin injects into its slot entries. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexPrepareOptions } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { ReflexReadiness } from './readiness.ts'

/** The notice on display in the frame-wide layer; `seq` restarts the banner for each new notice. */
export type ReflexToast =
  | { readonly seq: number; readonly kind: 'enabled' | 'undoFailed' }
  | { readonly seq: number; readonly kind: 'actionFailed'; readonly message: string }

/** Host commands; each rejects with the Remote failure so the calling surface can report it. */
export interface ReflexLocalActions {
  prepare: (options?: ReflexPrepareOptions) => Promise<void>
  pause: () => Promise<void>
  cancel: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  remove: () => Promise<void>
  /** Open the bundle details page. */
  openDetails: () => void
  /** Announce a failed command raised from a surface without room for an in-place notice. */
  reportFailure: (error: unknown) => void
  /** Hide the slow-Mac chip until the page reloads; no Host state changes. */
  dismissSlowChip: () => void
  /** Hide the current notice; closing the enablement notice acknowledges it on the Host. */
  dismissToast: () => void
  /**
   * Hide the enablement notice and turn local decisions off, which also clears the Host marker;
   * a failure replaces it with the undo-failed notice.
   */
  undoEnable: () => void
}

/** Entry-injected Host readiness, notice state, and commands. */
export interface ReflexLocalInjected extends ReflexLocalActions {
  hooks: {
    reflexReadiness: HostObservable<ReflexReadiness>
    reflexToast: HostObservable<ReflexToast | null>
    /** Whether the user chose Not now on the slow-Mac chip during this page load. */
    reflexSlowChipDismissed: HostObservable<boolean>
  }
}
