/**
 * Completion review: before the model marks a DSH goal complete, Jev checks the goal and each requirement in the task frame
 * against a digest of what the Agent actually did. A confident "not met" or a response to an obsolete task frame refuses
 * completion up to a per-Session, per-goal limit; provider failure and an unsure response to the current frame let it through.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type { System3DataClass, System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { Message, MessageId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { noulVerdict, runSystem3Decision, validateSystem3DecisionSettings, type System3DecisionContext,
  type System3DecisionResult, type System3DecisionSettings, type System3DecisionSpec } from './decision-kernel.ts'
import type { System3JevOptions } from './decisions.ts'
import type { System3TaskFrame } from './task-frame.ts'

/** Mode, thresholds, and limits of the completion review; deployment-owned. */
export interface System3CompletionReviewConfig extends System3DecisionSettings {
  /** Data classes of Session text sent to Jev, checked against the privacy policy. */
  readonly sessionDataClasses: readonly System3DataClass[]
  /** Refusals per Session and goal before later completions are reviewed without refusal. */
  readonly maxRefusals: number
  /** Most recent tool calls summarized for Jev. */
  readonly evidenceCalls: number
  /** Characters kept from the start and from the end of each tool result. */
  readonly resultChars: number
}

/** One review, recorded in the Session of the Agent whose goal it concerns. */
export interface System3CompletionReview {
  readonly version: 1
  readonly goalId: GoalId
  /**
   * `incomplete` when Jev found a current goal or requirement not met; `complete` when all were met;
   * otherwise `unsure`, including an obsolete task frame.
   */
  readonly decision: 'complete' | 'incomplete' | 'unsure'
  /** Requirements of the task frame judged not met, by message id. */
  readonly unmet: readonly MessageId[]
  /** Whether the goal itself was judged not met. */
  readonly goalUnmet: boolean
  /** Whether the completion was refused. */
  readonly refused: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A goal completion was reviewed; a refusal reaches the model as the `update_goal` denial reason. */
    'system3/completion-review': System3CompletionReview
  }
}

/** What the review judges. */
export interface System3ReviewInput {
  readonly objective: string
  readonly requirements: readonly string[]
  readonly evidence: string
}

type ReviewOutcome = 'complete' | 'incomplete'

const MET = { true: '有证据表明已经满足', false: '没有满足，或执行记录里没有证据' } as const
/** Only tool calls and their results are evidence; the model's own statements are left out of the digest. */
const EVIDENCE = 'state.evidence 是 AI 为完成任务实际执行的工具调用和结果。'

/** The review decision: whether the goal is done, and whether each requirement is met, judged from the evidence. */
export const system3CompletionReviewDecision: System3DecisionSpec<System3ReviewInput, ReviewOutcome> = {
  id: 'completion.review',
  version: 1,
  state: input => ({ evidence: input.evidence }),
  questions: input => ({
    goal: { type: 'noul', instructions: `${EVIDENCE}任务目标是：「${input.objective}」。根据执行记录，这个目标是否已经完成？记录里看不出来的不算完成；没有真正执行到任何用例的“通过”也不算。`, criteria: MET },
    ...Object.fromEntries(input.requirements.map((text, index) => [`r${String(index + 1)}`, {
      type: 'noul' as const,
      instructions: `${EVIDENCE}用户提出过这条要求：「${text}」。根据执行记录，这条要求是否已经满足？禁止类要求（不要、不许、别）在记录里没有违反的操作就算满足；必须做到的要求要在记录里看到做到的证据。`,
      criteria: MET,
    }])),
  }),
  decide(response, settings, input) {
    const verdicts = ['goal', ...input.requirements.map((_text, index) => `r${String(index + 1)}`)].map(key => verdictOf(response, settings, key))
    if (verdicts.includes('no')) return 'incomplete'
    return verdicts.every(verdict => verdict === 'yes') ? 'complete' : 'unsure'
  },
  fallback: 'complete',
}

