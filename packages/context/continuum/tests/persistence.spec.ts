import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  MemoryId,
  MemoryRecordStore,
  appendMemoryIndexEvent,
  appendMemoryRecordEvent,
  foldMemoryRecordEvents,
  readMemorySourceEvents,
  MemoryRecordIndex,
  retrieveMemoryWorkingSet,
  buildContinuumSummaryView,
  zoomContinuumSummaryView,
} from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Continuum L1 index events', () => {
  const human = (session: Session, text: string, kind: 'user' | 'continuum-memory' = 'user') =>
    session.append('user/message', createUserMessage({
      source: kind === 'user' ? { kind } : { kind, form: 'recall', version: 1, recordIds: [] },
      content: [{ type: 'text', text }],
    }), { surfaceOp: 'append' })

  it('rebuilds records whose text comes only from the L2 source event', () => {
    const session = Session.create(SessionId('index-fold'))
    session.append('turn/start', { turn: 1 })
    const source = human(session, '  小米对猫毛过敏。  ')
    const id = MemoryId(`index-fold:${String(source.seq)}`)
    appendMemoryIndexEvent(session, { id, scope: 'workspace', tags: ['people', 'health'], source: { sessionId: session.id, eventSeq: source.seq } })
    const indexEvent = session.snapshotEvents().at(-1)
    expect(indexEvent?.type === 'continuum/memory-index' ? JSON.stringify(indexEvent.data) : '').not.toContain('猫毛')
    const store = foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore())
    expect(store.get(id)).toMatchObject({ content: '小米对猫毛过敏。', kind: 'fact', scope: 'workspace', status: 'active',
      sourceRefs: [{ sessionId: session.id, eventSeq: source.seq }] })
  })

  it('records the admission path and tag source without changing the fold', () => {
    const session = Session.create(SessionId('index-admission'))
    const source = human(session, 'The release is Friday.')
    const id = MemoryId(`index-admission:${String(source.seq)}`)
    const entry = { id, scope: 'workspace', tags: ['work'], source: { sessionId: session.id, eventSeq: source.seq } }
    const event = appendMemoryIndexEvent(session, entry, { source: 'compaction', tagSource: 'reflex' })
    expect(event.data).toEqual({ operation: 'add', entry, admission: { source: 'compaction', tagSource: 'reflex' } })
    expect(foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore()).get(id))
      .toMatchObject({ content: 'The release is Friday.', status: 'active' })
  })

  it.each(['missing', 'generated'] as const)('refuses an index entry whose source is %s', (kind) => {
    const session = Session.create(SessionId('index-fold-bad'))
    session.append('turn/start', { turn: 1 })
    const generated = human(session, 'recall text', 'continuum-memory')
    const eventSeq = kind === 'missing' ? SessionSeq(999) : generated.seq
    appendMemoryIndexEvent(session, { id: MemoryId('bad'), scope: 'workspace', tags: [], source: { sessionId: session.id, eventSeq } })
    expect(() => foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore())).toThrow('has no human text')
  })
})

