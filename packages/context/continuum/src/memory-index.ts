import type { MemoryId, MemoryRecord } from './records.ts'

/** Result of a complete or bounded derived-index rebuild. */
export interface MemoryIndexRebuildResult {
  /** Number of records represented by the index after this operation. */
  readonly indexedRecords: number
  /** Number of queued records that still need indexing. */
  readonly pendingRecords: number
}

/**
 * Disposable deterministic inverted index for Continuum records.
 *
 * The Session log and MemoryRecordStore remain authoritative. This index is
 * an optional optimization and may be discarded and rebuilt at any time.
 */
export class MemoryRecordIndex {
  private postings = new Map<string, Set<MemoryId>>()
  private indexed = new Map<MemoryId, MemoryRecord>()
  private pending = new Map<MemoryId, MemoryRecord>()

  /**
   * Replace the index from an authoritative record projection.
   * @param records - complete current record projection.
   * @returns counts describing the rebuilt derived state.
   */
  rebuild(records: readonly MemoryRecord[]): MemoryIndexRebuildResult {
    const postings = new Map<string, Set<MemoryId>>()
    const indexed = new Map<MemoryId, MemoryRecord>()
    for (const record of records) {
      indexed.set(record.id, record)
      addRecord(postings, record)
    }
    this.postings = postings
    this.indexed = indexed
    this.pending.clear()
    return this.result()
  }

  /**
   * Queue a newer record snapshot for a bounded rebuild.
   * @param record - authoritative record snapshot to apply later.
   */
  enqueue(record: MemoryRecord): void {
    this.pending.set(record.id, record)
  }

  /**
   * Apply at most `limit` queued snapshots, making backlog progress explicit.
   * @param limit - positive safe integer work budget.
   * @returns counts after applying the bounded batch.
   */
  rebuildPending(limit: number): MemoryIndexRebuildResult {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('limit must be a positive safe integer')
    let applied = 0
    for (const [id, record] of this.pending) {
      this.removeIndexed(id)
      this.indexed.set(id, record)
      addRecord(this.postings, record)
      this.pending.delete(id)
      applied += 1
      if (applied >= limit) break
    }
    return this.result()
  }

  /** Number of snapshots waiting for a bounded rebuild.
   * @returns Pending snapshot count.
   */
  pendingCount(): number {
    return this.pending.size
  }

  /** Number of snapshots represented by the current derived index.
   * @returns Indexed snapshot count.
   */
  indexedCount(): number {
    return this.indexed.size
  }

  /**
   * Return IDs whose indexed tokens contain any supplied term as a substring.
   * @param terms - normalized search terms.
   * @returns stable IDs; missing terms produce an empty result.
   */
  idsForTerms(terms: readonly string[]): readonly MemoryId[] {
    const ids = new Set<MemoryId>()
    for (const [token, postings] of this.postings) {
      if (!terms.some(term => token.includes(term))) continue
      for (const id of postings) ids.add(id)
    }
    return Object.freeze([...ids].sort())
  }

  private removeIndexed(id: MemoryId): void {
    const previous = this.indexed.get(id)
    if (previous === undefined) return
    for (const term of memorySearchTerms(recordSearchText(previous))) {
      const ids = this.postings.get(term)
      ids?.delete(id)
      if (ids?.size === 0) this.postings.delete(term)
    }
    this.indexed.delete(id)
  }

  private result(): MemoryIndexRebuildResult {
    return Object.freeze({ indexedRecords: this.indexed.size, pendingRecords: this.pending.size })
  }
}

/** Normalize lexical search fields independently of the host locale.
 * @param value - Text to tokenize.
 * @returns Unique normalized search terms.
 */
export function memorySearchTerms(value: string): readonly string[] {
  return [...new Set(value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(term => term.length > 1))]
}

function recordSearchText(record: MemoryRecord): string {
  return `${record.kind} ${record.scope} ${record.content}`
}

function addRecord(postings: Map<string, Set<MemoryId>>, record: MemoryRecord): void {
  for (const term of memorySearchTerms(recordSearchText(record))) {
    const ids = postings.get(term) ?? new Set<MemoryId>()
    ids.add(record.id)
    postings.set(term, ids)
  }
}
