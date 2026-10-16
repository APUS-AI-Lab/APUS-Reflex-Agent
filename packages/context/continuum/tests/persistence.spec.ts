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

  it.each(['missing', 'generated'] as const)('refuses an index entry whose source is %s', (kind) => {
    const session = Session.create(SessionId('index-fold-bad'))
    session.append('turn/start', { turn: 1 })
    const generated = human(session, 'recall text', 'continuum-memory')
    const eventSeq = kind === 'missing' ? SessionSeq(999) : generated.seq
    appendMemoryIndexEvent(session, { id: MemoryId('bad'), scope: 'workspace', tags: [], source: { sessionId: session.id, eventSeq } })
    expect(() => foldMemoryRecordEvents(session.snapshotEvents(), new MemoryRecordStore())).toThrow('has no human text')
  })
})

describe('Continuum record events', () => {
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
