/** Source-backed record transitions; no persistence or authorization is performed here. */
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Stable identifier for one derived memory record. */
export type MemoryId = Branded<'MemoryId'>

/**
 * Admit a non-empty memory identifier.
 * @param value - caller-owned identifier, unique within the store.
 * @returns the identifier with its memory brand.
 */
export function MemoryId(value: string): MemoryId {
  if (value.length === 0) throw new TypeError('memory id must not be empty')
  return brandString<MemoryId>(value)
}

/** A source event that can be opened again from the Session log. */
export interface MemorySourceRef {
  readonly sessionId: SessionId
  readonly eventSeq: SessionSeq
}

/** Lifecycle of one memory record. */
export type MemoryStatus = 'active' | 'superseded' | 'deactivated'

/** Immutable fact or task record derived from one or more durable sources. */
export interface MemoryRecord {
  readonly id: MemoryId
  readonly revision: number
  readonly kind: 'fact' | 'task' | 'decision'
  readonly scope: string
  readonly content: string
  readonly sourceRefs: readonly [MemorySourceRef, ...MemorySourceRef[]]
  readonly status: MemoryStatus
  readonly supersedes?: MemoryId
}

/** Caller-supplied record fields; lifecycle and correction links belong to the store. */
export type NewMemoryRecord = Omit<MemoryRecord, 'revision' | 'status' | 'supersedes'>

/** Errors that callers must handle instead of silently overwriting memory. */
export type MemoryRecordErrorCode = 'MEMORY_REVISION_CONFLICT' | 'MEMORY_NOT_FOUND' | 'MEMORY_INACTIVE' | 'MEMORY_SCOPE_MISMATCH'

/** Record-store failure with a stable code for product and tests. */
export class MemoryRecordError extends Error {
  /** Stable failure category independent of human-facing text. */
  readonly code: MemoryRecordErrorCode

  constructor(message: string, code: MemoryRecordErrorCode) {
    super(message)
    this.name = 'MemoryRecordError'
    this.code = code
  }
}

/**
 * Pure revisioned store used by the first Continuum slice.
 *
 * Snapshots retain retired records for inspection. Callers own source validation
 * and authorization; scope equality prevents corrections from moving records to
 * another domain but does not grant access. Operations have no I/O or callbacks.
 */
export class MemoryRecordStore {
  private readonly records = new Map<MemoryId, MemoryRecord>()

  /**
   * Create an active record at revision one; reject a previously used ID.
   * @param record - source-backed content admitted by the caller.
   * @returns the immutable created record.
   */
  create(record: NewMemoryRecord): MemoryRecord {
    if (this.records.has(record.id)) throw new MemoryRecordError(`memory ${record.id} already exists`, 'MEMORY_REVISION_CONFLICT')
    const created: MemoryRecord = freezeRecord({ ...record, revision: 1, status: 'active' })
    this.records.set(created.id, created)
    return created
  }

  /**
   * Atomically retire an active record and create its same-scope successor.
   * All validation precedes mutation. The old revision increments; the new ID
   * starts at revision one. Previous snapshots remain unchanged.
   * @param id - active record to retire.
   * @param expectedRevision - version observed by the caller.
   * @param replacement - new content with a never-used ID and the same scope.
   * @returns the immutable successor carrying its predecessor ID.
   */
  supersede(id: MemoryId, expectedRevision: number, replacement: NewMemoryRecord): MemoryRecord {
    const previous = this.require(id)
    this.assertRevision(previous, expectedRevision)
    this.assertActive(previous)
    if (replacement.id === id || this.records.has(replacement.id)) {
      throw new MemoryRecordError(`replacement memory ${replacement.id} already exists`, 'MEMORY_REVISION_CONFLICT')
    }
    if (previous.scope !== replacement.scope) {
      throw new MemoryRecordError('memory correction must retain its scope', 'MEMORY_SCOPE_MISMATCH')
    }
    const retired = freezeRecord({ ...previous, revision: previous.revision + 1, status: 'superseded' })
    const next: MemoryRecord = freezeRecord({ ...replacement, revision: 1, status: 'active', supersedes: id })
    this.records.set(id, retired)
    this.records.set(next.id, next)
    return next
  }

  /**
   * Retire one active record without removing its source references.
   * @param id - record to deactivate.
   * @param expectedRevision - version observed by the caller.
   * @returns the immutable retired record at its next revision.
   */
  deactivate(id: MemoryId, expectedRevision: number): MemoryRecord {
    const previous = this.require(id)
    this.assertRevision(previous, expectedRevision)
    this.assertActive(previous)
    const next = freezeRecord({ ...previous, revision: previous.revision + 1, status: 'deactivated' })
    this.records.set(id, next)
    return next
  }

  /**
   * Read the current record, including retired records, without granting access.
   * @param id - exact record identifier.
   * @returns an immutable record, or undefined when the ID is absent.
   */
  get(id: MemoryId): MemoryRecord | undefined {
    return this.records.get(id)
  }

  /**
   * Inspect current records, including retired ones, in insertion order.
   * @returns an immutable array unaffected by subsequent store operations.
   */
  snapshot(): readonly MemoryRecord[] {
    return Object.freeze([...this.records.values()])
  }

  private require(id: MemoryId): MemoryRecord {
    const record = this.records.get(id)
    if (record === undefined) throw new MemoryRecordError(`memory ${id} was not found`, 'MEMORY_NOT_FOUND')
    return record
  }

  private assertRevision(record: MemoryRecord, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected !== record.revision) {
      throw new MemoryRecordError(`memory ${record.id} revision conflict`, 'MEMORY_REVISION_CONFLICT')
    }
  }

  private assertActive(record: MemoryRecord): void {
    if (record.status !== 'active') {
      throw new MemoryRecordError(`memory ${record.id} is ${record.status}`, 'MEMORY_INACTIVE')
    }
  }
}

function freezeRecord(record: MemoryRecord): MemoryRecord {
  const [first, ...remaining] = record.sourceRefs
  const sourceRefs: [MemorySourceRef, ...MemorySourceRef[]] = [
    Object.freeze({ ...first }), ...remaining.map(ref => Object.freeze({ ...ref })),
  ]
  return Object.freeze({ ...record, sourceRefs: Object.freeze(sourceRefs) })
}
