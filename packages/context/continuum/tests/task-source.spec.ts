import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type {} from '../src/context.ts'
import { readTaskSource } from '../src/task-source.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function runtime(root: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'continuum-task-source-'))
  roots.push(root)
  const workspace = join(await realpath(root), 'workspace')
  const other = join(await realpath(root), 'other')
  await mkdir(workspace)
  await mkdir(other)
  const ctx = await runtime(root)
  const agent = await ctx.agentLoop.create(SessionId('source-owner'), {}, { cwd: workspace })
  const text = '  原文\r\n\tlong text 尾部🪶  \n'
  const event = agent.session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'First block' }, { type: 'text', text }],
  }), { surfaceOp: 'append' })
  const source = { sessionId: agent.session.id, eventSeq: event.seq, blockIndex: 1 }
  return { ctx, agent, root, workspace, other, text, event, source }
}

it('flushes current input and preserves exact UTF-8 text including whitespace and its tail', async () => {
  const h = await fixture()
  const flush = vi.spyOn(h.ctx.sessions, 'flush')
  const result = await readTaskSource(h.ctx, h.agent, h.workspace, h.source)
  expect(flush).toHaveBeenCalledWith(h.agent.session)
  expect(result).toEqual({ text: h.text, source: { ...h.source, digest: createHash('sha256').update(h.text, 'utf8').digest('hex') } })
})

it('reads a closed source from a new runtime context without resuming its Session', async () => {
  const h = await fixture()
  await h.ctx.sessions.flush(h.agent.session)
  await h.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(h.ctx), 1)
  const ctx = await runtime(h.root)
  const caller = await ctx.agentLoop.create(SessionId('new-session'), {}, { cwd: h.workspace })
  const flush = vi.spyOn(ctx.sessions, 'flush')
  expect((await readTaskSource(ctx, caller, h.workspace, h.source)).text).toBe(h.text)
  expect(ctx.sessions.get(h.source.sessionId)).toBeUndefined()
  expect(flush).not.toHaveBeenCalled()
})

it.each(['other-workspace', 'missing-workspace', 'no-workspace'] as const)('rejects a caller with %s before storage access', async (kind) => {
  const h = await fixture()
  const cwd = kind === 'other-workspace' ? h.other : kind === 'missing-workspace' ? join(h.root, 'absent') : undefined
  const caller = await h.ctx.agentLoop.create(SessionId('caller'), {}, cwd === undefined ? {} : { cwd })
  const stat = vi.spyOn(h.ctx.sessionPersistence, 'stat')
  await expect(readTaskSource(h.ctx, caller, h.workspace, h.source)).rejects.toThrow(/workspace/)
  expect(stat).not.toHaveBeenCalled()
})

it('denies another workspace even when its source ID is known', async () => {
  const h = await fixture()
  const caller = await h.ctx.agentLoop.create(SessionId('caller'), {}, { cwd: h.other })
  await h.ctx.sessions.flush(h.agent.session)
  const open = vi.spyOn(h.ctx.sessionPersistence, 'open')
  await expect(readTaskSource(h.ctx, caller, h.other, h.source)).rejects.toThrow('workspace access denied')
  expect(open).not.toHaveBeenCalled()
})

it('rejects a missing durable source session', async () => {
  const h = await fixture()
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, { ...h.source, sessionId: SessionId('absent') })).rejects.toThrow('session was not found')
})

it.each([-1, 2, 0.5])('rejects invalid or absent block %s', async (blockIndex) => {
  const h = await fixture()
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, { ...h.source, blockIndex })).rejects.toThrow(/text block/)
})

it('rejects an absent event instead of reading another event', async () => {
  const h = await fixture()
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, { ...h.source, eventSeq: SessionSeq(500) })).rejects.toThrow('requested durable human message')
})

it('rejects generated recall as a source of human requirements', async () => {
  const h = await fixture()
  const event = h.agent.session.append('user/message', createUserMessage({
    source: { kind: 'continuum-memory', form: 'recall', version: 1, recordIds: ['fact'] }, content: [{ type: 'text', text: 'Generated text' }],
  }), { surfaceOp: 'append' })
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, { ...h.source, eventSeq: event.seq, blockIndex: 0 })).rejects.toThrow('requested durable human message')
})

