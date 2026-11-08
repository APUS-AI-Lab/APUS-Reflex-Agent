import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header, releasedV5SessionFormatCodec, restoreReleasedV5Artifact, sessionFormatV4ToV5 } from '../src/index.ts'

const header: SessionFormatHeader = { version: 4, id: 'identity', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const fact: SessionFormatEvent = { type: 'feedback/record', seq: 0, time: 2, data: { text: 'retained' } }
const seed: SessionFormatEvent = { type: 'session/end-seed', seq: 1, time: 3, data: { inherited: true } }
const memoryIndex: SessionFormatEvent = { type: 'continuum/memory-index', seq: 1, time: 3,
  data: { admission: { source: 'user-message', tagSource: 'reflex' }, entry: { id: 'a', scope: 's', source: { eventSeq: 0, sessionId: 's' }, tags: [] }, operation: 'add' } }

function stage(sourceHeader = header, sourceInheritedEventCount?: number) {
  return sessionFormatV4ToV5.createStage({
    sourceHeader, targetHeader: sessionFormatV4ToV5.migrateHeader(sourceHeader),
    sourceInheritedEventCount, sourceKind: 'decoded',
  })
}

function migrate(events: readonly SessionFormatEvent[], sourceHeader = header, cut?: number) {
  const current = stage(sourceHeader, cut)
  const output = new SessionFormatEventCollector()
  for (const event of events) current.transformEvent(event, output)
  return { events: output.values, cut: current.finish(output) }
}

describe('V4 to V5 header promotion', () => {
  it('changes only the header version and retains events, payloads, and coordinates', () => {
    const rows = [fact, memoryIndex]
    const before = JSON.stringify({ header, rows })
    expect(sessionFormatV4ToV5.migrateHeader(header)).toEqual({ ...header, version: 5 })
    expect(migrate(rows)).toEqual({ events: rows, cut: 0 })
    expect(migrate(rows).events[0]).toBe(fact)
    expect(migrate(rows).events[1]).toBe(memoryIndex)
    expect(JSON.stringify({ header, rows })).toBe(before)
    expect(stage().headerInheritedEventCount).toBe(0)
    expect(migrate([])).toEqual({ events: [], cut: 0 })
  })

  it('preserves compact runs without expanding them', () => {
    const current = stage()
    const output = new SessionFormatEventCollector()
    const run = { runType: 'identity', eventCount: 1, firstSeq: 0, *expand() { yield fact } }
    current.transformRun(run, output)
    expect(current.finish(output)).toBe(0)
    expect(output.values).toEqual([fact])
  })

  it('keeps interleaved stage state independent and preserves the inherited cut', () => {
    const inherited = stage({ ...header, isSeeded: true, parentSession: 'ancestor' }, 1)
    const local = stage()
    const a = new SessionFormatEventCollector()
    const b = new SessionFormatEventCollector()
    inherited.transformEvent(fact, a)
    local.transformEvent(fact, b)
    expect(inherited.finish(a)).toBe(1)
    expect(local.finish(b)).toBe(0)
  })

  it('derives a seeded inherited cut from the last inherited end-seed marker', () => {
    const unknown = stage({ ...header, isSeeded: true }, undefined)
    const output = new SessionFormatEventCollector()
    unknown.transformEvent(fact, output)
    unknown.transformEvent(seed, output)
    expect(unknown.finish(output)).toBe(1)
    const missing = stage({ ...header, isSeeded: true }, undefined)
    const empty = new SessionFormatEventCollector()
    missing.transformEvent(fact, empty)
    expect(() => missing.finish(empty)).toThrow('inherited event count')
  })
})

describe('V5 physical framing', () => {
  it('reuses released V4 framing and round trips native V5 rows', () => {
    expect(releasedV5SessionFormatCodec.version).toBe(5)
    const physical = releasedV5SessionFormatCodec.encodeHeader({ ...header, version: 5 }, 0)
    expect(physical).toEqual({ type: 'session', ...header, version: 5 })
    expect(releasedV5SessionFormatCodec.decodeHeader(physical)).toEqual({ ...header, version: 5 })
    const decoder = releasedV5SessionFormatCodec.createDecoder(physical, 'strict')
    const output = new SessionFormatEventCollector()
    decoder.decodeRow(releasedV5SessionFormatCodec.encodeEvent(fact), output)
    expect(decoder.finish(output)).toBe(0)
    expect(output.values).toEqual([fact])
    expect(releasedV4SessionFormatCodec.encodeEvent(fact)).toEqual(releasedV5SessionFormatCodec.encodeEvent(fact))
  })

  it('rejects mismatched versions on both the logical header and the physical record', () => {
    expect(() => { assertReleasedV5Header({ ...header, version: 4 }) }).toThrow('v5 header')
    expect(() => releasedV5SessionFormatCodec.decodeHeader({ type: 'session', ...header, version: 4 })).toThrow('v5 physical')
    expect(() => releasedV5SessionFormatCodec.createDecoder({ ...header, version: 4 }, 'strict')).toThrow('v5 physical')
  })
})

describe('V5 restoration', () => {
  const types = new Set(['feedback/record', 'session/end-seed', 'continuum/memory-index'])

  it('accepts both V4 and V5 admission sources in a current artifact', () => {
    const artifact = { header: { ...header, version: 5 }, inheritedEventCount: 0, events: [fact, memoryIndex] }
    expect(restoreReleasedV5Artifact(artifact, types)).toBe(artifact)
    const compactionSource = { ...memoryIndex, data: { ...memoryIndex.data as Record<string, never>, admission: { source: 'compaction', tagSource: 'unjudged' } } }
    expect(restoreReleasedV5Artifact({ ...artifact, events: [fact, compactionSource] }, types).events).toHaveLength(2)
  })

  it('refuses unknown required events and sparse coordinates while keeping ignorable payloads opaque', () => {
    const artifact = { header: { ...header, version: 5 }, inheritedEventCount: 0, events: [fact] }
    expect(() => restoreReleasedV5Artifact({ ...artifact, events: [{ ...fact, type: 'external/required' }] }, types)).toThrow('unknown event type')
    const opaque = { ...fact, type: 'external/ignorable', ignorable: true as const }
    expect(restoreReleasedV5Artifact({ ...artifact, events: [opaque] }, types).events).toEqual([opaque])
    expect(() => restoreReleasedV5Artifact({ ...artifact, events: [{ ...fact, seq: 2 }] }, types)).toThrow('dense')
  })

  it('enforces the inherited cut against the last inherited end-seed marker', () => {
    const seeded = { ...header, version: 5, isSeeded: true, parentSession: 'ancestor' }
    const artifact = { header: seeded, inheritedEventCount: 1, events: [{ ...fact, seq: 0 }, seed] }
    expect(restoreReleasedV5Artifact(artifact, types)).toBe(artifact)
    expect(() => restoreReleasedV5Artifact({ ...artifact, inheritedEventCount: 0 }, types)).toThrow('marker')
    expect(() => restoreReleasedV5Artifact({ header: { ...header, version: 5 }, inheritedEventCount: 0, events: [{ ...fact, seq: 0 }, { ...seed, seq: 1 }] }, types)).toThrow('inherited end-seed')
  })

  it('applies current-generation delivery ownership to V5 markers', () => {
    const delivery = (version: number, sessionId: string): SessionFormatEvent => ({
      type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 3,
      data: { sessionId, throughSeq: 0, sessionFormatVersion: version },
    })
    const artifact = { header: { ...header, version: 5 }, inheritedEventCount: 0, events: [fact, delivery(5, header.id)] }
    const known = new Set([...types, 'session-log-deepseek/delivery-accepted'])
    expect(restoreReleasedV5Artifact(artifact, known)).toBe(artifact)
    expect(() => restoreReleasedV5Artifact({ ...artifact, events: [fact, delivery(5, 'foreign')] }, known)).toThrow('wrong Session')
    expect(restoreReleasedV5Artifact({ ...artifact, events: [fact, delivery(4, 'foreign')] }, known).events).toHaveLength(2)
  })
})
