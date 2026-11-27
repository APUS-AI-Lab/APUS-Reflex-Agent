import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only import: registers the `goal` Session projection state this reader consults.
import type {} from '@deepseek-ai/dsh-goal/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryId, MemoryRecordStore } from './records.ts'
import {
  budgetMemoryWorkingSetWithDrops, renderMemoryWorkingSet, retrieveMemoryWorkingSet, retrieveMemoryWorkingSetWithReport,
  type MemoryBudgetOutcome, type MemoryCandidate, type MemoryCandidatePool, type MemoryDroppedRecord,
  type MemoryRetrievalConfig, type MemoryRetrievalOutcome, type MemoryRetrievalReport, type MemoryWorkingSet,
} from './retrieval.ts'
import {
  MAX_RECORDED_RECORDS, type MemoryExecutionCandidate, type MemoryFilterFacts, type MemoryFilterMessageFact,
  type MemoryQueryFacts, type MemoryQueryMessageFact, type MemoryRecordRefFact, type MemoryRecallDecisionReason,
  type MemoryRecallQuerySource, type MemoryRetrievalFacts, type MemoryRetrievalLimits, type MemorySelectionFacts,
  type MemorySelectionRecord,
} from './persistence.ts'
import { recordMemoryRecallDecision, recordMemoryRetrieval, type MemoryRetrievalRecorder } from './retrieval-events.ts'
import type { ContinuumMemoryController, ContinuumMemoryPrincipal } from './policy.ts'

/** Model-visible source for one bounded Continuum memory snapshot. */
export interface ContinuumMemorySource {
  readonly kind: 'continuum-memory'
  readonly form: 'recall'
  readonly version: 1
  readonly recordIds: readonly string[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Source-backed, bounded Continuum memory context.
     * @persistenceAttribution
     */
    'continuum-memory': ContinuumMemorySource
  }
}

/** A recall query and the part of the request or history it came from. */
export interface ContinuumRecallQuery {
  readonly text: string
  readonly source: MemoryRecallQuerySource
}

/** Configuration for the deterministic memory context consumer. */
export interface ContinuumMemoryContextConfig extends MemoryRetrievalConfig {
  /**
   * Candidates offered to a mounted selector, which may route by tag before judging; the final recall still keeps
   * `maxTotalBytes`. Omitted means `maxCandidates`.
   */
  readonly maxPool?: number | undefined
  /** Admission mode recorded with selector decisions. Omitted means `explicit`. */
  readonly admission?: 'explicit' | 'user-message' | 'compaction' | undefined
  /**
   * Record each read's query, ranking and injection as `continuum/memory-*` events. Off by default so an existing
   * composition keeps its current log.
   */
  readonly trace?: boolean | undefined
}

/** Candidate passed to the optional mounted Reflex selector. */
export interface ContinuumMemorySelectionCandidate {
  readonly id: string
  readonly label: string
  readonly excerpt: string
  readonly score: number
  /** L1 index tags of the record; empty for untagged records. */
  readonly tags: readonly string[]
}

/** Effective retrieval limits and admission mode a caller applied before selection. */
export interface ContinuumMemorySelectionLimits {
  readonly maxCandidates: number
  readonly maxExcerptBytes: number
  readonly maxTotalBytes: number
  readonly candidatePool: MemoryCandidatePool
  /** Candidate pool offered to the selector; equal to `maxCandidates` when unset. */
  readonly maxPool: number
  readonly admission: 'explicit' | 'user-message' | 'compaction'
}

/** Minimal replayable outcome returned by a mounted Reflex selector. */
export interface ContinuumMemorySelection {
  readonly mode: 'off' | 'shadow' | 'active'
  readonly selectedIds: readonly string[]
  readonly baselineIds: readonly string[]
  readonly outcome: 'off' | 'baseline' | 'jev' | 'unknown'
  readonly confidence?: number
  readonly failure?: string
}

/** Optional Jev-backed selector installed by the profile's Reflex plugin. */
export interface ContinuumMemorySelector {
  select(
    agent: Agent,
    input: {
      readonly query: string
      readonly candidates: readonly ContinuumMemorySelectionCandidate[]
      readonly isCurrent: () => boolean
      /** Applied limits and admission mode for the receipt; omitted when the caller does not own them. */
      readonly limits?: ContinuumMemorySelectionLimits
      /**
       * Stable id of the pre-step recall this selection belongs to. A selector that persists a receipt records it, so
       * the rerank receipt groups with the read it followed; a caller outside a pre-step recall passes none.
       */
      readonly recallId?: string
    },
    signal: AbortSignal,
  ): Promise<ContinuumMemorySelection>
}

/** One compacted human message offered for admission as a memory record. */
export interface ContinuumAdmissionCandidate {
  readonly id: string
  /** Complete original text of the message. */
  readonly content: string
}

/** One kept candidate and the tags Reflex assigned it. */
export interface ContinuumAdmittedMemory {
  readonly id: string
  /** Index tags; empty when the candidate was kept without a Reflex judgement. */
  readonly tags: readonly string[]
}

