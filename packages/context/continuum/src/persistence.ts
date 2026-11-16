import type { Session, SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
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
  /** The write trigger this transition belongs to; absent on historical events and on caller-owned transitions. */
  readonly writeId?: string
  /** The single create attempt that produced this record; absent on historical events and on non-create transitions. */
  readonly attemptId?: string
  /** Which entry produced the transition; absent on historical events. */
  readonly origin?: MemoryWriteOrigin
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
  /** The write trigger this entry belongs to; absent on historical events. */
  readonly writeId?: string
  /** The single create attempt whose record this entry indexes; absent on historical events. */
  readonly attemptId?: string
  /** Which entry produced the L1 entry; absent on historical events. */
  readonly origin?: MemoryWriteOrigin
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
  /** Kept for compatibility with events written before goal and execution fallbacks; always `latest-user-message`. */
  readonly querySource: 'latest-user-message'
  /** Where the query actually came from; absent on those older events. */
  readonly queryOrigin?: MemoryRecallQuerySource
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
  /** Stable identifier of the pre-step recall this read belongs to; absent on historical events. */
  readonly recallId?: string
  /** What the query composer consulted and settled on; written here when this event exists. */
  readonly queryFacts?: MemoryQueryFacts
  /** Complete retrieval participation and channel facts; absent on historical events. */
  readonly retrievalFacts?: MemoryRetrievalFacts
  /** Which candidates the pre-step request already contained; absent when filtering did not run. */
  readonly filterFacts?: MemoryFilterFacts
}

/** One message the query composer inspected, identified by its native message id. */
export interface MemoryQueryMessageFact {
  readonly messageId: string
  readonly role: string
  /** Source kind the message carries; absent when the message has none, which never supplies a human query. */
  readonly sourceKind?: string
  /** Text the composer extracted from this message; empty when it carries no text block. */
  readonly text: string
}

/** Which source the composer actually consulted, and whether it supplied the query. */
export type MemoryQuerySourceLocation = 'pre_step_messages' | 'session_surface' | 'goal_projection'

/** One source position the composer considered, in priority order. */
export interface MemoryQuerySourceCheck {
  /** `surface_execution_text` is the surface's assistant or tool text, consulted after the goal. */
  readonly location: MemoryQuerySourceLocation | 'surface_execution_text'
  readonly result: 'selected' | 'empty' | 'absent' | 'not_consulted'
}

/** The fixed lookup order and text rule this code version executes; not a tunable policy. */
export interface MemoryQueryLookupPolicy {
  readonly sourcePriority: readonly string[]
  readonly textRule: string
}

/** Memory-query facts: which sources this read consulted and what query it settled on. */
export interface MemoryQueryFacts {
  readonly status: 'resolved' | 'no_query'
  /** Complete query text; absent when no source produced one. */
  readonly queryText?: string
  readonly origin?: MemoryRecallQuerySource
  readonly sourceLocation?: MemoryQuerySourceLocation
  readonly lookupPolicy: MemoryQueryLookupPolicy
  /** Request messages inspected, in the order the composer scanned them. */
  readonly requestMessages: readonly MemoryQueryMessageFact[]
  /** Session messages inspected from the current surface, in scan order. */
  readonly surfaceMessages: readonly MemoryQueryMessageFact[]
  /** Goal objective the composer actually read, when it reached that branch. */
  readonly goalObjective?: string
  /** The message or projection position that supplied the query. */
  readonly selectedSource?: { readonly messageId: string } | { readonly location: 'goal_projection' }
  readonly sourceChecks: readonly MemoryQuerySourceCheck[]
  /** UTF-16 length of the query text. */
  readonly lengthUtf16?: number
  /** Epoch milliseconds when composition started and settled. */
  readonly startedAt?: number
  readonly endedAt?: number
}

/** Versioned record identity; the record event reference is present only when it was resolved. */
export interface MemoryRecordRefFact {
  readonly recordId: string
  readonly revision: number
  readonly recordSessionId?: string
  readonly recordEventSeq?: number
}

/** One candidate the read produced, with its exact excerpt window inside the record content. */
export interface MemoryRetrievalCandidateFact {
  readonly record: MemoryRecordRefFact
  readonly score: number
  readonly excerptStart: number
  readonly excerptEnd: number
}

