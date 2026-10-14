/** Delegation hand-off pack: earlier requirements of the person that a delegate must receive verbatim. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { JevConfigurationError, MAX_JEV_QUESTIONS, type JevErrorCode, type JevRequest, type JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { admitSystem3Routes, type System3DataClass, type System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { System3JevOptions } from './decisions.ts'

/** How many earlier messages Jev reviews and how a requirement is recognized; deployment-owned. */
export interface System3HandoffPackConfig {
  /** Most recent earlier text messages of the person that Jev reviews, at most 16. */
  readonly recentMessages: number
  /** Messages longer than this many characters are not reviewed. */
  readonly maxMessageChars: number
  /** Jev probability, from 0 to 1, at or above which a message counts as a requirement. */
  readonly minProbability: number
  /** Milliseconds the review may take before the instruction is sent without a pack. */
  readonly deadlineMs: number
}

/** Why a pack has the requirements it has. */
export type System3HandoffOutcome = 'packed' | 'none' | 'no-history' | 'privacy-denied' | 'provider-unavailable' | 'timeout' | JevErrorCode

/** One hand-off review, recorded before the instruction that carries its requirements. */
export interface System3HandoffPack {
  readonly version: 1
  /** Entry request whose delegation this pack accompanies. */
  readonly requestId: SessionRequestId
  /** Exact Jev request, or null when none was sent. */
  readonly request: JevRequest | null
  readonly response?: JevResponse
  readonly outcome: System3HandoffOutcome
  /** Ids of the earlier messages forwarded verbatim as requirements, oldest first. */
  readonly constraints: readonly MessageId[]
  readonly elapsedMs: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Earlier messages System3 forwards with a delegation; the instruction message carries their text to the model. */
    'system3/handoff-pack': System3HandoffPack
  }
}

/** Services and policy the review needs, captured when entry routing is installed. */
export interface System3HandoffSettings {
  readonly config: System3HandoffPackConfig
  readonly policy: System3PrivacyPolicy
  readonly options: System3JevOptions
  readonly dataClasses: readonly System3DataClass[]
}

/**
 * Reject settings that cannot produce a valid review.
 * @param config - Hand-off pack settings from deployment configuration.
 */
export function validateSystem3HandoffPack(config: System3HandoffPackConfig): void {
  const integerIn = (value: number, max: number): boolean => Number.isSafeInteger(value) && value >= 1 && value <= max
  if (!integerIn(config.recentMessages, MAX_JEV_QUESTIONS)) {
    throw new Error(`handoffPack recentMessages must be an integer from 1 to ${String(MAX_JEV_QUESTIONS)}`)
  }
  if (!integerIn(config.maxMessageChars, Number.MAX_SAFE_INTEGER)) throw new Error('handoffPack maxMessageChars must be a positive integer')
  if (!(config.minProbability > 0 && config.minProbability <= 1)) throw new Error('handoffPack minProbability must be above 0 and at most 1')
  if (!integerIn(config.deadlineMs, MAX_TIMER_DELAY_MS)) throw new Error('handoffPack deadlineMs must be a positive integer within the timer limit')
}

/**
 * Render the requirements block appended to the delegation instruction.
 * @param label - Display label of the delegation route.
 * @param constraints - Earlier messages of the person, verbatim, oldest first.
 * @returns Model-visible text.
 */
export function handoffText(label: string, constraints: readonly string[]): string {
  return `[System3 交接包] 用户在本会话前面提出过以下要求。委派时请把它们原文写进交给 ${label} 的任务，并在核对结果时逐条检查：\n`
    + constraints.map(text => `- ${text}`).join('\n')
}

/**
 * Ask Jev which earlier messages of the person are requirements for the delegated task, and record the review.
 * Failures and timeouts yield no requirements; cancellation of the turn rejects.
 * @param ctx - Context providing the optional Jev service.
 * @param agent - Agent whose Session supplies the messages and receives the record.
 * @param requestId - Entry request whose delegation the pack accompanies.
 * @param task - Text of the delegated input.
 * @param settings - Review settings, privacy policy, and Jev options.
 * @param signal - Turn cancellation.
 * @returns Requirement texts, verbatim and oldest first.
 */
export async function prepareSystem3HandoffPack(ctx: Context, agent: Agent, requestId: SessionRequestId, task: string,
  settings: System3HandoffSettings, signal: AbortSignal): Promise<string[]> {
  const started = Date.now()
  const { config } = settings
  const earlier = agent.session.deriveMessages().flatMap((message) => {
    if (message.role !== 'user' || message.source.kind !== 'user') return []
    const blocks = message.content.filter(block => block.type === 'text')
    if (blocks.length === 0 || blocks.length !== message.content.length) return []
    const text = blocks.map(block => block.text).join('\n').trim()
    return text === '' || text.length > config.maxMessageChars ? [] : [{ id: message.id, text }]
  }).slice(-config.recentMessages)
  let request: JevRequest | null = null
  let response: JevResponse | undefined
  let outcome: System3HandoffOutcome = 'provider-unavailable'
  let constraints: { id: MessageId; text: string }[] = []
  const jev = ctx.get('jev')
  try {
    if (earlier.length === 0) { outcome = 'no-history'; return [] }
    const admission = admitSystem3Routes(settings.policy, [{ id: settings.options.routeId,
      executionDomain: settings.options.executionDomain, dataClasses: settings.dataClasses }])
    if (admission.allowed.length === 0) { outcome = 'privacy-denied'; return [] }
    if (jev === undefined) return []
    const unresolved: JevRequest = {
      state: { task },
      ...settings.options.effort === undefined ? {} : { effort: settings.options.effort },
      questions: Object.fromEntries(earlier.map((message, index) => [`m${String(index + 1)}`, {
        type: 'noul' as const,
        instructions: `用户在本会话更早时说过：「${message.text}」。state.task 是现在要交给另一个执行者的任务。判断这句话是否是用户定下的、执行这个任务时仍然有效的工作要求或约束，例如命名规范、不许改动的文件或目录、提交前必须通过的检查、文件放置约定、需要同步更新的文档、输出语言或安全规定。闲聊、提问、感谢、对已完成工作的评价、与这个项目无关的请求都不算。`,
        criteria: { true: '是仍然有效的工作要求或约束', false: '不是' },
      }])),
    }
    const deadline = AbortSignal.timeout(config.deadlineMs)
    try {
      // An unconfigured or switched-off provider throws a configuration error, which leaves the instruction unpacked.
      request = jev.resolve(unresolved)
      const result = await jev.decide(request, AbortSignal.any([signal, deadline]))
      if (result.kind === 'unknown') { outcome = result.failure.code; return [] }
      response = result.response
    } catch (error) {
      if (!signal.aborted && error instanceof JevConfigurationError) return []
      if (signal.aborted || !deadline.aborted) throw error
      outcome = 'timeout'
      return []
    }
    const answers = response.answers
    constraints = earlier.filter((_message, index) => {
      const answer = answers[`m${String(index + 1)}`]
      return answer?.type === 'noul' && answer.noul >= config.minProbability
    })
    outcome = constraints.length === 0 ? 'none' : 'packed'
    return constraints.map(message => message.text)
  } finally {
    agent.session.append('system3/handoff-pack', {
      version: 1, requestId, request, ...response === undefined ? {} : { response }, outcome,
      constraints: constraints.map(message => message.id), elapsedMs: Date.now() - started,
    })
  }
}