/** Text one closed step produced, offered to the execution adjudicator. */
export type ContinuumExecutionCandidate = MemoryExecutionCandidate

/** Replayable outcome returned by a mounted Reflex admitter. */
export interface ContinuumMemoryAdmission {
  /** Candidates to index; IDs absent from the request are ignored. */
  readonly admitted: readonly ContinuumAdmittedMemory[]
}

/** Optional Jev-backed admitter that selects and tags the compacted messages worth indexing. */
export interface ContinuumMemoryAdmitter {
  admit(
    agent: Agent,
    input: {
      readonly candidates: readonly ContinuumAdmissionCandidate[]
      readonly isCurrent: () => boolean
      /** The write trigger this admission belongs to; recorded on its receipts when the admitter writes them. */
      readonly writeId?: string
    },
    signal: AbortSignal,
  ): Promise<ContinuumMemoryAdmission>
  /**
   * Judge which executed facts one closed step may record, when `executionAdmission` is `verified`. An admitter
   * without this method writes no execution records.
   * @param agent - Agent whose step produced the candidates.
   * @param input - candidates and a synchronous lifecycle check that prevents a stale write.
   * @param signal - cancellation for the judgement.
   * @returns the candidates kept as records, each with its tags; absent means none.
   */
  judgeExecution?(
    agent: Agent,
    input: {
      readonly candidates: readonly ContinuumExecutionCandidate[]
      readonly isCurrent: () => boolean
      /** The write trigger this judgement belongs to; recorded on its receipts when the admitter writes them. */
      readonly writeId?: string
    },
    signal: AbortSignal,
  ): Promise<readonly ContinuumAdmittedMemory[]>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional Reflex selector; absent keeps deterministic original behavior. */
    continuumMemorySelector?: ContinuumMemorySelector
    /** Optional Reflex admitter for compaction admission; absent admits every compacted human message. */
    continuumMemoryAdmitter?: ContinuumMemoryAdmitter
  }
}

/** Store lookup owned by the product profile; no global memory store is implied. */
export type ContinuumMemoryStoreOf = (agent: Agent) => MemoryRecordStore | undefined

/** Resolves the exact scopes visible to one agent request. */
export type ContinuumMemoryPrincipalOf = (agent: Agent) => ContinuumMemoryPrincipal

/**
 * Install same-step bounded memory context on the existing pre-step waterfall.
 * Disposing the listener or its context prevents pending reads from injecting recall.
 * @param ctx - Cordis context that owns AgentLoop events.
 * @param storeOf - per-agent store resolver; returning undefined disables this agent.
 * @param config - retrieval and byte limits.
 * @returns idempotent synchronous disposer for the listener.
 */
