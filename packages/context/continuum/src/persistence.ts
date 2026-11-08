import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { MemoryId, MemoryRecord, MemoryRecordStore, MemorySourceRef, MemoryStatus, NewMemoryRecord } from './records.ts'
import type { MemoryDroppedRecord } from './retrieval.ts'
import type { MemoryIndexRebuildResult } from './memory-index.ts'

/** Durable operation written to the existing Session event log. */
export type MemoryRecordOperation = 'create' | 'supersede' | 'deactivate'

/** The record a supersede or deactivate transition replaced, before that transition. */
export interface MemoryRecordPredecessor {
  readonly id: MemoryId
  readonly revision: number
  readonly status: MemoryStatus
  readonly sourceRefs: readonly [MemorySourceRef, ...MemorySourceRef[]]
}

/** Event payload for one accepted Continuum record transition. */
export interface MemoryRecordEventData {
  /** Transition applied to the record store. */
  readonly operation: MemoryRecordOperation
  /** Complete post-transition record snapshot. */
  readonly record: MemoryRecord
  /**
   * Pre-transition record snapshot for a supersede or deactivate transition, including its source references;
   * absent for create and on historical events.
   */
  readonly previous?: MemoryRecordPredecessor
  /** Present when the transition invalidated in-flight reads; absent for create and on historical events. */
  readonly invalidatesReads?: true
}

/** One exact event resolved from a source reference. */
export interface MemorySourceEvent {
  readonly sessionId: SessionId
  readonly event: SessionEvent
}

/** One L1 index entry: Reflex tags and a pointer to the original human message in L2, never the message text. */
export interface MemoryIndexEntry {
  readonly id: MemoryId
  readonly scope: string
  /** Tags Reflex assigned; empty when the message was kept without a Reflex judgement. */
  readonly tags: readonly string[]
  /** The human `user/message` event whose text the entry indexes. */
  readonly source: MemorySourceRef
}

/** Which admission path produced one L1 index entry and how its tags were decided. */
export interface MemoryIndexAdmission {
  /** Which admission path produced the entry: compaction, or a committed user message. */
  readonly source: 'compaction' | 'user-message'
  /** Reflex supplied the tags, the admitter failed and every candidate was kept untagged, or no admitter judged it. */
  readonly tagSource: 'reflex' | 'fallback-untagged' | 'unjudged'
}

/** Event payload that adds one entry to the L1 index. */
export interface MemoryIndexEventData {
  readonly operation: 'add'
  readonly entry: MemoryIndexEntry
  /** Admission path that produced the entry; absent on historical events. */
  readonly admission?: MemoryIndexAdmission
}

/** Effective retrieval limits applied before any candidate reached the model. */
export interface MemoryRetrievalLimits {
  readonly maxCandidates: number
  readonly maxExcerptBytes: number
  readonly maxTotalBytes: number
  /** Candidates offered to a mounted selector; equal to `maxCandidates` without one. */
  readonly maxPool: number
}

/** Event payload for the start of one memory retrieval, before ranking limits apply. */
export interface MemoryRetrievalEventData {
  /** Where the query came from; the current consumer always uses the latest human message with text. */
  readonly querySource: 'latest-user-message'
  /** Query terms used for scoring, truncated to {@link MAX_RECORDED_QUERY_CHARS} characters. */
  readonly query: string
  /** Full UTF-16 length of the query, before recording truncation. */
  readonly queryChars: number
  /** Whether `query` is a prefix of the full query text. */
  readonly queryTruncated: boolean
  /** Exact scopes the read was authorized for; absent when the caller owns no scopes. */
  readonly scopes?: readonly string[]
  readonly candidatePool: 'lexical' | 'all'
  readonly limits: MemoryRetrievalLimits
  /** Active records in the authorized projection. */
  readonly activeRecords: number
  /** Records left after the inverted-index prefilter. */
  readonly candidateRecords: number
  /** Normalized query terms used for lexical scoring, at most {@link MAX_RECORDED_RECORDS} of them. */
  readonly terms: readonly string[]
  /** Matched records before candidate and byte limits; may exceed `candidates` in the scored event. */
  readonly matchedRecords: number
  /** Whether an optional selector receives the candidate pool after this read. */
  readonly selectorMounted: boolean
}

