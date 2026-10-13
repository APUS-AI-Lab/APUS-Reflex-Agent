import { describe, expect, it } from 'vitest'
import { ContinuumMemoryController, MemoryId, MemoryRecordIndex, MemoryRecordStore, retrieveMemoryWorkingSet } from '../src/index.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

function records(): MemoryRecordStore {
  const store = new MemoryRecordStore()
  store.create({ id: MemoryId('friday'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled for Friday.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
  store.create({ id: MemoryId('monday'), kind: 'fact', scope: 'workspace', content: 'Office is closed on Monday.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(1) }] })
  return store
}

function partialRecords(): MemoryRecordStore {
  const store = new MemoryRecordStore()
  for (const [id, content, scope] of [
    ['chinese', '迁移安排在周五。', 'workspace'],
    ['english', 'Migration is scheduled Friday.', 'workspace'],
    ['exact', 'The migrat token is intentional.', 'workspace'],
    ['unicode', '复核迁移窗口 Migration résumé', 'workspace'],
    ['private', 'Migration is private.', 'private'],
    ['retired', 'Migration was cancelled.', 'workspace'],
  ] as const) {
    store.create({ id: MemoryId(id), kind: 'fact', scope, content, sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
  }
  store.deactivate(MemoryId('retired'), 1)
  return store
}

const config = { maxCandidates: 5, maxExcerptBytes: 200, maxTotalBytes: 2000 }

describe('Continuum memory index', () => {
  it('rebuilds deterministic postings and preserves retrieval results', () => {
    const store = records()
    const index = new MemoryRecordIndex()
    expect(index.rebuild(store.snapshot())).toEqual({ indexedRecords: 2, pendingRecords: 0 })
    expect(index.idsForTerms(['migration', 'friday'])).toEqual([MemoryId('friday')])
    expect(retrieveMemoryWorkingSet(store, config, 'migration Friday')).toEqual(retrieveMemoryWorkingSet(store, { ...config, index }, 'migration Friday'))
  })

  it.each([
    ['迁移', ['chinese', 'unicode']],
    ['migrat', ['english', 'exact', 'private', 'unicode']],
    ['gration', ['english', 'private', 'unicode']],
    ['迁移 MIGRAT', ['chinese', 'english', 'exact', 'private', 'unicode']],
    ['rés', ['unicode']],
    ['unrelated', []],
  ] as const)('preserves indexed and direct substring retrieval for %s', (query, expected) => {
    const store = partialRecords()
    const index = new MemoryRecordIndex()
    index.rebuild(store.snapshot())
    const direct = retrieveMemoryWorkingSet(store, config, query)
    expect(direct.candidates.map(candidate => String(candidate.id)).sort()).toEqual(expected)
    expect(retrieveMemoryWorkingSet(store, { ...config, index }, query)).toEqual(direct)
  })

  it('keeps partial matches subject to controller scope and active-record filtering', () => {
    const controller = new ContinuumMemoryController(partialRecords(), { enabled: true, mode: 'active', reflexMounted: true })
    const ticket = controller.beginRead({ scopes: ['workspace'] })
    if (ticket === undefined) throw new Error('enabled controller did not issue a read ticket')
    const workingSet = controller.read(ticket, config, 'migrat')
    expect(workingSet?.candidates.map(candidate => String(candidate.id)).sort()).toEqual(['english', 'exact', 'unicode'])
  })

  it('reports and drains a bounded backlog without replacing the source of truth', () => {
    const store = records()
    const index = new MemoryRecordIndex()
    index.rebuild(store.snapshot().slice(0, 1))
    const added = store.create({ id: MemoryId('decision'), kind: 'decision', scope: 'workspace', content: 'Migration decision is approved.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(2) }] })
    index.enqueue(added)
    expect(index.pendingCount()).toBe(1)
    expect(retrieveMemoryWorkingSet(store, { ...config, index }, 'decision approved').candidates).toHaveLength(0)
    expect(index.rebuildPending(1)).toEqual({ indexedRecords: 2, pendingRecords: 0 })
    expect(retrieveMemoryWorkingSet(store, { ...config, index }, 'decision approved').candidates.map(candidate => candidate.id)).toEqual([MemoryId('decision')])
  })

  it('leaves excess records queued and drains a final batch smaller than its budget', () => {
    const index = new MemoryRecordIndex()
    const pending = partialRecords().snapshot().slice(0, 3)
    for (const record of pending) index.enqueue(record)
    expect(index.indexedCount()).toBe(0)
    expect(index.rebuildPending(2)).toEqual({ indexedRecords: 2, pendingRecords: 1 })
    expect(index.indexedCount()).toBe(2)
    expect(index.rebuildPending(2)).toEqual({ indexedRecords: 3, pendingRecords: 0 })
    expect(index.indexedCount()).toBe(3)
    expect(index.pendingCount()).toBe(0)
    expect(index.idsForTerms(['迁移', 'migrat'])).toHaveLength(3)
  })

  it('removes old postings when a queued snapshot replaces a record', () => {
    const store = records()
    const index = new MemoryRecordIndex()
    index.rebuild(store.snapshot())
    const retired = store.deactivate(MemoryId('friday'), 1)
    index.enqueue(retired)
    index.rebuildPending(1)
    expect(index.idsForTerms(['friday'])).toEqual([MemoryId('friday')])
    expect(retrieveMemoryWorkingSet(store, { ...config, index }, 'migration Friday').candidates).toHaveLength(0)
  })

  it('rejects an invalid bounded rebuild limit', () => {
    expect(() => new MemoryRecordIndex().rebuildPending(0)).toThrow('limit')
  })
})
