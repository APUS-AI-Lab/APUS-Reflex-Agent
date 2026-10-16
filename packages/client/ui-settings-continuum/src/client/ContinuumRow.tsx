import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContinuumSettingsFace, ContinuumSettingsState } from './continuum-settings-controller.ts'
import type { ContinuumSettingsLocaleKey } from './locales.ts'
import css from './ContinuumRow.module.css'

/** Props for the memory preference in Reflex settings. */
export type ContinuumRowProps = PropsRuntime<'settings.reflex.item'>
  & PropsLocale<'settings.continuum'>
  & InjectFace<ContinuumSettingsFace>

/** Render the persistent-memory switch; the slot is absent when the Host omits Continuum. */
export function ContinuumRow({ t, useContinuumSettings, setEnabled }: ContinuumRowProps) {
  const state = useContinuumSettings(snapshot => snapshot)
  const unavailable = !state.available
  return <div className={css.row}>
    <div className={css.rowText}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.desc}>{t(unavailable ? 'unavailable' : state.failed ? 'error' : 'description')}</div>
      {!state.writable && !unavailable && <div className={css.desc} role="status">{t('readOnly')}</div>}
    </div>
    <Switch checked={state.enabled} disabled={unavailable || !state.writable || state.busy}
      label={t('title')} onChange={(next) => { void setEnabled(next) }} />
  </div>
}

export type { ContinuumSettingsLocaleKey, ContinuumSettingsState }
