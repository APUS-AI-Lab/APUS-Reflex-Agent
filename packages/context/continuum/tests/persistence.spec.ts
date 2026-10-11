import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  MemoryId,
  MemoryRecordStore,
  appendMemoryRecordEvent,
  foldMemoryRecordEvents,
  readMemorySourceEvents,
  MemoryRecordIndex,
  retrieveMemoryWorkingSet,
} from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
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
    await readHandle.close()
    await reader.fiber.dispose()
  })
})
