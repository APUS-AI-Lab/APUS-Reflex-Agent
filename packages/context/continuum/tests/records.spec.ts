import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { MemoryId, MemoryRecordError, MemoryRecordStore } from '../src/records.ts'

const source = { sessionId: SessionId('session-1'), eventSeq: SessionSeq(4) }

function record(id: string) {
  return { id: MemoryId(id), kind: 'fact' as const, scope: '/project', content: 'keep amount 731.25', sourceRefs: [source] }
}

describe('MemoryRecordStore', () => {
  it('creates immutable revision-one records with source references', () => {
    const store = new MemoryRecordStore()
    const created = store.create(record('invoice'))
    expect(created).toMatchObject({ revision: 1, status: 'active', sourceRefs: [source] })
    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.sourceRefs)).toBe(true)
    expect(store.get(created.id)).toEqual(created)
  })

  it('supersedes only the revision the caller observed', () => {
    const store = new MemoryRecordStore()
    const first = store.create(record('invoice'))
    const second = store.supersede(first.id, 1, record('invoice-v2'))
    expect(second).toMatchObject({ revision: 1, status: 'active', supersedes: first.id })
    expect(store.get(first.id)).toMatchObject({ revision: 2, status: 'superseded' })
    expect(() => store.supersede(first.id, 1, record('stale'))).toThrowError(
      expect.objectContaining({ code: 'MEMORY_REVISION_CONFLICT' }),
    )
  })

  it('deactivates without deleting the source-backed record', () => {
    const store = new MemoryRecordStore()
    const first = store.create(record('invoice'))
    const disabled = store.deactivate(first.id, 1)
    expect(disabled).toMatchObject({ revision: 2, status: 'deactivated' })
    expect(store.get(first.id)?.sourceRefs).toEqual([source])
    expect(() => store.deactivate(first.id, 2)).toThrowError(
      expect.objectContaining({ code: 'MEMORY_ALREADY_DEACTIVATED' }),
    )
  })

  it('rejects duplicate, missing and invalid revisions with stable errors', () => {
    const store = new MemoryRecordStore()
    const first = store.create(record('invoice'))
    expect(() => store.create(record('invoice'))).toThrowError(
      expect.objectContaining({ code: 'MEMORY_REVISION_CONFLICT' }),
    )
    expect(() => store.deactivate(MemoryId('missing'), 1)).toThrowError(
      expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }),
    )
    expect(() => store.deactivate(first.id, 0)).toThrowError(MemoryRecordError)
  })
})
