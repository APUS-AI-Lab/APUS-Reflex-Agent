/**
 * Page-lifetime record of a deferred first-run credential prompt. Deferring
 * keeps the automatic prompt closed for the rest of this page load and leaves
 * the composer notice until the user closes it; a new page load starts
 * undeferred, so the coordinator checks provider readiness again.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Deferral facts shared by the onboarding step and the composer notice. */
export interface ReadinessDeferralState {
  /** The user postponed the automatic credential prompt during this page load. */
  deferred: boolean
  /** The user closed the composer notice during this page load. */
  noticeClosed: boolean
}

/** Owns the deferral state for one plugin activation. */
export class ReadinessDeferral {
  /** uSES-safe state source bound by both registrations. */
  readonly store: SnapshotStore<ReadinessDeferralState> = createSnapshotStore<ReadinessDeferralState>({
    deferred: false, noticeClosed: false,
  })

  /** Postpone the automatic prompt until the next page load. */
  defer(): void {
    if (this.store.getSnapshot().deferred) return
    this.store.set({ ...this.store.getSnapshot(), deferred: true })
  }

  /** Hide the composer notice until the next page load. */
  closeNotice(): void {
    if (this.store.getSnapshot().noticeClosed) return
    this.store.set({ ...this.store.getSnapshot(), noticeClosed: true })
  }
}