export function installContinuumMemoryContext(
  ctx: Context,
  storeOf: ContinuumMemoryStoreOf,
  config: ContinuumMemoryContextConfig,
): () => void {
  let active = true
  const budget = retrievalBudget(config)
  const isActive = (): boolean => active
  const stop = ctx.on('agent/pre-step', async ({ agent, messages, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    const composition = composeRecallQueryRecord(ctx, agent.session, messages)
    const query = composition.query
    const note = recallNote(ctx, agent, turn, step, query, composition)
    try {
      if (!isActive()) { note.decide('consumer-inactive'); return decision }
      if (decision.kind === 'reject') { note.decide('step-rejected'); return decision }
      const store = storeOf(agent)
      if (store === undefined) { note.decide('no-store'); return decision }
      if (query === undefined) { note.decide('no-query'); return decision }
      signal.throwIfAborted()
      const startedAt = Date.now()
      const { workingSet, report, facts } = retrieveMemoryWorkingSetWithReport(store, budget, query.text)
      const retrievalFacts = retrievalSourceFacts(facts, budget, undefined, startedAt)
      const freshness = freshnessFacts(workingSet.candidates, messages, startedAt)
      const kept = freshness.kept
      const alreadyPresentRecords = freshness.facts.alreadyPresentCount
      // Re-render from the kept candidates: the model must see exactly the records `recordIds` names.
      const rendered = kept.length === 0 ? undefined : renderMemoryWorkingSet(workingSet.query, kept)
      // 同 controller 路径：回执据真实写入结果决定是否省略查询依据。
      const retrievalTraced = config.trace === true
        && recordMemoryRetrieval(retrievalRecorder(ctx, agent), {
          query: query.text, querySource: query.source, limits: retrievalLimits(config), selectorMounted: false, report,
          recallId: note.recallId, queryFacts: composition.facts, retrievalFacts, filterFacts: freshness.facts,
          ...(rendered === undefined ? {} : { injection: { workingSet: rendered, dropped: [] } }),
        })
      if (rendered === undefined) {
        if (alreadyPresentRecords > 0) {
          note.decide('no-query-match', { report, alreadyPresentRecords, retrievalTraced })
          return decision
        }
        note.decide(report.activeRecords === 0 ? 'empty-store' : 'no-candidates',
          { report, retrievalTraced })
        return decision
      }
      const message = recallMessage(rendered)
      note.decide('injected', {
        report, injectedRecords: rendered.candidates.length, alreadyPresentRecords,
        resultMessageId: String(message.id), retrievalTraced,
      })
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error: unknown) {
      note.decide(signal.aborted ? 'cancelled' : 'error')
      throw error
    }
  })
  const dispose = ctx.effect(() => () => {
    active = false
    stop()
  })
  return () => { void dispose() }
}

/**
 * Install the lifecycle-aware consumer. The controller owns switch state,
 * authorization, and invalidation; an absent controller leaves messages intact.
 * Disposing the listener or its context prevents pending reads from injecting recall.
 * @param ctx - Cordis context that owns AgentLoop events.
 * @param controllerOf - per-agent Continuum controller resolver.
 * @param principalOf - exact scope resolver for the current agent.
 * @param config - retrieval and byte limits; its admission mode is recorded with selector decisions.
 * @param selectorOf - Reads the optional Jev selector at request time. Without one, only candidates that share a
 * query term are injected.
 * @param pendingOf - Admissions the read waits for, so records from a just-completed compaction are visible.
 * @param tagsOf - L1 index tags of one record, passed to the selector.
 * @returns idempotent synchronous disposer for the listener.
 */
export function installContinuumMemoryControllerContext(
  ctx: Context,
  controllerOf: (agent: Agent) => ContinuumMemoryController | undefined,
  principalOf: ContinuumMemoryPrincipalOf,
  config: ContinuumMemoryContextConfig,
  selectorOf: () => ContinuumMemorySelector | undefined = () => undefined,
  pendingOf: (agent: Agent) => Promise<void> | undefined = () => undefined,
  tagsOf: (agent: Agent, id: MemoryId) => readonly string[] = () => [],
): () => void {
  let active = true
  const budget = retrievalBudget(config)
  const isActive = (): boolean => active
  const stop = ctx.on('agent/pre-step', async ({ agent, messages, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    const composition = composeRecallQueryRecord(ctx, agent.session, messages)
    const query = composition.query
    const note = recallNote(ctx, agent, turn, step, query, composition)
    try {
      if (!isActive()) { note.decide('consumer-inactive'); return decision }
      if (decision.kind === 'reject') { note.decide('step-rejected'); return decision }
      const controller = controllerOf(agent)
      // No controller means this profile left the feature off: there is no
      // recall judgement to record, so the log stays free of Continuum facts
      // until a live enablement installs one.
      if (controller === undefined) return decision
      if (query === undefined) { note.decide('no-query'); return decision }
      signal.throwIfAborted()
      const pending = pendingOf(agent)
      if (pending !== undefined) await abortable(pending, signal)
      if (!isActive()) { note.decide('consumer-inactive'); return decision }
      const ticket = controller.beginRead(principalOf(agent))
      if (ticket === undefined) { note.decide('unavailable'); return decision }
      const selector = selectorOf()
      const requestedLimits = selector === undefined ? budget : {
        ...budget, maxCandidates: config.maxPool ?? config.maxCandidates, maxTotalBytes: Number.MAX_SAFE_INTEGER,
      }
      const readStartedAt = Date.now()
      const outcome = controller.readWithReport(ticket, requestedLimits, query.text)
      if (outcome === undefined || !controller.isCurrent(ticket)) { note.decide('stale'); return decision }
      const { workingSet, report, facts } = outcome
      const retrievalFacts = retrievalSourceFacts(facts, requestedLimits, ticket.principal.scopes, readStartedAt)
      // A record whose text the request already carries is not injected again; the rest keep their order.
      const freshness = freshnessFacts(workingSet.candidates, messages, Date.now())
      const fresh = freshness.kept
      const alreadyPresentRecords = freshness.facts.alreadyPresentCount
      // “检索事件是否真的写进了日志”决定回执能否省略查询依据。只看 trace 开关，
      // 会把一次被吞掉的 append 当成已记录，读者从此看不到这次召回的查询全文。
      let retrievalTraced = false
      const traced = (extra: TracedInjection): void => {
        if (config.trace !== true) return
        retrievalTraced = recordMemoryRetrieval(retrievalRecorder(ctx, agent), {
          query: query.text, querySource: query.source, limits: retrievalLimits(config),
          selectorMounted: selector !== undefined, report,
          recallId: note.recallId, queryFacts: composition.facts, retrievalFacts, filterFacts: freshness.facts,
          ...extra,
        })
      }
      const freshSet = { ...workingSet, candidates: fresh }
      if (fresh.length === 0) {
        traced({})
        if (alreadyPresentRecords > 0) {
          note.decide('no-query-match', { report, alreadyPresentRecords, retrievalTraced }); return decision
        }
        note.decide(report.activeRecords === 0 ? 'empty-store' : 'no-candidates',
          { report, retrievalTraced })
        return decision
      }
      if (selector === undefined) {
        const matched = renderMemoryWorkingSet(freshSet.query, fresh.filter(candidate => candidate.score > 0))
        traced(matched.candidates.length === 0 ? {} : {
          injection: {
            workingSet: matched,
            dropped: fresh.filter(candidate => candidate.score === 0)
              .map(candidate => ({ id: candidate.id, reason: 'no-query-match' as const })),
          },
        })
        const zeroScore = fresh.filter(candidate => candidate.score === 0)
        const selection = selectionFactsOf('controller_without_selector', fresh, matched, zeroScore
          .map((candidate, index) => ({ recordId: String(candidate.id), inputRank: fresh.length + index + 1, reason: 'no-query-match' as const })))
        if (matched.candidates.length === 0) {
          note.decide('no-query-match', {
            report, alreadyPresentRecords, selectionFacts: selection, retrievalTraced,
          }); return decision
        }
        const message = recallMessage(matched)
        note.decide('injected', {
          report, injectedRecords: matched.candidates.length, alreadyPresentRecords,
          resultMessageId: String(message.id), selectionFacts: selection, retrievalTraced,
        })
        return { ...decision, messages: [...decision.messages, message] }
      }
      const selectionStartedAt = Date.now()
      const selection = await selector.select(agent, {
        query: query.text,
        isCurrent: () => isActive() && controller.isCurrent(ticket),
        candidates: fresh.map(candidate => ({
          id: String(candidate.id),
          label: candidate.record.kind,
          excerpt: candidate.excerpt,
          score: candidate.score,
          tags: tagsOf(agent, candidate.id),
        })),
        limits: {
          maxCandidates: config.maxCandidates,
          maxExcerptBytes: config.maxExcerptBytes,
          maxTotalBytes: config.maxTotalBytes,
          candidatePool: config.candidatePool ?? 'lexical',
          maxPool: config.maxPool ?? config.maxCandidates,
          admission: config.admission ?? 'explicit',
        },
        recallId: note.recallId,
      }, signal)
      signal.throwIfAborted()
      if (!isActive()) { note.decide('consumer-inactive', { report }); return decision }
      if (!controller.isCurrent(ticket)) { note.decide('stale', { report }); return decision }
      const byId = new Map(fresh.map(candidate => [String(candidate.id), candidate]))
      const uniqueIds = [...new Set(selection.selectedIds)]
      const candidates = uniqueIds.flatMap((id) => {
        const candidate = byId.get(id)
        return candidate === undefined ? [] : [candidate]
      })
      const budgeted = budgetMemoryWorkingSetWithDrops(freshSet.query, candidates, config.maxTotalBytes)
      traced({
        injection: {
          workingSet: budgeted.workingSet,
          dropped: budgeted.dropped,
          selection: {
            mode: selection.mode, outcome: selection.outcome,
            selectedIds: [...selection.selectedIds].slice(0, MAX_RECORDED_RECORDS),
            baselineIds: [...selection.baselineIds].slice(0, MAX_RECORDED_RECORDS),
          },
        },
      })
      const factsOfSelection = selectionFactsWithSelector(
        fresh, selection, uniqueIds, budgeted, selectionStartedAt,
      )
      if (budgeted.workingSet.candidates.length === 0) {
        note.decide('selection-empty', {
          report, alreadyPresentRecords, selectionFacts: factsOfSelection, retrievalTraced,
        }); return decision
      }
      const message = recallMessage(budgeted.workingSet)
      note.decide('injected', {
        report, injectedRecords: budgeted.workingSet.candidates.length, alreadyPresentRecords,
        resultMessageId: String(message.id), selectionFacts: factsOfSelection, retrievalTraced,
      })
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error: unknown) {
      note.decide(signal.aborted ? 'cancelled' : 'error')
      throw error
    }
  })
  const dispose = ctx.effect(() => () => {
    active = false
    stop()
  })
  return () => { void dispose() }
}

/**
 * Compose the recall query for one pre-step: the newest user message in the request, then the Session's most recent
 * human message in its current surface, then its current goal objective, then its most recent assistant or tool text.
 * The Session fallbacks read the current surface, so a message a compaction replaced never supplies a stale query.
 * @param ctx - context that may own the Session projection registry.
 * @param session - Session whose current surface and goal projection supply the fallbacks.
 * @param messages - messages the pre-step decision carries.
 * @returns the query text and its source, or undefined when none of the sources has text.
 */
export function composeRecallQuery(
  ctx: Context,
  session: Session | undefined,
  messages: readonly UserMessage[],
): ContinuumRecallQuery | undefined {
  return composeRecallQueryRecord(ctx, session, messages).query
}

/** One composition attempt: the query, or undefined, together with the sources it actually consulted. */
export interface RecallQueryComposition {
  readonly query?: ContinuumRecallQuery
  readonly facts: MemoryQueryFacts
}

const QUERY_LOOKUP_POLICY = Object.freeze({
  sourcePriority: Object.freeze([
    'pre_step_messages:newest_user_text',
    'session_surface:newest_user_text',
    'goal_projection:objective',
    'session_surface:newest_non_user_text',
  ]),
  textRule: 'text blocks joined with a newline, then trimmed; only source.kind=user can supply a human query',
})

/**
 * Compose the recall query and record which sources this attempt consulted, in priority order.
 * A source after the one that supplied the query is reported as `not_consulted`, never as read.
 * @param ctx - context that may own the Session projection registry.
 * @param session - Session whose current surface and goal projection supply the fallbacks.
 * @param messages - messages the pre-step decision carries.
 * @returns the query composition with its facts.
 */
export function composeRecallQueryRecord(
  ctx: Context,
  session: Session | undefined,
  messages: readonly UserMessage[],
): RecallQueryComposition {
  const startedAt = Date.now()
  const requestMessages: MemoryQueryMessageFact[] = []
  const surfaceMessages: MemoryQueryMessageFact[] = []
  // 0 pre-step messages, 1 session surface, 2 goal, 3 surface execution text.
  const checks: { location: NonNullable<MemoryQueryFacts['sourceChecks'][number]['location']>; result: 'selected' | 'empty' | 'absent' | 'not_consulted' }[] = [
    { location: 'pre_step_messages', result: 'empty' },
    { location: 'session_surface', result: 'not_consulted' },
    { location: 'goal_projection', result: 'not_consulted' },
    { location: 'surface_execution_text', result: 'not_consulted' },
  ]
  const finish = (query?: ContinuumRecallQuery, extra: Partial<MemoryQueryFacts> = {}): RecallQueryComposition => ({
    ...(query === undefined ? {} : { query }),
    facts: {
      status: query === undefined ? 'no_query' : 'resolved',
      ...(query === undefined ? {} : {
        queryText: query.text, origin: query.source,
        lengthUtf16: query.text.length,
      }),
      lookupPolicy: QUERY_LOOKUP_POLICY,
      requestMessages,
      surfaceMessages,
      sourceChecks: checks,
      startedAt, endedAt: Date.now(),
      ...extra,
    },
  })
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined) continue
    const text = messageText(message.content)
    requestMessages.push({ messageId: String(message.id), role: message.role, ...sourceKindOf(message), text })
    if (message.source.kind !== 'user' || text.length === 0) continue
    checks[0] = { location: 'pre_step_messages', result: 'selected' }
    return finish({ text, source: 'latest-user-message' }, {
      sourceLocation: 'pre_step_messages', selectedSource: { messageId: String(message.id) },
    })
  }
  if (session === undefined) {
    checks[1] = { location: 'session_surface', result: 'absent' }
    checks[2] = { location: 'goal_projection', result: 'absent' }
    checks[3] = { location: 'surface_execution_text', result: 'absent' }
    return finish()
  }
  const surface = session.deriveMessages()
  for (let index = surface.length - 1; index >= 0; index -= 1) {
    const message = surface[index]
    if (message === undefined) continue
    const text = messageText(message.content)
    surfaceMessages.push({ messageId: String(message.id), role: message.role, ...sourceKindOf(message), text })
    // A restored surface entry may lack a source; only a user-role message can carry the human source kind.
    if (message.role !== 'user' || text.length === 0 || message.source.kind !== 'user') continue
    checks[1] = { location: 'session_surface', result: 'selected' }
    return finish({ text, source: 'latest-user-message' }, {
      sourceLocation: 'session_surface', selectedSource: { messageId: String(message.id) },
    })
  }
  checks[1] = { location: 'session_surface', result: 'empty' }
  const goalState = ctx.get('sessionProjections')?.stateOf(session, 'goal')
  const goal = goalState?.current?.goal.objective.trim()
  if (goal !== undefined && goal.length > 0) {
    checks[2] = { location: 'goal_projection', result: 'selected' }
    return finish({ text: goal, source: 'session-goal' }, {
      sourceLocation: 'goal_projection', goalObjective: goal, selectedSource: { location: 'goal_projection' },
    })
  }
  checks[2] = { location: 'goal_projection', result: goal === undefined ? 'absent' : 'empty' }
  for (let index = surface.length - 1; index >= 0; index -= 1) {
    const message = surface[index]
    if (message === undefined || message.role === 'user') continue
    const text = messageText(message.content)
    if (text.length > 0) {
      checks[3] = { location: 'surface_execution_text', result: 'selected' }
      return finish({ text, source: 'execution-text' }, {
        sourceLocation: 'session_surface', selectedSource: { messageId: String(message.id) },
      })
    }
  }
  checks[3] = { location: 'surface_execution_text', result: 'empty' }
  return finish()
}

