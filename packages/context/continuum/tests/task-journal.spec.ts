import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryId } from '../src/records.ts'
import { TaskJournal } from '../src/task-journal.ts'
import { MemoryDomainId, MemoryPrincipalId, MemoryTaskId, type TaskCommitRequest, type TaskEntry, type TaskOperationData } from '../src/task-types.ts'

const roots: string[] = []
const contexts: Context[] = []
const journals: TaskJournal[] = []
const identity = { domainId: MemoryDomainId('workspace-memory'), principalId: MemoryPrincipalId('owner'), workspace: '/authorized/workspace' }
const taskId = MemoryTaskId('release-task')
const logId = SessionId('isolated-task-journal')

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(journals.splice(0).map(journal => journal.close()))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function entry(id: string, text = `original ${id}`): TaskEntry {
  return { id: MemoryId(id), role: 'input', text, source: {
    sessionId: SessionId('source-session'), eventSeq: SessionSeq(7), blockIndex: 0,
    digest: createHash('sha256').update(text).digest('hex'),
  } }
}

function create(id = 'input-1', text?: string): TaskCommitRequest {
  return { requestId: 'request-create', expectedRevision: 0, command: { kind: 'create', taskId, entry: entry(id, text) } }
}

function committed(request: TaskCommitRequest = create()): SessionEvent<'continuum/task-operation'> {
  return { type: 'continuum/task-operation', seq: SessionSeq(1), time: 2, data: {
    version: 1, kind: 'commit', request,
    digest: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    receipt: { revision: request.expectedRevision + 1, taskId: request.command.taskId, requestId: request.requestId },
  } }
}