/** One ranked candidate with its lexical score and the query terms it matched. */
export interface MemoryScoredCandidate {
  readonly id: MemoryId
  readonly score: number
  readonly matchedTerms: readonly string[]
}

/** Event payload listing the lexical ranking that candidate limits then filter. */
export interface MemoryScoredEventData {
  /** Matched candidates in ranked order, at most {@link MAX_RECORDED_RECORDS} entries. */
  readonly candidates: readonly MemoryScoredCandidate[]
  /** Complete matched candidate count, including entries omitted from `candidates`. */
  readonly matchedRecords: number
}

/** Event payload for one candidate or byte limit that excluded records. */
export interface MemoryBudgetEventData {
  /** `recall` before any selector; `selection` after the selector's proposal. */
  readonly stage: 'recall' | 'selection'
  /** Excluded records in ranked order, at most {@link MAX_RECORDED_RECORDS} entries. */
  readonly dropped: readonly MemoryDroppedRecord[]
  /** Complete excluded count, including entries omitted from `dropped`. */
  readonly droppedRecords: number
  /** UTF-8 bytes of the recall that this stage produced. */
  readonly bytes: number
}

/** Selector outcome recorded with an injection, so advice and applied recall are distinguishable. */
export interface MemorySelectionRecord {
  readonly mode: 'off' | 'shadow' | 'active'
  readonly outcome: 'off' | 'baseline' | 'jev' | 'unknown'
  /**
   * IDs the selector returned and the consumer applied. Shadow mode returns the baseline order, not the Jev advice;
   * the advice order of that round is in the paired `continuum/memory-decision` evaluation.
   */
  readonly selectedIds: readonly string[]
  /** Baseline recall the deterministic path would have injected. */
  readonly baselineIds: readonly string[]
}

/** Event payload for the record set that reached the model. */
export interface MemoryInjectedEventData {
  /** Injected record IDs in model order, at most {@link MAX_RECORDED_RECORDS} entries. */
  readonly injectedIds: readonly string[]
  /** Complete injected count, including entries omitted from `injectedIds`. */
  readonly injectedRecords: number
  /** UTF-8 bytes of the injected recall. */
  readonly bytes: number
  /** Selector outcome; absent on the deterministic path. */
  readonly selection?: MemorySelectionRecord
}

/** Why one pre-step recall judgement did or did not add memory context to the request. */
export type MemoryRecallDecisionReason =
  | 'injected'
  | 'consumer-inactive'
  | 'step-rejected'
  | 'no-store'
  | 'no-controller'
  | 'no-query'
  | 'unavailable'
  | 'empty-store'
  | 'no-candidates'
  | 'no-query-match'
  | 'selection-empty'
  | 'stale'
  | 'cancelled'
  | 'error'

/** Terminal facts of one pre-step recall judgement; log-only and independent of detailed retrieval tracing. */
export interface MemoryRecallDecisionEventData {
  /** Proposed turn and step; a rejected or empty proposal may have no later `step/start`. */
  readonly turn: number
  readonly step: number
  /** `injected` means a recall message was appended in this judgement, not that a candidate merely existed. */
  readonly outcome: 'injected' | 'skipped' | 'failed'
  readonly reason: MemoryRecallDecisionReason
  /** Present when a current human-message query was available. */
  readonly querySource?: 'latest-user-message'
  /** Full UTF-16 length of that query. */
  readonly queryChars?: number
  /** Active records visible to the authorized read, when a read ran. */
  readonly activeRecords?: number
  /** Candidates left by that read before selection, when a read ran. */
  readonly candidateRecords?: number
  /** Records in the recall appended by this judgement; present only for `injected`. */
  readonly injectedRecords?: number
}

