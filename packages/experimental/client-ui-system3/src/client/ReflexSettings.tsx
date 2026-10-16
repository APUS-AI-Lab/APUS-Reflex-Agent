/** Reflex settings: a master switch, then the 决策服务, 决策前置, and 记忆 modules in the General section's row layout. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  Button, IconChevronDownOutlineRegular, Menu, SettingsSecretField, SettingsValueField, Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexSettingsKey } from './reflex-settings-locales.ts'
import type { ReflexCardFace, ReflexCardState, ReflexConnectionMode } from './reflex-settings-controller.ts'
import css from './ReflexSettings.module.css'

/** Renderer-bound Reflex configuration page properties. */
export type ReflexSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.reflex'> & InjectFace<ReflexCardFace>
  & PropsRenderSlots<'settings.reflex.item' | 'settings.reflex.local'>

const MODES: readonly ReflexConnectionMode[] = ['trial', 'custom', 'local']
const FIELDS = ['endpoint', 'model', 'effort', 'timeoutMs', 'apiKeyEnv'] as const

function probeKey(state: ReflexCardState): ReflexSettingsKey {
  if (state.probe.pending) return 'testing'
  if (state.probe.failed) return 'failed'
  const result = state.probe.result
  if (!result) return 'untested'
  if (result.kind === 'ok') return 'connected'
  // A missing credential stops the test before any request; a 401/403 is the service refusing the credential sent.
  if (result.code === 'missing-credential') return state.mode === 'trial' ? 'trialNoCredential' : 'noCredential'
  if (result.status === 401 || result.status === 403) return state.mode === 'trial' ? 'trialAuthFailed' : 'authFailed'
  if (result.code === 'timeout') return 'timeout'
  if (result.code === 'model-missing') return 'modelMissing'
  if (result.code === 'decision-rejected') return 'decisionRejected'
  return 'unavailableService'
}

/**
 * The measured duration of the last connection test.
 * @param state - page snapshot holding the probe result.
 * @returns whole milliseconds, or undefined when no request was sent or nothing measurable elapsed.
 */
function probeLatency(state: ReflexCardState): number | undefined {
  const result = state.probe.result
  if (result === undefined || (result.kind === 'failed' && result.code === 'missing-credential')) return undefined
  const ms = Math.round(result.latencyMs)
  return ms > 0 ? ms : undefined
}

/** One titled module; while the master switch is off its title says so and its `dimmable` content dims. */
function Module({ titleKey, paused, inert, children, t, className }: {
  readonly titleKey: ReflexSettingsKey
  readonly paused: boolean
  readonly inert?: boolean
  readonly children: ReactNode
  readonly t: ReflexSettingsProps['t']
  readonly className?: string | undefined
}) {
  // React 18 has no `inert` prop; the attribute is set on the element so paused contributed rows take no input.
  return <section className={className === undefined ? css.module : `${css.module} ${className}`} data-paused={paused}
    aria-label={t(titleKey)} ref={(node) => { if (node !== null) node.inert = inert === true }}>
    <h3 className={css.moduleTitle}>{t(titleKey)}{paused && <span className={css.pausedNote}>{t('pausedByMaster')}</span>}</h3>
    {children}
  </section>
}