describe('Continuum record-before-index fold order', () => {
  const human = (session: Session, text: string) =>
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })

  it('recovers a record whose index event never arrived, without tags', () => {
    const session = Session.create(SessionId('record-crash-window'))
    session.append('turn/start', { turn: 1 })
    const source = human(session, 'The API key header is X-Orbit-Key.')
    const writer = new MemoryRecordStore()
    const created = writer.create({
      id: MemoryId(`record-crash-window:${String(source.seq)}`), kind: 'fact', scope: 'workspace',
      content: 'The API key header is X-Orbit-Key.',
      sourceRefs: [{ sessionId: session.id, eventSeq: source.seq }],
    })
    appendMemoryRecordEvent(session, 'create', created)
    const tags = new Map<MemoryId, readonly string[]>()
    const store = foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore(), tags)
    expect(store.get(created.id)).toEqual(created)
    expect(tags.has(created.id)).toBe(false)
  })

  it('treats an equal record event that follows its index as one record', () => {
    const session = Session.create(SessionId('index-then-record'))
    session.append('turn/start', { turn: 1 })
    const source = human(session, 'The release is Friday.')
    const id = MemoryId(`index-then-record:${String(source.seq)}`)
    const writer = new MemoryRecordStore()
    const created = writer.create({
      id, kind: 'fact', scope: 'workspace', content: 'The release is Friday.',
      sourceRefs: [{ sessionId: session.id, eventSeq: source.seq }],
    })
    appendMemoryIndexEvent(session, { id, scope: 'workspace', tags: ['work'], source: { sessionId: session.id, eventSeq: source.seq } })
    appendMemoryRecordEvent(session, 'create', created)
    const tags = new Map<MemoryId, readonly string[]>()
    const store = foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore(), tags)
    expect(store.snapshot()).toHaveLength(1)
    expect(store.get(id)).toEqual(created)
    expect(tags.get(id)).toEqual(['work'])
  })

  it('treats a repeated create as equal regardless of source-ref property order', () => {
    const session = Session.create(SessionId('record-key-order'))
    session.append('turn/start', { turn: 1 })
    const source = human(session, 'Property order must not matter.')
    const id = MemoryId('record-key-order')
    const writer = new MemoryRecordStore()
    const created = writer.create({
      id, kind: 'fact', scope: 'workspace', content: 'Property order must not matter.',
      sourceRefs: [{ sessionId: session.id, eventSeq: source.seq }],
    })
    appendMemoryRecordEvent(session, 'create', created)
    // Spliced in JSON order: same pointer, different property order.
    const reordered = JSON.stringify({ ...created, sourceRefs: [{ eventSeq: source.seq, sessionId: session.id }] })
    const events = session.snapshotEvents()
    const replay = { ...events.at(-1), data: { operation: 'create', record: JSON.parse(reordered) } }
    const store = foldMemoryRecordEvents([...events, replay as never], new MemoryRecordStore())
    expect(store.snapshot()).toHaveLength(1)
    expect(store.get(id)).toEqual(created)
  })

  it('keeps the first record and names the differing fields when a duplicate create conflicts', () => {
    const session = Session.create(SessionId('record-conflict'))
    session.append('turn/start', { turn: 1 })
    const writer = new MemoryRecordStore()
    const first = writer.create({
      id: MemoryId('record-conflict'), kind: 'fact', scope: 'workspace', content: 'First fact.',
      sourceRefs: [{ sessionId: session.id, eventSeq: SessionSeq(0) }],
    })
    appendMemoryRecordEvent(session, 'create', first)
    const second = new MemoryRecordStore().create({
      id: MemoryId('record-conflict'), kind: 'fact', scope: 'workspace', content: 'Second fact.',
      sourceRefs: [{ sessionId: session.id, eventSeq: SessionSeq(0) }],
    })
    appendMemoryRecordEvent(session, 'create', second)
    const store = new MemoryRecordStore()
    expect(() => foldMemoryRecordEvents(session.snapshotEvents(), store)).toThrow(/record-conflict.*content/)
    expect(store.get(MemoryId('record-conflict'))).toEqual(first)
  })

  it('restores index-only and record-then-index entries in one stream', () => {
    const session = Session.create(SessionId('mixed-orders'))
    session.append('turn/start', { turn: 1 })
    const oldSource = human(session, 'Old log entry.')
    appendMemoryIndexEvent(session, {
      id: MemoryId('mixed-old'), scope: 'workspace', tags: ['old'],
      source: { sessionId: session.id, eventSeq: oldSource.seq },
    })
    const newSource = human(session, 'New log entry.')
    const writer = new MemoryRecordStore()
    const created = writer.create({
      id: MemoryId('mixed-new'), kind: 'fact', scope: 'workspace', content: 'New log entry.',
      sourceRefs: [{ sessionId: session.id, eventSeq: newSource.seq }],
    })
    appendMemoryRecordEvent(session, 'create', created)
    appendMemoryIndexEvent(session, {
      id: MemoryId('mixed-new'), scope: 'workspace', tags: ['new'],
      source: { sessionId: session.id, eventSeq: newSource.seq },
    })
    const store = foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore())
    expect(store.snapshot().map(record => record.id)).toEqual([MemoryId('mixed-old'), MemoryId('mixed-new')])
    expect(store.get(MemoryId('mixed-old'))).toMatchObject({ content: 'Old log entry.' })
    expect(store.get(MemoryId('mixed-new'))).toEqual(created)
  })
})