/** Maximum UTF-16 characters of a query or term recorded in a retrieval event. */
export const MAX_RECORDED_QUERY_CHARS = 500
/** Maximum IDs or candidates one retrieval event records; paired counts stay complete. */
export const MAX_RECORDED_RECORDS = 64

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A source-backed Continuum record transition; log-only and never model-visible. */
    'continuum/memory-record': MemoryRecordEventData
    /** An L1 index entry pointing at an original human message; log-only and never model-visible. */
    'continuum/memory-index': MemoryIndexEventData
    /** Terminal outcome and reason of one pre-step recall judgement; log-only and never model-visible. */
    'continuum/memory-recall-decision': MemoryRecallDecisionEventData
    /** One memory retrieval's query, authorization scope and applied limits; log-only and never model-visible. */
    'continuum/memory-retrieval': MemoryRetrievalEventData
    /** The lexical ranking one retrieval produced; log-only and never model-visible. */
    'continuum/memory-scored': MemoryScoredEventData
    /** Records a candidate or byte limit excluded before injection; log-only and never model-visible. */
    'continuum/memory-budgeted': MemoryBudgetEventData
    /** The record set one retrieval injected into the next model request; log-only and never model-visible. */
    'continuum/memory-injected': MemoryInjectedEventData
    /** One rebuild of the disposable lexical index, whole or bounded; log-only and never model-visible. */
    'continuum/memory-index-rebuilt': MemoryIndexRebuiltEventData
    /** A newer record snapshot queued for the next bounded index rebuild; log-only and never model-visible. */
    'continuum/memory-index-queued': MemoryIndexQueuedEventData
  }
}

/** Event payload for one rebuild of the derived lexical index. */
export interface MemoryIndexRebuiltEventData {
  /**
   * `full` rebuilds from the whole authoritative projection; `bounded` rebuilds
   * at most `limit` queued snapshots. The index itself is disposable state: it
   * is never authoritative, and a reader uses these counts to tell how far it
   * lagged behind the record log at this moment.
   */
  readonly scope: 'full' | 'bounded'
  /** Records represented by the index after this rebuild. */
  readonly indexedRecords: number
  /** Snapshots still waiting for a rebuild after this one. */
  readonly pendingRecords: number
  /** How many queued snapshots this rebuild consumed; absent on a full rebuild. */
  readonly consumed?: number
}

/** Event payload for one record snapshot queued into the derived index. */
export interface MemoryIndexQueuedEventData {
  readonly recordId: MemoryId
  /** Queue depth after this enqueue, before the bounded rebuild drains it. */
  readonly pendingRecords: number
}

/**
 * Text of a human message, as an index entry resolves it.
 * @param event - any Session event.
 * @returns the joined, trimmed text blocks of a human `user/message`; empty for every other event.
 */
export function memorySourceText(event: SessionEvent): string {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return ''
  return event.data.content
    .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
    .map(block => block.text).join('\n').trim()
}

