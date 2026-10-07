import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { delegationInstruction, installSystem3Delegation } from '../src/delegation.ts'
import { createSystem3EntryRouter, type System3EntryRoutingConfig } from '../src/entry-routing.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const config: System3EntryRoutingConfig = {
  candidates: [
    { id: 'fast', description: '简单任务', provider: 'mock', model: 'fast', executionDomain: 'local', dataClasses: ['workspace'] },
    { id: 'codex', description: '需要修改工作区代码的工程任务', label: '工程任务 · 委派 Codex',
      delegate: { provider: 'codex', tool: 'subagent_codex' }, executionDomain: 'local', dataClasses: ['workspace'] },
  ],
  sessionDataClasses: ['workspace'], minConfidence: 0.8, maxInputBytes: 4000,
}
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(available: { provider: boolean; tool: boolean } = { provider: true, tool: true }) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.sessionProjections.register(system3RuntimeProjection)
  const adapter = new MockAdapter([])
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({ provider, id: model, name: model,
    context: { contextWindow: 10000 }, inputModalities: ['text'] }))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async query => ({ kind: 'ok', spec: ctx.jev.resolve(query),
    response: { model: 'jev-test', answers: { route: { type: 'choice', choice: 'codex', confidence: 0.95, probabilities: { codex: 0.95 } } } } }))
  const get = (name: string): unknown => ctx.reflect.get(name)
  const lookups: unknown[] = []
  vi.spyOn(ctx, 'get').mockImplementation(((name: string) => {
    if (name === 'subagents') return { getProvider: (provider: string) => (available.provider && provider === 'codex' ? {} : undefined) }
    if (name === 'tools') return { get: (tool: string, scope: unknown) => { lookups.push(scope); return available.tool && tool === 'subagent_codex' ? {} : undefined } }
    return get(name)
  }) as Context['get'])
  const agent = await ctx.agentLoop.create(SessionId('delegation-test'), { provider: 'mock', model: 'fast' })
  const requestId = brandString<SessionRequestId>('delegate-1')
  const message = createUserMessage({ content: [{ type: 'text', text: '给这个仓库加登录接口并补测试' }], source: { kind: 'user', rpcId: requestId } })
  const router = createSystem3EntryRouter(ctx, config, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  const route = () => router.route({ agent, requestId, baseline: { provider: 'mock', model: 'fast' }, message }, new AbortController().signal)
  const view = () => ctx.sessionProjections.stateOf(agent.session, 'system3Runtime')?.entry
  return { ctx, agent, decide, message, requestId, route, view, lookups }
}

it('keeps the baseline model, records the delegation target, and offers delegation only in the requesting scope', async () => {
  const h = await setup()
  expect(await h.route()).toBeUndefined()
  const receipt = h.agent.session.snapshotEvents().at(-1)?.data
  expect(receipt).toMatchObject({ outcome: 'selected', candidateIds: ['fast', 'codex'],
    candidate: { id: 'codex', label: '工程任务 · 委派 Codex', delegate: { provider: 'codex', tool: 'subagent_codex' } } })
  expect(receipt).not.toHaveProperty('selected')
  expect(h.lookups).toEqual([h.agent])
  expect(h.view()?.route).toEqual({ id: 'codex', label: '工程任务 · 委派 Codex', retained: false,
    delegation: { candidateId: 'codex', tool: 'subagent_codex', injected: false, called: false } })
})

it.each([{ provider: false, tool: true }, { provider: true, tool: false }])('does not offer delegation when %o', async (available) => {
  const h = await setup(available)
  h.decide.mockImplementation(async query => ({ kind: 'ok', spec: h.ctx.jev.resolve(query),
    response: { model: 'jev-test', answers: { route: { type: 'choice', choice: 'codex', confidence: 0.95, probabilities: { codex: 0.95 } } } } }))
  expect(await h.route()).toBeUndefined()
  expect(h.decide.mock.calls[0]?.[0].questions.route).toMatchObject({ criteria: { fast: '简单任务' } })
  expect(h.decide.mock.calls[0]?.[0].questions.route).not.toHaveProperty('criteria.codex')
  expect(h.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'invalid-response', candidateIds: ['fast'] })
})

