import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

/** Stable identifier for one derived memory record. */
export type MemoryId = string & { readonly __memoryId: unique symbol }

/** Admit a non-empty memory identifier. */
export function MemoryId(value: string): MemoryId {
  if (value.length === 0) throw new TypeError('memory id must not be empty')
  return value as MemoryId
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
  readonly sourceRefs: readonly MemorySourceRef[]
  readonly status: MemoryStatus
  readonly supersedes?: MemoryId
}

/** Errors that callers must handle instead of silently overwriting memory. */
export type MemoryRecordErrorCode = 'MEMORY_REVISION_CONFLICT' | 'MEMORY_NOT_FOUND' | 'MEMORY_ALREADY_DEACTIVATED'

/** Record-store failure with a stable code for product and tests. */
export class MemoryRecordError extends Error {
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
 * It is an in-memory semantic owner only. A later provider will append the same
 * operations to Session events and rebuild this projection after restart.
 */
export class MemoryRecordStore {
  private readonly records = new Map<MemoryId, MemoryRecord>()

  /** Create a record at revision one. */
  create(record: Omit<MemoryRecord, 'revision' | 'status'>): MemoryRecord {
    if (this.records.has(record.id)) throw new MemoryRecordError(`memory ${record.id} already exists`, 'MEMORY_REVISION_CONFLICT')
    const created: MemoryRecord = freezeRecord({ ...record, revision: 1, status: 'active' })
    this.records.set(created.id, created)
    return created
  }

  /** Replace an active record only when its caller saw the current revision. */
  supersede(id: MemoryId, expectedRevision: number, replacement: Omit<MemoryRecord, 'revision' | 'status' | 'supersedes'>): MemoryRecord {
    const previous = this.require(id)
    this.assertRevision(previous, expectedRevision)
    if (previous.status !== 'active') throw new MemoryRecordError(`memory ${id} is deactivated`, 'MEMORY_ALREADY_DEACTIVATED')
    if (replacement.id === id || this.records.has(replacement.id)) {
      throw new MemoryRecordError(`replacement memory ${replacement.id} already exists`, 'MEMORY_REVISION_CONFLICT')
    }
    const retired = freezeRecord({ ...previous, revision: previous.revision + 1, status: 'superseded' })
    const next: MemoryRecord = freezeRecord({ ...replacement, revision: 1, status: 'active', supersedes: id })
    this.records.set(id, retired)
    this.records.set(next.id, next)
    return next
  }

  /** Mark one active record unavailable without deleting its source history. */
  deactivate(id: MemoryId, expectedRevision: number): MemoryRecord {
    const previous = this.require(id)
    this.assertRevision(previous, expectedRevision)
    if (previous.status !== 'active') throw new MemoryRecordError(`memory ${id} is already deactivated`, 'MEMORY_ALREADY_DEACTIVATED')
    const next = freezeRecord({ ...previous, revision: previous.revision + 1, status: 'deactivated' })
    this.records.set(id, next)
    return next
  }

  /** Return a detached immutable snapshot, or undefined when absent. */
  get(id: MemoryId): MemoryRecord | undefined {
    const record = this.records.get(id)
    return record === undefined ? undefined : freezeRecord({ ...record, sourceRefs: [...record.sourceRefs] })
  }

  /** Return every current record in insertion order. */
  snapshot(): readonly MemoryRecord[] {
    return [...this.records.values()].map(record => freezeRecord({ ...record, sourceRefs: [...record.sourceRefs] }))
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
}

function freezeRecord(record: MemoryRecord): MemoryRecord {
  return Object.freeze({ ...record, sourceRefs: Object.freeze([...record.sourceRefs]) })
}
