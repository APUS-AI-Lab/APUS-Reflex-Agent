/**
 * Desktop routing inside the model-credential readiness step, which renders
 * this seat only while no provider is usable. The native welcome window owns
 * signed-out credential entry, so a signed-out workspace defers the prompt to
 * the composer notice instead of asking again; a signed-in account without a
 * usable route goes straight to the API-key editor.
 */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { AccountSnapshot } from './AccountSection.tsx'
import type { DesktopOnboardingState } from './onboarding-contract.ts'

/** Observable sources the account plugin supplies to the readiness seat. */
export interface AccountOnboardingInjected {
  hooks: {
    /** Account stream state, unresolved until the Host responds. */
    account: HostObservable<AccountSnapshot>
    /** Desktop introduction state; the prompt waits until the introduction is not showing. */
    introduction: HostObservable<DesktopOnboardingState>
  }
}

/**
 * @param props - readiness-step actions plus account and introduction state.
 * @returns nothing; the step's own editor or the composer notice presents the outcome.
 */
export function AccountOnboarding({ later, useApiKey, useAccount, useIntroduction }:
  PropsRuntime<'settings.models.sign-in'> & InjectFace<AccountOnboardingInjected>) {
  const status = useAccount(snapshot => snapshot.view?.status)
  const accountFailed = useAccount(snapshot => snapshot.failed)
  const introductionPending = useIntroduction(snapshot => snapshot.visible || snapshot.status === 'loading')
  const settled = (status !== undefined || accountFailed) && !introductionPending
  useEffect(() => {
    if (!settled) return
    if (status === 'credential-stored') useApiKey()
    else later()
  }, [settled, status, useApiKey, later])
  return null
}