/**
 * Whether one record's text already appears verbatim in the current request, so injecting it would repeat it.
 * @param recordContent - complete content of one active record.
 * @param messages - messages the pre-step decision carries.
 * @returns true only when a request message contains the record content exactly.
 */
export function alreadyPresentIn(recordContent: string, messages: readonly UserMessage[]): boolean {
  if (recordContent.length === 0) return false
  return messages.some(message => messageText(message.content).includes(recordContent))
}

/**
 * Source kind of one message, or no key when the message carries none. A surface message rebuilt from a historical log
 * entry may lack the source its role implies; that absence is reported rather than filled with a guessed kind.
 * @param message - message whose source may be absent in restored data.
 * @returns the source kind key, or an empty object.
 */
function sourceKindOf(message: object): { readonly sourceKind?: string } {
  // Restored surface messages are typed as carrying a source, but a historical log entry may omit it; a missing kind
  // is reported as absent rather than filled with a guess.
  const source = (message as { readonly source?: { readonly kind?: string } }).source
  return source?.kind === undefined ? {} : { sourceKind: source.kind }
}

function messageText(content: readonly ContentBlock[]): string {
  return content.filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
    .map(block => block.text).join('\n').trim()
}

/** One optional injection a traced read attaches to its retrieval event. */
interface TracedInjection {
  readonly injection?: {
    readonly workingSet: MemoryWorkingSet
    readonly dropped: readonly MemoryDroppedRecord[]
    readonly selection?: MemorySelectionRecord
  }
}

