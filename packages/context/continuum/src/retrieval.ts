/** Deterministic recall windows with complete model-visible byte accounting. */
import type { MemoryId, MemoryRecord, MemoryRecordStore } from './records.ts'
import { memorySearchTerms, type MemoryRecordIndex } from './memory-index.ts'

/** Limits applied before any candidate can reach Jev or the main model. */
export interface MemoryRetrievalConfig {
  readonly maxCandidates: number
  /** UTF-8 byte limit for each exact record-content excerpt. */
  readonly maxExcerptBytes: number
  /** UTF-8 byte limit including the recall heading, metadata and separators. */
  readonly maxTotalBytes: number
  /**
   * `lexical` offers only records that share a term with the query. `all` also offers the remaining active records,
   * newest first after every lexical hit, for a selector that judges relevance without shared terms. Omitted means `lexical`.
   */
  readonly candidatePool?: MemoryCandidatePool | undefined
  /** Optional disposable inverted index; the record store remains authoritative. */
  readonly index?: MemoryRecordIndex
}

/** Which active records retrieval may offer as candidates. */
export type MemoryCandidatePool = 'lexical' | 'all'

/** One deterministic candidate produced from an active record. */
export interface MemoryCandidate {
  readonly id: MemoryId
  readonly record: MemoryRecord
  /** Number of query terms the record contains; zero only in the `all` pool. */
  readonly score: number
  readonly excerpt: string
  /** Inclusive UTF-16 offset in record.content, not in its source events. */
  readonly excerptStart: number
  /** Exclusive UTF-16 offset in record.content, not in its source events. */
  readonly excerptEnd: number
}

/** Bounded selection result used by the Jev adapter and context renderer. */
export interface MemoryWorkingSet {
  readonly query: string
  readonly candidates: readonly MemoryCandidate[]
  /** Complete model-visible recall, including its heading; empty without candidates. */
  readonly text: string
  /** UTF-8 bytes of text, including all metadata and separators. */
  readonly bytes: number
}

/** One ranked record with the query terms it matched, before candidate and byte limits. */
export interface MemoryRankedRecord {
  readonly id: MemoryId
  /** Number of matched query terms; `matchedTerms` lists at most {@link MAX_REPORT_TERMS} of them. */
  readonly score: number
  readonly matchedTerms: readonly string[]
}

/** Why one active record did not reach the model. */
export type MemoryDropReason = 'candidate-limit' | 'byte-budget' | 'excerpt-budget' | 'no-query-match'

/** One active record excluded by a candidate count, byte limit, or the lexical pool's zero-score filter. */
export interface MemoryDroppedRecord {
  readonly id: MemoryId
  readonly reason: MemoryDropReason
}

/**
 * Deterministic retrieval facts for one read. Arrays hold at most
 * {@link MAX_REPORT_RECORDS} entries; the paired counts stay exact. Record text is never included.
 */
export interface MemoryRetrievalReport {
  readonly candidatePool: MemoryCandidatePool
  /** Active records in the supplied projection. */
  readonly activeRecords: number
  /** Active records left after the inverted-index prefilter. */
  readonly candidateRecords: number
  /** Normalized query terms used for lexical scoring. */
  readonly terms: readonly string[]
  /** Matched records in ranked order, before candidate and byte limits. */
  readonly ranked: readonly MemoryRankedRecord[]
  readonly rankedRecords: number
  /** Ranked records that share at least one query term; zero-score records follow them in the `all` pool. */
  readonly matchedRecords: number
  /** Matched records excluded by a limit, in ranked order. */
  readonly dropped: readonly MemoryDroppedRecord[]
  readonly droppedRecords: number
  /** UTF-8 bytes of the bounded recall. */
  readonly bytes: number
}

/** One bounded recall together with the deterministic facts that produced it. */
export interface MemoryRetrievalOutcome {
  readonly workingSet: MemoryWorkingSet
  readonly report: MemoryRetrievalReport
  /** Complete scoring and exclusion facts, not cut at the report's recorded-entry bound. */
  readonly facts: MemoryRetrievalSourceFacts
}

/** One active record as scored and whether it survived the candidate and byte limits. */
export interface MemoryRetrievalParticipant {
  readonly record: MemoryRecord
  readonly score: number
  readonly matchedTerms: readonly string[]
}