it('rejects a non-message event and non-text content', async () => {
  const h = await fixture()
  const event = h.agent.session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'reasoning', text: 'Not a human text block' }],
  }), { surfaceOp: 'append' })
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, { ...h.source, eventSeq: event.seq, blockIndex: 0 })).rejects.toThrow('text block was not found')
  const start = h.agent.session.append('turn/start', { turn: 1 })
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, { ...h.source, eventSeq: start.seq, blockIndex: 0 }))
    .rejects.toThrow('requested durable human message')
})

it('does not read or acknowledge a source after its flush fails', async () => {
  const h = await fixture()
  vi.spyOn(h.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('flush failed'))
  const stat = vi.spyOn(h.ctx.sessionPersistence, 'stat')
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, h.source)).rejects.toThrow('flush failed')
  expect(stat).not.toHaveBeenCalled()
})

it('rejects a flush without a durability listener even when a cached source is readable', async () => {
  const h = await fixture()
  await h.ctx.sessions.flush(h.agent.session)
  vi.spyOn(h.ctx.sessions, 'flush').mockResolvedValueOnce(false)
  const stat = vi.spyOn(h.ctx.sessionPersistence, 'stat')
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, h.source)).rejects.toThrow('no durability listener')
  expect(stat).not.toHaveBeenCalled()
})

/** Decorate one real reader while preserving its resource owner and teardown. */
function decorateRead(ctx: Context, decorate: (handle: SessionHandle) => SessionHandle): void {
  const open = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
  vi.spyOn(ctx.sessionPersistence, 'open').mockImplementation(async (...args) => decorate(await open(...args)))
}

it.each(['stat-id', 'open-id', 'open-workspace', 'read-workspace', 'read-seq'] as const)('rejects source changes at %s', async (stage) => {
  const h = await fixture()
  if (stage === 'stat-id') {
    const stat = h.ctx.sessionPersistence.stat.bind(h.ctx.sessionPersistence)
    vi.spyOn(h.ctx.sessionPersistence, 'stat').mockImplementation(async (...args) => {
      const result = await stat(...args)
      return result === undefined ? undefined : { ...result, header: { ...result.header, id: SessionId('wrong') } }
    })
  } else {
    decorateRead(h.ctx, (handle) => {
      let read = false
      return {
        id: stage === 'open-id' ? SessionId('wrong') : handle.id,
        get header() {
          return stage === 'open-workspace' || (stage === 'read-workspace' && read) ? { ...handle.header, cwd: h.other } : handle.header
        },
        access: handle.access,
        inheritedEventCount: handle.inheritedEventCount,
        read: async (...args) => {
          const result = await handle.read(...args)
          read = true
          return stage === 'read-seq' ? { ...result, events: result.events.map(event => ({ ...event, seq: SessionSeq(999) })) } : result
        },
        append: (...args) => handle.append(...args),
        flush: (...args) => handle.flush(...args),
        close: () => handle.close(),
        [Symbol.asyncDispose]: () => handle.close(),
      }
    })
  }
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, h.source))
    .rejects.toThrow(/identity changed|workspace access denied|requested durable human message/)
})

it('honors cancellation after a backend read and releases the reader', async () => {
  const h = await fixture()
  const abort = new AbortController()
  let closed = false
  decorateRead(h.ctx, (handle) => {
    const read = handle.read.bind(handle)
    const close = handle.close.bind(handle)
    vi.spyOn(handle, 'read').mockImplementation(async (...args) => {
      const result = await read(...args)
      abort.abort(new Error('cancel task source'))
      return result
    })
    vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed = true })
    return handle
  })
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, h.source, abort.signal)).rejects.toThrow('cancel task source')
  expect(closed).toBe(true)
})