/** What one judgement knows about its recall when it settles. */
interface RecallOutcome {
  readonly report?: MemoryRetrievalReport
  readonly injectedRecords?: number
  readonly alreadyPresentRecords?: number
  /** Native id of the recall message this judgement appended, when it appended one. */
  readonly resultMessageId?: string
  /** Selection facts, present only after a selection path actually ran. */
  readonly selectionFacts?: MemorySelectionFacts
  /** Whether a `continuum/memory-retrieval` event already carried the query facts for this recall. */
  readonly retrievalTraced?: boolean
}

/** One pre-step recall's identity and its terminal judgement. */
interface RecallNote {
  readonly recallId: string
  decide(reason: MemoryRecallDecisionReason, outcome?: RecallOutcome): void
}

/** Start one recall judgement: allocate its stable id and record the terminal reason once it settles. */
function recallNote(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  query: ContinuumRecallQuery | undefined,
  composition: RecallQueryComposition,
): RecallNote {
  const recallId = randomUUID()
  return {
    recallId,
    decide: (reason, outcome = {}) => {
      const { report, injectedRecords, alreadyPresentRecords, resultMessageId, selectionFacts, retrievalTraced } = outcome
      recordMemoryRecallDecision(retrievalRecorder(ctx, agent), {
        turn, step, recallId,
        outcome: reason === 'injected' ? 'injected' : reason === 'error' || reason === 'cancelled' ? 'failed' : 'skipped',
        reason,
        ...(query === undefined
          ? {}
          : {
            ...(query.source === 'latest-user-message' ? { querySource: 'latest-user-message' as const } : {}),
            queryOrigin: query.source,
            queryChars: query.text.length,
          }),
        ...(report === undefined ? {} : { activeRecords: report.activeRecords, candidateRecords: report.candidateRecords }),
        ...(injectedRecords === undefined ? {} : { injectedRecords }),
        ...(alreadyPresentRecords === undefined ? {} : { alreadyPresentRecords }),
        ...(resultMessageId === undefined ? {} : { resultMessageId }),
        ...(selectionFacts === undefined ? {} : { selectionFacts }),
        ...(retrievalTraced === true ? {} : { queryFacts: composition.facts }),
      })
    },
  }
}