/** Complete retrieval participation: every scored record, every survivor, every exclusion. */
export interface MemoryRetrievalSourceFacts {
  readonly candidatePool: MemoryCandidatePool
  readonly terms: readonly string[]
  /** Every active record that entered scoring, in ranked order. */
  readonly participants: readonly MemoryRetrievalParticipant[]
  /** Survivors in model order with their exact excerpt window. */
  readonly candidates: readonly MemoryCandidate[]
  /** Every exclusion with its real reason, in exclusion order. */
  readonly excluded: readonly MemoryDroppedRecord[]
  /**
   * Active records the derived index prefilter removed before scoring. They were never evaluated, so a reader must
   * not treat them as records the lexical match rejected.
   */
  readonly prefiltered: readonly MemoryRecord[]
  /** Survivors in the order handed to the freshness filter. */
  readonly handoff: readonly MemoryCandidate[]
}

/** One order-preserving subset and the candidates its byte budget excluded. */
export interface MemoryBudgetOutcome {
  readonly workingSet: MemoryWorkingSet
  readonly dropped: readonly MemoryDroppedRecord[]
}

const heading = '## Continuum memory\n'
const encoder = new TextEncoder()
const MAX_REPORT_RECORDS = 64
const MAX_REPORT_TERMS = 64

/**
 * Lexical, deterministic retrieval over the current record projection.
 * @param store - read-only record projection containing active and retired snapshots.
 * @param config - candidate and byte limits; metadata is never partially emitted.
 * @param query - user request terms; content hits anchor exact Unicode-safe excerpts.
 * @returns a bounded working set sorted by score and stable ID; records without a matching term follow, newest first.
 */
export function retrieveMemoryWorkingSet(
  store: Pick<MemoryRecordStore, 'snapshot'>,
  config: MemoryRetrievalConfig,
  query: string,
): MemoryWorkingSet {
  return retrieveMemoryWorkingSetWithReport(store, config, query).workingSet
}

/**
 * Lexical, deterministic retrieval with the ranked and dropped facts that produced the working set.
 * @param store - read-only record projection containing active and retired snapshots.
 * @param config - candidate and byte limits; metadata is never partially emitted.
 * @param query - user request terms; content hits anchor exact Unicode-safe excerpts.
 * @returns the same bounded working set as {@link retrieveMemoryWorkingSet}, plus bounded retrieval facts.
 */
