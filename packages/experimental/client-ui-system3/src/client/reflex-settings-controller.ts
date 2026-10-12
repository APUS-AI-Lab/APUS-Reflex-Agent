/** Staged Reflex connection settings and credential-free runtime observations. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ReflexConnectionResult, ReflexStatus } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin/types'
import type {} from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin/remote'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormShell,
  type SettingsFormScope, type SettingsFormPathOp,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Loader entry id retained for configuration compatibility.
 */
export const REFLEX_NS = 'jev'

/** Managed reference assigned when the user supplies a first key. */
const DEFAULT_API_KEY_REF = 'REFLEX_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The decision-provider fields this page edits. */
export interface ReflexSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Decision endpoint. */
  endpoint?: string
  model?: string
  effort?: 'low' | 'high'
  protocol?: 'openjev' | 'typesafe'
  /** Decision request deadline. */
  timeoutMs?: number
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the Reflex page renders. */
export interface ReflexCardState extends SettingsFormShell {
  /** Provider endpoint. */
  endpoint: SettingsFieldState
  model: SettingsFieldState
  effort: SettingsFieldState
  timeoutMs: SettingsFieldState
  apiKeyEnv: SettingsFieldState
  /** Last unsaved connection probe. */
  probe: { pending: boolean; result?: ReflexConnectionResult; failed: boolean }
  runtime: ReflexStatus | undefined
  credentialFailed: boolean
  /** Save preflight refused an existing reference or could not confirm its availability. */
  credentialSaveError: 'configured' | 'unavailable' | undefined
  /** Settings compensation was refused after the credential write failed. */
  partialSave: boolean
  /** The staged credential, which starts blank on every load. */
  apiKey: SettingsFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the Reflex page's slot entry injects. */
export interface ReflexCardFace extends SettingsFormActions {
  testConnection: () => Promise<void>
  clearCredential: () => Promise<void>
  refresh: () => Promise<void>
  hooks: {
    /** Page snapshot bound by the renderer as useReflexCard. */
    reflexCard: SnapshotStore<ReflexCardState>
  }
}

/** Bridges the `jev` scope and the credentials domain onto the page. */
export class ReflexCardController {
  private readonly form: SettingsFormModel<ReflexSettings>
  private readonly store: SnapshotStore<ReflexCardState>
  private readonly unsubscribe: () => void
  private probe: ReflexCardState['probe'] = { pending: false, failed: false }
  private runtime: ReflexStatus | undefined
  private saveKeyRef = DEFAULT_API_KEY_REF
  private partialSave = false
  private savedSettings: { inverse: SettingsFormPathOp[]; revision: number | undefined; originalRevision: number | undefined } | undefined
  private recoveredRevision: { from: number | undefined; to: number } | undefined
  private credentialFailed = false
  private checkingCredential = false
  private credentialSaveError: ReflexCardState['credentialSaveError']
  private disposed = false
  private epoch = 0
  private probeAbort: AbortController | undefined
  private credentialEpoch = 0
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `jev` namespace.
   * @param ctx - the page plugin's context, whose `remote.credentials` namespace
   * answers for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsFormScope<ReflexSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new SettingsFormModel(
      {
        getSnapshot: () => scope.getSnapshot(), subscribe: listener => scope.subscribe(listener),
        mutate: async (ops, expectedRevision) => {
          const user = scope.getSnapshot().user ?? {}
          const inverse: SettingsFormPathOp[] = ops.map((op) => {
            const field = op.path.join('.')
            const prior: { value?: unknown } | undefined = Object.getOwnPropertyDescriptor(user, field)
            return prior === undefined ? { op: 'unset', path: op.path } : { op: 'set', path: op.path, value: prior.value }
          })
          const revision = this.recoveredRevision !== undefined && this.recoveredRevision.from === expectedRevision
            ? this.recoveredRevision.to : expectedRevision
          const accepted = await scope.mutate(ops, revision)
          if (accepted) {
            const observedRevision = scope.getSnapshot().revision
            this.savedSettings = { inverse,
              revision: revision !== undefined && observedRevision === revision + 1 ? observedRevision : undefined,
              originalRevision: expectedRevision }
            this.recoveredRevision = undefined
          }
          return accepted
        },
      },
      [validatedText('endpoint', validEndpoint), validatedText('model', text => text.length > 0 && text.length <= 256),
        validatedText('effort', text => text === 'low' || text === 'high'),
        { ...settingsNumberField('timeoutMs'), parse: (text) => {
          const value = Number(text)
          return Number.isInteger(value) && value > 0 && value <= 2147483647 ? { kind: 'set', value } : undefined
        } },
        settingsTextField('apiKeyEnv')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      this.invalidateProbe()
      void this.readCredential(); this.store.set(this.projection())
    })
    void this.readCredential()
  }

