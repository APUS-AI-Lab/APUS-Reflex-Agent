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

const heading = '## Continuum memory\n'
const encoder = new TextEncoder()

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
  assertConfig(config)
  const terms = memorySearchTerms(query)
  const all = config.candidatePool === 'all'
  const indexedIds = all || config.index === undefined ? undefined : new Set(config.index.idsForTerms(terms))
  const ranked = store.snapshot()
    .map((record, order) => ({ record, order }))
    .filter(({ record }) => record.status === 'active')
    .filter(({ record }) => indexedIds === undefined || indexedIds.has(record.id))
    .map(({ record, order }) => ({ record, order, score: scoreRecord(record, terms) }))
    .filter(item => all || item.score > 0)
    .sort((a, b) => b.score - a.score || (a.score === 0
      ? b.order - a.order
      : Number(a.record.id > b.record.id) - Number(a.record.id < b.record.id)))
  const candidates: MemoryCandidate[] = []
  let bytes = utf8Bytes(heading)
  for (const item of ranked) {
    if (candidates.length >= config.maxCandidates) break
    const available = config.maxTotalBytes - bytes - (candidates.length > 0 ? 1 : 0)
    if (available <= 0) break
    const content = prepareContent(item.record.content, terms)
    let excerptBudget = Math.min(config.maxExcerptBytes, available)
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
        break
      }
      excerptBudget = utf8Bytes(candidate.excerpt) - (candidateBytes - available)
    }
  }
  return renderMemoryWorkingSet(query, candidates)
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
  const kept: MemoryCandidate[] = []
  let bytes = utf8Bytes(heading)
  for (const candidate of candidates) {
    const added = utf8Bytes(renderCandidate(candidate)) + (kept.length > 0 ? 1 : 0)
    if (bytes + added > maxTotalBytes) continue
    bytes += added
    kept.push(candidate)
  }
  return renderMemoryWorkingSet(query, kept)
}

function renderCandidate(candidate: MemoryCandidate): string {
  const before = candidate.excerptStart > 0
  const after = candidate.excerptEnd < candidate.record.content.length
  const omitted = before ? (after ? 'both' : 'before') : (after ? 'after' : 'none')
  return `[memory:${JSON.stringify(candidate.id)} revision:${candidate.record.revision} sources:${JSON.stringify(candidate.record.sourceRefs)} record-content-utf16:[${candidate.excerptStart},${candidate.excerptEnd}) omitted:${omitted}]\n${candidate.excerpt}`
}

function scoreRecord(record: MemoryRecord, terms: readonly string[]): number {
  if (terms.length === 0) return 0
  const haystack = `${record.kind} ${record.scope} ${record.content}`.toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
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
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  }
}