export function retrieveMemoryWorkingSetWithReport(
  store: Pick<MemoryRecordStore, 'snapshot'>,
  config: MemoryRetrievalConfig,
  query: string,
): MemoryRetrievalOutcome {
  assertConfig(config)
  const terms = memorySearchTerms(query)
  const all = config.candidatePool === 'all'
  const indexedIds = all || config.index === undefined ? undefined : new Set(config.index.idsForTerms(terms))
  const snapshot = store.snapshot()
  const visible = snapshot
    .map((record, order) => ({ record, order }))
    .filter(({ record }) => record.status === 'active')
  const indexed = visible.filter(({ record }) => indexedIds === undefined || indexedIds.has(record.id))
  const scored = indexed.map(({ record, order }) => ({ record, order, ...scoreRecord(record, terms) }))
  const ranked = scored
    .filter(item => all || item.score > 0)
    .sort((a, b) => b.score - a.score || (a.score === 0
      ? b.order - a.order
      : Number(a.record.id > b.record.id) - Number(a.record.id < b.record.id)))
  const candidates: MemoryCandidate[] = []
  // A query with no search terms excludes every record for that reason, not for zero lexical overlap.
  const dropped: MemoryDroppedRecord[] = all || terms.length === 0
    ? []
    : scored.filter(item => item.score === 0).map(item => ({ id: item.record.id, reason: 'no-query-match' as const }))
  let bytes = utf8Bytes(heading)
  for (const [position, item] of ranked.entries()) {
    if (candidates.length >= config.maxCandidates) {
      dropped.push(...ranked.slice(position).map(entry => ({ id: entry.record.id, reason: 'candidate-limit' as const })))
      break
    }
    const available = config.maxTotalBytes - bytes - (candidates.length > 0 ? 1 : 0)
    if (available <= 0) {
      dropped.push(...ranked.slice(position).map(entry => ({ id: entry.record.id, reason: 'byte-budget' as const })))
      break
    }
    const content = prepareContent(item.record.content, terms)
    let excerptBudget = Math.min(config.maxExcerptBytes, available)
    let admitted = false
    while (excerptBudget > 0) {
      const range = excerptRange(content, excerptBudget)
      if (range === undefined) break
      const candidate: MemoryCandidate = Object.freeze({
        id: item.record.id,
        record: item.record,
        score: item.score,
        excerpt: item.record.content.slice(range.start, range.end),
        excerptStart: range.start,
        excerptEnd: range.end,
      })
      const candidateBytes = utf8Bytes(renderCandidate(candidate))
      if (candidateBytes <= available) {
        bytes += candidateBytes + (candidates.length > 0 ? 1 : 0)
        candidates.push(candidate)
        admitted = true
        break
      }
      excerptBudget = utf8Bytes(candidate.excerpt) - (candidateBytes - available)
    }
    if (!admitted) dropped.push({ id: item.record.id, reason: 'excerpt-budget' })
  }
  const workingSet = renderMemoryWorkingSet(query, candidates)
  return Object.freeze({
    workingSet,
    facts: Object.freeze({
      candidatePool: all ? 'all' : 'lexical',
      terms: Object.freeze([...terms]),
      participants: Object.freeze(ranked.map(item => Object.freeze({
        record: item.record, score: item.score, matchedTerms: Object.freeze([...item.matchedTerms]),
      }))),
      candidates: Object.freeze([...candidates]),
      excluded: Object.freeze([...dropped]),
      prefiltered: Object.freeze(indexedIds === undefined ? [] : visible
        .filter(({ record }) => !indexedIds.has(record.id)).map(({ record }) => record)),
      handoff: Object.freeze([...candidates]),
    }),
    report: Object.freeze({
      candidatePool: all ? 'all' : 'lexical',
      activeRecords: visible.length,
      candidateRecords: indexed.length,
      terms: Object.freeze(terms.slice(0, MAX_REPORT_TERMS)),
      ranked: Object.freeze(ranked.slice(0, MAX_REPORT_RECORDS).map(item => Object.freeze({
        id: item.record.id, score: item.score, matchedTerms: Object.freeze(item.matchedTerms.slice(0, MAX_REPORT_TERMS)),
      }))),
      rankedRecords: ranked.length,
      matchedRecords: ranked.filter(item => item.score > 0).length,
      dropped: Object.freeze(dropped.slice(0, MAX_REPORT_RECORDS)),
      droppedRecords: dropped.length,
      bytes: workingSet.bytes,
    }),
  })
}

/**
 * Render the complete recall or an order-preserving subset of a bounded recall.
 * @param query - original retrieval query.
 * @param candidates - previously budgeted candidates; removing entries preserves the bound.
 * @returns exact model-visible text with its UTF-8 byte count and an immutable candidate list.
 */
export function renderMemoryWorkingSet(query: string, candidates: readonly MemoryCandidate[]): MemoryWorkingSet {
  const text = candidates.length === 0 ? '' : heading + candidates.map(renderCandidate).join('\n')
  return Object.freeze({ query, candidates: Object.freeze([...candidates]), text, bytes: utf8Bytes(text) })
}

/**
 * Render selected candidates in order, keeping each one while the complete recall stays within the byte budget.
 * @param query - original retrieval query.
 * @param candidates - selected candidates in recall order; each excerpt is already bounded.
 * @param maxTotalBytes - UTF-8 byte limit including the heading, metadata and separators.
 * @returns the bounded working set; a candidate that does not fit is skipped and later ones may still fit.
 */
export function budgetMemoryWorkingSet(query: string, candidates: readonly MemoryCandidate[], maxTotalBytes: number): MemoryWorkingSet {
  return budgetMemoryWorkingSetWithDrops(query, candidates, maxTotalBytes).workingSet
}

/**
 * Render selected candidates in order within the byte budget and report which ones it excluded.
 * @param query - original retrieval query.
 * @param candidates - selected candidates in recall order; each excerpt is already bounded.
 * @param maxTotalBytes - UTF-8 byte limit including the heading, metadata and separators.
 * @returns the bounded working set and the candidates the budget excluded.
 */
export function budgetMemoryWorkingSetWithDrops(
  query: string,
  candidates: readonly MemoryCandidate[],
  maxTotalBytes: number,
): MemoryBudgetOutcome {
  const kept: MemoryCandidate[] = []
  const dropped: MemoryDroppedRecord[] = []
  let bytes = utf8Bytes(heading)
  for (const candidate of candidates) {
    const added = utf8Bytes(renderCandidate(candidate)) + (kept.length > 0 ? 1 : 0)
    if (bytes + added > maxTotalBytes) {
      dropped.push({ id: candidate.id, reason: 'byte-budget' })
      continue
    }
    bytes += added
    kept.push(candidate)
  }
  return Object.freeze({ workingSet: renderMemoryWorkingSet(query, kept), dropped: Object.freeze(dropped) })
}

