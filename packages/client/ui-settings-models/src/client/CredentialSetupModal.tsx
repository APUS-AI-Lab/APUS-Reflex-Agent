/**
 * The official DeepSeek credential editor inside the shared onboarding modal.
 * The first-run step and the composer readiness notice both open it, so the
 * key is entered through the Models page's own credential-only editor.
 */

import type { ReactNode } from 'react'
import type { ModelsSettingsState } from './store.ts'
import { officialDeepSeekRow } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'

/**
 * Render the credential-only editor for the official route.
 * @param props.state - shared Models join snapshot whose readiness is `credential-missing`.
 * @param props.operations - Host operations the editor writes through.
 * @param props.schema - settings schema and immutable path callbacks.
 * @param props.t - feature copy.
 * @param props.onClose - receives whether the editor stored a credential.
 * @returns the blocking modal, or null when the joined row is unavailable.
 */
export function CredentialSetupModal({ state, operations, schema, t, onClose }: {
  state: ModelsSettingsState
  operations: ModelsOperations
  schema: SettingsSchemaOperations
  t: (key: keyof typeof en) => string
  onClose: (changed: boolean) => void
}): ReactNode {
  const row = officialDeepSeekRow(state)
  const namespace = state.namespaces.get('llm-deepseek')
  /* v8 ignore next 2 -- callers open this only for credential-missing readiness, derived from this exact joined row. */
  if (row === undefined || namespace === undefined) return null
  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <div className={styles.editor}>
        <ProviderEditor
          provider={row.entry.provider}
          displayName={row.entry.displayName}
          namespace={namespace}
          schema={schema}
          settingsPath={row.entry.settingsPath}
          operations={operations}
          t={t}
          readOnly={false}
          hideTitle
          credentialOnly
          credentialRequired
          autoFocusCredential
          cancelLabelKey="onboardingLater"
          submitLabelKey="onboardingSave"
          submitBusyLabelKey="onboardingSaving"
          onClose={onClose}
        />
      </div>
    </OnboardingModal>
  )
}
