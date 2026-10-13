/**
 * Memory scoring: after compaction replaces part of the conversation, Jev scores the person's verbatim messages in the
 * replaced span, and the ones still needed later are shown to the main model again, verbatim, with their checkpoint.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { System3DataClass, System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { System3MemoryView } from './types.ts'
import { noulVerdict, runSystem3Decision, validateSystem3DecisionSettings, type System3DecisionContext,
  type System3DecisionSettings, type System3DecisionSpec } from './decision-kernel.ts'
import type { System3JevOptions } from './decisions.ts'

/** Mode, thresholds, and size limits of memory scoring; deployment-owned. */
export interface System3MemoryScoringConfig extends System3DecisionSettings {
  /** Data classes of Session text sent to Jev, checked against the privacy policy. */
  readonly sessionDataClasses: readonly System3DataClass[]
  /** Most recent person messages of one replaced span that are scored; each becomes one Jev question. */
  readonly maxCandidates: number
  /** Messages longer than this many characters are not scored. */
  readonly maxMessageChars: number
  /** Most recent kept messages shown to the main model across all checkpoints. */
  readonly maxItems: number
}

/** One verbatim message of the person kept after its span was compacted. */
export interface System3MemoryItem {
  /** Seq of the person's `user/message` event. */
  readonly seq: number
  readonly messageId: MessageId
  readonly text: string
  /** Jev probability that later work still needs the message. */
  readonly probability: number
}

/** The scoring of one compaction checkpoint, recorded whole. */
export interface System3MemoryScore {
  readonly version: 1
  /** Seq of the checkpoint's `compaction/summary` event; the id `history_read` accepts. */
  readonly checkpoint: number
  /** Person messages of the replaced span that were scored. */
  readonly scanned: number
  /** Messages judged still needed, oldest first. */
  readonly items: readonly System3MemoryItem[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A compacted span was scored; kept messages reach the main model through the `system3:memory` runtime context. */
    'system3/memory-score': System3MemoryScore
  }
}

/** A person's message that may be scored once its span is compacted. */
interface Candidate {
  readonly seq: number
  readonly messageId: MessageId
  readonly text: string
}

interface ScoreInput {
  readonly candidates: readonly Candidate[]
}

const questionKey = (candidate: Candidate): string => `m${candidate.seq}`

/** One yes/no question per message; the message is quoted because Jev relates referenced state poorly. */
export const system3MemoryScoreDecision: System3DecisionSpec<ScoreInput, 'keep' | 'none'> = {
  id: 'memory.score',
  version: 1,
  state: input => ({ messages: input.candidates.map(candidate => candidate.text) }),
  questions: input => Object.fromEntries(input.candidates.map(candidate => [questionKey(candidate), {
    type: 'noul' as const,
    instructions: `这条用户原话所在的对话已被压缩成摘要：「${candidate.text}」。判断它是否包含之后的工作仍须逐字遵守或引用的内容，`
      + '例如工作要求或约束、对 AI 的纠正、完成标准、精确的数值、路径、文件名、命令或标识符。闲聊、致谢、单纯的提问或“继续”都不算。',
    criteria: { true: '之后仍须逐字遵守或引用', false: '不需要' },
  }])),
  decide(response, settings, input) {
    const verdicts = input.candidates.map((candidate) => {
      const answer = response.answers[questionKey(candidate)]
      return answer?.type === 'noul' ? noulVerdict(answer.noul, settings) : 'unsure'
    })
    if (verdicts.includes('yes')) return 'keep'
    return verdicts.every(verdict => verdict === 'no') ? 'none' : 'unsure'
  },
  fallback: 'none',
}

/**
 * Render kept messages as the main model sees them.
 * @param items - Kept messages with their checkpoints, oldest first.
 * @returns Model-visible text, or an empty string when nothing is kept.
 */
export function memoryText(items: readonly Pick<System3MemoryView, 'checkpoint' | 'seq' | 'text'>[]): string {
  if (items.length === 0) return ''
  return ['[System3 记忆] 以下用户原话所在的对话已被压缩，经评分判断之后仍须遵守或引用（均为原话）。'
    + '需要上下文时，用 history_read 读取对应检查点的原文：',
  ...items.map(item => `- 检查点 ${item.checkpoint}，#${item.seq}：${item.text}`)].join('\n')
}

/** Text of a person's message when it is plain text within the size limit. */
function personText(message: UserMessage, limit: number): string | undefined {
  if (message.source.kind !== 'user') return undefined
  const blocks = message.content.filter(block => block.type === 'text')
  if (blocks.length !== message.content.length) return undefined
  const text = blocks.map(block => block.text).join('\n').trim()
  return text === '' || text.length > limit ? undefined : text
}

