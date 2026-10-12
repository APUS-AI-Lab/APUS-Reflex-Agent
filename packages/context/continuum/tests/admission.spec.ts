import { afterEach, describe, expect, it } from 'vitest'
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
import ContinuumMemory from '../src/service.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(admission: 'explicit' | 'user-message' = 'user-message') {
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
  await ctx.plugin(ContinuumMemory, {
    enabled: true, mode: 'active', admission, scopes: ['workspace'], maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192,
  })
  const agent = await ctx.agentLoop.create(SessionId('continuum-admission'), { provider: 'recording', model: 'recording' })
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

  it('keeps explicit mode from admitting user input', async () => {
    const h = await harness('explicit')
    h.agent.followup(user('This must remain caller-owned.'))
    await h.agent.whenIdle()
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  })
})
