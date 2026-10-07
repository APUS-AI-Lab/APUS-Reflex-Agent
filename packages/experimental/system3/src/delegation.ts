/** Native pre-step instruction that carries an entry delegation decision to the generation model. */
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from './runtime-projection.ts'

/** Attribution of the instruction System3 injects after an entry decision chose a delegation route. */
export interface System3DelegationSource {
  readonly kind: 'system3-delegation'
  /** Entry request whose decision chose the delegation route. */
  readonly requestId: SessionRequestId
  /** Configured delegation candidate. */
  readonly candidateId: string
  /** Model-facing subagent tool the instruction names. */
  readonly tool: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Entry delegation instruction injected by System3 before the first step of the delegated input.
     * Readers preserve the content without this producer; System3 reads the kind only to avoid a repeated injection.
     * @persistenceAttribution
     */
    'system3-delegation': System3DelegationSource
  }
}

/**
 * Render the instruction for one delegation decision. It names the tool and leaves the choice to the model.
 * @param label - Display label of the delegation route, or the tool name when the deployment set none.
 * @param tool - Subagent tool name.
 * @returns Model-visible instruction text.
 */
export function delegationInstruction(label: string, tool: string): string {
  return `[System3 入口判断] 这项任务适合委派给 ${label}。请调用 \`${tool}\` 工具，把用户的完整需求、相关文件路径和验收要求作为任务交给它，`
    + '完成后核对它的结果再回复用户。如果你确认这项任务不需要委派，直接说明原因并自行完成。'
}

/**
 * Inject the delegation instruction once, in the pre-step that first carries the delegated input.
 * The entry decision, this injected message, and the later tool call remain separate Session facts.
 * @param ctx - Plugin context providing session projections.
 */
export function installSystem3Delegation(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const entry = ctx.sessionProjections.stateOf(agent.session, 'system3Runtime')?.entry
    const delegation = entry?.route?.delegation
    if (entry === undefined || entry === null || delegation === undefined || delegation === null || delegation.injected) return decision
    const carriesInput = decision.messages.some(message => message.source.kind === 'user'
      && 'rpcId' in message.source && message.source.rpcId === entry.requestId)
    if (!carriesInput) return decision
    const instruction = createUserMessage({
      content: [{ type: 'text', text: delegationInstruction(entry.route?.label ?? delegation.tool, delegation.tool) }],
      source: { kind: 'system3-delegation', requestId: entry.requestId, candidateId: delegation.candidateId, tool: delegation.tool },
    })
    return { ...decision, messages: [...decision.messages, instruction] }
  })
}
