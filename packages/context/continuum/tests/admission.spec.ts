import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../../experimental/apus-dsh-jev-plugin/src/index.ts'
import ContinuumMemory, { type ContinuumConfig } from '../src/service.ts'
import { MemoryId } from '../src/records.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

async function harness(admission: 'explicit' | 'user-message' = 'user-message', scopes = ['workspace'], lateMount = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([textResponse('ack'), textResponse('recalled')])
  ctx.llm.registerAdapter(['recording'], adapter)
  await ctx.plugin(Jev, { endpoint: 'http://127.0.0.1:1', model: 'jev-test' })
  const config: ContinuumConfig = {
    enabled: true, mode: 'active', admission, scopes, maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192,
  }
  if (!lateMount) await ctx.plugin(ContinuumMemory, config)
  const agent = await ctx.agentLoop.create(SessionId('continuum-admission'), { provider: 'recording', model: 'recording' })
  if (lateMount) await ctx.plugin(ContinuumMemory, config)
  return { ctx, agent, adapter }
}

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

describe('Continuum automatic admission', () => {
  it('records committed human input and recalls it on the next request', async () => {
    const h = await harness()
    h.agent.followup(user('The migration cutover moved to Monday.'))
    await h.agent.whenIdle()
    const created = h.agent.session.snapshotEvents().find(event => event.type === 'continuum/memory-record')
    expect(created).toMatchObject({
      data: { operation: 'create', record: { content: 'The migration cutover moved to Monday.', scope: 'workspace', sourceRefs: [{ sessionId: h.agent.session.id }] } },
    })
    expect(created?.type === 'continuum/memory-record' ? created.data.record.sourceRefs[0]?.eventSeq : undefined).toBe(
      h.agent.session.snapshotEvents().find(event => event.type === 'user/message')?.seq,
    )

    h.agent.followup(user('What day is the migration cutover?'))
    await h.agent.whenIdle()
    const messages = h.adapter.requests[1]?.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])) ?? []
    expect(messages.some(text => text.includes('Continuum memory'))).toBe(true)
    expect(messages.some(text => text.includes('Monday'))).toBe(true)

    const seed = h.agent.session.snapshotEvents()
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const restarted = await harness()
    const resumed = (await restarted.ctx.agents.create({
      sessionId: SessionId('continuum-admission-restarted'),
      agentOptions: { provider: 'recording', model: 'recording' }, meta: { isSeeded: true }, seed, inheritedEventCount: SessionLogOffset(seed.length),
    })).agent
    resumed.followup(user('After restart, what day is the migration cutover?'))
    await resumed.whenIdle()
    const replayed = restarted.adapter.requests[0]?.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])) ?? []
    expect(replayed.some(text => text.includes('Monday'))).toBe(true)
  })

  it.each(['blank', 'no-scope', 'generated'] as const)('does not admit %s input as a human fact', async (kind) => {
    const h = await harness('user-message', kind === 'no-scope' ? [] : ['workspace'])
    const message = kind === 'generated'
      ? createUserMessage({ source: { kind: 'continuum-memory', form: 'recall', version: 1, recordIds: ['existing'] }, content: [{ type: 'text', text: 'Generated recall.' }] })
      : user(kind === 'blank' ? ' \n ' : 'Input without an admission scope.')
    const source = h.agent.session.append('user/message', message, { surfaceOp: 'append' })
    await Promise.resolve()
    expect(h.agent.session.snapshotEvents().find(event => event.seq === source.seq)).toEqual(source)
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  })

  it('leaves an agentless Session input unadmitted', async () => {
    const h = await harness()
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => undefined)
    const session = h.ctx.sessions.create(SessionId('unowned-input'))
    const source = session.append('user/message', user('There is no initiating Agent.'), { surfaceOp: 'append' })
    await Promise.resolve()
    expect(session.snapshotEvents()).toContainEqual(source)
    expect(warn).not.toHaveBeenCalled()
    expect(session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  })

  it('does not admit another Session input through an unrelated initiating Agent', async () => {
    const h = await harness()
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => undefined)
    const session = h.ctx.sessions.create(SessionId('unrelated-session-input'))
    await h.ctx.agents.withInitiator(h.agent, async () => {
      const source = session.append('user/message', user('This fact belongs only to the unrelated Session.'), { surfaceOp: 'append' })
      await Promise.resolve()
      expect(session.snapshotEvents()).toContainEqual(source)
      expect(session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
      expect(h.agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('admits through the initiating Agent when the service mounts after Agent creation', async () => {
    const h = await harness('user-message', ['workspace'], true)
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => undefined)
    h.agent.followup(user('The release moves to Thursday.'))
    await h.agent.whenIdle()
    expect(warn).not.toHaveBeenCalled()
    const source = h.agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    expect(h.agent.session.snapshotEvents().find(event => event.type === 'continuum/memory-record')).toMatchObject({ data: {
      operation: 'create', record: { content: 'The release moves to Thursday.', sourceRefs: [{ sessionId: h.agent.session.id, eventSeq: source.seq }] },
    } })
  })

  it('keeps explicit admission before the queued automatic admission idempotent', async () => {
    const h = await harness()
    const content = 'The release is Friday.'
    const source = h.agent.session.append('user/message', user(content), { surfaceOp: 'append' })
    const record = h.ctx.continuumMemory.create(h.agent, {
      id: MemoryId(`${String(h.agent.session.id)}:${String(source.seq)}`), kind: 'fact', scope: 'workspace', content,
      sourceRefs: [{ sessionId: h.agent.session.id, eventSeq: source.seq }],
    })
    await Promise.resolve()
    const admitted = h.agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')
    expect(admitted).toHaveLength(1)
    expect(admitted[0]?.data).toEqual({ operation: 'create', record })
  })

  it('retains input and reports a Session append failure during automatic admission', async () => {
    const h = await harness()
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => undefined)
    const source = h.agent.session.append('user/message', user('This input must survive an admission failure.'), { surfaceOp: 'append' })
    const append = vi.spyOn(h.agent.session, 'append').mockImplementationOnce(() => { throw new Error('Session append unavailable') })
    await Promise.resolve()
    expect(append).toHaveBeenCalledWith('continuum/memory-record', expect.any(Object))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('continuum memory admission failed: Error: Session append unavailable'))
    expect(h.agent.session.snapshotEvents()).toContainEqual(source)
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  })

  it('keeps explicit mode from admitting user input', async () => {
    const h = await harness('explicit')
    h.agent.followup(user('This must remain caller-owned.'))
    await h.agent.whenIdle()
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  })
})