/** The candidates one selection stage saw, numbered from one in model order. */
function candidateViews(candidates: readonly MemoryCandidate[]): readonly MemorySelectionEligible[] {
  return candidates.map((candidate, index) => ({
    record: recordRefOf(candidate.record), inputRank: index + 1,
    excerptStart: candidate.excerptStart, excerptEnd: candidate.excerptEnd, score: candidate.score,
  }))
}

/** One candidate a selection stage saw, numbered from one in model order. */
type MemorySelectionEligible = MemorySelectionFacts['eligible'] extends readonly (infer T)[] ? T : never

/** Selection facts for the deterministic path that never consulted a selector. */
function selectionFactsOf(
  selectionPath: MemorySelectionFacts['selectionPath'],
  eligible: readonly MemoryCandidate[],
  applied: MemoryWorkingSet,
  excluded: readonly MemorySelectionExclusion[] = [],
): MemorySelectionFacts {
  const started = Date.now()
  return {
    selectionPath,
    eligible: candidateViews(eligible),
    appliedOrder: applied.candidates.map((candidate, index) => ({ record: recordRefOf(candidate.record), appliedRank: index + 1 })),
    duplicateSelections: [],
    invalidSelections: [],
    selected: applied.candidates.map((candidate, index) => ({
      record: recordRefOf(candidate.record), finalRank: index + 1,
      excerptStart: candidate.excerptStart, excerptEnd: candidate.excerptEnd,
    })),
    excluded: [...excluded],
    topKApplied: false,
    actualSelectedCount: applied.candidates.length,
    renderedBytes: applied.bytes,
    coverage: { complete: true, missingEvidence: [] },
    startedAt: started, endedAt: Date.now(),
  }
}

/**
 * Selection facts for one selector round: the settled receipt, which returned ids became candidates, which repeated or
 * named no eligible record, and which candidates the byte budget then excluded.
 * @param eligible - candidates offered to the selector, in input order.
 * @param selection - the settled selector result this consumer applied.
 * @param uniqueIds - the selector's ids after order-preserving deduplication.
 * @param budgeted - the byte-budgeted working set actually rendered.
 * @param startedAt - epoch milliseconds when the selector call began.
 * @returns complete selection facts for this round.
 */