function verdictOf(response: JevResponse, settings: Pick<System3DecisionSettings, 'yes' | 'no'>, key: string): 'yes' | 'no' | 'unsure' {
  const answer = response.answers[key]
  return answer?.type === 'noul' ? noulVerdict(answer.noul, settings) : 'unsure'
}

/** The most useful argument of a tool call for a reader: a command, a path, or an action. */
function callSummary(name: string, raw: string): string {
  let args: unknown
  try {
    args = JSON.parse(raw)
  } catch {
    // JSON.parse of a string throws only SyntaxError: arguments the model streamed but never closed are summarized by name only.
    return name
  }
  if (typeof args !== 'object' || args === null) return name
  for (const field of ['command', 'file_path', 'path', 'action', 'query', 'url']) {
    const value: unknown = Reflect.get(args, field)
    if (typeof value === 'string') return `${name}: ${value}`
  }
  return name
}

function clip(text: string, chars: number): string {
  const trimmed = text.trim()
  return trimmed.length <= chars * 2 ? trimmed : `${trimmed.slice(0, chars)}\n…\n${trimmed.slice(-chars)}`
}

function textOf(message: Message): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

/**
 * Summarize what the Agent did, newest calls last: each tool call with its main argument and the start and end of its result.
 * The model's own text and its `update_goal` calls are left out because a claim is not evidence.
 * @param messages - The Agent's model-visible history.
 * @param calls - Most recent tool calls to include.
 * @param chars - Characters kept from the start and from the end of each result.
 * @returns Plain text for Jev.
 */
export function completionEvidence(messages: readonly Message[], calls: number, chars: number): string {
  const results = new Map<string, string>()
  for (const message of messages) if (message.role === 'tool') results.set(message.toolCallId, textOf(message))
  const lines: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      // A goal update is the model's own claim, and a refused one carries this review's earlier refusal.
      if (block.type === 'tool-call' && block.name !== 'update_goal') {
        const result = results.get(block.id)
        lines.push(`- ${callSummary(block.name, block.arguments)}${result === undefined ? '' : `\n  结果：${clip(result, chars).replace(/\n/gu, '\n  ')}`}`)
      }
    }
  }
  return [`执行记录（最近 ${String(Math.min(calls, lines.length))} 次工具调用，按时间顺序）：`, ...lines.slice(-calls)].join('\n')
}

/**
 * The denial text the model receives when the review refuses a completion.
 * @param objective - The goal, verbatim, when it was judged not met.
 * @param unmet - Requirements judged not met, verbatim.
 * @returns Model-visible reason.
 */
export function completionRefusal(objective: string | undefined, unmet: readonly string[]): string {
  return ['[System3 完成核验] 执行记录里还看不到以下内容已经完成的证据：',
    ...objective === undefined ? [] : [`- 目标：${objective}`], ...unmet.map(text => `- 用户要求：${text}`),
    '请先完成并验证；如果做不到或要求之间有冲突，请向用户说明并请用户决定，不要标记完成。'].join('\n')
}

/** A changed task frame requires a new review; its current text is context, not an unmet verdict. */
function changedFrameRefusal(frame: System3TaskFrame | null): string {
  return ['[System3 完成核验] 任务卡在核验期间更新，请按当前目标和要求重新核验后再标记完成。',
    ...frame === null ? ['当前任务卡已移除，请先确认当前目标和要求。']
      : [`- 当前目标：${frame.goal.text}`, ...frame.items.map(item => `- 当前用户要求：${item.text}`)],
  ].join('\n')
}

/** Services and policy the review needs. */
export interface System3CompletionReviewSettings {
  readonly config: System3CompletionReviewConfig
  readonly policy: System3PrivacyPolicy
  readonly options: System3JevOptions
  /** The current immutable task frame of an Agent, or null; a committed update returns a new object. */
  readonly frameOf: (agent: Agent) => System3TaskFrame | null
}

/**
 * Reject a completion-review configuration that cannot work.
 * @param config - Completion-review settings from deployment configuration.
 */
