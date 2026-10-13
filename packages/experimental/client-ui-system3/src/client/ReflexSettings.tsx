/** Dedicated settings section for Reflex decision service configuration. */
import { useEffect } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels, type ReflexSettingsKey } from './reflex-settings-locales.ts'
import type { ReflexCardFace, ReflexCardState } from './reflex-settings-controller.ts'
import css from './ReflexSettings.module.css'

/** Renderer-bound Reflex configuration page properties. */
export type ReflexSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.reflex'> & InjectFace<ReflexCardFace>
  & PropsRenderSlots<'settings.reflex.item'>

function probeKey(state: ReflexCardState): ReflexSettingsKey {
  if (state.probe.pending) return 'testing'
  if (state.probe.failed) return 'failed'
  const result = state.probe.result
  if (!result) return 'untested'
  if (result.kind === 'ok') return 'connected'
  if (result.status === 401 || result.status === 403 || result.code === 'missing-credential') return state.mode === 'trial' ? 'trialAuthFailed' : 'authFailed'
  if (result.code === 'timeout') return 'timeout'
  if (result.code === 'model-missing') return 'modelMissing'
  if (result.code === 'decision-rejected') return 'decisionRejected'
  return 'unavailableService'
}

/** Render connection settings, unsaved diagnostics and independent runtime capability status.
 * @param props - Typed locale and staged form actions.
 * @returns The dedicated settings section.
 */
export function ReflexSettings(props: ReflexSettingsProps) {
  const { t } = props
  const state = props.useReflexCard(snapshot => snapshot)
  useEffect(() => { void props.refresh() }, [props.refresh])
  const limits = ['stallMs', 'cooldownMs', 'maxInterventions', 'feedbackMs', 'nativeSilenceMs', 'recoveryReassessmentMs', 'retryLimit', 'interruptGraceMs', 'recoveryCooldownMs', 'maxRecoveries', 'maxCandidates', 'maxFragmentChars', 'maxRestoredChars', 'maxRequestChars'] as const
  const fields = ['endpoint', 'model', 'effort', 'timeoutMs', 'apiKeyEnv'] as const
  return <section className={css.section} aria-label={t('title')}>
    <p>{t('description')}</p>
    {state.runtime?.provider === null ? <p role="status">{t('unconfigured')}</p> : null}
    <SettingsForm labels={{ ...formLabels(t), ...state.credentialSaveError ? { saveFailed: t(state.credentialSaveError === 'configured' ? 'newCredentialReference' : 'credentialCheckFailed') } : state.partialSave ? { saveFailed: t('partialSave') } : {} }} state={state} onSave={props.save} onDiscard={props.discard}>
      <div className={css.protocol}>
        <label htmlFor="reflex-mode">{t('connectionMode')}</label>
        <select id="reflex-mode" value={state.mode} disabled={!state.writable || state.saving}
          onChange={(event) => { props.selectMode(event.target.value as 'trial' | 'custom') }}>
          <option value="trial">{t('trialMode')}</option>
          <option value="custom">{t('customMode')}</option>
        </select>
        <p>{t('protocol')}: {t('protocolReflex')}</p>
        {state.mode === 'trial' && <p>{t('trialHint')}</p>}
      </div>
      {state.mode === 'custom' && <>
        {fields.map(field => <SettingsValueField key={field} id={`reflex-${field}`} label={t(field)} hint={t(`${field}Hint`)}
          overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
          disabled={!state.writable || state.saving} numeric={field === 'timeoutMs'} {...state[field]}
          onEdit={(text) =>{  props.edit(field, text) }} onReset={() =>{  props.resetField(field) }} />)}
        <SettingsSecretField id="reflex-api-key" label={t('apiKey')} hint={t('apiKeyHint')}
          disabled={!state.writable || state.saving || !state.apiKeyWritable} text={state.apiKey.text}
          configured={state.apiKeyConfigured} stateLabel={t(state.apiKeyConfigured ? 'apiKeySet' : 'apiKeyUnset')}
          onEdit={(text) =>{  props.edit('apiKey', text) }} />
      </>}
      <div className={css.actions}>
        {state.mode === 'custom' && <Button onClick={() => { void props.clearCredential() }} disabled={!state.apiKeyConfigured || !state.apiKeyWritable || state.saving}>{t('clear')}</Button>}
        <Button onClick={() => { void props.testConnection() }} disabled={state.probe.pending || state.invalid || state.saving}>{t(state.probe.pending ? 'testing' : 'test')}</Button>
      </div>
      <div role="status" aria-live="polite">
        <p>{t(probeKey(state))}{state.probe.result ? ` · ${t('latency', { ms: String(Math.round(state.probe.result.latencyMs)) })}` : ''}</p>
        {state.credentialFailed ? <p>{t('clearFailed')}</p> : null}
      </div>
      <p>{t('draft')}</p><p>{t('effective')}</p>
    </SettingsForm>
    {props.renderSlot('settings.reflex.item', {})}
    <h3>{t('capabilities')}</h3>
    {state.runtime ? <ul className={css.capabilities}>{state.runtime.capabilities.map(capability => <li key={capability.id}>
      <span>{t(capability.id)}</span><span>{t(!capability.implemented ? 'notImplemented' : capability.enabled ? 'enabled' : 'disabled')}</span>
      <small>{capability.lastOutcome ?? t('unverified')}</small>
      {capability.semanticSupervision && <small>{t(capability.semanticSupervision.enabled ? 'semanticEnabled' : 'semanticDisabled')}</small>}
      {capability.verifiedAt !== undefined && <small>{t('verifiedAt', { time: new Date(capability.verifiedAt).toISOString() })}</small>}
      {capability.settings && <details><summary>{t('deploymentSettings')}</summary><dl>{limits.flatMap(key => capability.settings?.[key] === undefined ? [] : [<div key={key}><dt>{t(key)}</dt><dd>{capability.settings[key]}</dd></div>])}</dl></details>}
    </li>)}</ul> : <p role="status">{t('runtimeUnavailable')}</p>}
    <Button onClick={() => { void props.refresh() }}>{t('refresh')}</Button>
  </section>
}
