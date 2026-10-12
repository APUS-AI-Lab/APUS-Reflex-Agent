import { describe, expect, it } from 'vitest'
import { MemoryId, MemoryRecordIndex, MemoryRecordStore, retrieveMemoryWorkingSet } from '../src/index.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

function records(): MemoryRecordStore {
  const store = new MemoryRecordStore()
  store.create({ id: MemoryId('friday'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled for Friday.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
  store.create({ id: MemoryId('monday'), kind: 'fact', scope: 'workspace', content: 'Office is closed on Monday.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(1) }] })
  return store
}

const config = { maxCandidates: 5, maxExcerptBytes: 200, maxTotalBytes: 500 }

describe('Continuum memory index', () => {
  it('rebuilds deterministic postings and preserves retrieval results', () => {
    const store = records()
    const index = new MemoryRecordIndex()
    expect(index.rebuild(store.snapshot())).toEqual({ indexedRecords: 2, pendingRecords: 0 })
    expect(index.idsForTerms(['migration', 'friday'])).toEqual([MemoryId('friday')])
    expect(retrieveMemoryWorkingSet(store, config, 'migration Friday')).toEqual(retrieveMemoryWorkingSet(store, { ...config, index }, 'migration Friday'))
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
