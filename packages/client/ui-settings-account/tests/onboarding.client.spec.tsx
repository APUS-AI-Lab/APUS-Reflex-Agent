// @vitest-environment jsdom
/** The Desktop readiness seat routes a provider-less workspace by account state. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { AccountOnboarding } from '../src/client/AccountOnboarding.tsx'
import type { AccountSnapshot } from '../src/client/AccountSection.tsx'
import type { DesktopOnboardingState } from '../src/client/onboarding-contract.ts'

afterEach(cleanup)

const unused = (): never => { throw new Error('AccountOnboarding does not consume global hooks') }
const globals: GlobalStandardProps = {
  usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
  useSessionRetainInfo: unused, useResource: unused, useWorkspaces: unused,
}
const links = { usageUrl: '', topUpUrl: '' }
const introductionDone: DesktopOnboardingState = {
  status: 'ready', visible: false, creditFunded: false, error: null,
  progress: { version: 1, step: 'done', purpose: null, process: 'standard', completion: 'skipped', usage: 'compact', developerTools: false },
}

function harness() {
  const state = {
    account: { view: undefined, details: undefined, failed: false } as AccountSnapshot,
    introduction: { ...introductionDone, status: 'loading' } as DesktopOnboardingState,
  }
  const props = {
    ...globals,
    later: vi.fn(), useApiKey: vi.fn(),
    useAccount: <T,>(select: (snapshot: AccountSnapshot) => T) => select(state.account),
    useIntroduction: <T,>(select: (snapshot: DesktopOnboardingState) => T) => select(state.introduction),
  }
  const view = render(<AccountOnboarding {...props} />)
  return { state, props, rerender: () => { view.rerender(<AccountOnboarding {...props} />) } }
}

it('waits for account state and the introduction before opening the key editor for a signed-in account', () => {
  const h = harness()
  expect(h.props.useApiKey).not.toHaveBeenCalled()
  h.state.account = { ...h.state.account, view: { status: 'credential-stored', attempt: null, links } }
  h.state.introduction = { ...introductionDone, status: 'ready', visible: true, progress: { ...introductionDone.progress, step: 'credit' } }
  h.rerender()
  expect(h.props.useApiKey).not.toHaveBeenCalled()
  h.state.introduction = introductionDone
  h.rerender()
  expect(h.props.useApiKey).toHaveBeenCalledOnce()
  expect(h.props.later).not.toHaveBeenCalled()
  expect(document.body.textContent).toBe('')
})

it('defers to the composer notice when signed out because the native welcome owns that entry', () => {
  const h = harness()
  h.state.introduction = introductionDone
  h.rerender()
  expect(h.props.later).not.toHaveBeenCalled()
  h.state.account = { ...h.state.account, view: { status: 'signed-out', attempt: null, links } }
  h.rerender()
  expect(h.props.later).toHaveBeenCalledOnce()
  expect(h.props.useApiKey).not.toHaveBeenCalled()
})

it('defers when the account stream failed before reporting a state', () => {
  const h = harness()
  h.state.introduction = introductionDone
  h.state.account = { ...h.state.account, failed: true }
  h.rerender()
  expect(h.props.later).toHaveBeenCalledOnce()
  expect(h.props.useApiKey).not.toHaveBeenCalled()
})
