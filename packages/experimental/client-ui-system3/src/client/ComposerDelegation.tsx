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
  // A settled run belongs to an earlier delegation; the new one has not reported yet.
  const active = run !== null && run.state === 'running'
  const text = active ? props.t('composerDelegated', { provider: run.provider }) : props.t('composerDelegating')
  return <Tooltip label={props.t('composerDelegationHint')} side="top" delayMs={300}>
    <span className={css.delegating} role="status"><span className={css.dot} data-active="true" aria-hidden="true" />{text}</span>
  </Tooltip>
}
