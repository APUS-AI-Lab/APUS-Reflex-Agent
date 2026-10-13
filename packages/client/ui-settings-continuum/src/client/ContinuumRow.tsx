import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContinuumSettingsFace, ContinuumSettingsState } from './continuum-settings-controller.ts'
import type { ContinuumSettingsLocaleKey } from './locales.ts'

/** Props for the memory preference in Reflex settings. */
export type ContinuumRowProps = PropsRuntime<'settings.reflex.item'>
  & PropsLocale<'settings.continuum'>
  & InjectFace<ContinuumSettingsFace>

/** Render the persistent-memory switch; the slot is absent when the Host omits Continuum. */
export function ContinuumRow({ t, useContinuumSettings, setEnabled }: ContinuumRowProps) {
  const state = useContinuumSettings(snapshot => snapshot)
  const unavailable = !state.available
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 0' }}>
    <div>
      <div>{t('title')}</div>
      <div>{t(unavailable ? 'unavailable' : state.failed ? 'error' : 'description')}</div>
      {!state.writable && !unavailable && <div role="status">{t('readOnly')}</div>}
    </div>
    <Switch checked={state.enabled} disabled={unavailable || !state.writable || state.busy}
      label={t('title')} onChange={(next) => { void setEnabled(next) }} />
  </div>
}

export type { ContinuumSettingsLocaleKey, ContinuumSettingsState }