/** One record that took part in lexical scoring, with the matched query terms. */
export interface MemoryParticipantFact {
  readonly record: MemoryRecordRefFact
  readonly score: number
  readonly matchedTerms: readonly string[]
}

/** One retrieval channel that actually ran. */
export interface MemoryRetrievalRouteFact {
  readonly routeId: 'lexical'
  readonly method: string
  readonly query: string
  readonly scopes?: readonly string[]
  readonly index: 'disposable_lexical_index' | 'none'
}

/** The matching, pool, limit and ordering rules this read actually applied. */
export interface MemoryRetrievalPolicyFact {
  readonly matchRule: string
  readonly candidatePool: 'lexical' | 'all'
  readonly maxCandidates: number
  readonly maxExcerptBytes: number
  readonly maxTotalBytes: number
  readonly orderRule: string
}

/** Retrieval facts: complete participants, surviving candidates, channels and exclusions. */
export interface MemoryRetrievalFacts {
  readonly status: 'completed'
  readonly participants: readonly MemoryParticipantFact[]
  readonly candidates: readonly MemoryRetrievalCandidateFact[]
  readonly routes: readonly MemoryRetrievalRouteFact[]
  readonly retrievalPolicy: MemoryRetrievalPolicyFact
  readonly excluded: readonly { readonly recordId: string; readonly reason: MemoryDropReasonFact }[]
  readonly handoff: readonly MemoryRecordRefFact[]
  readonly coverage: MemoryFactCoverage
  readonly startedAt?: number
  readonly endedAt?: number
}

/** Why one record did not survive a stage; the runtime drop reasons plus the index prefilter. */
export type MemoryDropReasonFact = 'candidate-limit' | 'byte-budget' | 'excerpt-budget' | 'no-query-match' | 'index-prefilter'

/** One compared candidate, identified by version and the pre-step message that contains it. */
export interface MemoryFilterCandidateFact {
  readonly record: MemoryRecordRefFact
  readonly inputRank: number
  readonly excerptStart: number
  readonly excerptEnd: number
}

/** One pre-step message the freshness filter compared against. */
export interface MemoryFilterMessageFact {
  readonly messageId: string
  readonly role: string
  /** Source kind the message carries; absent when the message has none. */
  readonly sourceKind?: string
  readonly content: readonly ContentBlock[]
}

/** Comparison rule the filter executed; not a tunable policy. */
export interface MemoryFilterRuleFact {
  readonly textBlocksOnly: true
  readonly joinSeparator: '\n'
  readonly trimMessageText: true
  readonly caseSensitive: true
  readonly match: 'full_record_substring'
}

/** Filter facts: which candidates the pre-step request already contained, and which message proved it. */
export interface MemoryFilterFacts {
  readonly status: 'completed'
  readonly comparisonScope: 'pre_step_messages'
  readonly candidates: readonly MemoryFilterCandidateFact[]
  readonly comparisonMessages: readonly MemoryFilterMessageFact[]
  readonly kept: readonly { readonly record: MemoryRecordRefFact; readonly inputRank: number; readonly outputRank: number }[]
  readonly excluded: readonly {
    readonly record: MemoryRecordRefFact
    readonly inputRank: number
    readonly reason: 'already_in_pre_step_messages'
    readonly matchedMessageId: string
  }[]
  readonly comparisonRule: MemoryFilterRuleFact
  readonly alreadyPresentCount: number
  readonly coverage: MemoryFactCoverage
  readonly startedAt?: number
  readonly endedAt?: number
}

/** Completeness of one stage's source facts; a missing member names the absent evidence. */
export interface MemoryFactCoverage {
  readonly complete: boolean
  readonly missingEvidence: readonly string[]
}

/** Selector receipt this consumer applied; verbatim values from the settled result. */
export interface MemorySelectorResultFact {
  readonly mode: 'off' | 'shadow' | 'active'
  readonly selectedIds: readonly string[]
  readonly baselineIds: readonly string[]
  readonly outcome: 'off' | 'baseline' | 'jev' | 'unknown'
  readonly failure?: string
}

/** One selector id that repeated an earlier id in the same array; indices are zero-based. */
export interface MemorySelectionDuplicateFact {
  readonly recordId: string
  readonly selectedInputIndex: number
  readonly retainedInputIndex: number
}

