import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { MemoryRecord, MemoryRecordStore, NewMemoryRecord } from './records.ts'

/** Durable operation written to the existing Session event log. */
export type MemoryRecordOperation = 'create' | 'supersede' | 'deactivate'

/** Event payload for one accepted Continuum record transition. */
export interface MemoryRecordEventData {
  /** Transition applied to the record store. */
  readonly operation: MemoryRecordOperation
  /** Complete post-transition record snapshot. */
  readonly record: MemoryRecord
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A source-backed Continuum record transition; log-only and never model-visible. */
    'continuum/memory-record': MemoryRecordEventData
  }
}

/**
 * Append one already-validated record transition to the Session log.
 * @param session - live Session that owns the durable event log.
 * @param operation - transition represented by the record snapshot.
 * @param record - post-transition record accepted by the caller's store.
 * @returns the appended event with its assigned sequence number.
 */
export function appendMemoryRecordEvent(
  session: Session,
  operation: MemoryRecordOperation,
  record: MemoryRecord,
): SessionEvent<'continuum/memory-record'> {
  return session.append('continuum/memory-record', { operation, record })
}

/**
 * Rebuild Continuum records from durable log events without model calls or I/O.
 * @param events - complete Session event stream in sequence order.
 * @param store - empty or partially rebuilt record store.
 * @returns the supplied store after applying every Continuum transition.
 */
export function foldMemoryRecordEvents(
  events: readonly SessionEvent[],
  store: MemoryRecordStore,
): MemoryRecordStore {
  for (const event of events) {
    if (event.type !== 'continuum/memory-record') continue
    const { operation, record } = event.data
    if (operation === 'create') {
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

function assertRestoredRecord(actual: MemoryRecord, expected: MemoryRecord): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`memory ${expected.id} event does not match its store transition`)
  }
}
