import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '../../../session/session-persistence-jsonl/src/index.ts'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestController } from './test-remote.ts'
import { findPromptAdmission, textPromptReceipt } from '../src/prompt-receipt.ts'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function profile(root?: string, restore = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  if (root !== undefined) await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const selection = { provider: 'recording', model: 'recording' }
  const adapter = new MockAdapter(Array.from({ length: 10 }, () => textResponse('ack')))
  ctx.llm.registerAdapter(['recording'], adapter)
  const sessionId = SessionId('input-receipt')
  const agent = restore
    ? (await ctx.agentLoop.resume(ctx, { resumeSessionId: sessionId, agentOptions: selection })).agent
    : await ctx.agentLoop.create(sessionId, selection)
  const controller = createSessionTestController(ctx, { defaultModelSelection: () => selection, cwd: '/work' })
  const request: SessionPromptRequest = { sessionId, requestId: 'first-request' as SessionRequestId, mode: 'queue', content: [{ type: 'text', text: '  exact\n输入 😀\r\n  ' }] }
  const prompt = (input = request) => controller.prompt(input, new AbortController().signal)
  return { ctx, agent, adapter, controller, request, prompt }
}
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'apus-input-receipts-'))
  roots.push(root)
  return root
}
it('saves complete text before model processing and deduplicates claimed, unprocessed input', async () => {
  const h = await profile(await directory())
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  h.ctx.on('agent/pre-step', async (_payload, next) => { entered.resolve(undefined); await release.promise; return next() })
  try {
    const saved = await h.prompt()
    await entered.promise
    expect(saved.storage).toMatchObject({ state: 'saved', source: { sessionId: h.agent.id } })
    expect(h.agent.inbox.nextTurn).toHaveLength(0)
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
    expect(await h.prompt()).toEqual(saved)
    await expect(h.prompt({ ...h.request, content: [{ type: 'text', text: 'changed' }] })).rejects.toMatchObject({ code: 'session/request-conflict' })
    const source = saved.storage!.source!
    const handle = await h.ctx.sessionPersistence.open(h.agent.id, 'read')
    try {
      const { events } = await handle.read(source.eventSeq, 1)
      expect(events[0]).toMatchObject({ type: 'agent/inbox/spliced', data: { inserted: [{ id: saved.storage!.messageId, content: h.request.content }] } })
    } finally { await handle.close() }
  } finally { release.resolve(undefined) }
  await h.agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
})
it('keeps a removed queued input removed when its original request is retried after restart', async () => {
  const root = await directory()
  const h = await profile(root)
  const release = Promise.withResolvers<undefined>()
  h.ctx.on('agent/pre-step', async (_payload, next) => { await release.promise; return next() })
  try {
    await h.prompt()
    const queued = { ...h.request, requestId: 'cancelled-request' as SessionRequestId }
    const saved = await h.prompt(queued)
    expect(h.agent.inbox.nextTurn).toHaveLength(1)
    await h.controller.updateQueue({ sessionId: h.agent.id, itemId: saved.storage!.messageId, action: { kind: 'remove' } })
    expect(await h.prompt(queued)).toEqual(saved)
    expect(h.agent.inbox.nextTurn).toHaveLength(0)
    release.resolve(undefined)
    await h.agent.whenIdle()
    await h.ctx.sessions.flush(h.agent.session)
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const restored = await profile(root, true)
    expect(await restored.prompt(queued)).toEqual(saved)
    expect(restored.agent.inbox.nextTurn).toHaveLength(0)
    expect(restored.adapter.requests).toHaveLength(0)
  } finally { release.resolve(undefined) }
})
it('returns failed on flush failure and retries saving without another insertion', async () => {
  const h = await profile(await directory())
  const dispose = h.ctx.on('session/flush', () => { throw new Error('injected persistence barrier failure') })
  const failed = await h.prompt()
  expect(failed.storage?.state).toBe('failed')
  dispose()
  const saved = await h.prompt()
  expect(saved.storage).toEqual({ ...failed.storage, state: 'saved' })
  await h.agent.whenIdle()
  const inserted = h.agent.session.snapshotEvents().flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
  expect(inserted).toHaveLength(1)
})
it('reports unavailable without a persistence backend', async () => {
  const h = await profile()
  expect((await h.prompt()).storage?.state).toBe('unavailable')
  await h.agent.whenIdle()
})
it('deduplicates concurrent submissions that both passed the initial lookup', async () => {
  const h = await profile(await directory())
  const receipts = await Promise.all([h.prompt(), h.prompt()])
  expect(receipts[0]).toEqual(receipts[1])
  await h.agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
})

it('refuses saved without an admission source or when stored event data differs', async () => {
  const h = await profile(await directory())
  await h.prompt()
  const admission = findPromptAdmission(h.agent, h.request.requestId)!
  expect((await textPromptReceipt(h.ctx, h.agent, admission.message, undefined)).storage?.state).toBe('failed')
  const mismatched = { ...admission, event: { ...admission.event, time: admission.event.time + 1 } }
  expect((await textPromptReceipt(h.ctx, h.agent, admission.message, mismatched)).storage?.state).toBe('failed')
  await h.agent.whenIdle()
})
it('saves long ordered text blocks without trimming or collapsing block boundaries', async () => {
  const h = await profile(await directory())
  const content = [{ type: 'text' as const, text: '  输入😀\r\n'.repeat(32_768) }, { type: 'text' as const, text: '\n tail  ' }]
  const saved = await h.prompt({ ...h.request, content })
  expect(saved.storage?.state).toBe('saved')
  const handle = await h.ctx.sessionPersistence.open(h.agent.id, 'read')
  try {
    const { events } = await handle.read(saved.storage!.source!.eventSeq, 1)
    expect(events[0]).toMatchObject({ data: { inserted: [{ content }] } })
  } finally { await handle.close() }
  await expect(h.prompt({ ...h.request, content: [{ type: 'text', text: content.map(block => block.text).join('') }] })).rejects.toMatchObject({ code: 'session/request-conflict' })
  await h.agent.whenIdle()
})
