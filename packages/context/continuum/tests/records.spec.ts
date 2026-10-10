import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { MemoryId, MemoryRecordError, MemoryRecordStore, type NewMemoryRecord } from '../src/index.ts'

const source = { sessionId: SessionId('session-1'), eventSeq: SessionSeq(4) }

function record(id: string): NewMemoryRecord {
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
      expect.objectContaining({ code: 'MEMORY_INACTIVE' }),
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

  it('detaches and freezes source objects without freezing caller inputs', () => {
    const store = new MemoryRecordStore()
    const refs: NewMemoryRecord['sourceRefs'] = [
      { ...source }, { sessionId: SessionId('second'), eventSeq: SessionSeq(7) },
    ]
    const input = { ...record('invoice'), sourceRefs: refs }
    const saved = store.create(input)
    expect(saved.sourceRefs).toEqual(refs)
    expect(Object.isFrozen(refs[0])).toBe(false)
    Reflect.set(refs[0], 'eventSeq', SessionSeq(9))
    expect(saved.sourceRefs[0].eventSeq).toBe(SessionSeq(4))
    for (const ref of saved.sourceRefs) expect(Object.isFrozen(ref)).toBe(true)
    expect(Reflect.set(saved.sourceRefs[0], 'eventSeq', SessionSeq(99))).toBe(false)
    expect(store.get(saved.id)?.sourceRefs[0].eventSeq).toBe(SessionSeq(4))
  })

  it('keeps old snapshots unchanged across correction and deactivation', () => {
    const store = new MemoryRecordStore()
    const first = store.create(record('a'))
    const before = store.snapshot()
    const next = store.supersede(first.id, first.revision, { ...record('b'), content: 'new amount 9.50' })
    store.deactivate(next.id, next.revision)
    expect(Object.isFrozen(before)).toBe(true)
    expect(before).toEqual([first])
    expect(first).toMatchObject({ status: 'active', revision: 1 })
    expect(next).toMatchObject({ status: 'active', revision: 1 })
    expect(store.snapshot().map(value => [value.id, value.status, value.revision])).toEqual([
      [first.id, 'superseded', 2], [next.id, 'deactivated', 2],
    ])
    expect(store.get(MemoryId('absent'))).toBeUndefined()
  })

  it.each(['same ID', 'existing ID', 'different scope'] as const)('rejects %s before changing either record', (kind) => {
    const store = new MemoryRecordStore()
    const previous = store.create(record('previous'))
    store.create(record('existing'))
    const before = store.snapshot()
    const replacement = kind === 'same ID'
      ? record('previous')
      : kind === 'existing ID' ? record('existing') : { ...record('new'), scope: '/another-project' }
    expect(() => store.supersede(previous.id, 1, replacement)).toThrowError(
      expect.objectContaining({ code: kind === 'different scope' ? 'MEMORY_SCOPE_MISMATCH' : 'MEMORY_REVISION_CONFLICT' }),
    )
    expect(store.snapshot()).toEqual(before)
    expect(store.get(MemoryId('new'))).toBeUndefined()
  })

  it.each(['superseded', 'deactivated'] as const)('refuses new corrections to a %s record at its current revision', (status) => {
    const store = new MemoryRecordStore()
    const first = store.create(record('original'))
    if (status === 'superseded') store.supersede(first.id, 1, record('successor'))
    else store.deactivate(first.id, 1)
    const before = store.snapshot()
    expect(() => store.supersede(first.id, 2, record('unwanted'))).toThrowError(
      expect.objectContaining({ code: 'MEMORY_INACTIVE' }),
    )
    expect(() => store.deactivate(first.id, 2)).toThrowError(
      expect.objectContaining({ code: 'MEMORY_INACTIVE' }),
    )
    expect(store.snapshot()).toEqual(before)
  })

  it('does not reuse a retired ID and preserves the explicit correction chain', () => {
    const store = new MemoryRecordStore()
    const a = store.create(record('a'))
    const b = store.supersede(a.id, 1, record('b'))
    const c = store.supersede(b.id, 1, record('c'))
    expect(c.supersedes).toBe(b.id)
    expect(store.get(b.id)?.supersedes).toBe(a.id)
    const before = store.snapshot()
    expect(() => store.supersede(c.id, 1, record('a'))).toThrowError(MemoryRecordError)
    expect(() => store.create(record('a'))).toThrowError(MemoryRecordError)
    expect(store.snapshot()).toEqual(before)
  })

  it('rejects a missing predecessor without creating its replacement', () => {
    const store = new MemoryRecordStore()
    expect(() => store.supersede(MemoryId('missing'), 1, record('new'))).toThrowError(
      expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }),
    )
    expect(store.snapshot()).toEqual([])
  })

  it('rejects stale deactivation without changing the replacement', () => {
    const store = new MemoryRecordStore()
    const first = store.create(record('a'))
    store.supersede(first.id, 1, record('b'))
    const before = store.snapshot()
    expect(() => store.deactivate(first.id, 1)).toThrowError(
      expect.objectContaining({ code: 'MEMORY_REVISION_CONFLICT' }),
    )
    expect(store.snapshot()).toEqual(before)
  })

  it('requires a nonempty identifier', () => {
    expect(() => MemoryId('')).toThrow(TypeError)
    expect(MemoryId('invoice')).toBe('invoice')
  })
})