/** One selector id that named no eligible candidate; it was ignored, not turned into a record version. */
export interface MemorySelectionInvalidFact {
  readonly recordId: string
  readonly selectedInputIndex: number
  readonly reason: 'outside_fresh_candidates'
}

/** One candidate that survived into the rendered recall, at its applied rank. */
export interface MemorySelectedCandidateFact {
  readonly record: MemoryRecordRefFact
  readonly finalRank: number
  readonly excerptStart: number
  readonly excerptEnd: number
}

/** Selection facts: the path taken, what was applied, and every exclusion with its cause. */
export interface MemorySelectionFacts {
  readonly selectionPath: 'controller_with_selector' | 'controller_without_selector' | 'direct_store'
  readonly maxTotalBytes?: number
  readonly eligible: readonly {
    readonly record: MemoryRecordRefFact
    readonly inputRank: number
    readonly excerptStart: number
    readonly excerptEnd: number
    readonly score: number
  }[]
  readonly selectorResult?: MemorySelectorResultFact
  readonly appliedOrder: readonly { readonly record: MemoryRecordRefFact; readonly appliedRank: number }[]
  readonly duplicateSelections: readonly MemorySelectionDuplicateFact[]
  readonly invalidSelections: readonly MemorySelectionInvalidFact[]
  readonly selected: readonly MemorySelectedCandidateFact[]
  readonly excluded: readonly {
    readonly recordId: string
    readonly inputRank?: number
    readonly reason: MemoryDropReasonFact | 'selection-duplicate' | 'selection-unknown-id'
  }[]
  readonly appliedSource?: 'jev' | 'baseline' | 'off'
  /** This version has no independent final Top-K step, so it never reports one. */
  readonly topKApplied: false
  readonly actualSelectedCount: number
  /** UTF-8 bytes of the complete rendered recall, including heading, metadata and separators. */
  readonly renderedBytes: number
  readonly coverage: MemoryFactCoverage
  readonly startedAt?: number
  readonly endedAt?: number
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
  /** Stable identifier of the pre-step recall that produced this injection; absent on historical events. */
  readonly recallId?: string
}

/** Where one recall query came from: the request's newest user message, the Session goal, or executed text. */
export type MemoryRecallQuerySource = 'latest-user-message' | 'session-goal' | 'execution-text'

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
  /** Compatibility field: present only when the query was the latest user message. */
  readonly querySource?: 'latest-user-message'
  /** Where the query actually came from, including the Session-goal and executed-text fallbacks. */
  readonly queryOrigin?: MemoryRecallQuerySource
  /** Full UTF-16 length of that query. */
  readonly queryChars?: number
  /** Active records visible to the authorized read, when a read ran. */
  readonly activeRecords?: number
  /** Candidates left by that read before selection, when a read ran. */
  readonly candidateRecords?: number
  /** Records in the recall appended by this judgement; present only for `injected`. */
  readonly injectedRecords?: number
  /** Records dropped because the current request already contained their text verbatim. */
  readonly alreadyPresentRecords?: number
  /** Stable identifier of this pre-step recall; absent on historical events. */
  readonly recallId?: string
  /** Query facts, written here only when no `continuum/memory-retrieval` event carries them. */
  readonly queryFacts?: MemoryQueryFacts
  /** Selection facts for this recall; present when a selection path actually ran. */
  readonly selectionFacts?: MemorySelectionFacts
  /** Native id of the recall `user/message` this judgement appended; absent when none was created. */
  readonly resultMessageId?: string
}

/** Which entry produced one memory write trigger. */
export type MemoryWriteOrigin = 'explicit' | 'user-message' | 'compaction' | 'execution'

/** One candidate an automatic entry actually offered for storage, before any judge ran. */
export interface MemoryWriteCandidateFact {
  readonly candidateId: string
  /** Source events whose text supplied the candidate. */
  readonly sourceRefs: readonly MemorySourceRef[]
  /** Normalization this entry applied; `sourceChars` and `candidateChars` are both UTF-16 lengths. */
  readonly normalization: {
    readonly textBlocksOnly: boolean
    readonly joinSeparator: '\n'
    readonly trim: boolean
    readonly sourceChars: number
    readonly candidateChars: number
    readonly truncated: boolean
  }
  /** Record id this candidate would create, when the entry derives one before the judge runs. */
  readonly targetRecordId?: string
}

