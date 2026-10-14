import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { MemoryId, MemoryRecordIndex, MemoryRecordStore } from '../src/index.ts'
import { renderMemoryWorkingSet, retrieveMemoryWorkingSet } from '../src/retrieval.ts'
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
    expect(result.text).toContain('[memory:"migration" revision:1')
  })

  it('excludes retired records and enforces byte limits', () => {
    const records = store()
    records.deactivate(MemoryId('migration'), 1)
    const result = retrieveMemoryWorkingSet(records, { maxCandidates: 4, maxExcerptBytes: 8, maxTotalBytes: 8 }, 'office Monday')
    expect(result.candidates).toHaveLength(0)
    expect(result.bytes).toBe(0)
    expect(result.text).toBe('')
  })

  it('recovers a query and adjacent answer from the tail without modifying the record', () => {
    const records = new MemoryRecordStore()
    const content = 'background '.repeat(300) + ' projectquartz launch PIN 7319'
    const record = records.create({ id: MemoryId('tail'), kind: 'fact', scope: 'workspace', content, sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(23) }] })
    const result = retrieveMemoryWorkingSet(records, { maxCandidates: 4, maxExcerptBytes: 80, maxTotalBytes: 500 }, 'projectquartz')
    const candidate = result.candidates[0]!
    expect(candidate.excerpt).toContain('projectquartz launch PIN 7319')
    expect(candidate.record).toBe(record)
    expect(record.content).toBe(content)
    expect(content.slice(candidate.excerptStart, candidate.excerptEnd)).toBe(candidate.excerpt)
    expect(result.text).toContain('sources:[{"sessionId":"source","eventSeq":23}]')
    expect(result.text).toContain('omitted:before]')
    expect(result.text.startsWith('## Continuum memory\n')).toBe(true)
    expect(result.bytes).toBe(Buffer.byteLength(result.text))
  })

  it.each([
    ['start', 'ProjectQuartz PIN 7319 ' + 'padding '.repeat(100), 'projectquartz', 'ProjectQuartz PIN 7319', 'after'],
    ['middle', 'padding '.repeat(100) + ' ProjectQuartz PIN 7319 ' + 'padding '.repeat(100), 'projectquartz', 'ProjectQuartz PIN 7319', 'both'],
    ['unicode', '前文😀'.repeat(100) + '迁移密码7319🎉' + '后文🦜'.repeat(100), '迁移密码', '迁移密码7319🎉', 'both'],
    ['folding', 'İ😀'.repeat(100) + ' PROJECTQUARTZ PIN 7319 ' + 'padding '.repeat(100), 'projectquartz', 'PROJECTQUARTZ PIN 7319', 'both'],
    ['sigma', 'padding '.repeat(100) + ' ΟΣ 7319 ' + 'padding '.repeat(100), 'ΟΣ', 'ΟΣ 7319', 'both'],
  ])('keeps an exact Unicode-safe window for %s', (_name, content, query, answer, omitted) => {
    const records = new MemoryRecordStore()
    records.create({ id: MemoryId('window'), kind: 'fact', scope: 'workspace', content, sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    const result = retrieveMemoryWorkingSet(records, { maxCandidates: 1, maxExcerptBytes: 64, maxTotalBytes: 500 }, query)
    const candidate = result.candidates[0]!
    expect(candidate.excerpt).toContain(answer)
    expect(candidate.excerpt).not.toContain('�')
    expect(Buffer.byteLength(candidate.excerpt)).toBeLessThanOrEqual(64)
    expect(content.slice(candidate.excerptStart, candidate.excerptEnd)).toBe(candidate.excerpt)
    expect(result.text).toContain(`omitted:${omitted}]`)
  })

  it('counts every header and source byte at exact and insufficient budgets', () => {
    const records = store()
    const config = { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 2000 }
    const complete = retrieveMemoryWorkingSet(records, config, 'migration Friday')
    expect(retrieveMemoryWorkingSet(records, { ...config, maxTotalBytes: complete.bytes }, 'migration Friday')).toEqual(complete)
    const smaller = retrieveMemoryWorkingSet(records, { ...config, maxTotalBytes: complete.bytes - 1 }, 'migration Friday')
    expect(smaller.bytes).toBeLessThanOrEqual(complete.bytes - 1)
    expect(smaller.text).not.toBe(complete.text)
    for (const maxTotalBytes of [1, 20, 100, 150, 160, 175, 200, 350]) {
      const result = retrieveMemoryWorkingSet(records, { ...config, maxTotalBytes }, 'migration office')
      expect(result.bytes).toBe(Buffer.byteLength(result.text))
      expect(result.bytes).toBeLessThanOrEqual(maxTotalBytes)
    }
  })

  it.each([30, 2048, 8192])('shrinks a short excerpt under large metadata with a %i-byte excerpt limit', (maxExcerptBytes) => {
    const records = new MemoryRecordStore()
    const content = 'migration PIN 7319 short body!'
    records.create({ id: MemoryId('id'.repeat(2000)), kind: 'fact', scope: 'workspace', content, sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    const config = { maxCandidates: 1, maxExcerptBytes, maxTotalBytes: 10_000 }
    const full = retrieveMemoryWorkingSet(records, config, 'migration')
    expect(full.candidates[0]?.excerpt).toBe(content)
    const reduced = retrieveMemoryWorkingSet(records, { ...config, maxTotalBytes: full.bytes - 1 }, 'migration')
    expect(reduced.candidates).toHaveLength(1)
    expect(reduced.candidates[0]?.excerpt).toBe(content.slice(0, -2))
    expect(reduced.text).toContain('omitted:after]')
    expect(reduced.bytes).toBe(full.bytes - 1)
  })

  it('keeps multiple source references and escaped identifiers intact', () => {
    const records = new MemoryRecordStore()
    const id = MemoryId('untrusted]\n## replacement "' + 'long'.repeat(20))
    const sourceRefs = [{ sessionId: SessionId('source\n"one'), eventSeq: SessionSeq(23) }, { sessionId: SessionId('source-two'), eventSeq: SessionSeq(45) }] as const
    records.create({ id, kind: 'fact', scope: 'workspace', content: 'projectquartz PIN 7319', sourceRefs })
    const full = retrieveMemoryWorkingSet(records, { maxCandidates: 1, maxExcerptBytes: 100, maxTotalBytes: 1000 }, 'projectquartz')
    expect(full.text).toContain(`memory:${JSON.stringify(id)}`)
    expect(full.text).toContain(`sources:${JSON.stringify(sourceRefs)}`)
    expect(full.text.split('\n')).toHaveLength(3)
    const tiny = retrieveMemoryWorkingSet(records, { maxCandidates: 1, maxExcerptBytes: 100, maxTotalBytes: 100 }, 'projectquartz')
    expect(tiny.text).toBe('')
  })

  it('renders selected candidates with the same source and range metadata', () => {
    const result = retrieveMemoryWorkingSet(store(), { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1000 }, 'migration office')
    const selected = result.candidates.slice(1)
    const rendered = renderMemoryWorkingSet(result.query, selected)
    expect(rendered.candidates).toEqual(selected)
    expect(rendered.text).toContain('memory:"office"')
    expect(rendered.text).not.toContain('memory:"migration"')
    expect(rendered.text).toContain('record-content-utf16:[0,31) omitted:none]')
    expect(rendered.bytes).toBe(Buffer.byteLength(rendered.text))
    expect(rendered.bytes).toBeLessThan(result.bytes)
    expect(renderMemoryWorkingSet(result.query, []).text).toBe('')
  })

  it('caps candidate count by relevance and returns nothing for an empty query', () => {
    const config = { maxCandidates: 1, maxExcerptBytes: 200, maxTotalBytes: 1000 }
    const result = retrieveMemoryWorkingSet(store(), config, 'office migration Friday')
    expect(result.candidates.map(candidate => candidate.id)).toEqual([MemoryId('migration')])
    expect(result.candidates[0]?.score).toBe(2)
    expect(retrieveMemoryWorkingSet(store(), config, '').candidates).toEqual([])
    expect(retrieveMemoryWorkingSet(store(), { ...config, maxTotalBytes: 20 }, 'migration').text).toBe('')
  })

  it('breaks equal-score ties by code-unit ID order independently of the host locale', () => {
    const records = new MemoryRecordStore()
    for (const id of ['ä', 'Z', 'a']) {
      records.create({ id: MemoryId(id), kind: 'fact', scope: 'workspace', content: 'migration', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    }
    const index = new MemoryRecordIndex()
    index.rebuild(records.snapshot())
    const result = retrieveMemoryWorkingSet(records, { index, maxCandidates: 3, maxExcerptBytes: 100, maxTotalBytes: 1000 }, 'migration')
    expect(result.candidates.map(candidate => String(candidate.id))).toEqual(['Z', 'a', 'ä'])
    expect(index.idsForTerms(['migration'])).toEqual(['Z', 'a', 'ä'])
  })

  it('uses the supplied index without admitting unmatched or inactive records', () => {
    const records = store()
    const index = new MemoryRecordIndex()
    index.rebuild(records.snapshot())
    const result = retrieveMemoryWorkingSet(records, { index, maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1000 }, 'migration')
    expect(result.candidates.map(candidate => candidate.id)).toEqual([MemoryId('migration')])
  })

  it('uses a prefix for kind-only matches and omits empty record contents', () => {
    const records = new MemoryRecordStore()
    records.create({ id: MemoryId('empty'), kind: 'fact', scope: 'workspace', content: '', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    records.create({ id: MemoryId('text'), kind: 'fact', scope: 'workspace', content: 'one two three', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(1) }] })
    const result = retrieveMemoryWorkingSet(records, { maxCandidates: 4, maxExcerptBytes: 4, maxTotalBytes: 1000 }, 'fact')
    expect(result.candidates.map(candidate => candidate.excerpt)).toEqual(['one '])
    expect(result.candidates[0]?.excerptStart).toBe(0)
    expect(result.text).toContain('omitted:after]')
  })

  it('keeps the full matched token when it fits and marks partial tokens when it does not', () => {
    const records = new MemoryRecordStore()
    records.create({ id: MemoryId('token'), kind: 'fact', scope: 'workspace', content: 'padding '.repeat(10) + 'abcdefghijklmnop trailing', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    const config = { maxCandidates: 1, maxExcerptBytes: 18, maxTotalBytes: 1000 }
    expect(retrieveMemoryWorkingSet(records, config, 'abcdefghijklmnop').candidates[0]?.excerpt).toContain('abcdefghijklmnop')
    const partial = retrieveMemoryWorkingSet(records, { ...config, maxExcerptBytes: 4 }, 'abcdefghijklmnop')
    expect(partial.candidates[0]?.excerpt).toContain('abc')
    expect(partial.text).toContain('omitted:both]')
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('never splits a code point with an excerpt budget of %i bytes', (maxExcerptBytes) => {
    const records = new MemoryRecordStore()
    records.create({ id: MemoryId('multibyte'), kind: 'fact', scope: 'workspace', content: '😀迁移🎉', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    const result = retrieveMemoryWorkingSet(records, { maxCandidates: 1, maxExcerptBytes, maxTotalBytes: 1000 }, 'workspace')
    expect(result.candidates.map(candidate => candidate.excerpt)).toEqual(maxExcerptBytes < 4 ? [] : maxExcerptBytes < 7 ? ['😀'] : ['😀迁'])
    for (const candidate of result.candidates) expect(Buffer.byteLength(candidate.excerpt)).toBeLessThanOrEqual(maxExcerptBytes)
  })

  it('prioritizes a matched multibyte character over preceding context in a tiny window', () => {
    const records = new MemoryRecordStore()
    records.create({ id: MemoryId('tiny-match'), kind: 'fact', scope: 'workspace', content: 'a迁移 after', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    const config = { maxCandidates: 1, maxExcerptBytes: 3, maxTotalBytes: 1000 }
    const result = retrieveMemoryWorkingSet(records, config, '迁移')
    expect(result.candidates[0]?.excerpt).toBe('迁')
    expect(result.candidates[0]?.excerptStart).toBe(1)
    expect(retrieveMemoryWorkingSet(records, { ...config, maxExcerptBytes: 2 }, '迁移').candidates).toEqual([])
  })

  it('skips an oversized metadata entry and admits a later record that fits', () => {
    const records = new MemoryRecordStore()
    records.create({ id: MemoryId('a'.repeat(300)), kind: 'fact', scope: 'workspace', content: 'migration', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    records.create({ id: MemoryId('b'), kind: 'fact', scope: 'workspace', content: 'migration', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(1) }] })
    const result = retrieveMemoryWorkingSet(records, { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 }, 'migration')
    expect(result.candidates.map(candidate => candidate.id)).toEqual([MemoryId('b')])
    expect(result.bytes).toBeLessThanOrEqual(200)
  })

  it('keeps query normalization and source coordinates stable on a Turkish host', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', `
      import { retrieveMemoryWorkingSet } from ${JSON.stringify(new URL('../src/retrieval.ts', import.meta.url).href)}
      import { MemoryRecordStore, MemoryId } from ${JSON.stringify(new URL('../src/records.ts', import.meta.url).href)}
      import { MemoryRecordIndex, memorySearchTerms } from ${JSON.stringify(new URL('../src/memory-index.ts', import.meta.url).href)}
      const store = new MemoryRecordStore()
      const content = 'I\\u0307'.repeat(200) + ' PROJECTQUARTZ PIN 7319'
      store.create({ id: MemoryId('tail'), kind: 'fact', scope: 'workspace', content, sourceRefs: [{ sessionId: 'source', eventSeq: 0 }] })
      const index = new MemoryRecordIndex()
      index.rebuild(store.snapshot())
      const recall = retrieveMemoryWorkingSet(store, { maxCandidates: 1, maxExcerptBytes: 40, maxTotalBytes: 1000, index }, 'PROJECTQUARTZ')
      process.stdout.write(JSON.stringify({
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        terms: memorySearchTerms('MIGRATION'),
        excerpt: recall.candidates[0]?.excerpt,
        exact: recall.candidates.every(candidate => content.slice(candidate.excerptStart, candidate.excerptEnd) === candidate.excerpt),
      }))
    `], { env: { ...process.env, LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, encoding: 'utf8', timeout: 10_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ locale: 'tr-TR', terms: ['migration'], exact: true })
    expect(result.stdout).toContain('PROJECTQUARTZ PIN 7319')
  })

  it('offers records without a shared term after the lexical hits, newest first, in the all pool', () => {
    const records = store()
    records.create({ id: MemoryId('budget'), kind: 'fact', scope: 'workspace', content: 'Budget cap is 400 dollars.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(2) }] })
    const index = new MemoryRecordIndex()
    index.rebuild(records.snapshot())
    const bounds = { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1000, index }
    expect(retrieveMemoryWorkingSet(records, bounds, 'migration').candidates.map(candidate => candidate.id)).toEqual([MemoryId('migration')])
    const all = retrieveMemoryWorkingSet(records, { ...bounds, candidatePool: 'all' }, 'migration')
    expect(all.candidates.map(candidate => [candidate.id, candidate.score])).toEqual([
      [MemoryId('migration'), 1], [MemoryId('budget'), 0], [MemoryId('office'), 0],
    ])
    expect(all.candidates[1]?.excerpt).toBe('Budget cap is 400 dollars.')
    expect(retrieveMemoryWorkingSet(records, { ...bounds, candidatePool: 'lexical' }, 'migration').candidates).toHaveLength(1)
  })

  it('rejects invalid limits', () => {
    expect(() => retrieveMemoryWorkingSet(store(), { maxCandidates: 0, maxExcerptBytes: 10, maxTotalBytes: 10 }, 'migration')).toThrow('maxCandidates')
    // @ts-expect-error -- JSON configuration can carry an unknown pool name.
    expect(() => retrieveMemoryWorkingSet(store(), { maxCandidates: 1, maxExcerptBytes: 10, maxTotalBytes: 10, candidatePool: 'semantic' }, 'migration'))
      .toThrow('candidatePool')
  })
})