/** Services and policy memory scoring needs. */
export interface System3MemoryScoringSettings {
  readonly config: System3MemoryScoringConfig
  readonly policy: System3PrivacyPolicy
  readonly options: System3JevOptions
}

/**
 * Reject a memory-scoring configuration that cannot work.
 * @param config - Memory-scoring settings from deployment configuration.
 */
export function validateSystem3MemoryScoring(config: System3MemoryScoringConfig): void {
  validateSystem3DecisionSettings('memoryScoring', config)
  for (const key of ['maxCandidates', 'maxMessageChars', 'maxItems'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`memoryScoring ${key} must be a positive integer`)
  }
}

/**
 * Score every compaction of a top-level Agent's Session. Person messages are remembered as they are committed; when a
 * `compaction/summary` replaces some of them, the next step starts one Jev judgement without delaying that step, and an
 * `active` result records `system3/memory-score`. The `system3:memory` runtime context shows the most recent kept messages
 * from the Session projection, so it survives resume. Messages committed before this process started are not scored.
 * @param ctx - Plugin context with the system prompt and Session projections; listeners are disposed with it.
 * @param settings - Memory-scoring settings, privacy policy, and Jev options.
 */
export function installSystem3MemoryScoring(ctx: Context, settings: System3MemoryScoringSettings): void {
  const { config } = settings
  validateSystem3MemoryScoring(config)
  const shared: System3DecisionContext = { policy: settings.policy, options: settings.options, dataClasses: config.sessionDataClasses }
  const messages = new WeakMap<Session, Map<number, Candidate>>()
  const pending = new WeakMap<Session, Array<{ checkpoint: number; candidates: Candidate[] }>>()
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'system3.memoryScoring()')

  ctx.on('session/event', (session, event) => {
    if (config.mode === 'off' || (session.header.delegationDepth ?? 0) !== 0) return
    if (event.type === 'user/message') {
      const text = personText(event.data, config.maxMessageChars)
      if (text === undefined) return
      const known = messages.get(session) ?? new Map<number, Candidate>()
      messages.set(session, known)
      known.set(event.seq, { seq: event.seq, messageId: event.data.id, text })
      return
    }
    if (event.type !== 'compaction/summary') return
    const known = messages.get(session)
    if (known === undefined) return
    const candidates = event.data.shadowedSeqs.flatMap((seq) => {
      const candidate = known.get(seq)
      known.delete(seq)
      return candidate === undefined ? [] : [candidate]
    }).slice(-config.maxCandidates)
    if (candidates.length === 0) return
    const queue = pending.get(session) ?? []
    pending.set(session, queue)
    queue.push({ checkpoint: event.seq, candidates })
  })

  const score = async (agent: Agent, checkpoint: number, candidates: Candidate[]): Promise<void> => {
    const result = await runSystem3Decision(ctx, shared, system3MemoryScoreDecision, config, agent, { candidates }, lifetime.signal)
    if (result.outcome !== 'keep') return
    const answers = result.judgement.response?.answers ?? {}
    const items = candidates.flatMap((candidate) => {
      const answer = answers[questionKey(candidate)]
      if (answer?.type !== 'noul' || noulVerdict(answer.noul, config) !== 'yes') return []
      return [{ ...candidate, probability: answer.noul }]
    })
    agent.session.append('system3/memory-score', { version: 1, checkpoint, scanned: candidates.length, items })
  }

  ctx.on('agent/pre-step', ({ agent }, next) => {
    const queue = pending.get(agent.session)
    if (queue !== undefined && queue.length > 0) {
      for (const { checkpoint, candidates } of queue.splice(0)) {
        void score(agent, checkpoint, candidates).catch((error: unknown) => {
          if (!lifetime.signal.aborted) ctx.logger.warn(`system3 memory scoring: ${String(error)}`)
        })
      }
    }
    return next()
  })

  if (config.mode === 'active') {
    ctx.effect(() => ctx.systemPrompt.context({ name: 'system3:memory', order: ctx.systemPrompt.getContextOrder('SYSTEM3_MEMORY'),
      text: ({ agent }) => agent === undefined ? ''
        : memoryText((ctx.get('sessionProjections')?.stateOf(agent.session, 'system3Runtime')?.memory ?? []).slice(-config.maxItems)) }),
    'system3.memoryScoring.context()')
  }
}
