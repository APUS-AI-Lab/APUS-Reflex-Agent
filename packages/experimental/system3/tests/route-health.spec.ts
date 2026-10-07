import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { createSystem3EntryRouter, type System3EntryRoutingConfig } from '../src/entry-routing.ts'
import { installSystem3RouteHealth, type System3RouteHealth, type System3RouteHealthConfig } from '../src/route-health.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const contexts: Context[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }) })
afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** How the next request to a model behaves: first-token delay, generation time, and output tokens, or a failure. */
type Behaviour = { readonly firstMs: number; readonly generateMs: number; readonly outputTokens: number } | 'fail' | 'abort'

/** An adapter whose responses move the fake clock, so the measured times are exact. */
class TimedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(readonly behaviour: Map<string, Behaviour>) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 10000 }, inputModalities: ['text'] })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const plan = this.behaviour.get(options.model) ?? { firstMs: 100, generateMs: 1000, outputTokens: 50 }
    await Promise.resolve()
    if (plan === 'fail') throw new Error('relay unavailable')
    if (plan === 'abort') {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'aborted' } } }
      return
    }
    vi.setSystemTime(Date.now() + plan.firstMs)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    vi.setSystemTime(Date.now() + plan.generateMs)
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: plan.outputTokens } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const HEALTH: System3RouteHealthConfig = {
  window: 4, sampleTtlMs: 60_000, minSamples: 2, maxFirstTokenMs: 5000, minTokensPerSecond: 20, minOutputTokens: 20,
  maxErrorRate: 0.5, probe: false,
}

async function setup(config: Partial<System3RouteHealthConfig> = {}, routes = [{ provider: 'relay', model: 'fast' }]) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const behaviour = new Map<string, Behaviour>()
  const adapter = new TimedAdapter(behaviour)
  ctx.effect(() => ctx.llm.registerAdapter(['relay'], adapter))
  const health = installSystem3RouteHealth(ctx, { ...HEALTH, ...config }, routes)
  const call = async (model: string, behave?: Behaviour): Promise<void> => {
    if (behave !== undefined) behaviour.set(model, behave)
    for await (const _chunk of ctx.llm.stream({ provider: 'relay', model, messages: [] })) { /* drain */ }
  }
  return { ctx, health, adapter, call, behaviour }
}

it('marks a route slow from median first-token latency and output rate, and failing from its error rate', async () => {
  const h = await setup()
  await h.call('fast', { firstMs: 200, generateMs: 1000, outputTokens: 100 })
  expect(h.health.statusOf('relay', 'fast')).toEqual({ samples: 1, firstTokenMs: null, tokensPerSecond: null, errorRate: null })
  await h.call('fast')
  expect(h.health.statusOf('relay', 'fast')).toEqual({ samples: 2, firstTokenMs: 200, tokensPerSecond: 100, errorRate: 0 })

  for (const _ of [1, 2]) await h.call('first', { firstMs: 6000, generateMs: 1000, outputTokens: 100 })
  expect(h.health.statusOf('relay', 'first')).toMatchObject({ firstTokenMs: 6000, degraded: 'slow-first-token' })

  // Two rates of 18 and one short answer whose rate does not count.
  await h.call('rate', { firstMs: 100, generateMs: 5000, outputTokens: 90 })
  await h.call('rate', { firstMs: 100, generateMs: 1000, outputTokens: 5 })
  await h.call('rate', { firstMs: 100, generateMs: 5000, outputTokens: 90 })
  expect(h.health.statusOf('relay', 'rate')).toMatchObject({ samples: 3, tokensPerSecond: 18, degraded: 'slow-output' })

  await h.call('flaky', 'fail')
  await h.call('flaky', { firstMs: 100, generateMs: 1000, outputTokens: 100 })
  await h.call('flaky', 'fail')
  expect(h.health.statusOf('relay', 'flaky')).toMatchObject({ samples: 3, errorRate: 2 / 3, firstTokenMs: null, degraded: 'errors' })
})

