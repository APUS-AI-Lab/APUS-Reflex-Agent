import { describe, expect, it } from 'vitest'
import { MemoryId, MemoryRecordStore } from '../src/index.ts'
import { retrieveMemoryWorkingSet } from '../src/retrieval.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

function store(): MemoryRecordStore {
  const records = new MemoryRecordStore()
  records.create({ id: MemoryId('migration'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled for Friday.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
  records.create({ id: MemoryId('office'), kind: 'fact', scope: 'workspace', content: 'The office is closed on Monday.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(1) }] })
  return records
}

describe('Continuum retrieval working set', () => {
  it('returns active records in stable relevance order', () => {
    const result = retrieveMemoryWorkingSet(store(), { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 500 }, 'migration Friday')
    expect(result.candidates.map(candidate => candidate.id)).toEqual([MemoryId('migration')])
    expect(result.text).toContain('[memory:migration]')
  })

  it('excludes retired records and enforces byte limits', () => {
    const records = store()
    records.deactivate(MemoryId('migration'), 1)
    const result = retrieveMemoryWorkingSet(records, { maxCandidates: 4, maxExcerptBytes: 8, maxTotalBytes: 8 }, 'office Monday')
    expect(result.candidates).toHaveLength(1)
    expect(result.bytes).toBeLessThanOrEqual(8 + '[memory:office] '.length)
    expect(result.candidates[0]?.excerpt).toBe('The offi')
  })

  it('rejects invalid limits', () => {
    expect(() => retrieveMemoryWorkingSet(store(), { maxCandidates: 0, maxExcerptBytes: 10, maxTotalBytes: 10 }, 'migration')).toThrow('maxCandidates')
  })
})
