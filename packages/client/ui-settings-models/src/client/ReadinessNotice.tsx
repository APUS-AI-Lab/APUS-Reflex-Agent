/**
 * Composer notice after the first-run credential prompt is deferred. It stays
 * above the composer while no provider is usable, reopens the same credential
 * editor on request, and closes for the rest of the page load.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconCloseOutlineRegular, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { ReadinessDeferral, ReadinessDeferralState } from './readiness-deferral.ts'
import type { en } from './locales.ts'
import { CredentialSetupModal } from './CredentialSetupModal.tsx'
import css from './DeepSeekOnboardingDialog.module.css'

/** Registration-side dependencies of {@link ReadinessNotice}. */
export interface ReadinessNoticeInjected {
  hooks: {
    /** Shared Models-page join state. */
    models: SnapshotStore<ModelsSettingsState>
    /** Page-lifetime deferral written by the first-run step. */
    deferral: SnapshotStore<ReadinessDeferralState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Records that the user closed this notice. */
  deferral: ReadinessDeferral
  /** The Host operations the reused Models credential editor writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** The feature's injected dependencies; the notice reads no composer-zone owner data. */
export type ReadinessNoticeProps = InjectFace<ReadinessNoticeInjected>

/**
 * Show the deferred readiness notice while the official credential is still missing.
 * @param props - Models feature dependencies.
 * @returns the notice, the credential editor it opened, or null.
 */
export function ReadinessNotice({ useModels, useDeferral, controller, deferral, operations, schema, t }: ReadinessNoticeProps): ReactNode {
  const state = useModels(snapshot => snapshot)
  const { deferred, noticeClosed } = useDeferral(snapshot => snapshot)
  const [editing, setEditing] = useState(false)
  if (!deferred || onboardingReadiness(state).kind !== 'credential-missing') return null
  if (editing) {
    return <CredentialSetupModal state={state} operations={operations} schema={schema} t={t} onClose={(changed) => {
      setEditing(false)
      if (changed) void controller.load()
    }} />
  }
  if (noticeClosed) return null
  return (
    <div className={css.dock} data-readiness-notice>
      <div className={css.notice} role="status">
        <span className={css.icon} aria-hidden><IconWarningOutlineRegular size={14} /></span>
        <span className={css.text}>{t('readinessNotice')}</span>
        <Button variant="primary" size="sm" onClick={() => { setEditing(true) }}>{t('readinessConfigure')}</Button>
        <button type="button" className={css.close} aria-label={t('close')} onClick={() => { deferral.closeNotice() }}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </div>
    </div>
  )
}