  private projection(): ReflexCardState {
    return {
      ...this.form.shell(),
      saving: this.checkingCredential || this.form.shell().saving,
      failed: this.credentialSaveError !== undefined || this.form.shell().failed,
      endpoint: this.form.field('endpoint'), model: this.form.field('model'), effort: this.form.field('effort'),
      timeoutMs: this.form.field('timeoutMs'), apiKeyEnv: this.form.field('apiKeyEnv'),
      probe: this.probe, runtime: this.runtime, credentialFailed: this.credentialFailed,
      credentialSaveError: this.credentialSaveError, partialSave: this.partialSave,
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = this.form.field('apiKeyEnv').text.trim() || DEFAULT_API_KEY_REF
    const epoch = ++this.credentialEpoch
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (this.disposed || !response.ok || epoch !== this.credentialEpoch) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the page guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this page watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): ReflexCardFace {
    const actions = this.form.actions()
    return { hooks: { reflexCard: this.store }, ...actions,
      save: () => { void this.save() },
      edit: (field, text) => {
        if (this.checkingCredential) return
        this.credentialSaveError = undefined
        this.invalidateProbe()
        if (field === API_KEY_FIELD && !this.form.field('apiKeyEnv').text.trim()) actions.edit('apiKeyEnv', DEFAULT_API_KEY_REF)
        actions.edit(field, text)
        if (field === 'apiKeyEnv') void this.readCredential()
      },
      resetField: (field) => {
        if (this.checkingCredential) return
        this.credentialSaveError = undefined
        this.invalidateProbe(); actions.resetField(field); void this.readCredential()
      },
      discard: () => {
        if (this.checkingCredential) return
        this.credentialSaveError = undefined
        this.invalidateProbe(); this.partialSave = false; this.recoveredRevision = undefined
        actions.discard(); void this.readCredential()
      },
      testConnection: () => this.testConnection(), clearCredential: () => this.clearCredential(), refresh: () => this.refresh(),
    }
  }

  /** Read lifecycle state afresh after asynchronous work can dispose this controller. */
  private isDisposed(): boolean { return this.disposed }

  /** Refuse overwriting a live reference before either configuration or credentials can change. */
  private async save(): Promise<void> {
    const shell = this.form.shell()
    if (this.isDisposed() || this.checkingCredential || shell.saving || !shell.writable || shell.invalid || !shell.dirty) return
    this.savedSettings = undefined
    this.saveKeyRef = this.form.field('apiKeyEnv').text.trim() || DEFAULT_API_KEY_REF
    this.partialSave = false
    this.credentialSaveError = undefined
    if (this.form.field(API_KEY_FIELD).text.trim()) {
      this.checkingCredential = true
      this.store.set(this.projection())
      try {
        const response = await this.ctx.remote.credentials.describe([this.saveKeyRef])
        if (this.isDisposed()) return
        if (!response.ok) this.credentialSaveError = 'unavailable'
        else if (response.value[this.saveKeyRef]?.configured) this.credentialSaveError = 'configured'
      } catch (_error) {
        this.credentialSaveError = 'unavailable'
      } finally {
        this.checkingCredential = false
        if (!this.isDisposed()) this.store.set(this.projection())
      }
      if (this.isDisposed() || this.credentialSaveError !== undefined) return
    }
    await this.form.save()
    if (this.isDisposed() || this.form.shell().failed) return
    try { await this.refresh() }
    catch (_error) { // Status lookup failure does not undo an acknowledged configuration save.
      if (this.isDisposed()) return
      this.runtime = undefined
      this.store.set(this.projection())
    }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host acknowledged the credential write; failed writes compensate only the unchanged settings revision.
   */
  private async writeKey(value: string): Promise<boolean> {
    let accepted: boolean
    let unconfirmed = false
    try {
      accepted = (await this.ctx.remote.credentials.set(this.saveKeyRef, value)).ok
    } catch (_error) { // A transport failure leaves credential acceptance unconfirmed.
      accepted = false
      unconfirmed = true
    }
    if (!accepted) {
      this.partialSave = unconfirmed
      const saved = this.savedSettings
      if (saved !== undefined) {
        let restored = false
        if (saved.revision !== undefined) {
          try { restored = await this.scope.mutate(saved.inverse, saved.revision) }
          catch (_error) { /* Preserve current configuration when compensation cannot be confirmed. */ }
        }
        this.partialSave = unconfirmed || !restored
        const revision = this.scope.getSnapshot().revision
        if (restored && revision !== undefined) this.recoveredRevision = { from: saved.originalRevision, to: revision }
      }
      return false
    }
    try { await this.readCredential() }
    catch (_error) { /* A failed status refresh cannot invalidate an acknowledged write. */ }
    return true
  }

  /** Refresh runtime capability observations when opening this page. */
  async refresh(): Promise<void> {
    const response = await this.ctx.remote.reflex.readStatus()
    if (this.disposed) return
    this.runtime = response.ok ? response.value : undefined
    this.store.set(this.projection())
    await this.readCredential()
  }

  /** Test staged values without writing either the settings document or the credential store. */
  async testConnection(): Promise<void> {
    if (this.probe.pending || this.form.shell().invalid) return
    const epoch = ++this.epoch
    const controller = new AbortController()
    this.probeAbort = controller
    this.probe = { pending: true, failed: false }
    this.store.set(this.projection())
    try {
      const apiKey = this.form.field(API_KEY_FIELD).text.trim()
      const apiKeyEnv = this.form.field('apiKeyEnv').text.trim()
      const response = await this.ctx.remote.reflex.testConnection({
        endpoint: this.form.field('endpoint').text.trim(), model: this.form.field('model').text.trim(),
        effort: this.form.field('effort').text.trim() as 'high' | 'low',
        protocol: this.scope.getSnapshot().value?.protocol ?? 'openjev',
        timeoutMs: Number(this.form.field('timeoutMs').text),
        ...apiKeyEnv ? { apiKeyEnv } : {}, ...apiKey ? { apiKey } : {},
      }, controller.signal)
      if (this.disposed || epoch !== this.epoch) return
      this.probe = response.ok ? { pending: false, failed: false, result: response.value } : { pending: false, failed: true }
    } catch (_error) {
      if (this.disposed || epoch !== this.epoch) return
      this.probe = { pending: false, failed: true }
    }
    this.probeAbort = undefined
    this.store.set(this.projection())
  }

  /** Remove only the currently stored credential; environment-owned values remain read-only. */
  async clearCredential(): Promise<void> {
    if (!this.credential.writable) return
    const response = await this.ctx.remote.credentials.unset(this.credential.ref)
    if (this.disposed) return
    this.credentialFailed = !response.ok
    this.invalidateProbe()
    await this.readCredential()
    this.store.set(this.projection())
  }

  private invalidateProbe(): void {
    this.epoch++
    this.probeAbort?.abort()
    this.probeAbort = undefined
    this.probe = { pending: false, failed: false }
  }

  /** Release configuration subscriptions. */
  dispose(): void { this.disposed = true; this.invalidateProbe(); this.unsubscribe(); this.form.dispose() }

}

/** Form validation mirrors the Host input requirements before save or probe. */
function validEndpoint(text: string): boolean {
  try {
    const url = new URL(text)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.search && !url.hash
  } catch (_error) { return false }
}

function validatedText(field: string, accepts: (text: string) => boolean): SettingsFieldSpec {
  return { ...settingsTextField(field), parse: text => accepts(text.trim()) ? { kind: 'set', value: text.trim() } : undefined }
}