export function validateSystem3CompletionReview(config: System3CompletionReviewConfig): void {
  validateSystem3DecisionSettings('completionReview', config)
  for (const key of ['maxRefusals', 'evidenceCalls', 'resultChars'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`completionReview ${key} must be a positive integer`)
  }
}

/** The goal id an `update_goal` call would complete, when the call is a completion. */
function completedGoal(exec: ToolExecution): string | undefined {
  if (exec.name !== 'update_goal') return undefined
  const args = exec.arguments
  if (typeof args !== 'object' || args === null) return undefined
  const action: unknown = Reflect.get(args, 'action')
  const goalId: unknown = Reflect.get(args, 'goal_id')
  return action === 'complete' && typeof goalId === 'string' ? goalId : undefined
}

/**
 * Review every goal completion of a top-level Agent before it runs. Successful responses to an obsolete frame are unsure;
 * active mode refuses them within the Session's goal allowance, while provider failures retain the completion fallback.
 * Unloading cancels pending reviews without refusing their calls; caller cancellation still prevents execution.
 * @param ctx - Plugin context; listeners are disposed with it.
 * @param settings - Review settings, privacy policy, Jev options, and the task-frame reader.
 */
export function installSystem3CompletionReview(ctx: Context, settings: System3CompletionReviewSettings): void {
  const { config } = settings
  validateSystem3CompletionReview(config)
  const shared: System3DecisionContext = { policy: settings.policy, options: settings.options, dataClasses: config.sessionDataClasses }
  // Root forks inherit GoalIds but own their allowances; discarded Sessions do not retain their counters.
  const refusals = new WeakMap<Session, Map<GoalId, number>>()
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'system3.completionReview()')

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const goalId = completedGoal(exec)
    const agent = exec.agent
    if (goalId === undefined || agent === undefined || exec.parent !== undefined || config.mode === 'off'
      || (agent.session.header.delegationDepth ?? 0) !== 0) return next()
    // Only a goal the task frame follows has requirements to check against.
    const frame = settings.frameOf(agent)
    if (frame?.goal.goalId !== goalId) return next()
    const input = { objective: frame.goal.text, requirements: frame.items.map(item => item.text),
      evidence: completionEvidence(agent.session.deriveMessages(), config.evidenceCalls, config.resultChars) }
    let result: System3DecisionResult<ReviewOutcome>
    try {
      result = await runSystem3Decision(ctx, shared, system3CompletionReviewDecision, config, agent, input,
        AbortSignal.any([exec.signal, lifetime.signal]))
    } catch (error) {
      if (lifetime.signal.aborted && !exec.signal.aborted) return next()
      throw error
    }
    exec.signal.throwIfAborted()
    if (lifetime.signal.aborted) return next()
    const response = result.judgement.response
    const current = settings.frameOf(agent)
    const stale = response !== undefined && current !== frame
    const unmet = stale || response === undefined ? [] : frame.items.filter((_item, index) => verdictOf(response, config, `r${String(index + 1)}`) === 'no')
    const goalUnmet = !stale && response !== undefined && verdictOf(response, config, 'goal') === 'no'
    const decision = stale ? 'unsure' : result.judgement.outcome === 'incomplete' ? 'incomplete' : result.judgement.reason === 'judged' ? 'complete' : 'unsure'
    const count = refusals.get(agent.session)?.get(frame.goal.goalId) ?? 0
    const refused = config.mode === 'active' && (stale || result.outcome === 'incomplete') && count < config.maxRefusals
    if (refused) {
      let counts = refusals.get(agent.session)
      if (counts === undefined) {
        counts = new Map()
        refusals.set(agent.session, counts)
      }
      counts.set(frame.goal.goalId, count + 1)
    }
    agent.session.append('system3/completion-review', { version: 1, goalId: frame.goal.goalId, decision,
      unmet: unmet.map(item => item.messageId), goalUnmet, refused })
    if (!refused) return next()
    return { kind: 'deny', reason: stale ? changedFrameRefusal(current)
      : completionRefusal(goalUnmet ? frame.goal.text : undefined, unmet.map(item => item.text)) }
  })
}