it('keeps only the latest window, forgets stale samples, and ignores cancelled streams', async () => {
  const h = await setup()
  for (const _ of [1, 2]) await h.call('fast', { firstMs: 9000, generateMs: 1000, outputTokens: 100 })
  expect(h.health.statusOf('relay', 'fast').degraded).toBe('slow-first-token')
  for (const _ of [1, 2, 3, 4]) await h.call('fast', { firstMs: 100, generateMs: 1000, outputTokens: 100 })
  expect(h.health.statusOf('relay', 'fast')).toEqual({ samples: 4, firstTokenMs: 100, tokensPerSecond: 100, errorRate: 0 })
  await h.call('fast', 'abort')
  expect(h.health.statusOf('relay', 'fast').samples).toBe(4)
  vi.setSystemTime(Date.now() + 61_000)
  expect(h.health.statusOf('relay', 'fast')).toEqual({ samples: 0, firstTokenMs: null, tokensPerSecond: null, errorRate: null })
})

it('probes only idle routes with a fixed small request and stops probing on disposal', async () => {
  const h = await setup({ probe: { idleMs: 1000, maxTokens: 16 } }, [{ provider: 'relay', model: 'fast' }, { provider: 'relay', model: 'busy' }])
  // Instant responses keep the fake clock on the probe interval.
  h.behaviour.set('fast', { firstMs: 0, generateMs: 0, outputTokens: 1 })
  h.behaviour.set('busy', 'fail')
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.adapter.requests.map(request => [request.model, request.maxTokens])).toEqual([['fast', 16], ['busy', 16]])
  expect(JSON.stringify(h.adapter.requests[0]?.messages)).toContain('Reply with OK.')
  expect(h.health.statusOf('relay', 'busy').samples).toBe(1)
  await vi.advanceTimersByTimeAsync(500)
  await h.call('busy', { firstMs: 0, generateMs: 0, outputTokens: 1 })
  await vi.advanceTimersByTimeAsync(500)
  // `busy` had a request 500 ms ago, so only `fast` is probed again.
  expect(h.adapter.requests.map(request => request.model)).toEqual(['fast', 'busy', 'busy', 'fast'])
  await h.ctx.fiber.dispose()
  await vi.advanceTimersByTimeAsync(5000)
  expect(h.adapter.requests).toHaveLength(4)
})

it('skips probes while the llm service is absent, and rejects invalid settings at load', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  installSystem3RouteHealth(ctx, { ...HEALTH, probe: { idleMs: 1000, maxTokens: 16 } }, [{ provider: 'relay', model: 'fast' }])
  await vi.advanceTimersByTimeAsync(1000)
  // A probe that middleware rejects records no sample and is retried at the next interval.
  const h = await setup({ probe: { idleMs: 1000, maxTokens: 16 } })
  h.ctx.on('llm/stream', () => { throw new Error('middleware refused') })
  await vi.advanceTimersByTimeAsync(2000)
  expect(h.adapter.requests).toEqual([])
  expect(h.health.statusOf('relay', 'fast').samples).toBe(0)
  expect(() => installSystem3RouteHealth(ctx, { ...HEALTH, window: 0 }, [])).toThrow('routeHealth window must be a positive integer')
  expect(() => installSystem3RouteHealth(ctx, { ...HEALTH, maxErrorRate: 1 }, [])).toThrow('routeHealth maxErrorRate must be at least 0 and below 1')
})

const ROUTING: System3EntryRoutingConfig = {
  candidates: [
    { id: 'flash', description: '简单任务', label: 'Flash', provider: 'relay', model: 'flash', executionDomain: 'local', dataClasses: ['workspace'] },
    { id: 'expert', description: '复杂任务', provider: 'relay', model: 'expert', executionDomain: 'local', dataClasses: ['workspace'] },
    { id: 'codex', description: '大型工程', delegate: { provider: 'codex', tool: 'subagent_codex' }, executionDomain: 'local', dataClasses: ['workspace'] },
  ],
  sessionDataClasses: ['workspace'], minConfidence: 0.5, maxInputBytes: 8000,
}

