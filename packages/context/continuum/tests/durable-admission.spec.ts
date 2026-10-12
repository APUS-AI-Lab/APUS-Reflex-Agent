import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../../experimental/apus-dsh-jev-plugin/src/index.ts'
import ContinuumMemory from '../src/service.ts'
import { foldMemoryRecordEvents, readMemorySourceEvents } from '../src/persistence.ts'
import { MemoryRecordStore } from '../src/records.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

async function profile(root: string, admission: 'explicit' | 'user-message', restore = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([textResponse('ack'), textResponse('recalled')])
  ctx.llm.registerAdapter(['recording'], adapter)
  await ctx.plugin(Jev, { endpoint: 'http://127.0.0.1:1', model: 'jev-test' })
  await ctx.plugin(ContinuumMemory, {
    enabled: true, mode: 'active', admission, scopes: ['workspace'], maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192,
  })
  const sessionId = SessionId('continuum-durable-admission')
  const agent = restore ? undefined : await ctx.agentLoop.create(sessionId, { provider: 'recording', model: 'recording' })
  return { ctx, agent, adapter, sessionId }
}

describe('Continuum automatic admission durable profile path', () => {
  it('flushes admitted user memory, restarts from JSONL, recalls it in a model request, and retains attribution', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-continuum-durable-admission-'))
    roots.push(root)
    const writer = await profile(root, 'user-message')
    writer.agent!.followup(user('The release train departs on Wednesday.'))
    await writer.agent!.whenIdle()
    await writer.ctx.sessions.flush(writer.agent!.session)
    const persisted = writer.agent!.session.snapshotEvents()
    expect(persisted.some(event => event.type === 'continuum/memory-record')).toBe(true)
    const source = persisted.find(event => event.type === 'user/message')
    const record = persisted.find(event => event.type === 'continuum/memory-record')
    expect(record).toMatchObject({ data: { record: { sourceRefs: [{ sessionId: writer.sessionId, eventSeq: source?.seq }] } } })
    await writer.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(writer.ctx), 1)

    const reader = await profile(root, 'user-message', true)
    const restored = await reader.ctx.agentLoop.resume(reader.ctx, {
      resumeSessionId: reader.sessionId,
      agentOptions: { provider: 'recording', model: 'recording' },
    })
    restored.agent.followup(user('After restart, which day does the release train depart?'))
    await restored.agent.whenIdle()
    const request = reader.adapter.requests[0]
    const text = request?.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])) ?? []
    expect(text.some(value => value.includes('Wednesday'))).toBe(true)
    const recall = request?.messages.find(message => message.source?.kind === 'continuum-memory')
    expect(recall?.source).toMatchObject({ kind: 'continuum-memory', form: 'recall', recordIds: [expect.any(String)] })
    const rebuilt = foldMemoryRecordEvents(restored.agent.session.snapshotEvents(), new MemoryRecordStore())
    expect(rebuilt.snapshot().length).toBeGreaterThanOrEqual(1)
    const refs = rebuilt.snapshot()[0]?.sourceRefs ?? []
    const sources = await readMemorySourceEvents(reader.ctx.sessionPersistence, refs)
    expect(sources.map(item => item.event.type)).toEqual(['user/message'])
  })

  it('keeps the shipped explicit default from writing memory records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-continuum-explicit-default-'))
    roots.push(root)
    const profileRun = await profile(root, 'explicit')
    profileRun.agent!.followup(user('This must stay caller-owned.'))
    await profileRun.agent!.whenIdle()
    await profileRun.ctx.sessions.flush(profileRun.agent!.session)
    expect(profileRun.agent!.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  })
})
