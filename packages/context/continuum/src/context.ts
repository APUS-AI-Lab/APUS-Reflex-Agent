import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryId, MemoryRecordStore } from './records.ts'
import {
  budgetMemoryWorkingSetWithDrops, renderMemoryWorkingSet, retrieveMemoryWorkingSet, retrieveMemoryWorkingSetWithReport,
  type MemoryCandidatePool, type MemoryRetrievalConfig, type MemoryRetrievalReport,
} from './retrieval.ts'
import { MAX_RECORDED_RECORDS, type MemoryExecutionCandidate, type MemoryRecallDecisionReason, type MemoryRetrievalLimits } from './persistence.ts'
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
    input: { readonly candidates: readonly ContinuumAdmissionCandidate[]; readonly isCurrent: () => boolean },
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
    input: { readonly candidates: readonly ContinuumExecutionCandidate[]; readonly isCurrent: () => boolean },
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
    const query = latestUserText(messages)
    const note = recallDecision(ctx, agent, turn, step, query)
    try {
      if (!isActive()) { note('consumer-inactive'); return decision }
      if (decision.kind === 'reject') { note('step-rejected'); return decision }
      const store = storeOf(agent)
      if (store === undefined) { note('no-store'); return decision }
      if (query === undefined) { note('no-query'); return decision }
      signal.throwIfAborted()
      const { workingSet, report } = retrieveMemoryWorkingSetWithReport(store, budget, query)
      if (config.trace === true) {
        recordMemoryRetrieval(retrievalRecorder(ctx, agent), {
          query, limits: retrievalLimits(config), selectorMounted: false, report,
          ...(workingSet.candidates.length === 0 ? {} : { injection: { workingSet, dropped: [] } }),
        })
      }
      if (workingSet.candidates.length === 0) {
        note(report.activeRecords === 0 ? 'empty-store' : 'no-candidates', report)
        return decision
      }
      note('injected', report, workingSet.candidates.length)
      return { ...decision, messages: [...decision.messages, recallMessage(workingSet)] }
    } catch (error: unknown) {
      note(signal.aborted ? 'cancelled' : 'error')
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
    const query = latestUserText(messages)
    const note = recallDecision(ctx, agent, turn, step, query)
    try {
      if (!isActive()) { note('consumer-inactive'); return decision }
      if (decision.kind === 'reject') { note('step-rejected'); return decision }
      const controller = controllerOf(agent)
      if (controller === undefined) { note('no-controller'); return decision }
      if (query === undefined) { note('no-query'); return decision }
      signal.throwIfAborted()
      const pending = pendingOf(agent)
      if (pending !== undefined) await abortable(pending, signal)
      if (!isActive()) { note('consumer-inactive'); return decision }
      const ticket = controller.beginRead(principalOf(agent))
      if (ticket === undefined) { note('unavailable'); return decision }
      const selector = selectorOf()
      const requestedLimits = selector === undefined ? budget : {
        ...budget, maxCandidates: config.maxPool ?? config.maxCandidates, maxTotalBytes: Number.MAX_SAFE_INTEGER,
      }
      const outcome = controller.readWithReport(ticket, requestedLimits, query)
      if (outcome === undefined || !controller.isCurrent(ticket)) { note('stale'); return decision }
      const { workingSet, report } = outcome
      const recorder = config.trace === true ? retrievalRecorder(ctx, agent) : undefined
      if (workingSet.candidates.length === 0) {
        if (recorder !== undefined) {
          recordMemoryRetrieval(recorder, {
            query, limits: retrievalLimits(config), selectorMounted: selector !== undefined, report,
          })
        }
        note(report.activeRecords === 0 ? 'empty-store' : 'no-candidates', report)
        return decision
      }
      if (selector === undefined) {
        const matched = renderMemoryWorkingSet(workingSet.query, workingSet.candidates.filter(candidate => candidate.score > 0))
        if (recorder !== undefined) {
          recordMemoryRetrieval(recorder, {
            query, limits: retrievalLimits(config), selectorMounted: false, report,
            ...(matched.candidates.length === 0 ? {} : {
              injection: {
                workingSet: matched,
                dropped: workingSet.candidates.filter(candidate => candidate.score === 0)
                  .map(candidate => ({ id: candidate.id, reason: 'no-query-match' as const })),
              },
            }),
          })
        }
        if (matched.candidates.length === 0) { note('no-query-match', report); return decision }
        note('injected', report, matched.candidates.length)
        return { ...decision, messages: [...decision.messages, recallMessage(matched)] }
      }
      const selection = await selector.select(agent, {
        query,
        isCurrent: () => isActive() && controller.isCurrent(ticket),
        candidates: workingSet.candidates.map(candidate => ({
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
      }, signal)
      signal.throwIfAborted()
      if (!isActive()) { note('consumer-inactive', report); return decision }
      if (!controller.isCurrent(ticket)) { note('stale', report); return decision }
      const byId = new Map(workingSet.candidates.map(candidate => [String(candidate.id), candidate]))
      const candidates = [...new Set(selection.selectedIds)].flatMap((id) => {
        const candidate = byId.get(id)
        return candidate === undefined ? [] : [candidate]
      })
      const budgeted = budgetMemoryWorkingSetWithDrops(workingSet.query, candidates, config.maxTotalBytes)
      if (recorder !== undefined) {
        recordMemoryRetrieval(recorder, {
          query, limits: retrievalLimits(config), selectorMounted: true, report,
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
      }
      if (budgeted.workingSet.candidates.length === 0) { note('selection-empty', report); return decision }
      note('injected', report, budgeted.workingSet.candidates.length)
      return { ...decision, messages: [...decision.messages, recallMessage(budgeted.workingSet)] }
    } catch (error: unknown) {
      note(signal.aborted ? 'cancelled' : 'error')
      throw error
    }
  })
  const dispose = ctx.effect(() => () => {
    active = false
    stop()
  })
  return () => { void dispose() }
}

/** Record one judgement's terminal reason without depending on detailed retrieval tracing. */
function recallDecision(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  query: string | undefined,
): (reason: MemoryRecallDecisionReason, report?: MemoryRetrievalReport, injectedRecords?: number) => void {
  return (reason, report, injectedRecords) => {
    recordMemoryRecallDecision(retrievalRecorder(ctx, agent), {
      turn, step,
      outcome: reason === 'injected' ? 'injected' : reason === 'error' || reason === 'cancelled' ? 'failed' : 'skipped',
      reason,
      ...(query === undefined ? {} : { querySource: 'latest-user-message' as const, queryChars: query.length }),
      ...(report === undefined ? {} : { activeRecords: report.activeRecords, candidateRecords: report.candidateRecords }),
      ...(injectedRecords === undefined ? {} : { injectedRecords }),
    })
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

function latestUserText(messages: readonly UserMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.source.kind !== 'user') continue
    const text = message.content.filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text').map(block => block.text).join('\n').trim()
    if (text.length > 0) return text
  }
  return undefined
}