async function routing(health: System3RouteHealth, delegation = true) {
  const h = await setup()
  await h.ctx.plugin(AgentLoop, { agents: [] })
  await h.ctx.plugin(SubagentRuntime, {})
  h.ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false,
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    start: () => Promise.reject(new Error('not started in this test')) })
  if (delegation) h.ctx.tools.register(defineTool({ name: 'subagent_codex', description: 'Delegate.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => Promise.resolve('') }))
  h.ctx.sessionProjections.register(system3RuntimeProjection)
  await h.ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(h.ctx.jev, 'decide').mockImplementation(async request => ({
    kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'jev-test', answers: { route: {
      type: 'choice', choice: 'flash', confidence: 0.9, probabilities: { flash: 0.9 } } } },
  }))
  const agent = await h.ctx.agentLoop.create(SessionId('route-health'), { provider: 'relay', model: 'flash' })
  const router = createSystem3EntryRouter(h.ctx, ROUTING, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' }, health)
  const route = async () => await router.route({ agent, requestId: brandString<SessionRequestId>('r1'), baseline: { provider: 'relay', model: 'flash' },
    message: createUserMessage({ content: [{ type: 'text', text: '证明这个定理' }], source: { kind: 'user' } }) }, new AbortController().signal)
  const receipt = () => agent.session.snapshotEvents().findLast(event => event.type === 'system3/entry-decision')?.data
  return { ...h, decide, agent, route, receipt }
}

it('leaves a degraded model candidate out of the choice and records why', async () => {
  const h = await routing({ statusOf: (_provider, model) => model === 'expert'
    ? { samples: 3, firstTokenMs: 900, tokensPerSecond: 12, errorRate: 0, degraded: 'slow-output' }
    : { samples: 3, firstTokenMs: 300, tokensPerSecond: 80, errorRate: 0 } })
  await h.route()
  expect(Object.keys(h.decide.mock.calls[0]![0].questions.route!.criteria!)).toEqual(['flash', 'codex', 'abstain'])
  expect(h.receipt()).toMatchObject({ candidateIds: ['flash', 'codex'], avoided: [{ id: 'expert', reason: 'slow-output' }] })
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.entry?.avoided).toEqual([{ label: 'expert', reason: 'slow-output' }])
})

it('never avoids a delegation, and offers every candidate when all of them would be avoided', async () => {
  const h = await routing({ statusOf: () => ({ samples: 3, firstTokenMs: 9000, tokensPerSecond: 50, errorRate: 0, degraded: 'slow-first-token' }) })
  await h.route()
  expect(h.receipt()).toMatchObject({ candidateIds: ['codex'], avoided: [{ id: 'flash', label: 'Flash' }, { id: 'expert' }] })
  const all = await routing({ statusOf: () => ({ samples: 3, firstTokenMs: 9000, tokensPerSecond: 50, errorRate: 0, degraded: 'slow-first-token' }) }, false)
  await all.route()
  expect(all.receipt()).toMatchObject({ candidateIds: ['flash', 'expert'] })
  expect(all.receipt()).not.toHaveProperty('avoided')
})

it('keeps a labelled degraded route label for the person when real samples degrade it', async () => {
  const h = await routing({ statusOf: (_provider, model) => model === 'flash'
    ? { samples: 2, firstTokenMs: null, tokensPerSecond: null, errorRate: 1, degraded: 'errors' }
    : { samples: 0, firstTokenMs: null, tokensPerSecond: null, errorRate: null } })
  h.decide.mockImplementation(async request => ({ kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'jev-test',
    answers: { route: { type: 'choice', choice: 'expert', confidence: 0.9, probabilities: { expert: 0.9 } } } } }))
  expect(await h.route()).toEqual({ provider: 'relay', model: 'expert' })
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.entry?.avoided).toEqual([{ label: 'Flash', reason: 'errors' }])
})