it('uses canonical workspace equality for a directory alias', async () => {
  const h = await fixture()
  const alias = join(h.root, 'alias')
  await symlink(h.workspace, alias, 'junction')
  const caller = await h.ctx.agentLoop.create(SessionId('alias-caller'), {}, { cwd: alias })
  await h.ctx.sessions.flush(h.agent.session)
  expect((await readTaskSource(h.ctx, caller, h.workspace, h.source)).text).toBe(h.text)
})

it('denies a source directory alias redirected while reading its event', async () => {
  const h = await fixture()
  const alias = join(h.root, 'source-alias')
  await symlink(h.workspace, alias, 'junction')
  const owner = await h.ctx.agentLoop.create(SessionId('alias-owner'), {}, { cwd: alias })
  const event = owner.session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'Private task source' }],
  }), { surfaceOp: 'append' })
  await h.ctx.sessions.flush(owner.session)
  decorateRead(h.ctx, (handle) => {
    const read = handle.read.bind(handle)
    vi.spyOn(handle, 'read').mockImplementation(async (...args) => {
      const result = await read(...args)
      await unlink(alias)
      await symlink(h.other, alias, 'junction')
      return result
    })
    return handle
  })
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, { sessionId: owner.session.id, eventSeq: event.seq, blockIndex: 0 }))
    .rejects.toThrow('workspace access denied')
})

it('rejects an already cancelled read before touching persistence', async () => {
  const h = await fixture()
  const stat = vi.spyOn(h.ctx.sessionPersistence, 'stat')
  await expect(readTaskSource(h.ctx, h.agent, h.workspace, h.source, AbortSignal.abort(new Error('cancelled source'))))
    .rejects.toThrow('cancelled source')
  expect(stat).not.toHaveBeenCalled()
})

it('flushes an authorized live source in another Session without a global barrier', async () => {
  const h = await fixture()
  const caller = await h.ctx.agentLoop.create(SessionId('other-live-caller'), {}, { cwd: h.workspace })
  const targeted = vi.spyOn(h.ctx.sessions, 'flush')
  const durable = vi.spyOn(h.ctx.sessionPersistence, 'flush')
  expect((await readTaskSource(h.ctx, caller, h.workspace, h.source)).text).toBe(h.text)
  expect(targeted).toHaveBeenCalledWith(h.agent.session)
  expect(durable).not.toHaveBeenCalled()
})

async function coldFixture() {
  const h = await fixture()
  await h.ctx.sessions.flush(h.agent.session)
  await h.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(h.ctx), 1)
  const ctx = await runtime(h.root)
  const caller = await ctx.agentLoop.create(SessionId('cold-source-caller'), {}, { cwd: h.workspace })
  return { ...h, ctx, caller }
}

it('refuses cold source text changed during the post-flush readback', async () => {
  const h = await coldFixture()
  decorateRead(h.ctx, (handle) => {
    const read = handle.read.bind(handle)
    let reads = 0
    vi.spyOn(handle, 'read').mockImplementation(async (...args) => {
      const result = await read(...args)
      reads++
      return reads === 1 ? result : { ...result, events: [] }
    })
    return handle
  })
  await expect(readTaskSource(h.ctx, h.caller, h.workspace, h.source)).rejects.toThrow('changed during durable readback')
})

it('does not acknowledge a cold source when its exclusive durability barrier fails', async () => {
  const h = await coldFixture()
  decorateRead(h.ctx, (handle) => {
    expect(handle.access).toBe('write')
    vi.spyOn(handle, 'flush').mockRejectedValueOnce(new Error('cold source flush failed'))
    return handle
  })
  await expect(readTaskSource(h.ctx, h.caller, h.workspace, h.source)).rejects.toThrow('cold source flush failed')
})

it('refuses a cold source owned by another runtime instead of treating a local flush as foreign durability', async () => {
  const h = await fixture()
  await h.ctx.sessions.flush(h.agent.session)
  const reader = await runtime(h.root)
  const caller = await reader.agentLoop.create(SessionId('foreign-runtime-caller'), {}, { cwd: h.workspace })
  await expect(readTaskSource(reader, caller, h.workspace, h.source)).rejects.toThrow(/owned|ownership|lease/)
})