function selectionFactsWithSelector(
  eligible: readonly MemoryCandidate[],
  selection: ContinuumMemorySelection,
  uniqueIds: readonly string[],
  budgeted: MemoryBudgetOutcome,
  startedAt: number,
): MemorySelectionFacts {
  const position = new Map(eligible.map((candidate, index) => [String(candidate.id), index]))
  const retained = new Map<string, number>()
  const duplicateSelections: MemorySelectionDuplicate[] = []
  const invalidSelections: MemorySelectionInvalid[] = []
  for (const [index, id] of selection.selectedIds.entries()) {
    if (retained.has(id)) {
      duplicateSelections.push({ recordId: id, selectedInputIndex: index, retainedInputIndex: retained.get(id) as number })
      continue
    }
    retained.set(id, index)
    if (!position.has(id)) invalidSelections.push({ recordId: id, selectedInputIndex: index, reason: 'outside_fresh_candidates' })
  }
  const excluded: MemorySelectionExclusion[] = [
    ...duplicateSelections.map(entry => ({
      recordId: entry.recordId, inputRank: (position.get(entry.recordId) ?? 0) + 1, reason: 'selection-duplicate' as const,
    })),
    ...invalidSelections.map(entry => ({ recordId: entry.recordId, reason: 'selection-unknown-id' as const })),
    ...budgeted.dropped.map(entry => ({
      recordId: String(entry.id), inputRank: (position.get(String(entry.id)) ?? 0) + 1, reason: entry.reason,
    })),
  ]
  const applied = uniqueIds.flatMap((id) => {
    const candidate = eligible[position.get(id) ?? -1]
    return candidate === undefined ? [] : [candidate]
  })
  return {
    selectionPath: 'controller_with_selector',
    eligible: candidateViews(eligible),
    selectorResult: {
      mode: selection.mode, selectedIds: [...selection.selectedIds], baselineIds: [...selection.baselineIds],
      outcome: selection.outcome, ...(selection.failure === undefined ? {} : { failure: selection.failure }),
    },
    appliedOrder: applied.map((candidate, index) => ({ record: recordRefOf(candidate.record), appliedRank: index + 1 })),
    duplicateSelections,
    invalidSelections,
    selected: budgeted.workingSet.candidates.map((candidate, index) => ({
      record: recordRefOf(candidate.record), finalRank: index + 1,
      excerptStart: candidate.excerptStart, excerptEnd: candidate.excerptEnd,
    })),
    excluded,
    ...(selection.outcome === 'unknown' ? {} : { appliedSource: selection.outcome }),
    topKApplied: false,
    actualSelectedCount: budgeted.workingSet.candidates.length,
    renderedBytes: budgeted.workingSet.bytes,
    coverage: { complete: true, missingEvidence: [] },
    startedAt, endedAt: Date.now(),
  }
}

/** One freshness exclusion with the message that proved it. */
type MemoryFilterExclusion = MemoryFilterFacts['excluded'] extends readonly (infer T)[] ? T : never

/** One selection exclusion as the selector or the byte budget produced it. */
type MemorySelectionExclusion = MemorySelectionFacts['excluded'] extends readonly (infer T)[] ? T : never
/** One selector id that repeated an earlier one. */
type MemorySelectionDuplicate = MemorySelectionFacts['duplicateSelections'] extends readonly (infer T)[] ? T : never
/** One selector id that named no eligible candidate. */
type MemorySelectionInvalid = MemorySelectionFacts['invalidSelections'] extends readonly (infer T)[] ? T : never

/** Record identity from a record snapshot; the event reference is absent unless the caller resolved it. */
function recordRefOf(record: { readonly id: MemoryId; readonly revision: number }): MemoryRecordRefFact {
  return { recordId: String(record.id), revision: record.revision }
}

/** Complete retrieval facts from one read: participants, survivors, channel and exclusions. */
function retrievalSourceFacts(
  facts: MemoryRetrievalOutcome['facts'],
  config: MemoryRetrievalConfig,
  scopes: readonly string[] | undefined,
  startedAt: number,
): MemoryRetrievalFacts {
  return {
    status: 'completed',
    participants: facts.participants.map(participant => ({
      record: recordRefOf(participant.record), score: participant.score, matchedTerms: [...participant.matchedTerms],
    })),
    candidates: facts.candidates.map(candidate => ({
      record: recordRefOf(candidate.record), score: candidate.score,
      excerptStart: candidate.excerptStart, excerptEnd: candidate.excerptEnd,
    })),
    // One lexical channel: the current pipeline has no second route, so the list never invents one.
    routes: [{
      routeId: 'lexical',
      method: 'deterministic substring match over kind, scope and content',
      query: facts.candidatePool === 'all' ? 'all active records' : 'query terms from the recall query',
      ...(scopes === undefined ? {} : { scopes: [...scopes] }),
      index: config.index === undefined ? 'none' : 'disposable_lexical_index',
    }],
    retrievalPolicy: {
      matchRule: 'a query term substring of the lowercased kind, scope or content counts as one hit',
      candidatePool: facts.candidatePool,
      maxCandidates: config.maxCandidates,
      maxExcerptBytes: config.maxExcerptBytes,
      maxTotalBytes: config.maxTotalBytes,
      orderRule: 'score descending; positive ties by record id; zero-score records newest first',
    },
    excluded: [
      ...facts.prefiltered.map(record => ({ recordId: String(record.id), reason: 'index-prefilter' as const })),
      ...facts.excluded.map(entry => ({ recordId: String(entry.id), reason: entry.reason })),
    ],
    handoff: facts.handoff.map(candidate => recordRefOf(candidate.record)),
    coverage: { complete: true, missingEvidence: [] },
    startedAt, endedAt: Date.now(),
  }
}

