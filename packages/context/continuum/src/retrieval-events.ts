/** Durable retrieval facts for one bounded memory read; log-only and never model-visible. */
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  MemoryInjectedEventData,
  MemoryRecallDecisionEventData,
  MemoryRecallQuerySource,
  MemoryRetrievalLimits,
  MemorySelectionRecord,
} from './persistence.ts'
import { MAX_RECORDED_QUERY_CHARS, MAX_RECORDED_RECORDS } from './persistence.ts'
import type { MemoryDroppedRecord, MemoryRetrievalReport, MemoryWorkingSet } from './retrieval.ts'

/** The bounded read one injection stage produced, if it produced one. */
export interface MemoryInjectionFacts {
  readonly workingSet: MemoryWorkingSet
  /** Records the deterministic no-match filter or the selection byte budget excluded. */
  readonly dropped: readonly MemoryDroppedRecord[]
  /** Selector outcome; absent on the deterministic path. */
  readonly selection?: MemorySelectionRecord
}

/** Everything one retrieval read recorded, built once the pipeline has decided what to inject. */
export interface MemoryRetrievalTrace {
  readonly query: string
  /** Where the query came from. */
  readonly querySource: MemoryRecallQuerySource
  /** Exact authorized scopes; absent when the caller owns no scope list. */
  readonly scopes?: readonly string[]
  readonly limits: MemoryRetrievalLimits
  /** Whether an optional selector received the candidate pool. */
  readonly selectorMounted: boolean
  readonly report: MemoryRetrievalReport
  /** Absent when no candidate survived the limits. */
  readonly injection?: MemoryInjectionFacts
}

/** A Session append that failed after the read; the read itself is not affected. */
export interface MemoryRetrievalRecorder {
  readonly session: Session
  readonly warn: (message: string) => void
}

/**
 * Append the terminal outcome of one pre-step recall judgement, including an empty store or a skipped read.
 * This fact is independent of the detailed `trace` switch and never changes the read or its injection.
 * @param recorder - Session that owns the log and a warning sink for contained append failures.
 * @param decision - proposed position, terminal outcome, reason and any real read counts.
 */
export function recordMemoryRecallDecision(recorder: MemoryRetrievalRecorder, decision: MemoryRecallDecisionEventData): void {
  try {
    recorder.session.append('continuum/memory-recall-decision', decision)
  } catch (error: unknown) {
    recorder.warn(`continuum recall decision was not recorded: ${String(error)}`)
  }
}

/**
 * Append the retrieval events for one bounded read: the read itself, its lexical ranking, every limit that excluded
 * records, and the injected record set. Each stage is written only when it holds a fact; a failed append is logged and
 * never fails or delays the read.
 * @param recorder - Session that owns the log and a warning sink for contained append failures.
 * @param trace - retrieval facts gathered by the read and its injection stage.
 */
export function recordMemoryRetrieval(recorder: MemoryRetrievalRecorder, trace: MemoryRetrievalTrace): void {
  try {
    const { report } = trace
    const query = trace.query.slice(0, MAX_RECORDED_QUERY_CHARS)
    recorder.session.append('continuum/memory-retrieval', {
      querySource: 'latest-user-message',
      queryOrigin: trace.querySource,
      query,
      queryChars: trace.query.length,
      queryTruncated: query.length !== trace.query.length,
      ...(trace.scopes === undefined ? {} : { scopes: [...trace.scopes].slice(0, MAX_RECORDED_RECORDS) }),
      candidatePool: report.candidatePool,
      limits: trace.limits,
      activeRecords: report.activeRecords,
      candidateRecords: report.candidateRecords,
      terms: [...report.terms],
      matchedRecords: report.matchedRecords,
      selectorMounted: trace.selectorMounted,
    })
    if (report.ranked.length > 0) {
      recorder.session.append('continuum/memory-scored', {
        candidates: report.ranked.map(candidate => ({
          id: candidate.id, score: candidate.score, matchedTerms: [...candidate.matchedTerms],
        })),
        matchedRecords: report.matchedRecords,
      })
    }
    if (report.dropped.length > 0) {
      recorder.session.append('continuum/memory-budgeted', {
        stage: 'recall', dropped: [...report.dropped], droppedRecords: report.droppedRecords, bytes: report.bytes,
      })
    }
    const injection = trace.injection
    if (injection === undefined) return
    if (injection.dropped.length > 0) {
      recorder.session.append('continuum/memory-budgeted', {
        stage: 'selection',
        dropped: injection.dropped,
        droppedRecords: injection.dropped.length,
        bytes: injection.workingSet.bytes,
      })
    }
    const injected: MemoryInjectedEventData = {
      injectedIds: injection.workingSet.candidates.slice(0, MAX_RECORDED_RECORDS).map(candidate => candidate.id),
      injectedRecords: injection.workingSet.candidates.length,
      bytes: injection.workingSet.bytes,
      ...(injection.selection === undefined ? {} : { selection: injection.selection }),
    }
    recorder.session.append('continuum/memory-injected', injected)
  } catch (error: unknown) {
    recorder.warn(`continuum retrieval events were not recorded: ${String(error)}`)
  }
}
