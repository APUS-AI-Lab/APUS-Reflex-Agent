/**
 * Continuum memory on Jev. Scoring: after compaction replaces part of the conversation, Jev scores the person's verbatim
 * messages in the replaced span and keeps the ones later work still needs (L1). Recall: for each new input, Jev judges the
 * person's inputs that compaction moved out of the context (L2), kept ones first, and the relevant originals reach the
 * main model again verbatim with their checkpoint. Jev only selects; it never rewrites, extracts, or trims an original.
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

/** Mode, thresholds, and size limits of per-turn memory recall; deployment-owned. */
export interface System3MemoryRecallConfig extends System3DecisionSettings {
  /** Data classes of Session text sent to Jev, checked against the privacy policy. */
  readonly sessionDataClasses: readonly System3DataClass[]
  /** Compacted inputs judged for one input; each becomes one Jev question, so at most 16. */
  readonly maxCandidates: number
  /** Characters of the person's current input quoted to Jev; a longer input is judged by its beginning. */
  readonly maxInputChars: number
  /** Characters of each compacted input quoted to Jev and shown to the main model; a longer one is shown as an excerpt. */
  readonly maxMessageChars: number
}

/** One compacted input of the person recalled for the current input; `probability` is the recall judgement. */
export interface System3RecalledItem extends System3MemoryItem {
  /** Seq of the `compaction/summary` event whose span contained the message. */
  readonly checkpoint: number
}

