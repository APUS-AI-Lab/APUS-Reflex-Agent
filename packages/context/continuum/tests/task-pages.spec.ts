import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { MemoryId } from '../src/records.ts'
import { MemoryTaskId, type TaskSnapshot, type TaskStoredEntry } from '../src/task-types.ts'
import { renderTaskPage, type TaskPage, type TaskPageOptions } from '../src/task-pages.ts'

function entry(id: string, text: string, status: TaskStoredEntry['status'] = 'active'): TaskStoredEntry {
  return {
    id: MemoryId(id), role: id === 'progress' ? 'progress' : 'input', text, status,
    source: { sessionId: SessionId('seed'), eventSeq: SessionSeq(7), blockIndex: 0, digest: 'a'.repeat(64) },
  }
}

function task(entries: readonly TaskStoredEntry[]): TaskSnapshot {
  return { id: MemoryTaskId('task-42'), revision: 9, entries }
}

function read(snapshot: TaskSnapshot, options: TaskPageOptions): TaskPage {
  const json = renderTaskPage(snapshot, options)
  expect(Buffer.byteLength(json)).toBeLessThanOrEqual(options.maxBytes)
  return JSON.parse(json) as TaskPage
}

describe('revisioned task text pages', () => {
  it('includes all small active inputs and progress with exact whitespace and source identifiers', () => {
    const snapshot = task([
      entry('old', 'obsolete', 'superseded'), entry('first', '  earliest requirement\n'),
      entry('disabled', 'secret retired value', 'deactivated'), entry('progress', '\toutput path\r\n'),
    ])
    const before = JSON.stringify(snapshot)
    const page = read(snapshot, { maxBytes: 4096 })
    expect(page).toMatchObject({ taskId: 'task-42', revision: 9, totalEntries: 4, activeEntries: 2, pending: false, next: null })
    expect(page.entries).toEqual([snapshot.entries[1]!, snapshot.entries[3]!].map(value => ({
      id: value.id, status: 'active', role: value.role, source: value.source,
      text: value.text, textOffset: 0, nextTextOffset: value.text.length,
    })))
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it.each([440, 512, 800, 4096])('reconstructs every active source across %i-byte Unicode and JSON-escaped pages', (maxBytes) => {
    const snapshot = task([
      entry('retired', 'hidden', 'superseded'),
      entry('first', (' 🌍漢字\n\t"\\\u0000').repeat(95)),
      entry('disabled', 'hidden', 'deactivated'), entry('empty', ''),
      entry('progress', '\ud800 raw lone surrogate \udc00'.repeat(37)), entry('last', ' terminal 🌈 '),
    ])
    let options: TaskPageOptions = { maxBytes }
    const recovered = new Map<string, string>()
    const order: string[] = []
    for (let pages = 0; ; pages++) {
      expect(pages).toBeLessThan(2000)
      const page = read(snapshot, options)
      expect(page.entries.length).toBeGreaterThan(0)
      for (const part of page.entries) {
        const previous = recovered.get(part.id) ?? ''
        if (!recovered.has(part.id)) order.push(part.id)
        expect(part.textOffset).toBe(previous.length)
        expect(part.nextTextOffset).toBe(previous.length + part.text.length)
        if (part.id === 'first' || part.id === 'last') expect(part.text.isWellFormed()).toBe(true)
        recovered.set(part.id, previous + part.text)
      }
      expect(page.pending).toBe(page.next !== null)
      if (page.next === null) break
      options = { maxBytes, entryIndex: page.next.entryIndex, textOffset: page.next.textOffset, expectedRevision: page.next.revision }
    }
    const active = snapshot.entries.filter(value => value.status === 'active')
    expect(order).toEqual(active.map(value => value.id))
    expect([...recovered]).toEqual(active.map(value => [value.id, value.text]))
  })

  it('retains every early requirement when there are more entries than the old recent-items limit', () => {
    const snapshot = task(Array.from({ length: 100 }, (_, index) => entry(`requirement-${index}`, `must keep ${index}`)))
    const page = read(snapshot, { maxBytes: 100000 })
    expect(page.entries.map(value => value.id)).toEqual(snapshot.entries.map(value => value.id))
    expect(page.pending).toBe(false)
  })

  it('returns a completed metadata page for empty, retired-only, and exhausted tasks', () => {
    expect(read(task([]), { maxBytes: 1024 })).toMatchObject({ activeEntries: 0, totalEntries: 0, entries: [], next: null })
    expect(read(task([entry('old', 'old', 'superseded')]), { maxBytes: 1024 })).toMatchObject({ activeEntries: 0, totalEntries: 1, entries: [], next: null })
    expect(read(task([entry('first', 'source')]), { maxBytes: 1024, entryIndex: 1, expectedRevision: 9 })).toMatchObject({ activeEntries: 1, entries: [], pending: false })
  })

  it('uses original array indices for continuation past retired entries', () => {
    const snapshot = task([entry('first', 'a'), entry('old', 'old', 'superseded'), entry('last', 'z'.repeat(1000))])
    const page = read(snapshot, { maxBytes: 440 })
    expect(page.entries.map(value => value.id)).toEqual(['first'])
    expect(page.next).toEqual({ entryIndex: 2, textOffset: 0, revision: 9 })
    const resumed = read(snapshot, { maxBytes: 440, entryIndex: 1, expectedRevision: 9 })
    expect(resumed.entries[0]!.id).toBe('last')
  })

  it('accepts a complete final entry at its exact serialized-byte limit', () => {
    const snapshot = task([entry('first', '🌈')])
    const full = renderTaskPage(snapshot, { maxBytes: 4096 })
    expect(renderTaskPage(snapshot, { maxBytes: Buffer.byteLength(full) })).toBe(full)
    expect(() => renderTaskPage(snapshot, { maxBytes: Buffer.byteLength(full) - 1 })).toThrow(/cannot fit/)
  })

  it('refuses zero-progress pages when even metadata or the next surrogate pair cannot fit', () => {
    expect(() => renderTaskPage(task([]), { maxBytes: 1 })).toThrow(/cannot fit/)
    expect(() => renderTaskPage(task([entry('first', '🌈')]), { maxBytes: 200 })).toThrow(/cannot fit/)
    const snapshot = task([entry('first', '🌈a')])
    const completeBytes = Buffer.byteLength(renderTaskPage(snapshot, { maxBytes: 4096 }))
    expect(() => renderTaskPage(snapshot, { maxBytes: completeBytes - 1 })).toThrow(/cannot fit/)
  })

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid maxBytes %s', (maxBytes) => {
    expect(() => renderTaskPage(task([]), { maxBytes })).toThrow(/maxBytes must/)
  })

  it.each([-1, 0.5, NaN, Infinity, 2])('rejects invalid entry index %s', (entryIndex) => {
    expect(() => renderTaskPage(task([entry('a', 'abc')]), { maxBytes: 1024, entryIndex, expectedRevision: 9 })).toThrow(/entryIndex/)
  })

  it.each([-1, 0.5, NaN, Infinity])('rejects invalid text offset %s', (textOffset) => {
    expect(() => renderTaskPage(task([entry('a', 'abc')]), { maxBytes: 1024, textOffset, expectedRevision: 9 })).toThrow(/textOffset/)
  })

  it('rejects stale revisions and unbound continuations', () => {
    const snapshot = task([entry('a', 'abc')])
    expect(() => renderTaskPage(snapshot, { maxBytes: 1024, expectedRevision: 8 })).toThrow(/revision conflict/)
    expect(() => renderTaskPage(snapshot, { maxBytes: 1024, textOffset: 1 })).toThrow(/requires expectedRevision/)
    expect(() => renderTaskPage(snapshot, { maxBytes: 1024, entryIndex: 1 })).toThrow(/requires expectedRevision/)
    expect(() => renderTaskPage(snapshot, { maxBytes: 1024, expectedRevision: NaN })).toThrow(/revision conflict/)
  })

  it('rejects offsets beyond source text, inside a surrogate pair, or on inactive and absent entries', () => {
    const snapshot = task([entry('a', 'a🌈b'), entry('b', 'old', 'deactivated')])
    for (const options of [
      { textOffset: 5 }, { textOffset: 2 }, { entryIndex: 1, textOffset: 1 }, { entryIndex: 2, textOffset: 1 },
    ]) {
      expect(() => renderTaskPage(snapshot, { maxBytes: 1024, expectedRevision: 9, ...options })).toThrow(/textOffset/)
    }
    expect(read(snapshot, { maxBytes: 1024, textOffset: 3, expectedRevision: 9 }).entries[0]!.text).toBe('b')
    expect(read(snapshot, { maxBytes: 1024, textOffset: 4, expectedRevision: 9 }).entries[0]!.text).toBe('')
  })
})
