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
const DEFAULT_API_KEY_REF = 'REFLEX_CUSTOM_API_KEY'

/** Public service preset; credentials are provisioned independently on the Host. */
export const REFLEX_TRIAL = {
  endpoint: 'https://ac2n5m38jjciqg-8086.proxy.runpod.net',
  model: 'APUS-OpenJev-v1-9B-5949',
  apiKeyEnv: 'APUS_REFLEX_TRIAL_API_KEY',
} as const

/** The connection choices offered by the product; `local` routes decisions to a provider named by `defaultProviderId`. */
export type ReflexConnectionMode = 'trial' | 'custom' | 'local'

const CONNECTION_FIELDS = ['endpoint', 'model', 'effort', 'timeoutMs', 'apiKeyEnv', 'protocol'] as const
type ConnectionDraft = Record<typeof CONNECTION_FIELDS[number], string>

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** Jev field naming a non-built-in default provider; only the local engine sets it. */
const PROVIDER_FIELD = 'defaultProviderId'

/** The decision-provider fields this page edits. */
export interface ReflexSettings {
  /** Whether Reflex decisions run; absence means on. */
  enabled?: boolean
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Decision endpoint. */
  endpoint?: string
  model?: string
  effort?: 'low' | 'high'
  protocol?: 'openjev' | 'typesafe'
  /** Decision request deadline. */
  timeoutMs?: number
  /** Registered provider answering instead of the built-in endpoint; set by the local engine, cleared by leaving local mode. */
  defaultProviderId?: string
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
  /** Saved state of the Reflex switch. */
  enabled: boolean
  /** A switch change is being saved. */
  toggling: boolean
  /** The last switch change was not saved. */
  toggleFailed: boolean
  /** Selected service preset or editable connection. */
  mode: ReflexConnectionMode
  /** Provider endpoint. */
  endpoint: SettingsFieldState
  model: SettingsFieldState
  effort: SettingsFieldState
  protocol: SettingsFieldState
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
  /** Stage another connection mode without saving or testing it. */
  selectMode: (mode: ReflexConnectionMode) => void
  /** Save the Reflex switch at once, independently of the staged connection form. */
  setEnabled: (enabled: boolean) => Promise<void>
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
  private mode: ReflexConnectionMode = 'custom'
  private initialized = false
  private customDraft: ConnectionDraft | undefined
  private probe: ReflexCardState['probe'] = { pending: false, failed: false }
  private runtime: ReflexStatus | undefined
  private saveKeyRef = DEFAULT_API_KEY_REF
  private partialSave = false
  private savedSettings: { inverse: SettingsFormPathOp[]; revision: number | undefined; originalRevision: number | undefined } | undefined
  private recoveredRevision: { from: number | undefined; to: number } | undefined
  private credentialFailed = false
  private toggling = false
  private toggleFailed = false
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
        { ...validatedText('protocol', text => text === 'openjev'),
          format: value => typeof value === 'string' ? value : 'openjev' },
        { ...settingsNumberField('timeoutMs'), parse: (text) => {
          const value = Number(text)
          return Number.isInteger(value) && value > 0 && value <= 2147483647 ? { kind: 'set', value } : undefined
        } },
        settingsTextField('apiKeyEnv'), settingsTextField(PROVIDER_FIELD)],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      this.initializeMode()
      if (!this.form.shell().dirty && !this.form.shell().saving) this.mode = this.savedMode()
      this.invalidateProbe()
      void this.readCredential(); this.store.set(this.projection())
    })
    this.initializeMode()
    void this.readCredential()
  }

  private projection(): ReflexCardState {
    return {
      ...this.form.shell(),
      enabled: this.scope.getSnapshot().value?.enabled !== false, toggling: this.toggling, toggleFailed: this.toggleFailed,
      mode: this.mode,
      saving: this.checkingCredential || this.form.shell().saving,
      failed: this.credentialSaveError !== undefined || this.form.shell().failed,
      endpoint: this.form.field('endpoint'), model: this.form.field('model'), effort: this.form.field('effort'),
      protocol: this.form.field('protocol'), timeoutMs: this.form.field('timeoutMs'), apiKeyEnv: this.form.field('apiKeyEnv'),
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
    const ref = this.keyReference()
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
      selectMode: (mode) => { this.selectMode(mode) },
      setEnabled: enabled => this.setEnabled(enabled),
      save: () => { void this.save() },
      edit: (field, text) => {
        if (this.checkingCredential || this.form.shell().saving || !this.form.shell().writable || this.mode !== 'custom') return
        if (field === 'apiKeyEnv' && text.trim() === REFLEX_TRIAL.apiKeyEnv) return
        this.credentialSaveError = undefined
        this.invalidateProbe()
        if (field === API_KEY_FIELD && !this.form.field('apiKeyEnv').text.trim()) actions.edit('apiKeyEnv', DEFAULT_API_KEY_REF)
        if (field === 'endpoint' && this.form.field('endpoint').text.trim() === REFLEX_TRIAL.endpoint
          && this.form.field('apiKeyEnv').text.trim() === 'REFLEX_API_KEY') actions.edit('apiKeyEnv', DEFAULT_API_KEY_REF)
        actions.edit(field, text)
        if (field === 'apiKeyEnv') void this.readCredential()
      },
      resetField: (field) => {
        if (this.checkingCredential || this.mode !== 'custom') return
        this.credentialSaveError = undefined
        this.invalidateProbe(); actions.resetField(field)
        if (this.form.field('apiKeyEnv').text.trim() === REFLEX_TRIAL.apiKeyEnv) actions.edit('apiKeyEnv', DEFAULT_API_KEY_REF)
        void this.readCredential()
      },
      discard: () => {
        if (this.checkingCredential) return
        this.credentialSaveError = undefined
        this.invalidateProbe(); this.partialSave = false; this.recoveredRevision = undefined
        actions.discard(); this.mode = this.savedMode(); this.customDraft = undefined
        this.store.set(this.projection()); void this.readCredential()
      },
      testConnection: () => this.testConnection(), clearCredential: () => this.clearCredential(), refresh: () => this.refresh(),
    }
  }

  private async setEnabled(enabled: boolean): Promise<void> {
    const current = this.scope.getSnapshot()
    if (this.toggling || this.form.shell().saving || !current.writable || current.status !== 'ready') return
    this.toggling = true
    this.toggleFailed = false
    this.store.set(this.projection())
    try {
      this.toggleFailed = !await this.scope.mutate([{ op: 'set', path: ['enabled'], value: enabled }], current.revision)
    } catch (_error) {
      // A rejected write leaves the saved switch unchanged; the page reports it and the user can retry.
      this.toggleFailed = true
    } finally {
      this.toggling = false
      if (!this.disposed) this.store.set(this.projection())
    }
  }

  private keyReference(): string {
    const ref = this.form.field('apiKeyEnv').text.trim() || DEFAULT_API_KEY_REF
    return ref === REFLEX_TRIAL.apiKeyEnv && (this.mode !== 'trial'
      || this.form.field('endpoint').text.trim() !== REFLEX_TRIAL.endpoint) ? DEFAULT_API_KEY_REF : ref
  }

  private savedMode(): ReflexConnectionMode {
    const value = this.scope.getSnapshot().value
    if (value?.defaultProviderId) return 'local'
    return value?.endpoint === REFLEX_TRIAL.endpoint && value.model === REFLEX_TRIAL.model
      && value.apiKeyEnv === REFLEX_TRIAL.apiKeyEnv ? 'trial' : 'custom'
  }

  private initializeMode(): void {
    if (this.initialized || this.scope.getSnapshot().status !== 'ready') return
    this.initialized = true
    this.mode = this.savedMode()
    const value = this.scope.getSnapshot().value
    if (this.scope.getSnapshot().writable) {
      if (!value?.endpoint && !value?.model && this.mode !== 'local') this.selectMode('trial')
      if (value?.protocol === 'typesafe') this.form.actions().edit('protocol', 'openjev')
      if (this.mode === 'custom' && value?.apiKeyEnv === REFLEX_TRIAL.apiKeyEnv) this.form.actions().edit('apiKeyEnv', DEFAULT_API_KEY_REF)
    }
    this.store.set(this.projection())
  }

  private selectMode(mode: ReflexConnectionMode): void {
    if (this.checkingCredential || this.form.shell().saving || !this.form.shell().writable || mode === this.mode) return
    const actions = this.form.actions()
    // Leaving local mode for custom starts from the saved connection, which local mode left untouched.
    if (this.mode === 'custom' || (this.mode === 'local' && mode === 'custom' && this.customDraft === undefined)) {
      this.customDraft = Object.fromEntries(CONNECTION_FIELDS.map(field => [field, this.form.field(field).text])) as ConnectionDraft
    }
    this.invalidateProbe()
    this.credentialSaveError = undefined
    if (mode === 'local') {
      // The local engine owns enabling; leaving staged connection edits would let Save write a mode the page no longer shows.
      actions.discard()
      this.mode = mode
      this.store.set(this.projection())
      return
    }
    this.mode = mode
    actions.edit(PROVIDER_FIELD, '')
    actions.edit(API_KEY_FIELD, '')
    const draft: ConnectionDraft = mode === 'trial' ? {
      ...REFLEX_TRIAL, protocol: 'openjev', effort: 'high', timeoutMs: '30000',
    } : this.customDraft ?? {
      endpoint: '', model: '', protocol: 'openjev', effort: 'high', timeoutMs: '30000', apiKeyEnv: DEFAULT_API_KEY_REF,
    }
    const trialReference = draft.apiKeyEnv === REFLEX_TRIAL.apiKeyEnv
      || (draft.endpoint === REFLEX_TRIAL.endpoint && draft.model === REFLEX_TRIAL.model && draft.apiKeyEnv === 'REFLEX_API_KEY')
    for (const field of CONNECTION_FIELDS) actions.edit(field, field === 'protocol' ? 'openjev'
      : field === 'apiKeyEnv' && mode === 'custom' && trialReference ? DEFAULT_API_KEY_REF : draft[field])
    void this.readCredential()
    this.store.set(this.projection())
  }

  /** Read lifecycle state afresh after asynchronous work can dispose this controller. */
  private isDisposed(): boolean { return this.disposed }

  /** Refuse overwriting a live reference before either configuration or credentials can change. */
  private async save(): Promise<void> {
    const shell = this.form.shell()
    if (this.isDisposed() || this.checkingCredential || shell.saving || !shell.writable || shell.invalid || !shell.dirty) return
    this.savedSettings = undefined
    this.saveKeyRef = this.keyReference()
    if (this.form.field('apiKeyEnv').text.trim() !== this.saveKeyRef) this.form.actions().edit('apiKeyEnv', this.saveKeyRef)
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
      const apiKeyEnv = this.keyReference()
      const response = await this.ctx.remote.reflex.testConnection({
        endpoint: this.form.field('endpoint').text.trim(), model: this.form.field('model').text.trim(),
        effort: this.form.field('effort').text.trim() as 'high' | 'low',
        protocol: this.form.field('protocol').text.trim() as 'openjev' | 'typesafe',
        timeoutMs: Number(this.form.field('timeoutMs').text),
        apiKeyEnv, ...apiKey ? { apiKey } : {},
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
    if (this.mode !== 'custom' || !this.credential.writable) return
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