/** The recall for one person input, recorded whole; an empty `items` clears the previous recall. */
export interface System3MemoryRecall {
  readonly version: 1
  /** Id of the person's message the recall answers. */
  readonly messageId: MessageId
  /** Compacted inputs judged for the input. */
  readonly scanned: number
  /** Memories judged relevant at or above the `yes` threshold, oldest first. */
  readonly items: readonly System3RecalledItem[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A compacted span was scored; kept messages reach the main model through the `system3:memory` runtime context. */
    'system3/memory-score': System3MemoryScore
    /** Compacted inputs were judged against the person's input; recalled ones replace the `system3:memory` runtime context. */
    'system3/memory-recall': System3MemoryRecall
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

/** A compacted input of the person that may be recalled; `text` is the complete original. */
interface RecallCandidate {
  readonly checkpoint: number
  readonly seq: number
  readonly messageId: MessageId
  readonly text: string
}

interface RecallInput {
  /** The person's current input, cut to `maxInputChars`. */
  readonly input: string
  readonly candidates: readonly RecallCandidate[]
  /** Characters of each candidate quoted to Jev. */
  readonly maxMessageChars: number
}

/** The beginning of a text, marked when cut. */
const excerpt = (text: string, limit: number): string => text.length <= limit ? text : `${text.slice(0, limit)}……`

const recallKey = (candidate: Pick<RecallCandidate, 'seq'>): string => `r${String(candidate.seq)}`

/** One yes/no question per compacted input; both inputs are quoted because Jev relates referenced state poorly. */
export const system3MemoryRecallDecision: System3DecisionSpec<RecallInput, 'recall' | 'none'> = {
  id: 'memory.recall',
  version: 1,
  state: input => ({ input: input.input, memories: input.candidates.map(candidate => excerpt(candidate.text, input.maxMessageChars)) }),
  questions: input => Object.fromEntries(input.candidates.map(candidate => [recallKey(candidate), {
    type: 'noul' as const,
    instructions: `用户当前输入：「${input.input}」。以下是之前对话被压缩、已移出上下文的一条用户原话：「${excerpt(candidate.text, input.maxMessageChars)}」。`
      + '判断主模型回答或执行当前输入时是否需要看到这条原话，例如它给出了当前输入涉及的要求、约束、数值、路径、名称或决定。与当前输入无关的不算。',
    criteria: { true: '与当前输入相关，需要提供', false: '无关' },
  }])),
  decide(response, settings, input) {
    const verdicts = input.candidates.map((candidate) => {
      const answer = response.answers[recallKey(candidate)]
      return answer?.type === 'noul' ? noulVerdict(answer.noul, settings) : 'unsure'
    })
    if (verdicts.includes('yes')) return 'recall'
    return verdicts.every(verdict => verdict === 'no') ? 'none' : 'unsure'
  },
  fallback: 'none',
}

/**
 * Render recalled inputs as the main model sees them; an input longer than `limit` is shown as its beginning with its length.
 * @param items - Recalled inputs with their checkpoints, oldest first.
 * @param limit - Most characters shown of one input.
 * @returns Model-visible text, or an empty string when nothing is recalled.
 */
export function recallText(items: readonly Pick<System3MemoryView, 'checkpoint' | 'seq' | 'text'>[], limit: number): string {
  if (items.length === 0) return ''
  return ['[System3 记忆召回] 以下用户原话所在的对话已被压缩，经评分判断与当前输入相关（均为原话）。'
    + '需要上下文时，用 history_read 读取对应检查点的原文：',
  ...items.map(item => `- 检查点 ${String(item.checkpoint)}，#${String(item.seq)}：${excerpt(item.text, limit)}`
    + (item.text.length > limit ? `（节选，原文共 ${String(item.text.length)} 字，完整原文用 history_read 读取检查点 ${String(item.checkpoint)}）` : ''))]
    .join('\n')
}

/** Overlapping character pairs of a text, lowercased; the deterministic relevance measure of the candidate prefilter. */
function bigrams(text: string): Set<string> {
  const pairs = new Set<string>()
  let previous: string | undefined
  for (const char of text.toLowerCase().replace(/\s+/gu, ' ')) {
    if (previous !== undefined) pairs.add(previous + char)
    previous = char
  }
  return pairs
}

/**
 * Pick the compacted inputs judged for an input: every one when they fit, otherwise the ones sharing the most character
 * pairs with the input, then ones memory scoring kept, then newer ones, returned oldest first.
 * @param input - The person's current input.
 * @param archive - Compacted inputs, oldest first.
 * @param kept - Seqs of the inputs memory scoring kept.
 * @param limit - Most inputs one recall judges.
 * @returns At most `limit` inputs, oldest first.
 */
export function selectRecallCandidates<T extends Pick<RecallCandidate, 'seq' | 'text'>>(input: string, archive: readonly T[],
  kept: ReadonlySet<number>, limit: number): T[] {
  if (archive.length <= limit) return [...archive]
  const query = bigrams(input)
  const ranked = archive.map((entry, index) => {
    let shared = 0
    for (const pair of bigrams(entry.text)) if (query.has(pair)) shared += 1
    return { entry, index, shared, kept: kept.has(entry.seq) ? 1 : 0 }
  }).sort((a, b) => b.shared - a.shared || b.kept - a.kept || b.index - a.index).slice(0, limit)
  return ranked.sort((a, b) => a.index - b.index).map(ranked => ranked.entry)
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
  /** Active per-turn recall owns the `system3:memory` runtime context, so scoring does not register it. */
  readonly recallActive?: boolean
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
    const answers = result.judgement.response?.answers ?? {}
    if (result.outcome !== 'keep') return
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

  if (config.mode === 'active' && settings.recallActive !== true) {
    ctx.effect(() => ctx.systemPrompt.context({ name: 'system3:memory', order: ctx.systemPrompt.getContextOrder('SYSTEM3_MEMORY'),
      text: ({ agent }) => {
        if (agent === undefined) return ''
        const state = ctx.get('sessionProjections')?.stateOf(agent.session, 'system3Runtime')
        return memoryText((state?.memory ?? []).slice(-config.maxItems))
      } }),
    'system3.memoryScoring.context()')
  }
}

/** Services and policy per-turn memory recall needs. */
export interface System3MemoryRecallSettings {
  readonly config: System3MemoryRecallConfig
  readonly policy: System3PrivacyPolicy
  readonly options: System3JevOptions
}

/**
 * Reject a memory-recall configuration that cannot work.
 * @param config - Memory-recall settings from deployment configuration.
 */
export function validateSystem3MemoryRecall(config: System3MemoryRecallConfig): void {
  validateSystem3DecisionSettings('memoryRecall', config)
  if (!Number.isSafeInteger(config.maxCandidates) || config.maxCandidates < 1 || config.maxCandidates > 16) {
    throw new Error('memoryRecall maxCandidates must be an integer from 1 to 16')
  }
  for (const key of ['maxInputChars', 'maxMessageChars'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`memoryRecall ${key} must be a positive integer`)
  }
}

/**
 * Judge the person's compacted inputs (L2, from the Session projection) against each new person input of a top-level
 * Agent before the request that answers it is assembled. Until compaction moves an input out of the context there is
 * nothing to recall and no Jev request. One Jev request asks one yes/no question per candidate, at most `maxCandidates`,
 * picked by a character-pair prefilter that prefers inputs memory scoring kept. In `active` mode the recalled originals
 * become the `system3:memory` runtime context of that request and are recorded as `system3/memory-recall`; an input that
 * recalls nothing records an empty recall when an earlier one was shown, so later steps do not show stale memories.
 * Shadow mode records only `system3/judgement`. The judgement waits at most `deadlineMs`; privacy refusal, a Jev failure,
 * and the deadline recall nothing for that input.
 * @param ctx - Plugin context with the system prompt and Session projections; listeners are disposed with it.
 * @param settings - Memory-recall settings, privacy policy, and Jev options.
 */
export function installSystem3MemoryRecall(ctx: Context, settings: System3MemoryRecallSettings): void {
  const { config } = settings
  validateSystem3MemoryRecall(config)
  const shared: System3DecisionContext = { policy: settings.policy, options: settings.options, dataClasses: config.sessionDataClasses }
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'system3.memoryRecall()')

  const pending = new WeakMap<Session, { readonly id: MessageId; readonly text: string }>()

  /** Judge compacted inputs against one input; returns the inputs the model sees for it, empty when none or not applied. */
  const recall = async (agent: Agent, input: { readonly id: MessageId; readonly text: string },
    signals: readonly AbortSignal[]): Promise<readonly System3RecalledItem[]> => {
    const state = ctx.get('sessionProjections')?.stateOf(agent.session, 'system3Runtime')
    const previous = state?.recall?.items.length ?? 0
    const kept = new Set((state?.memory ?? []).map(memory => memory.seq))
    const candidates = selectRecallCandidates(input.text, state?.archive ?? [], kept, config.maxCandidates)
    let items: System3RecalledItem[] = []
    if (candidates.length > 0) {
      const result = await runSystem3Decision(ctx, shared, system3MemoryRecallDecision, config, agent,
        { input: input.text, candidates, maxMessageChars: config.maxMessageChars }, AbortSignal.any([...signals, lifetime.signal]))
      const answers = result.judgement.response?.answers ?? {}
      if (result.outcome === 'recall') {
        items = candidates.flatMap((candidate) => {
          const answer = answers[recallKey(candidate)]
          if (answer?.type !== 'noul' || noulVerdict(answer.noul, config) !== 'yes') return []
          return [{ checkpoint: candidate.checkpoint, seq: candidate.seq, messageId: candidate.messageId, text: candidate.text,
            probability: answer.noul }]
        })
      }
    }
    if (config.mode === 'active' && (items.length > 0 || previous > 0)) {
      agent.session.append('system3/memory-recall', { version: 1, messageId: input.id, scanned: candidates.length, items })
    }
    return items
  }

  // The loop claims the person's input before it assembles the request, so the input is known when the assembly runs.
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (config.mode === 'off' || (agent.session.header.delegationDepth ?? 0) !== 0) return
    const text = personText(message, Infinity)
    if (text === undefined) pending.delete(agent.session)
    else pending.set(agent.session, { id: message.id, text: excerpt(text, config.maxInputChars) })
  })

  // Runtime-context providers are synchronous, so the judgement waits here and updates this assembly's memory context.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context.agent
    const input = agent === undefined ? undefined : pending.get(agent.session)
    if (agent === undefined || input === undefined) return next()
    pending.delete(agent.session)
    const items = await recall(agent, input, [context.signal].filter(signal => signal !== undefined))
    const memory = assembly.contexts.find(entry => entry.name === 'system3:memory')
    if (config.mode === 'active' && memory !== undefined) memory.text = recallText(items, config.maxMessageChars)
    return next()
  })

  if (config.mode === 'active') {
    ctx.effect(() => ctx.systemPrompt.context({ name: 'system3:memory', order: ctx.systemPrompt.getContextOrder('SYSTEM3_MEMORY'),
      text: ({ agent }) => {
        if (agent === undefined) return ''
        const state = ctx.get('sessionProjections')?.stateOf(agent.session, 'system3Runtime')
        return recallText(state?.recall?.items ?? [], config.maxMessageChars)
      } }),
    'system3.memoryRecall.context()')
  }
}