/**
 * Append the outcome of one derived-index rebuild to the Session log.
 *
 * The index is disposable and never authoritative, so these counts are the only
 * way a reader can tell how far retrieval's working set lagged the record log at
 * the moment it was rebuilt.
 * @param session - live Session that owns the durable event log.
 * @param result - counts the rebuild reported.
 * @param scope - whole projection or bounded drain of the queue.
 * @param consumed - queued snapshots this rebuild consumed; omit for a full rebuild.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryIndexRebuiltEvent(
  session: Session,
  result: MemoryIndexRebuildResult,
  scope: 'full' | 'bounded',
  consumed?: number,
): SessionEvent<'continuum/memory-index-rebuilt'> {
  return session.append('continuum/memory-index-rebuilt', {
    scope,
    indexedRecords: result.indexedRecords,
    pendingRecords: result.pendingRecords,
    ...(consumed === undefined ? {} : { consumed }),
  })
}

/**
 * Append one record snapshot entering the derived index queue.
 * @param session - live Session that owns the durable event log.
 * @param recordId - record whose newer snapshot was queued.
 * @param pendingRecords - queue depth after the enqueue.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryIndexQueuedEvent(
  session: Session,
  recordId: MemoryId,
  pendingRecords: number,
): SessionEvent<'continuum/memory-index-queued'> {
  return session.append('continuum/memory-index-queued', { recordId, pendingRecords })
}

/**
 * Append one L1 index entry to the Session log.
 * @param session - live Session that owns the durable event log.
 * @param entry - entry whose source is a human message of the same Session.
 * @param admission - admission path and tag source; omit only when the caller owns that fact.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryIndexEvent(
  session: Session,
  entry: MemoryIndexEntry,
  admission?: MemoryIndexAdmission,
): SessionEvent<'continuum/memory-index'> {
  return session.append('continuum/memory-index', { operation: 'add', entry, ...(admission === undefined ? {} : { admission }) })
}

/**
 * Append one already-validated record transition to the Session log.
 * @param session - live Session that owns the durable event log.
 * @param operation - transition represented by the record snapshot.
 * @param record - post-transition record accepted by the caller's store.
 * @param previous - pre-transition record for supersede or deactivate; omit for create.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryRecordEvent(
  session: Session,
  operation: MemoryRecordOperation,
  record: MemoryRecord,
  previous?: MemoryRecordPredecessor,
): SessionEvent<'continuum/memory-record'> {
  return session.append('continuum/memory-record', {
    operation, record,
    ...(previous === undefined ? {} : { previous }),
    ...(operation === 'create' ? {} : { invalidatesReads: true as const }),
  })
}

/**
 * Read exact source events from the existing durable Session backend.
 * @param persistence - mounted Session persistence service.
 * @param refs - source references declared by admitted records.
 * @param signal - cancellation propagated to backend reads.
 * @returns events in the same order as the supplied references.
 * @throws when a referenced Session or event sequence is absent.
 */
export async function readMemorySourceEvents(
  persistence: SessionPersistence,
  refs: readonly MemorySourceRef[],
  signal?: AbortSignal,
): Promise<readonly MemorySourceEvent[]> {
  const bySession = new Map<SessionId, readonly typeof refs[number][]>()
  for (const ref of refs) bySession.set(ref.sessionId, [...bySession.get(ref.sessionId) ?? [], ref])
  const resolved = new Map<string, MemorySourceEvent>()
  for (const [sessionId, sessionRefs] of bySession) {
    signal?.throwIfAborted()
    const handle = await persistence.open(sessionId, 'read', signal === undefined ? undefined : { signal })
    try {
      const { events } = await handle.read(undefined, undefined, signal === undefined ? undefined : { signal })
      for (const ref of sessionRefs) {
        const event = events.find(candidate => candidate.seq === ref.eventSeq)
        if (event === undefined) throw new Error(`memory source event ${sessionId}:${ref.eventSeq} was not found`)
        resolved.set(`${sessionId}:${ref.eventSeq}`, { sessionId, event })
      }
    } finally {
      await handle.close()
    }
  }
  return Object.freeze(refs.map((ref) => {
    const event = resolved.get(`${ref.sessionId}:${ref.eventSeq}`)
    if (event === undefined) throw new Error(`memory source event ${ref.sessionId}:${ref.eventSeq} was not resolved`)
    return event
  }))
}

/**
 * Rebuild Continuum records from durable log events without model calls or I/O. A live write appends the record event
 * before its index event, so the record event itself restores the content and the index only contributes its tags; an
 * index-only entry from an older log rebuilds an in-memory record whose content is resolved from its source event in
 * the same stream, so an index entry adds no second copy of that text.
 * @param events - complete Session event stream in sequence order.
 * @param store - empty or partially rebuilt record store.
 * @param tags - receives each index entry's tags by record ID, when supplied.
 * @returns the supplied store after applying every Continuum transition.
 * @throws when an index entry's source is not a human message with text in this stream, or a repeated record create
 *   event does not repeat its record exactly.
 */
