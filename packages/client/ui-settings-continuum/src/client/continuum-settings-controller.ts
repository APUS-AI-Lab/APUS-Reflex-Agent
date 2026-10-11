import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'

/** Host settings namespace owned by the Continuum profile service. */
export const CONTINUUM_NS = 'continuum-memory'

/** Snapshot consumed by the General settings row. */
export interface ContinuumSettingsState {
  readonly available: boolean
  readonly writable: boolean
  readonly enabled: boolean
  readonly busy: boolean
  readonly failed: boolean
}

/** Registration-side face for the Continuum General row. */
export interface ContinuumSettingsFace {
  hooks: { continuumSettings: SnapshotStore<ContinuumSettingsState> }
  setEnabled: (enabled: boolean) => Promise<void>
}

/** Minimal controller for the single Reflex-owned boolean preference. */
export class ContinuumSettingsController {
  private readonly store: SnapshotStore<ContinuumSettingsState>
  private readonly unsubscribe: () => void
  private busy = false
  private failed = false

  constructor(private readonly scope: SettingsFormScope<{ enabled?: boolean }>) {
    this.store = createSnapshotStore(this.snapshot())
    this.unsubscribe = scope.subscribe(() => { this.publish() })
  }

  /** Expose the settings store and mutation operation to the UI shell.
   * @returns The registered settings face.
   */
  inject(): ContinuumSettingsFace {
    return { hooks: { continuumSettings: this.store }, setEnabled: (enabled) => { return this.setEnabled(enabled) } }
  }

  /** Persist the requested switch value when the deployment accepts writes.
   * @param enabled - Requested Continuum state.
   * @returns A promise that settles after the mutation attempt.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    const current = this.scope.getSnapshot()
    if (this.busy || !current.writable || current.status !== 'ready') return
    this.busy = true
    this.failed = false
    this.publish()
    try {
      const accepted = await this.scope.mutate([{ op: 'set', path: ['enabled'], value: enabled }], current.revision)
      this.failed = !accepted
    } catch (_error) {
      this.failed = true
    } finally {
      this.busy = false
      this.publish()
    }
  }

  /** Release the settings subscription. */
  dispose(): void {
    this.unsubscribe()
  }

  private snapshot(): ContinuumSettingsState {
    const current = this.scope.getSnapshot()
    return {
      available: current.status === 'ready',
      writable: current.writable,
      enabled: current.value?.enabled === true,
      busy: this.busy,
      failed: this.failed,
    }
  }

  private publish(): void {
    this.store.set(this.snapshot())
  }
}
