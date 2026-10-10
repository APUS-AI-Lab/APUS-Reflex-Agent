/** Human inbox priority through claim and admission; automatic messages do not fence supervision. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

/** Track claimed human input until admission or cancellation, alongside durable pending inbox input.
 * @param ctx - Owner of the supervision listeners.
 * @returns Whether the Agent has human input awaiting model admission.
 */
export function installReflexHumanInputFence(ctx: Context): (agent: Agent) => boolean {
  const claimed = new WeakMap<Session, Set<MessageId>>()
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    const ids = claimed.get(agent.session) ?? new Set<MessageId>()
    ids.add(message.id)
    claimed.set(agent.session, ids)
  })
  ctx.on('agent/inbox/discarded', ({ agent, message }) => { claimed.get(agent.session)?.delete(message.id) })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'user/message') claimed.get(session)?.delete(event.data.id)
  })
  return agent => (claimed.get(agent.session)?.size ?? 0) > 0
    || [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user')
}