it('injects one instruction in the pre-step carrying the delegated input, then records the actual tool call', async () => {
  const h = await setup()
  installSystem3Delegation(h.ctx)
  await h.route()
  const dispatch = agentEvents(h.ctx, h.agent)
  const step = async (messages: ReturnType<typeof createUserMessage>[]) => await dispatch.waterfall('agent/pre-step',
    { messages, turn: 1, step: 0, signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages }))
  const unrelated = await step([createUserMessage({ content: [{ type: 'text', text: 'other' }], source: { kind: 'user' } })])
  expect(unrelated.kind === 'enter' && unrelated.messages).toHaveLength(1)
  const first = await step([h.message])
  if (first.kind !== 'enter') throw new Error('expected enter')
  const instruction = first.messages.at(-1)!
  expect(instruction.source).toEqual({ kind: 'system3-delegation', requestId: h.requestId, candidateId: 'codex', tool: 'subagent_codex' })
  expect(instruction.content).toEqual([{ type: 'text', text: delegationInstruction('工程任务 · 委派 Codex', 'subagent_codex') }])
  h.agent.session.append('user/message', instruction, { surfaceOp: 'append' })
  expect(h.view()?.route?.delegation).toMatchObject({ injected: true, called: false })
  const again = await step([h.message])
  expect(again.kind === 'enter' && again.messages).toHaveLength(1)
  h.agent.session.append('tool/call', { turn: 1, step: 0, callId: ToolCallId('other'), name: 'read', arguments: '{}' })
  expect(h.view()?.route?.delegation?.called).toBe(false)
  h.agent.session.append('tool/call', { turn: 1, step: 0, callId: ToolCallId('delegate'), name: 'subagent_codex', arguments: '{}' })
  expect(h.view()?.route?.delegation?.called).toBe(true)
  const rejected = await dispatch.waterfall('agent/pre-step', { messages: [h.message], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'reject', reason: 'stop' } as never))
  expect(rejected.kind).toBe('reject')
})

it('falls back to the tool name when the delegation route has no label and rejects incomplete delegate config', async () => {
  const h = await setup()
  const create = (candidates: System3EntryRoutingConfig['candidates']) => createSystem3EntryRouter(h.ctx, { ...config, candidates },
    { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(() => create([{ id: 'codex', description: 'x', delegate: { provider: ' ', tool: 'subagent_codex' }, executionDomain: 'local', dataClasses: ['workspace'] }])).toThrow('subagent provider and tool')
  expect(() => create([
    { id: 'a', description: 'x', delegate: { provider: 'codex', tool: 't' }, executionDomain: 'local', dataClasses: ['workspace'] },
    { id: 'b', description: 'y', delegate: { provider: 'codex', tool: 'u' }, executionDomain: 'local', dataClasses: ['workspace'] },
  ])).toThrow('distinct')
  installSystem3Delegation(h.ctx)
  const unlabeled = createSystem3EntryRouter(h.ctx, { ...config, candidates: [config.candidates[0]!,
    { id: 'codex', description: 'x', delegate: { provider: 'codex', tool: 'subagent_codex' }, executionDomain: 'local', dataClasses: ['workspace'] }] },
  { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  await unlabeled.route({ agent: h.agent, requestId: h.requestId, baseline: { provider: 'mock', model: 'fast' }, message: h.message }, new AbortController().signal)
  const result = await agentEvents(h.ctx, h.agent).waterfall('agent/pre-step', { messages: [h.message], turn: 1, step: 0,
    signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages: [h.message] }))
  expect(result.kind === 'enter' && result.messages.at(-1)?.content).toEqual([{ type: 'text', text: delegationInstruction('subagent_codex', 'subagent_codex') }])
})
