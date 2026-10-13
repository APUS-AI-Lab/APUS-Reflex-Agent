/** Exact text admission identity and persistence receipts over native inbox events. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionPromptRequest, SessionPromptValue, SessionRequestId } from './types.ts'

/** First recorded acceptance of a client request, before any later claim or cancellation. */
export interface PromptAdmission {
  readonly event: SessionEvent
  readonly message: UserMessage
}

/** Find the original request independently of whether the driver still has it queued.
 * @param agent - Target live Agent.
 * @param requestId - Client-minted identity.
 * @returns First exact logged acceptance, including old user-message-only histories.
 */
export function findPromptAdmission(agent: Agent, requestId: SessionRequestId): PromptAdmission | undefined {
  // oxlint-disable-next-line typescript/no-deprecated -- Exact historical inbox identity predates the derived current inbox.
  for (const event of agent.session.snapshotEvents()) {
    const messages = event.type === 'agent/inbox/spliced' ? event.data.inserted
      : event.type === 'user/message' ? [event.data] : []
    for (const message of messages) {
      const source = message.source
      if (source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId) return { event, message }
    }
  }
  return undefined
}

/** Reject a reused text request identity whose exact block sequence differs.
 * @param admission - Original recorded input.
 * @param request - Retried text request.
 * @throws A conflict without re-enqueuing either payload.
 */
export function assertTextPromptMatches(admission: PromptAdmission, request: SessionPromptRequest): void {
  const content = admission.message.content
  if (content.length !== request.content.length || content.some((block, i) => {
    const next = request.content[i]
    return block.type !== 'text' || next?.type !== 'text' || block.text !== next.text
  })) {
    throw new RemoteError('session/request-conflict', 'Request identity was already used for different prompt content.', { requestId: request.requestId })
  }
}

/** Flush this Session and verify the exact original admission before reporting saved.
 * @param ctx - Host services; absence of persistence reports unavailable.
 * @param agent - Live owner of the admitted Session.
 * @param message - Accepted input, used when no source event was recorded.
 * @param admission - Original inbox insertion or legacy message event.
 * @returns Acceptance plus independent persistence status; a failed save never revokes acceptance.
 */
export async function textPromptReceipt(
  ctx: Context, agent: Agent, message: UserMessage, admission: PromptAdmission | undefined,
): Promise<SessionPromptValue> {
  const identity = { messageId: message.id,
    ...(admission === undefined ? {} : { source: { sessionId: agent.session.id, eventSeq: admission.event.seq } }) }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return { accepted: true, storage: { ...identity, state: 'unavailable' } }
  if (admission === undefined) return { accepted: true, storage: { ...identity, state: 'failed' } }
  try {
    await ctx.sessions.flush(agent.session)
    const handle = await persistence.open(agent.session.id, 'read')
    try {
      const { events } = await handle.read(admission.event.seq, 1)
      if (JSON.stringify(events[0]) !== JSON.stringify(admission.event)) {
        return { accepted: true, storage: { ...identity, state: 'failed' } }
      }
    } finally {
      await handle.close()
    }
    return { accepted: true, storage: { ...identity, state: 'saved' } }
  } catch (error: unknown) {
    ctx.logger.warn(`session input persistence failed: ${String(error)}`)
    return { accepted: true, storage: { ...identity, state: 'failed' } }
  }
}