export function foldMemoryRecordEvents(
  events: readonly SessionEvent[],
  store: MemoryRecordStore,
  tags?: Map<MemoryId, readonly string[]>,
): MemoryRecordStore {
  let bySeq: Map<number, SessionEvent> | undefined
  for (const event of events) {
    if (event.type === 'continuum/memory-index') {
      const { entry } = event.data
      tags?.set(entry.id, entry.tags)
      // Every live write appends the record event first and its index second;
      // an older log wrote the index first or alone. Replay accepts either:
      // the record event restores the content, and an index whose record
      // already exists only contributes its tags.
      if (store.get(entry.id) !== undefined) continue
      bySeq ??= new Map(events.map(candidate => [Number(candidate.seq), candidate]))
      const source = bySeq.get(Number(entry.source.eventSeq))
      const content = source === undefined ? '' : memorySourceText(source)
      if (content.length === 0) throw new Error(`memory ${entry.id} index source ${String(entry.source.eventSeq)} has no human text`)
      store.create({ id: entry.id, kind: 'fact', scope: entry.scope, content, sourceRefs: [entry.source] })
      continue
    }
    if (event.type !== 'continuum/memory-record') continue
    const { operation, record } = event.data
    if (operation === 'create') {
      const existing = store.get(record.id)
      if (existing !== undefined) {
        // The id was introduced by an index-first rebuild or an earlier create.
        // An exact repeat is idempotent replay; a differing one is a conflict,
        // never a silent overwrite.
        assertEquivalentRecord(existing, record)
        continue
      }
      store.create(asNewRecord(record))
      continue
    }
    if (operation === 'supersede') {
      if (record.supersedes === undefined) throw new Error(`memory ${record.id} supersede event has no predecessor`)
      const previous = store.get(record.supersedes)
      if (previous === undefined) throw new Error(`memory ${record.supersedes} predecessor is missing`)
      const restored = store.supersede(record.supersedes, previous.revision, asNewRecord(record))
      assertRestoredRecord(restored, record)
      continue
    }
    const previous = store.get(record.id)
    if (previous === undefined) throw new Error(`memory ${record.id} deactivation predecessor is missing`)
    const restored = store.deactivate(record.id, previous.revision)
    assertRestoredRecord(restored, record)
  }
  return store
}

function asNewRecord(record: MemoryRecord): NewMemoryRecord {
  const { revision: _revision, status: _status, supersedes: _supersedes, ...newRecord } = record
  return newRecord
}

/** Fields a repeated create event must repeat exactly about its record. */
const RECORD_EQUIVALENCE_FIELDS = ['revision', 'kind', 'scope', 'content', 'status', 'supersedes'] as const

function assertEquivalentRecord(actual: MemoryRecord, replayed: MemoryRecord): void {
  const differing: string[] = RECORD_EQUIVALENCE_FIELDS.filter(field => actual[field] !== replayed[field])
  // Source references compare entry-wise, so a caller's property order cannot make equal pointers look different.
  const sameRefs = actual.sourceRefs.length === replayed.sourceRefs.length
    && actual.sourceRefs.every((ref, index) => {
      const other = replayed.sourceRefs[index]
      return other !== undefined && ref.sessionId === other.sessionId && ref.eventSeq === other.eventSeq
    })
  if (!sameRefs) differing.push('sourceRefs')
  if (differing.length > 0) {
    throw new Error(`memory ${replayed.id} record event conflicts with the restored record: ${differing.join(', ')}`)
  }
}

function assertRestoredRecord(actual: MemoryRecord, expected: MemoryRecord): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`memory ${expected.id} event does not match its store transition`)
  }
}