/** How completely one write entry's source window and candidate list were captured. */
export interface MemoryWriteCoverage {
  readonly sourceWindowComplete: boolean
  readonly candidateListComplete: boolean
  readonly missingEvidence: readonly string[]
}

/** One source the entry inspected and did not offer, with the reason it gave. */
export interface MemoryWriteExclusionFact {
  readonly sourceRefs: readonly MemorySourceRef[]
  readonly reason: 'empty-text' | 'not-human-text' | 'existing-record' | 'interrupted' | 'candidate-limit' | 'out-of-window'
}

/** Event payload for the candidates one automatic write trigger actually offered. */
export interface MemoryWriteCandidatesEventData {
  readonly version: 1
  readonly writeId: string
  readonly origin: MemoryWriteOrigin
  readonly status: 'candidates_ready' | 'skipped' | 'failed'
  /** Why nothing was offered; absent when candidates were ready. */
  readonly reason?: string
  /** The Session event that triggered this write; absent when the caller itself is the trigger. */
  readonly triggerRef?: MemoryWriteTriggerRef
  /** The exact source window this entry scanned. */
  readonly window?: MemoryWriteWindowFact
  readonly candidates: readonly MemoryWriteCandidateFact[]
  readonly exclusions: readonly MemoryWriteExclusionFact[]
  /** Sources inside the window the entry stopped before inspecting. */
  readonly unexaminedSourceRefs?: readonly MemorySourceRef[]
  readonly coverage: MemoryWriteCoverage
}

/** One native event that triggered a memory write. */
export interface MemoryWriteTriggerRef {
  readonly sessionId: SessionId
  readonly eventSeq: SessionSeq
  readonly eventType: string
}

/** The source window one automatic entry scanned. */
export type MemoryWriteWindowFact =
  | { readonly kind: 'user-message'; readonly messageSeq: SessionSeq }
  | { readonly kind: 'compaction'; readonly summarySeq: SessionSeq; readonly shadowedSeqs: readonly SessionSeq[] }
  | { readonly kind: 'execution'; readonly stepStartSeq: SessionSeq; readonly stepEndSeq: SessionSeq }

/** What happened to one offered candidate. */
export type MemoryCandidateResultStatus =
  | 'not_offered' | 'rejected' | 'already_exists' | 'not_attempted' | 'create_attempted' | 'record_accepted' | 'failed' | 'cancelled' | 'unverifiable'

/** One candidate's real destination, with the record version it produced when one exists. */
export interface MemoryCandidateResultFact {
  readonly candidateId: string
  readonly status: MemoryCandidateResultStatus
  readonly reason?: string
  readonly record?: MemoryRecordRefFact
  readonly attemptId?: string
}

/** How far one create attempt got; each stage is reported separately because they are not atomic. */
export interface MemoryAttemptResultFact {
  readonly attemptId: string
  readonly proposedRecordId: string
  readonly candidateId?: string
  readonly origin: MemoryWriteOrigin
  readonly storeStatus: 'created' | 'rejected' | 'unknown'
  readonly appendStatus: 'accepted' | 'rejected' | 'unverifiable'
  readonly indexStatus: 'observed' | 'not_attempted' | 'unverifiable'
  readonly l1Status: 'added' | 'not_applicable' | 'failed' | 'unverifiable'
  readonly recordEventRef?: { readonly sessionId: SessionId; readonly seq: SessionSeq }
  readonly failure?: { readonly stage: 'store' | 'append' | 'index'; readonly code?: string; readonly message?: string }
}

