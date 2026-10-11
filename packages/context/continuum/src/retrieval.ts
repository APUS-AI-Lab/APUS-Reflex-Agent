import type { MemoryId, MemoryRecord } from './records.ts'
import { MemoryRecordStore } from './records.ts'

/** Limits applied before any candidate can reach Jev or the main model. */
export interface MemoryRetrievalConfig {
  readonly maxCandidates: number
  readonly maxExcerptBytes: number
  readonly maxTotalBytes: number
}

/** One deterministic candidate produced from an active record. */
export interface MemoryCandidate {
  readonly id: MemoryId
  readonly record: MemoryRecord
  readonly score: number
  readonly excerpt: string
}

/** Bounded selection result used by the Jev adapter and context renderer. */
export interface MemoryWorkingSet {
  readonly query: string
  readonly candidates: readonly MemoryCandidate[]
  readonly text: string
  readonly bytes: number
}

/**
 * Lexical, deterministic retrieval over the current record projection.
 * @param store - record store containing active and retired snapshots.
 * @param config - candidate and byte limits.
 * @param query - user request terms.
 * @returns a bounded working set sorted by score and stable ID.
 */
export function retrieveMemoryWorkingSet(
  store: MemoryRecordStore,
  config: MemoryRetrievalConfig,
  query: string,
): MemoryWorkingSet {
  assertConfig(config)
  const terms = tokenize(query)
  const ranked = store.snapshot()
    .filter(record => record.status === 'active')
    .map(record => ({ record, score: scoreRecord(record, terms) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.record.id).localeCompare(String(b.record.id)))
  const candidates: MemoryCandidate[] = []
  let bytes = 0
  for (const item of ranked) {
    if (candidates.length >= config.maxCandidates) break
    const excerpt = truncateUtf8(item.record.content, config.maxExcerptBytes)
    const candidateBytes = utf8Bytes(excerpt)
    if (bytes + candidateBytes > config.maxTotalBytes) continue
    candidates.push({ id: item.record.id, record: item.record, score: item.score, excerpt })
    bytes += candidateBytes
  }
  const text = candidates.map(candidate => `[memory:${candidate.id}] ${candidate.excerpt}`).join('\n')
  return Object.freeze({ query, candidates: Object.freeze(candidates), text, bytes: utf8Bytes(text) })
}

function scoreRecord(record: MemoryRecord, terms: readonly string[]): number {
  if (terms.length === 0) return 0
  const haystack = `${record.kind} ${record.scope} ${record.content}`.toLocaleLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function tokenize(value: string): readonly string[] {
  return [...new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(term => term.length > 1))]
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Bytes(value) <= maxBytes) return value
  let result = ''
  for (const character of value) {
    if (utf8Bytes(result + character) > maxBytes) break
    result += character
  }
  return result
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertConfig(config: MemoryRetrievalConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  }
}