/** The remote connection fields of the preset and custom modes, their single Save row, and the connection status row. */
function ConnectionForm({ state, paused, t, ...props }: Pick<ReflexSettingsProps, 'save' | 'discard' | 'edit' | 'resetField'
  | 'testConnection' | 'clearCredential' | 't'> & { state: ReflexCardState; paused: boolean }) {
  const discard = useRef(props.discard)
  discard.current = props.discard
  // Staged edits belong to this form; leaving it, including for local mode, drops them.
  useEffect(() => () => { discard.current() }, [])
  if (!state.available) return <p className={css.fallback} role="status">{t('unavailable')}</p>
  const locked = !state.writable || state.saving || paused
  const ms = probeLatency(state), latency = ms === undefined ? '' : ` · ${t('latency', { ms: String(ms) })}`
  const failure: ReflexSettingsKey | undefined = state.credentialSaveError === 'configured' ? 'newCredentialReference'
    : state.credentialSaveError === 'unavailable' ? 'credentialCheckFailed' : state.partialSave ? 'partialSave' : state.failed ? 'saveFailed' : undefined
  return <div className={css.dimmable}>
    {!state.writable && <p className={css.fallback} role="status">{t('readOnly')}</p>}
    {state.mode === 'custom' && <div className={css.fields}>
      {FIELDS.map(field => <SettingsValueField key={field} id={`reflex-${field}`} label={t(field)} hint={t(`${field}Hint`)}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        disabled={locked} numeric={field === 'timeoutMs'} {...state[field]}
        onEdit={(text) => { props.edit(field, text) }} onReset={() => { props.resetField(field) }} />)}
      <SettingsSecretField id="reflex-api-key" label={t('apiKey')} hint={t('apiKeyHint')}
        disabled={locked || !state.apiKeyWritable} text={state.apiKey.text}
        configured={state.apiKeyConfigured} stateLabel={t(state.apiKeyConfigured ? 'apiKeySet' : 'apiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }} />
    </div>}
    <div className={css.row}>
      {failure === undefined
        ? <p className={css.saveNote}>{t('effective')}</p>
        : <p className={css.saveError} role="status">{t(failure)}</p>}
      <Button variant="primary" size="sm" disabled={!state.dirty || state.invalid || locked} onClick={props.save}>
        {t(state.saving ? 'saving' : 'save')}</Button>
    </div>
    <div className={css.row}>
      <div className={css.rowText} role="status" aria-live="polite">
        <div className={css.title}>{t('connectionStatus')}</div>
        <div className={css.desc}>{t(probeKey(state))}{latency}</div>
        {state.credentialFailed ? <div className={css.error}>{t('clearFailed')}</div> : null}
      </div>
      <div className={css.controls}>
        {state.mode === 'custom' && <Button size="sm" variant="outline" onClick={() => { void props.clearCredential() }}
          disabled={!state.apiKeyConfigured || !state.apiKeyWritable || locked}>{t('clear')}</Button>}
        <Button size="sm" variant="outline" onClick={() => { void props.testConnection() }}
          disabled={state.probe.pending || state.invalid || state.saving || paused}>{t(state.probe.pending ? 'testing' : 'test')}</Button>
      </div>
    </div>
  </div>
}

/** Capabilities that run before the main model answers and follow the 决策前置 switch, in display order. */
const PRESTEP_CAPABILITIES = ['skillSelection', 'workspacePrefetch', 'entryRouting'] as const

/**
 * The 决策前置 switch and, as compact read-only rows, the capabilities this build installs: each is running, or suspended by
 * the switch; a capability that is neither is not installed and gets no row.
 */
function Prestep({ state, setPrestep, t }: Pick<ReflexSettingsProps, 'setPrestep' | 't'> & { state: ReflexCardState }) {
  const installed = PRESTEP_CAPABILITIES.flatMap((id) => {
    const capability = state.runtime?.capabilities.find(item => item.id === id)
    return capability?.enabled === true || capability?.suspended === true ? [{ id, enabled: capability.enabled }] : []
  })
  const { prestep } = state
  return <>
    {prestep.available && <div className={`${css.row} ${css.dimmable}`}>
      <div className={css.rowText}>
        <div className={css.title}>{t('prestepTitle')}</div>
        <div className={css.desc}>{t('prestepDescription')}</div>
        {prestep.failed && <div className={css.error} role="alert">{t('switchFailed')}</div>}
      </div>
      <Switch checked={prestep.enabled} label={t('prestepTitle')} disabled={!state.enabled || !prestep.writable || prestep.toggling}
        onChange={(next) => { void setPrestep(next) }} />
    </div>}
    {state.runtime === undefined && <p className={css.fallback}>{t('runtimeUnavailable')}</p>}
    {installed.length > 0 && <ul className={css.subRows} data-active={installed.some(capability => capability.enabled)}>
      {installed.map(capability => <li key={capability.id}>
        <span>{t(capability.id)}</span>
        <span className={css.subStatus}>{t(!state.enabled ? 'pausedByMaster' : capability.enabled ? 'enabled' : 'suspendedByPrestep')}</span>
      </li>)}
    </ul>}
  </>
}

/** Render the master switch and the three modules.
 * @param props - Typed locale and staged form actions.
 * @returns The dedicated settings section.
 */
export function ReflexSettings(props: ReflexSettingsProps) {
  const { t } = props
  const state = props.useReflexCard(snapshot => snapshot)
  const [choosing, setChoosing] = useState(false)
  const reset = useRef(props.reset)
  reset.current = props.reset
  useEffect(() => { void props.refresh() }, [props.refresh])
  useEffect(() => () => { reset.current() }, [])
  const paused = !state.enabled
  return <section className={css.section} aria-label={t('title')}>
    <header className={css.header}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('subtitle')}</p>
    </header>
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('switchTitle')}</div>
        <div className={css.desc}>{t(state.enabled ? 'switchOn' : 'switchOff')}</div>
        {state.toggleFailed && <div className={css.error} role="alert">{t('switchFailed')}</div>}
      </div>
      <Switch checked={state.enabled} label={t('switchTitle')} disabled={!state.writable || state.toggling || state.saving}
        onChange={(next) => { void props.setEnabled(next) }} />
    </div>
    <Module titleKey="serviceTitle" paused={paused} t={t}>
      <div className={`${css.row} ${css.dimmable}`}>
        <div className={css.rowText}>
          <div className={css.title}>{t('connectionMode')}</div>
          <div className={css.desc}>{t(`modeHint.${state.mode}`)}</div>
          {state.localChoiceFailed && <div className={css.error} role="alert">{t('localChoiceFailed')}</div>}
        </div>
        <Menu open={choosing} onClose={() => { setChoosing(false) }} align="end" portal selectedId={state.mode}
          items={MODES.map(mode => ({ id: mode, label: t(`${mode}Mode`) }))}
          onSelect={(id) => { setChoosing(false); props.selectMode(id as ReflexConnectionMode) }}
          anchor={<button type="button" id="reflex-mode" className={css.selector} aria-haspopup="menu" aria-expanded={choosing}
            aria-label={t('connectionMode')} disabled={!state.writable || state.saving || paused} onClick={() => { setChoosing(value => !value) }}>
            {t(`${state.mode}Mode`)}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>} />
      </div>
      {state.mode === 'local'
        ? <div className={css.modeBody}>{props.renderSlot('settings.reflex.local', {}, {
          fallback: <p className={css.fallback} role="status" data-reflex-local="unavailable">{t('localUnavailable')}</p>,
        })}</div>
        : <ConnectionForm state={state} paused={paused} t={t} save={props.save} discard={props.discard} edit={props.edit}
          resetField={props.resetField} testConnection={props.testConnection} clearCredential={props.clearCredential} />}
    </Module>
    <Module titleKey="prestepModule" paused={paused} t={t}>
      <Prestep state={state} setPrestep={props.setPrestep} t={t} />
    </Module>
    <Module titleKey="memoryModule" paused={paused} inert={paused} t={t} className={css.memory}>
      <div className={`${css.items} ${css.dimmable}`}>{props.renderSlot('settings.reflex.item', {})}</div>
    </Module>
  </section>
}