/** Event payload for the real destination of every candidate one write trigger offered. */
export interface MemoryWriteResultEventData {
  readonly version: 1
  readonly writeId: string
  readonly origin: MemoryWriteOrigin
  readonly triggerRef?: MemoryWriteTriggerRef
  readonly candidateResults: readonly MemoryCandidateResultFact[]
  readonly attemptResults: readonly MemoryAttemptResultFact[]
  /** Accepted `continuum/memory-record` creates this trigger produced. */
  readonly recordEventRefs: readonly { readonly sessionId: SessionId; readonly seq: SessionSeq }[]
  /** L1 and lexical index events this trigger produced. */
  readonly indexEventRefs: readonly { readonly sessionId: SessionId; readonly seq: SessionSeq; readonly kind: 'l1' | 'lexical' }[]
  /** The execution write decision this result settles; absent for other entries. */
  readonly nativeWriteDecisionRef?: { readonly sessionId: SessionId; readonly seq: SessionSeq }
  /** Values the native decision reported, kept beside the observed ones so a conflict stays visible. */
  readonly reportedCounts?: { readonly candidateRecords: number; readonly writtenRecords?: number }
  readonly partialFailures: readonly string[]
  readonly missingEvidence: readonly string[]
}

/** Maximum UTF-16 characters of a query or term recorded in a retrieval event. */
export const MAX_RECORDED_QUERY_CHARS = 500
/** Maximum IDs or candidates one retrieval event records; paired counts stay complete. */
export const MAX_RECORDED_RECORDS = 64

/** Why one post-step execution-fact judgement did or did not write a record. */
export type MemoryWriteDecisionReason =
  | 'admitted'
  | 'no-new-facts'
  | 'no-scope'
  | 'no-admitter'
  | 'stale'
  | 'cancelled'
  | 'error'

/**
 * Terminal facts of one post-step execution-fact judgement; log-only and never model-visible. The candidates are the
 * assistant and tool text one closed step produced, offered to the adjudicator that decides which become records.
 */
export interface MemoryWriteDecisionEventData {
  /** Turn and step whose executed text this judgement covered. */
  readonly turn: number
  readonly step: number
  /** `admitted` means at least one record was written by this judgement. */
  readonly outcome: 'admitted' | 'skipped' | 'failed'
  readonly reason: MemoryWriteDecisionReason
  /** Candidates offered to the adjudicator; zero records a step that produced no assistant or tool text. */
  readonly candidateRecords: number
  /** Records this judgement wrote; absent unless at least one was written. */
  readonly writtenRecords?: number
}

/** Text one closed step produced, offered as a memory-record candidate. */
export interface MemoryExecutionCandidate {
  readonly id: string
  /** Session sequence of the assistant message or tool result that carries the text. */
  readonly seq: number
  /** Complete text of that event. */
  readonly content: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A source-backed Continuum record transition; log-only and never model-visible. */
    'continuum/memory-record': MemoryRecordEventData
    /** An L1 index entry pointing at an original human message; log-only and never model-visible. */
    'continuum/memory-index': MemoryIndexEventData
    /** Terminal outcome and reason of one pre-step recall judgement; log-only and never model-visible. */
    'continuum/memory-recall-decision': MemoryRecallDecisionEventData
    /** Terminal outcome of one post-step execution-fact judgement; log-only and never model-visible. */
    'continuum/memory-write-decision': MemoryWriteDecisionEventData
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
    /** The candidates one automatic memory write trigger actually offered; log-only and never model-visible. */
    'continuum/memory-write-candidates': MemoryWriteCandidatesEventData
    /** The real destination of every candidate one memory write trigger offered; log-only and never model-visible. */
    'continuum/memory-write-result': MemoryWriteResultEventData
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
  /**
   * Records this rebuild actually applied: the cold-start snapshot members for `full`, or the entries the bounded
   * loop drained. The count alone cannot say which version reached the index.
   */
  readonly appliedRecords?: readonly {
    readonly recordId: MemoryId
    readonly revision: number
    /** Search terms this version put in the index; absent on historical events. */
    readonly terms?: readonly string[]
  }[]
  /** Epoch milliseconds when the rebuild work itself started; absent on historical events. */
  readonly startedAt?: number
  /** Epoch milliseconds when the rebuild work finished; absent on historical events. */
  readonly endedAt?: number
}

