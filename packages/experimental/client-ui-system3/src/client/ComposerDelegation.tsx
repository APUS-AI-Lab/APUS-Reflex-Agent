/** Composer marker beside the model selector while the running turn has handed its work to a subagent. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-experimental-system3/types'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './System3Dock.module.css'

/**
 * Name the delegate next to the model selector, which keeps showing the coordinating model.
 * @param props - Projection and Session subscriptions with translations.
 * @returns The marker while a delegation of the running turn is prepared or runs, otherwise null.
 */
export function System3ComposerDelegation(props: Pick<PropsRuntime<'conversation.input.right'>, 'useProjection' | 'useSession'>
  & PropsLocale<'system3'>) {
  const facts = props.useProjection('system3Runtime')
  const running = props.useSession(s => s.running)
  const delegation = facts?.entry?.route?.delegation
  if (!running || delegation === undefined || delegation === null || !delegation.injected) return null
  const run = facts?.subagentRun ?? null
  const active = run !== null && run.state === 'running'
  // Once this turn has called the tool, a settled run is its own result under review, so the hand-off is over.
  if (!active && run !== null && delegation.called) return null
  // Before the call, a settled run belongs to an earlier delegation and the new one has not reported yet.
  const text = active ? props.t('composerDelegated', { provider: run.provider }) : props.t('composerDelegating')
  return <Tooltip label={props.t('composerDelegationHint')} side="top" delayMs={300}>
    <span className={css.delegating} role="status"><span className={css.dot} data-active="true" aria-hidden="true" />{text}</span>
  </Tooltip>
}