async function backend(root?: string) {
  if (root === undefined) {
    root = await mkdtemp(join(tmpdir(), 'apus-task-journal-'))
    roots.push(root)
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return { root, ctx, persistence: ctx.sessionPersistence }
}

async function fresh() {
  const result = await backend()
  const handle = await result.persistence.create({ id: logId, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false })
  const journal = await TaskJournal.open(handle, identity)
  journals.push(journal)
  return { ...result, handle, journal }
}

describe('cross-session task authority', () => {
  it('preserves complete text, explicit corrections and retired evidence across cold JSONL reopen', async () => {
    const { root, ctx, journal } = await fresh()
    const original = `  beginning\n${'长要求🙂\n'.repeat(12_000)}tail-random-fact  `
    await journal.commit(create('input-1', original))
    const before = journal.snapshot(taskId)
    await journal.commit({ requestId: 'append', expectedRevision: 1, command: { kind: 'append', taskId, entry: { ...entry('progress-1'), role: 'progress' } } })
    await journal.commit({ requestId: 'correct', expectedRevision: 2, command: { kind: 'supersede', taskId, predecessor: MemoryId('input-1'), entry: entry('corrected', 'updated requirement') } })
    await journal.commit({ requestId: 'deactivate', expectedRevision: 3, command: { kind: 'deactivate', taskId, entryId: MemoryId('progress-1') } })
    expect(before?.entries[0]?.status).toBe('active')
    expect(Object.isFrozen(before?.entries[0]?.source)).toBe(true)
    await journal.close()
    await ctx.fiber.dispose()

    const cold = await backend(root)
    const restored = await TaskJournal.open(await cold.persistence.open(logId, 'write'), identity)
    journals.push(restored)
    expect(restored.revision).toBe(4)
    expect(restored.snapshot(taskId)).toEqual({ id: taskId, revision: 4, entries: [
      { ...entry('input-1', original), status: 'superseded' },
      { ...entry('progress-1'), role: 'progress', status: 'deactivated' },
      { ...entry('corrected', 'updated requirement'), status: 'active', supersedes: 'input-1' },
    ] })
    expect(restored.list()).toEqual([{ id: taskId, revision: 4 }])
    expect(restored.snapshot(MemoryTaskId('other-task'))).toBeUndefined()
    expect(Object.isFrozen(restored.snapshot(taskId)?.entries)).toBe(true)
  })

  it('returns the original retry receipt before CAS and rejects changed payloads after restart', async () => {
    const { root, ctx, journal } = await fresh()
    const request = create()
    const receipt = await journal.commit(request)
    await journal.commit({ requestId: 'next', expectedRevision: 1, command: { kind: 'append', taskId, entry: entry('next') } })
    expect(await journal.commit(request)).toBe(receipt)
    await expect(journal.commit({ ...request, expectedRevision: 2 })).rejects.toMatchObject({ code: 'TASK_REQUEST_CONFLICT' })
    await journal.close()
    await ctx.fiber.dispose()
    const cold = await backend(root)
    const restored = await TaskJournal.open(await cold.persistence.open(logId, 'write'), identity)
    journals.push(restored)
    expect(await restored.commit(request)).toEqual(receipt)
    expect(restored.revision).toBe(2)
    await expect(restored.commit(create('different'))).rejects.toMatchObject({ code: 'TASK_REQUEST_CONFLICT' })
  })

  it('serializes competing CAS and keeps failed state transitions out of the log', async () => {
    const { journal } = await fresh()
    await journal.commit(create())
    const request = (id: string): TaskCommitRequest => ({ requestId: id, expectedRevision: 1,
      command: { kind: 'append', taskId, entry: entry(id) } })
    const results = await Promise.allSettled([journal.commit(request('a')), journal.commit(request('b'))])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'TASK_REVISION_CONFLICT' } })
    await expect(journal.commit({ requestId: 'duplicate-entry', expectedRevision: 2,
      command: { kind: 'append', taskId, entry: entry('a') } })).rejects.toMatchObject({ code: 'TASK_ENTRY_CONFLICT' })
    expect(journal.revision).toBe(2)
    await journal.commit({ requestId: 'retire', expectedRevision: 2, command: { kind: 'deactivate', taskId, entryId: MemoryId('a') } })
    await expect(journal.commit({ requestId: 'retire-again', expectedRevision: 3,
      command: { kind: 'deactivate', taskId, entryId: MemoryId('a') } })).rejects.toMatchObject({ code: 'TASK_ENTRY_INACTIVE' })
  })

  it('does not scan the whole log again or cross task identities on subsequent commits and reads', async () => {
    const { journal, handle } = await fresh()
    const reads = vi.spyOn(handle, 'read')
    await journal.commit(create())
    const other = MemoryTaskId('unrelated-task')
    await journal.commit({ requestId: 'other', expectedRevision: 1, command: { kind: 'create', taskId: other, entry: entry('other') } })
    for (let index = 0; index < 30; index += 1) {
      await journal.commit({ requestId: `input-${index}`, expectedRevision: index + 2,
        command: { kind: 'append', taskId, entry: entry(`requirement-${index}`) } })
      expect(journal.snapshot(taskId)?.entries).toHaveLength(index + 2)
      expect(journal.snapshot(other)?.entries).toHaveLength(1)
    }
    expect(reads).toHaveBeenCalledTimes(32)
    expect(reads.mock.calls.every(([offset, length]) => Number.isSafeInteger(offset) && length === 1)).toBe(true)
  })

  it.each(['domainId', 'principalId', 'workspace'] as const)('refuses mismatched %s and releases the rejected write handle', async (key) => {
    const { journal, persistence } = await fresh()
    await journal.close()
    const supplied = { ...identity, [key]: key === 'domainId' ? MemoryDomainId('other')
      : key === 'principalId' ? MemoryPrincipalId('other') : '/other' }
    const handle = await persistence.open(logId, 'write')
    await expect(TaskJournal.open(handle, supplied)).rejects.toMatchObject({ code: 'TASK_IDENTITY_MISMATCH' })
    const reopened = await persistence.open(logId, 'write')
    await reopened.close()
  })

  it('keeps the last committed projection after a flush failure and poisons queued writes', async () => {
    const { journal, handle } = await fresh()
    const flush = vi.spyOn(handle, 'flush').mockRejectedValueOnce(new Error('injected flush failure'))
    const failed = journal.commit(create())
    const queued = journal.commit({ ...create('second'), requestId: 'second' })
    await expect(failed).rejects.toThrow('injected flush failure')
    await expect(queued).rejects.toMatchObject({ code: 'TASK_POISONED' })
    expect(() => journal.revision).toThrow(expect.objectContaining({ code: 'TASK_POISONED' }))
    expect(() => journal.snapshot(taskId)).toThrow(expect.objectContaining({ code: 'TASK_POISONED' }))
    expect(() => journal.list()).toThrow(expect.objectContaining({ code: 'TASK_POISONED' }))
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('recovers an uncertain appended operation and reconciles its original request after reopen', async () => {
    const { journal, handle, root, ctx } = await fresh()
    const request = create()
    vi.spyOn(handle, 'flush').mockRejectedValueOnce(new Error('lost durability acknowledgment'))
    await expect(journal.commit(request)).rejects.toThrow('lost durability acknowledgment')
    expect(() => journal.revision).toThrow(expect.objectContaining({ code: 'TASK_POISONED' }))
    await journal.close()
    await ctx.fiber.dispose()
    const cold = await backend(root)
    const restored = await TaskJournal.open(await cold.persistence.open(logId, 'write'), identity)
    journals.push(restored)
    expect(restored.revision).toBe(1)
    expect(await restored.commit(request)).toEqual({ revision: 1, requestId: request.requestId, taskId })
    expect(restored.snapshot(taskId)?.entries).toHaveLength(1)
  })

  it('rejects wrong readback without publishing and drains queued work before closing', async () => {
    const { journal, handle } = await fresh()
    vi.spyOn(handle, 'read').mockResolvedValueOnce({ eventState: 'shared-frozen', events: [] })
    await expect(journal.commit(create())).rejects.toMatchObject({ code: 'TASK_CORRUPT' })
    expect(() => journal.snapshot(taskId)).toThrow(expect.objectContaining({ code: 'TASK_POISONED' }))
    await expect(journal.commit(create())).rejects.toMatchObject({ code: 'TASK_POISONED' })
    await journal.close()
    await expect(journal.commit(create())).rejects.toMatchObject({ code: 'TASK_CLOSED' })
  })

  it('captures mutable caller input before waiting and completes admitted work when close races it', async () => {
    const { journal, handle } = await fresh()
    let entered!: () => void
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const flush = handle.flush.bind(handle)
    vi.spyOn(handle, 'flush').mockImplementationOnce(async () => { entered(); await barrier; await flush() })
    const source = { sessionId: SessionId('source-session'), eventSeq: SessionSeq(7), blockIndex: 0, digest: 'a'.repeat(64) }
    const mutableEntry = { id: MemoryId('immutable'), role: 'input' as const, text: 'original', source }
    const saved = journal.commit({ requestId: 'capture', expectedRevision: 0, command: { kind: 'create', taskId, entry: mutableEntry } })
    mutableEntry.text = 'changed'
    source.blockIndex = 9
    await waiting
    const closing = journal.close()
    expect(journal.close()).toBe(closing)
    await expect(journal.commit(create())).rejects.toMatchObject({ code: 'TASK_CLOSED' })
    release()
    await saved
    await closing
    expect(journal.snapshot(taskId)?.entries[0]).toMatchObject({ text: 'original', source: { blockIndex: 0 } })
  })

  it('refuses read-only ownership and arbitrary or duplicate initialization events', async () => {
    const { journal, persistence } = await fresh()
    await journal.close()
    await expect(TaskJournal.open(await persistence.open(logId, 'read'), identity)).rejects.toMatchObject({ code: 'TASK_READ_ONLY' })
    const handle = await persistence.open(logId, 'write')
    const duplicate: SessionEvent<'continuum/task-operation'> = {
      type: 'continuum/task-operation', seq: SessionSeq(1), time: 2,
      data: { version: 1, kind: 'init', identity },
    }
    await handle.append([duplicate])
    await handle.flush()
    await expect(TaskJournal.open(handle, identity)).rejects.toMatchObject({ code: 'TASK_CORRUPT' })
  })

  it('rejects forged commit digests and receipts during recovery', async () => {
    const { journal, persistence } = await fresh()
    await journal.close()
    const handle = await persistence.open(logId, 'write')
    await handle.append([{ type: 'continuum/task-operation', seq: SessionSeq(1), time: 2,
      data: { version: 1, kind: 'commit', request: create(), digest: 'f'.repeat(64),
        receipt: { revision: 1, taskId, requestId: 'request-create' } } }])
    await handle.flush()
    await expect(TaskJournal.open(handle, identity)).rejects.toMatchObject({ code: 'TASK_CORRUPT' })
  })

  it('refuses reused task identities, missing targets and empty request identities without poisoning valid writes', async () => {
    const { journal } = await fresh()
    await expect(journal.commit({ ...create(), requestId: '' })).rejects.toMatchObject({ code: 'TASK_REQUEST_CONFLICT' })
    await expect(journal.commit({ requestId: 'missing-task', expectedRevision: 0,
      command: { kind: 'append', taskId, entry: entry('a') } })).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
    await journal.commit(create())
    await expect(journal.commit({ ...create(), requestId: 'recreate', expectedRevision: 1 })).rejects.toMatchObject({ code: 'TASK_ENTRY_CONFLICT' })
    await expect(journal.commit({ requestId: 'missing-entry', expectedRevision: 1,
      command: { kind: 'deactivate', taskId, entryId: MemoryId('absent') } })).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
    await journal.commit({ requestId: 'valid-next', expectedRevision: 1, command: { kind: 'append', taskId, entry: entry('b') } })
    expect(journal.revision).toBe(2)
  })

  it.each([MemoryTaskId, MemoryDomainId, MemoryPrincipalId])('refuses empty external identifiers', (factory) => {
    expect(() => factory('')).toThrow('must not be empty')
  })

  const malformedData: readonly { name: string; data: unknown }[] = [
    { name: 'null operation', data: null },
    { name: 'missing discriminant', data: {} },
    { name: 'future init version', data: { version: 2, kind: 'init', identity } },
    { name: 'null identity', data: { version: 1, kind: 'init', identity: null } },
    { name: 'extra identity fields', data: { version: 1, kind: 'init', identity: { ...identity, granted: true } } },
    { name: 'missing identity fields', data: { version: 1, kind: 'init', identity: { domainId: identity.domainId, extra: 1, workspace: identity.workspace } } },
    { name: 'empty workspace', data: { version: 1, kind: 'init', identity: { ...identity, workspace: '' } } },
    { name: 'future commit version', data: { ...committed().data, version: 2 } },
    { name: 'unknown operation', data: { ...committed().data, kind: 'delete' } },
    { name: 'fractional revision', data: { ...committed().data, request: { ...create(), expectedRevision: 0.5 } } },
    { name: 'invalid hash encoding', data: { ...committed().data, digest: 'not-a-hash' } },
    { name: 'null command', data: { ...committed().data, request: { ...create(), command: null } } },
    { name: 'unknown command', data: { ...committed().data, request: { ...create(), command: { kind: 'forget' } } } },
    { name: 'invalid entry role', data: { ...committed().data, request: { ...create(), command: { kind: 'create', taskId, entry: { ...entry('x'), role: 'authority' } } } } },
    { name: 'invalid entry role null', data: { ...committed().data, request: { ...create(), command: { kind: 'create', taskId, entry: { ...entry('x'), role: null } } } } },
    { name: 'nontext entry', data: { ...committed().data, request: { ...create(), command: { kind: 'create', taskId, entry: { ...entry('x'), text: 1 } } } } },
  ]

  it.each(malformedData)('rejects durable $name', async ({ data }) => {
    const { journal, persistence } = await fresh()
    await journal.close()
    const handle = await persistence.open(logId, 'write')
    // A damaged durable record enters at the persistence read interface.
    const bad: SessionEvent<'continuum/task-operation'> = {
      type: 'continuum/task-operation', seq: SessionSeq(0), time: 1, data: data as TaskOperationData,
    }
    vi.spyOn(handle, 'read').mockResolvedValueOnce({ eventState: 'shared-frozen', events: [bad] })
    await expect(TaskJournal.open(handle, identity)).rejects.toMatchObject({ code: 'TASK_CORRUPT' })
  })

  it.each(['sequence gap', 'ignorable operation', 'foreign event', 'missing initialization', 'forged receipt', 'duplicate commit'] as const)(
    'rejects %s in the authority log', async (scenario) => {
      const { journal, persistence } = await fresh()
      await journal.close()
      const handle = await persistence.open(logId, 'write')
      const { events } = await handle.read()
      const init = events[0]!
      const commit = committed()
      let damaged: readonly SessionEvent[]
      switch (scenario) {
        case 'sequence gap': damaged = [{ ...init, seq: SessionSeq(5) }]; break
        case 'ignorable operation': damaged = [{ ...init, ignorable: true }]; break
        case 'foreign event': damaged = [{ type: 'session/end-seed', seq: SessionSeq(0), time: 1, data: {} }]; break
        case 'missing initialization': damaged = [{ ...commit, seq: SessionSeq(0) }]; break
        case 'forged receipt': {
          if (commit.data.kind !== 'commit') throw new Error('fixture needs commit')
          damaged = [init, { ...commit, data: { ...commit.data, receipt: { ...commit.data.receipt, revision: 9 } } }]
          break
        }
        case 'duplicate commit': damaged = [init, commit, { ...commit, seq: SessionSeq(2) }]; break
      }
      vi.spyOn(handle, 'read').mockResolvedValueOnce({ eventState: 'shared-frozen', events: damaged })
      await expect(TaskJournal.open(handle, identity)).rejects.toMatchObject({ code: 'TASK_CORRUPT' })
    },
  )
})