/** Event payload for one record snapshot queued into the derived index. */
export interface MemoryIndexQueuedEventData {
  readonly recordId: MemoryId
  /** Queue depth after this enqueue, before the bounded rebuild drains it. */
  readonly pendingRecords: number
  /** Version of the snapshot this enqueue replaced in the queue; absent on historical events. */
  readonly revision?: number
  /** The write trigger that produced the queued snapshot; absent on historical events. */
  readonly writeId?: string
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
 * @param applied - the versions this rebuild really applied, with its real work interval.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryIndexRebuiltEvent(
  session: Session,
  result: MemoryIndexRebuildResult,
  scope: 'full' | 'bounded',
  consumed?: number,
  applied?: MemoryIndexRebuildEventDetails,
): SessionEvent<'continuum/memory-index-rebuilt'> {
  return session.append('continuum/memory-index-rebuilt', {
    scope,
    indexedRecords: result.indexedRecords,
    pendingRecords: result.pendingRecords,
    ...(consumed === undefined ? {} : { consumed }),
    ...(applied === undefined ? {} : {
      appliedRecords: applied.appliedRecords.map(entry => ({
        recordId: entry.recordId, revision: entry.revision, terms: [...entry.terms],
      })),
      startedAt: applied.startedAt,
      endedAt: applied.endedAt,
    }),
  })
}

/** Records one rebuild actually applied, with the real work interval. */
export interface MemoryIndexRebuildEventDetails {
  readonly appliedRecords: readonly {
    readonly recordId: MemoryId
    readonly revision: number
    readonly terms: readonly string[]
  }[]
  readonly startedAt: number
  readonly endedAt: number
}

/**
 * Append one record snapshot entering the derived index queue.
 * @param session - live Session that owns the durable event log.
 * @param recordId - record whose newer snapshot was queued.
 * @param pendingRecords - queue depth after the enqueue.
 * @param details - the queued snapshot's version and, when known, its write trigger.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryIndexQueuedEvent(
  session: Session,
  recordId: MemoryId,
  pendingRecords: number,
  details?: { readonly revision: number; readonly writeId?: string },
): SessionEvent<'continuum/memory-index-queued'> {
  return session.append('continuum/memory-index-queued', {
    recordId, pendingRecords,
    ...(details === undefined ? {} : { revision: details.revision }),
    ...(details?.writeId === undefined ? {} : { writeId: details.writeId }),
  })
}

/**
 * Assistant and tool text one closed step produced, offered as execution-fact candidates. Only the step's own
 * completed model output counts: a turn-cancelled `assistant/message` is marked `interrupted` and excluded, as are
 * generated recall, user input, index and record events, so a record can never be founded on Continuum's own writes
 * or on a half-delivered answer. Each candidate keeps at most {@link MAX_EXECUTION_CANDIDATE_CHARS} characters and
 * one step offers at most {@link MAX_EXECUTION_CANDIDATES}, so a large tool result cannot become an unbounded record.
 * @param events - Session event stream, in sequence order.
 * @param stepStartSeq - sequence of the `step/start` that opened the judged step.
 * @param stepEndSeq - sequence of the `step/end` that closed it; the window is `[stepStartSeq, stepEndSeq]`.
 * @returns one candidate per assistant message or tool result with text, in stream order; empty when the step produced none.
 */
export function executionSourceFacts(
  events: readonly SessionEvent[],
  stepStartSeq: number,
  stepEndSeq: number,
): readonly MemoryExecutionCandidate[] {
  const candidates: MemoryExecutionCandidate[] = []
  for (const event of events) {
    if (candidates.length >= MAX_EXECUTION_CANDIDATES) break
    if (Number(event.seq) < stepStartSeq || Number(event.seq) > stepEndSeq) continue
    const content = event.type === 'assistant/message'
      ? event.data.interrupted === true ? [] : event.data.message.content
      : event.type === 'tool/result' ? event.data.message.content : []
    const text = content
      .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
      .map(block => block.text).join('\n').trim()
    if (text.length === 0) continue
    candidates.push({ id: String(event.seq), seq: Number(event.seq), content: text.slice(0, MAX_EXECUTION_CANDIDATE_CHARS) })
  }
  return candidates
}

/** Maximum UTF-16 characters one execution candidate offers for judgement. */
export const MAX_EXECUTION_CANDIDATE_CHARS = 16_384
/** Maximum candidates one closed step offers for judgement. */
export const MAX_EXECUTION_CANDIDATES = 32

/**
 * Append the candidates one automatic write trigger offered. A failed append is reported and never fails the write.
 * @param session - live Session that owns the durable event log.
 * @param facts - the offered candidates, exclusions and window.
 * @param warn - warning sink for a contained append failure.
 * @returns the appended event, or undefined when the append failed.
 */
export function appendMemoryWriteCandidatesEvent(
  session: Session,
  facts: MemoryWriteCandidatesEventData,
  warn: (message: string) => void,
): SessionEvent<'continuum/memory-write-candidates'> | undefined {
  try {
    return session.append('continuum/memory-write-candidates', facts)
  } catch (error: unknown) {
    warn(`continuum write candidates were not recorded: ${String(error)}`)
    return undefined
  }
}

/**
 * Append the real destination of every candidate one write trigger offered. A failed append is reported and never
 * fails the write itself.
 * @param session - live Session that owns the durable event log.
 * @param facts - per-candidate and per-attempt results with their record references.
 * @param warn - warning sink for a contained append failure.
 * @returns the appended event, or undefined when the append failed.
 */
export function appendMemoryWriteResultEvent(
  session: Session,
  facts: MemoryWriteResultEventData,
  warn: (message: string) => void,
): SessionEvent<'continuum/memory-write-result'> | undefined {
  try {
    return session.append('continuum/memory-write-result', facts)
  } catch (error: unknown) {
    warn(`continuum write result was not recorded: ${String(error)}`)
    return undefined
  }
}

/**
 * Append one execution-fact judgement to the Session log. A failed append is reported and never fails the step.
 * @param session - live Session that owns the durable event log.
 * @param decision - turn, step, terminal outcome and real counts.
 * @param warn - warning sink for a contained append failure.
 * @returns the appended event, or undefined when the append failed.
 */
export function appendMemoryWriteDecision(
  session: Session,
  decision: MemoryWriteDecisionEventData,
  warn: (message: string) => void,
): SessionEvent<'continuum/memory-write-decision'> | undefined {
  try {
    return session.append('continuum/memory-write-decision', decision)
  } catch (error: unknown) {
    warn(`continuum memory write decision was not recorded: ${String(error)}`)
    return undefined
  }
}

/**
 * Append one L1 index entry to the Session log.
 * @param session - live Session that owns the durable event log.
 * @param entry - entry whose source is a human message of the same Session.
 * @param admission - admission path and tag source; omit only when the caller owns that fact.
 * @param attribution - the write trigger and attempt this entry belongs to.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryIndexEvent(
  session: Session,
  entry: MemoryIndexEntry,
  admission?: MemoryIndexAdmission,
  attribution?: MemoryWriteAttribution,
): SessionEvent<'continuum/memory-index'> {
  return session.append('continuum/memory-index', {
    operation: 'add', entry,
    ...(admission === undefined ? {} : { admission }),
    ...(attribution === undefined ? {} : {
      writeId: attribution.writeId, origin: attribution.origin,
      ...(attribution.attemptId === undefined ? {} : { attemptId: attribution.attemptId }),
    }),
  })
}

/**
 * Append one already-validated record transition to the Session log.
 * @param session - live Session that owns the durable event log.
 * @param operation - transition represented by the record snapshot.
 * @param record - post-transition record accepted by the caller's store.
 * @param previous - pre-transition record for supersede or deactivate; omit for create.
 * @param attribution - the write trigger and attempt this transition belongs to.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryRecordEvent(
  session: Session,
  operation: MemoryRecordOperation,
  record: MemoryRecord,
  previous?: MemoryRecordPredecessor,
  attribution?: MemoryWriteAttribution,
): SessionEvent<'continuum/memory-record'> {
  return session.append('continuum/memory-record', {
    operation, record,
    ...(previous === undefined ? {} : { previous }),
    ...(operation === 'create' ? {} : { invalidatesReads: true as const }),
    ...(attribution === undefined ? {} : { writeId: attribution.writeId }),
    ...(attribution?.attemptId === undefined ? {} : { attemptId: attribution.attemptId }),
    ...(attribution === undefined ? {} : { origin: attribution.origin }),
  })
}

/** Which write trigger and attempt one record or index event belongs to. */
export interface MemoryWriteAttribution {
  readonly writeId: string
  readonly origin: MemoryWriteOrigin
  /** Present only on the single create attempt that produced the transition. */
  readonly attemptId?: string
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