/** One freshness filter outcome: survivors, the per-record exclusions, and the comparison snapshot. */
interface FreshnessOutcome {
  readonly kept: readonly MemoryCandidate[]
  readonly facts: MemoryFilterFacts
}

/**
 * Compare each candidate's complete record content against the pre-step messages, recording the message that proved
 * each already-present record. The scan short-circuits at the first containing message, as the filter itself does.
 * @param candidates - candidates the read handed to this filter, in model order.
 * @param messages - messages the pre-step decision actually carries.
 * @param startedAt - epoch milliseconds when the comparison began.
 * @returns the kept candidates and the filter's complete facts.
 */
function freshnessFacts(
  candidates: readonly MemoryCandidate[],
  messages: readonly UserMessage[],
  startedAt: number,
): FreshnessOutcome {
  const text = messages.map(message => ({ message, joined: messageText(message.content) }))
  const kept: MemoryCandidate[] = []
  const excluded: MemoryFilterExclusion[] = []
  const keptFacts: { record: MemoryRecordRefFact; inputRank: number; outputRank: number }[] = []
  for (const [index, candidate] of candidates.entries()) {
    const matched = candidate.record.content.length === 0
      ? undefined
      : text.find(entry => entry.joined.includes(candidate.record.content))
    if (matched === undefined) {
      kept.push(candidate)
      keptFacts.push({ record: recordRefOf(candidate.record), inputRank: index + 1, outputRank: kept.length })
      continue
    }
    excluded.push({
      record: recordRefOf(candidate.record), inputRank: index + 1,
      reason: 'already_in_pre_step_messages', matchedMessageId: String(matched.message.id),
    })
  }
  const comparisonMessages: MemoryFilterMessageFact[] = messages.map(message => ({
    messageId: String(message.id), role: message.role, ...sourceKindOf(message), content: message.content,
  }))
  return {
    kept,
    facts: {
      status: 'completed',
      comparisonScope: 'pre_step_messages',
      candidates: candidates.map((candidate, index) => ({
        record: recordRefOf(candidate.record), inputRank: index + 1,
        excerptStart: candidate.excerptStart, excerptEnd: candidate.excerptEnd,
      })),
      comparisonMessages,
      kept: keptFacts,
      excluded,
      comparisonRule: {
        textBlocksOnly: true, joinSeparator: '\n', trimMessageText: true, caseSensitive: true,
        match: 'full_record_substring',
      },
      alreadyPresentCount: excluded.length,
      coverage: { complete: true, missingEvidence: [] },
      startedAt, endedAt: Date.now(),
    },
  }
}

/** Numeric retrieval budgets only; the observation switch must not reach budget validation. */
function retrievalBudget(config: ContinuumMemoryContextConfig): Omit<ContinuumMemoryContextConfig, 'trace'> {
  const { trace: _trace, ...budget } = config
  return budget
}

/** Session log and warning sink for one read's retrieval events. */
function retrievalRecorder(ctx: Context, agent: Agent): MemoryRetrievalRecorder {
  return { session: agent.session, warn: (message) => { ctx.logger.warn(message) } }
}

/** Limits applied to the bounded recall, including the selector pool when one is mounted. */
function retrievalLimits(config: ContinuumMemoryContextConfig): MemoryRetrievalLimits {
  return {
    maxCandidates: config.maxCandidates,
    maxExcerptBytes: config.maxExcerptBytes,
    maxTotalBytes: config.maxTotalBytes,
    maxPool: config.maxPool ?? config.maxCandidates,
  }
}

/** Wait for a promise that never rejects, or reject with the turn's cancellation. */
async function abortable(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  const aborted = Promise.withResolvers<never>()
  const reject = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', reject, { once: true })
  try {
    await Promise.race([promise, aborted.promise])
  } finally {
    signal.removeEventListener('abort', reject)
  }
}

function recallMessage(workingSet: ReturnType<typeof retrieveMemoryWorkingSet>): UserMessage {
  return createUserMessage({
    source: { kind: 'continuum-memory', form: 'recall', version: 1, recordIds: workingSet.candidates.map(candidate => String(candidate.id)) },
    content: [{ type: 'text', text: workingSet.text }],
  })
}