function renderCandidate(candidate: MemoryCandidate): string {
  const before = candidate.excerptStart > 0
  const after = candidate.excerptEnd < candidate.record.content.length
  const omitted = before ? (after ? 'both' : 'before') : (after ? 'after' : 'none')
  return `[memory:${JSON.stringify(candidate.id)} revision:${candidate.record.revision} sources:${JSON.stringify(candidate.record.sourceRefs)} record-content-utf16:[${candidate.excerptStart},${candidate.excerptEnd}) omitted:${omitted}]\n${candidate.excerpt}`
}

function scoreRecord(record: MemoryRecord, terms: readonly string[]): { readonly score: number; readonly matchedTerms: readonly string[] } {
  if (terms.length === 0) return { score: 0, matchedTerms: [] }
  const haystack = `${record.kind} ${record.scope} ${record.content}`.toLowerCase()
  const matchedTerms = terms.filter(term => haystack.includes(term))
  return { score: matchedTerms.length, matchedTerms }
}

interface PreparedContent {
  readonly offsets: readonly number[]
  readonly bytes: readonly number[]
  readonly anchor: number
  readonly matchEnd: number
}

function prepareContent(value: string, terms: readonly string[]): PreparedContent {
  const lower = value.toLowerCase()
  let matchStart = lower.length
  let matchLength = 0
  for (const term of terms) {
    const index = lower.indexOf(term)
    if (index >= 0 && index < matchStart) {
      matchStart = index
      matchLength = term.length
    }
  }
  const offsets = [0]
  const bytes = [0]
  const foldedOffsets = [0]
  let offset = 0
  let byteOffset = 0
  let foldedOffset = 0
  for (const character of value) {
    offset += character.length
    byteOffset += utf8Bytes(character)
    foldedOffset += character.toLowerCase().length
    offsets.push(offset)
    bytes.push(byteOffset)
    foldedOffsets.push(foldedOffset)
  }
  // A kind/scope-only match uses the record prefix and its actual record offsets.
  const anchor = matchLength === 0 ? 0 : lowerBound(foldedOffsets, matchStart + 1) - 1
  const matchEnd = matchLength === 0 ? 0 : lowerBound(foldedOffsets, matchStart + matchLength)
  return { offsets, bytes, anchor, matchEnd }
}

function excerptRange(content: PreparedContent, maxBytes: number): { start: number; end: number } | undefined {
  const { bytes, offsets, anchor, matchEnd } = content
  // Prepared positions and lowerBound results address the arrays' code-point boundaries, including the final sentinel.
  const anchorBytes = bytes[anchor] as number
  const matchEndBytes = bytes[matchEnd] as number
  let start = lowerBound(bytes, anchorBytes - Math.floor(maxBytes / 3))
  let end = lowerBound(bytes, (bytes[start] as number) + maxBytes + 1) - 1
  if (end < matchEnd && matchEndBytes - anchorBytes <= maxBytes) {
    end = matchEnd
  }
  // When leading context consumes a tiny budget, prioritize the first matched code point.
  if (end <= anchor) end = lowerBound(bytes, anchorBytes + maxBytes + 1) - 1
  // Use spare space before the hit when the record ends or a multibyte unit does not fit.
  start = lowerBound(bytes, (bytes[end] as number) - maxBytes)
  if (end <= anchor || end <= start) return undefined
  return { start: offsets[start] as number, end: offsets[end] as number }
}

function lowerBound(values: readonly number[], target: number): number {
  let left = 0
  let right = values.length
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if ((values[middle] as number) < target) left = middle + 1
    else right = middle
  }
  return left
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength
}

function assertConfig(config: MemoryRetrievalConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (name === 'index') continue
    if (name === 'candidatePool') {
      if (value !== undefined && value !== 'lexical' && value !== 'all') throw new TypeError('candidatePool must be lexical or all')
      continue
    }
    if (name === 'admission') {
      if (value !== undefined && value !== 'explicit' && value !== 'user-message' && value !== 'compaction') {
        throw new TypeError('admission must be explicit, user-message, or compaction')
      }
      continue
    }
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  }
}
