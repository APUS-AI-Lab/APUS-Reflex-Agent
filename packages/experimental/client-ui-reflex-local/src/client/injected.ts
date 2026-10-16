/** Data and callbacks the local decision engine plugin injects into its slot entries. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexPrepareOptions, ReflexSwitch, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { ReflexReadiness } from './readiness.ts'

/** The notice on display in the frame-wide layer; `seq` restarts the banner for each new notice. */
export type ReflexToast =
  | { readonly seq: number; readonly kind: 'enabled' | 'undoFailed' }
  | { readonly seq: number; readonly kind: 'switched'; readonly change: ReflexSwitch }
  | { readonly seq: number; readonly kind: 'actionFailed'; readonly message: string }

/** Host commands; each rejects with the Remote failure so the calling surface can report it. */
export interface ReflexLocalActions {
  /**
   * Make `options.variant` active: at once when it is downloaded and tested, otherwise after a background download and
   * self-test while the active model keeps answering.
   */
  prepare: (options?: ReflexPrepareOptions) => Promise<void>
  /** Delete one model's files; deleting the model in use keeps the local mode and leaves no active model. */
  deleteModel: (variant: ReflexVariant) => Promise<void>
  pause: () => Promise<void>
  cancel: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  /** Open the bundle details page. */
  openDetails: () => void
  /** Announce a failed command raised from a surface without room for an in-place notice. */
  reportFailure: (error: unknown) => void
  /** Hide the slow-Mac chip until the page reloads; no Host state changes. */
  dismissSlowChip: () => void
  /** Hide the current notice; closing an enablement or switch notice acknowledges it on the Host. */
  dismissToast: () => void
  /**
   * Hide the enablement notice and turn local decisions off, which also clears the Host marker;
   * a failure replaces it with the undo-failed notice.
   */
  undoEnable: () => void
  /** Hide the switch notice and select the previous model again; a failure replaces it with the undo-failed notice. */
  undoSwitch: (change: ReflexSwitch) => void
}

/** Entry-injected Host readiness, notice state, and commands. */
export interface ReflexLocalInjected extends ReflexLocalActions {
  hooks: {
    reflexReadiness: HostObservable<ReflexReadiness>
    reflexToast: HostObservable<ReflexToast | null>
    /** The live Reflex master switch (`jev.enabled`), or null while this client has no served Jev settings form. */
    reflexMaster: HostObservable<boolean | null>
    /** Whether the user chose Not now on the slow-Mac chip during this page load. */
    reflexSlowChipDismissed: HostObservable<boolean>
  }
}