describe('Continuum record events', () => {
  it('records the replaced record and read invalidation on corrections only', () => {
    const session = Session.create(SessionId('record-predecessor'))
    session.append('turn/start', { turn: 1 })
    const store = new MemoryRecordStore()
    const created = store.create({
      id: MemoryId('fact-v1'), kind: 'fact', scope: 'workspace', content: 'Old fact.',
      sourceRefs: [{ sessionId: session.id, eventSeq: SessionSeq(0) }],
    })
    appendMemoryRecordEvent(session, 'create', created)
    const replacement = store.supersede(created.id, created.revision, {
      id: MemoryId('fact-v2'), kind: 'fact', scope: 'workspace', content: 'New fact.', sourceRefs: created.sourceRefs,
    })
    appendMemoryRecordEvent(session, 'supersede', replacement, created)
    const events = session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')
    expect(events[0]?.data).toEqual({ operation: 'create', record: created })
    expect(events[1]?.data).toEqual({ operation: 'supersede', record: replacement, previous: created, invalidatesReads: true })
    expect(foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore()).snapshot())
      .toEqual([{ ...created, status: 'superseded', revision: 2 }, replacement])
  })

  it('flushes a record history and rebuilds it after a Context restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-continuum-jsonl-'))
    roots.push(root)
    const id = SessionId('continuum-jsonl')
    const writer = new Context()
    await writer.plugin(SessionStore)
    await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const currentSession = writer.sessions.create(id)
    const handle = await writer.sessionPersistence.create(currentSession.header)
    currentSession.append('turn/start', { turn: 1 })
    const store = new MemoryRecordStore()
    const created = store.create({
      id: MemoryId('project-status'),
      kind: 'fact',
      scope: 'workspace',
      content: 'The migration is scheduled.',
      sourceRefs: [{ sessionId: id, eventSeq: SessionSeq(0) }],
    })
    appendMemoryRecordEvent(currentSession, 'create', created)
    const replacement = store.supersede(created.id, created.revision, {
      id: MemoryId('project-status-v2'),
      kind: 'fact',
      scope: 'workspace',
      content: 'The migration is scheduled for Friday.',
      sourceRefs: created.sourceRefs,
    })
    appendMemoryRecordEvent(currentSession, 'supersede', replacement)
    const deactivated = store.deactivate(replacement.id, replacement.revision)
    appendMemoryRecordEvent(currentSession, 'deactivate', deactivated)
    await writer.sessions.flush(currentSession)
    await handle.close()
    await writer.fiber.dispose()

    const reader = new Context()
    await reader.plugin(SessionStore)
    await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const readHandle = await reader.sessionPersistence.open(id, 'read')
    const { events } = await readHandle.read()
    expect(events.map(event => event.type)).toEqual([
      'turn/start',
      'continuum/memory-record',
      'continuum/memory-record',
      'continuum/memory-record',
    ])
    const rebuilt = foldMemoryRecordEvents(events, new MemoryRecordStore())
    expect(rebuilt.snapshot()).toEqual(store.snapshot())
    const sources = await readMemorySourceEvents(reader.sessionPersistence, created.sourceRefs)
    expect(sources.map(source => [source.sessionId, source.event.type])).toEqual([[id, 'turn/start']])
    await readHandle.close()
    await reader.fiber.dispose()
  })

  it('retains memory events across a failed flush and replays the retry exactly once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-continuum-flush-retry-'))
    roots.push(root)
    const id = SessionId('continuum-flush-retry')
    const writer = new Context()
    try {
      await writer.plugin(SessionStore)
      await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const session = writer.sessions.create(id)
      const handle = await writer.sessionPersistence.create(session.header)
      const persistence = writer.sessionPersistence
      if (!(persistence instanceof JsonlSessionPersistence)) throw new Error('Expected JSONL persistence')
      // Materialize first so the injected failure targets the live event batch.
      await handle.flush()
      const failure = new Error('Continuum batch storage unavailable')
      const persist = vi.spyOn(persistence, 'persistBatch').mockRejectedValueOnce(failure)
      try {
        const store = new MemoryRecordStore()
        session.append('turn/start', { turn: 1 })
        const created = store.create({
          id: MemoryId('delivery'),
          kind: 'fact',
          scope: 'workspace',
          content: 'Delivery is scheduled for Thursday.',
          sourceRefs: [{ sessionId: id, eventSeq: SessionSeq(0) }],
        })
        appendMemoryRecordEvent(session, 'create', created)
        await expect(writer.sessions.flush(session)).rejects.toBe(failure)
        expect(persist).toHaveBeenCalledTimes(1)
        const beforeRetry = await persistence.open(id, 'read')
        try {
          expect((await beforeRetry.read()).events).toEqual([])
        } finally {
          await beforeRetry.close()
        }
        const corrected = store.supersede(created.id, created.revision, {
          id: MemoryId('delivery-corrected'),
          kind: 'fact',
          scope: 'workspace',
          content: 'Delivery is scheduled for Friday.',
          sourceRefs: created.sourceRefs,
        })
        appendMemoryRecordEvent(session, 'supersede', corrected)
        await expect(writer.sessions.flush(session)).resolves.toBe(true)
        await expect(writer.sessions.flush(session)).resolves.toBe(true)
        expect(persist).toHaveBeenCalledTimes(2)
        await handle.close()
        await writer.fiber.dispose()

        const reader = new Context()
        try {
          await reader.plugin(SessionStore)
          await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
          const readHandle = await reader.sessionPersistence.open(id, 'read')
          try {
            const { events } = await readHandle.read()
            expect(events.map(event => [event.type, event.seq])).toEqual([
              ['turn/start', 0],
              ['continuum/memory-record', 1],
              ['continuum/memory-record', 2],
            ])
            expect(foldMemoryRecordEvents(events, new MemoryRecordStore()).snapshot()).toEqual(store.snapshot())
            const sources = await readMemorySourceEvents(reader.sessionPersistence, corrected.sourceRefs)
            expect(sources.map(source => source.event.type)).toEqual(['turn/start'])
          } finally {
            await readHandle.close()
          }
        } finally {
          await reader.fiber.dispose()
        }
      } finally {
        persist.mockRestore()
      }
    } finally {
      await writer.fiber.dispose()
    }
  })

  it('rebuilds and searches a long JSONL history after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-continuum-long-jsonl-'))
    roots.push(root)
    const id = SessionId('continuum-long-jsonl')
    const writer = new Context()
    await writer.plugin(SessionStore)
    await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const session = writer.sessions.create(id)
    const handle = await writer.sessionPersistence.create(session.header)
    const store = new MemoryRecordStore()
    for (let index = 0; index < 1_000; index += 1) {
      const record = store.create({
        id: MemoryId(`history-${index}`),
        kind: 'fact',
        scope: 'workspace',
        content: `Long history marker-${index}.`,
        sourceRefs: [{ sessionId: id, eventSeq: SessionSeq(index) }],
      })
      appendMemoryRecordEvent(session, 'create', record)
    }
    await writer.sessions.flush(session)
    await handle.close()
    await writer.fiber.dispose()

    const reader = new Context()
    await reader.plugin(SessionStore)
    await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const readHandle = await reader.sessionPersistence.open(id, 'read')
    const { events } = await readHandle.read()
    const rebuilt = foldMemoryRecordEvents(events, new MemoryRecordStore())
    const index = new MemoryRecordIndex()
    expect(index.rebuild(rebuilt.snapshot())).toEqual({ indexedRecords: 1_000, pendingRecords: 0 })
    const workingSet = retrieveMemoryWorkingSet(rebuilt, { maxCandidates: 2, maxExcerptBytes: 200, maxTotalBytes: 400, index }, 'marker-999')
    expect(workingSet.candidates.map(candidate => candidate.id)).toEqual([MemoryId('history-999')])
    const view = buildContinuumSummaryView(rebuilt.snapshot(), { maxItemsPerLeaf: 1, maxSummaryBytes: 128 })
    const sources = zoomContinuumSummaryView(view, 'workspace/fact-1000')
    expect(sources).toEqual([{ recordId: MemoryId('history-999'), sourceRefs: [{ sessionId: id, eventSeq: SessionSeq(999) }] }])
    const sourceEvents = await readMemorySourceEvents(reader.sessionPersistence, sources[0]?.sourceRefs ?? [])
    expect(sourceEvents.map(source => [source.sessionId, source.event.type])).toEqual([[id, 'continuum/memory-record']])
    await readHandle.close()
    await reader.fiber.dispose()
  })
})
