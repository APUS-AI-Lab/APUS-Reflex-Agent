import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionPromptRouter } from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Jev, { JevConfigurationError } from '../../apus-dsh-jev-plugin/src/index.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSystem3EntryRouter, type System3EntryModelCandidate, type System3EntryRoutingConfig } from '../src/entry-routing.ts'
import System3 from '../src/index.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const config: System3EntryRoutingConfig = {
  candidates: [{ id: 'fast', description: '简单任务', provider: 'mock', model: 'fast', executionDomain: 'local', dataClasses: ['workspace'] }],
  sessionDataClasses: ['workspace'], minConfidence: 0.8, maxInputBytes: 4000,
}
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(options: Partial<System3EntryRoutingConfig> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([])
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({ provider, id: model, name: model, context: { contextWindow: 10000 }, inputModalities: ['text'] }))
  vi.spyOn(adapter, 'listModels').mockResolvedValue([{ provider: 'mock', id: 'fast', name: 'Fast' }])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async request => ({
    kind: 'ok', spec: ctx.jev.resolve(request), response: { model: 'jev-test', answers: { route: {
      type: 'choice', choice: 'fast', confidence: 0.9, probabilities: { fast: 0.9, abstain: 0.1 },
    } } },
  }))
  const agent = await ctx.agentLoop.create(SessionId('entry-test'), { provider: 'mock', model: 'fast' })
  const request = {
    agent, requestId: brandString<SessionRequestId>('request-1'), baseline: { provider: 'mock', model: 'baseline' },
    message: createUserMessage({ content: [{ type: 'text', text: '解释这个概念' }], source: { kind: 'user' } }),
  }
  const router = createSystem3EntryRouter(ctx, { ...config, ...options }, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  return { ctx, decide, request, router, adapter, signal: new AbortController().signal }
}

it('records the exact Jev request and returns a suggestion without changing the agent', async () => {
  const { decide, request, router, signal } = await setup()
  expect(await router.route(request, signal)).toEqual({ provider: 'mock', model: 'fast' })
  const receipt = request.agent.session.snapshotEvents().find(event => event.type === 'system3/entry-decision')
  expect(receipt?.data).toMatchObject({ requestId: request.requestId, outcome: 'selected', request: decide.mock.calls[0]?.[0], candidate: { id: 'fast' } })
  expect(receipt?.data).not.toHaveProperty('candidate.label')
  expect(request.agent.session.deriveMessages()).toEqual([])
})

it('does not truncate oversized input or call Jev', async () => {
  const { decide, request, router, signal } = await setup({ maxInputBytes: 1 })
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'input-too-large', request: null })
})

it('rejects pre-aborted decisions before calling a provider', async () => {
  const { decide, request, router } = await setup()
  const abort = new AbortController()
  abort.abort(new Error('cancel entry'))
  await expect(router.route(request, abort.signal)).rejects.toThrow('cancel entry')
  expect(decide).not.toHaveBeenCalled()
})

it.each(['abstain', 'low-confidence', 'timeout'] as const)('keeps the baseline on %s', async (outcome) => {
  const { ctx, decide, request, router, signal } = await setup()
  decide.mockImplementation(async query => outcome === 'timeout'
    ? { kind: 'unknown', spec: ctx.jev.resolve(query), failure: { code: 'timeout', message: 'timeout' } }
    : { kind: 'ok', spec: ctx.jev.resolve(query), response: { model: 'jev-test', answers: { route: {
      type: 'choice', choice: outcome === 'abstain' ? 'abstain' : 'fast', confidence: outcome === 'abstain' ? 1 : 0.4,
      probabilities: { fast: outcome === 'abstain' ? 0 : 0.4, abstain: outcome === 'abstain' ? 1 : 0.6 },
    } } } })
  expect(await router.route(request, signal)).toBeUndefined()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome })
})

describe('retainOnAbstain', () => {
  const twoRoutes: Partial<System3EntryRoutingConfig> = { retainOnAbstain: true, candidates: [
    ...config.candidates,
    { id: 'deep', description: '复杂任务', label: '复杂任务 · Deep', provider: 'mock', model: 'deep', executionDomain: 'local', dataClasses: ['workspace'] },
  ] }
  const answer = (ctx: Context, choice: string, confidence: number) => async (query: Parameters<Context['jev']['decide']>[0]) => ({
    kind: 'ok' as const, spec: ctx.jev.resolve(query), response: { model: 'jev-test', answers: { route: {
      type: 'choice' as const, choice, confidence, probabilities: { [choice]: confidence },
    } } },
  })
  async function retaining(options: Partial<System3EntryRoutingConfig> = twoRoutes) {
    const harness = await setup(options)
    harness.ctx.sessionProjections.register(system3RuntimeProjection)
    const next = (id: string) => ({ ...harness.request, requestId: brandString<SessionRequestId>(id) })
    return { ...harness, next }
  }

  it.each([['abstain', 1], ['deep', 0.4]] as const)('continues the earlier route when Jev answers %s', async (choice, confidence) => {
    const { ctx, decide, next, router, signal, request } = await retaining()
    decide.mockImplementationOnce(answer(ctx, 'deep', 0.95))
    expect(await router.route(next('first'), signal)).toEqual({ provider: 'mock', model: 'deep' })
    decide.mockImplementation(answer(ctx, choice, confidence))
    expect(await router.route(next('follow-up'), signal)).toEqual({ provider: 'mock', model: 'deep' })
    expect(await router.route(next('second-follow-up'), signal)).toEqual({ provider: 'mock', model: 'deep' })
    const receipt = request.agent.session.snapshotEvents().at(-1)?.data
    expect(receipt).toMatchObject({ outcome: choice === 'abstain' ? 'abstain' : 'low-confidence',
      retained: { requestId: 'first', selection: { provider: 'mock', model: 'deep' } }, candidate: { id: 'deep', label: '复杂任务 · Deep' } })
    expect(receipt).not.toHaveProperty('selected')
  })

  it('keeps the baseline when no earlier route exists or the earlier decision chose none', async () => {
    const { ctx, decide, next, router, signal, request } = await retaining()
    decide.mockImplementation(answer(ctx, 'abstain', 1))
    expect(await router.route(next('first'), signal)).toBeUndefined()
    expect(await router.route(next('second'), signal)).toBeUndefined()
    expect(request.agent.session.snapshotEvents().at(-1)?.data).not.toHaveProperty('retained')

  })

  it('keeps the baseline when the earlier route is no longer a candidate', async () => {
    const { ctx, decide, next, router, signal } = await retaining()
    decide.mockImplementationOnce(answer(ctx, 'deep', 0.95))
    expect(await router.route(next('first'), signal)).toEqual({ provider: 'mock', model: 'deep' })
    const narrowed = createSystem3EntryRouter(ctx, { ...config, retainOnAbstain: true }, { mode: 'local-only' },
      { routeId: 'jev', executionDomain: 'local', effort: 'low' })
    decide.mockImplementation(answer(ctx, 'abstain', 1))
    expect(await narrowed.route(next('after-narrowing'), signal)).toBeUndefined()
  })

  it('uses the baseline, not the earlier route, when Jev is unavailable', async () => {
    const { ctx, decide, next, router, signal } = await retaining()
    decide.mockImplementationOnce(answer(ctx, 'deep', 0.95))
    await router.route(next('first'), signal)
    decide.mockImplementation(async query => ({ kind: 'unknown', spec: ctx.jev.resolve(query), failure: { code: 'timeout', message: 'timeout' } }))
    expect(await router.route(next('second'), signal)).toBeUndefined()
  })

  it('requires session projections when enabled', async () => {
    const { ctx, request, signal } = await setup()
    const router = createSystem3EntryRouter(ctx, { ...config, retainOnAbstain: true }, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
    vi.spyOn(ctx, 'get').mockImplementation(((name: string) => name === 'sessionProjections' ? undefined : ctx[name as 'jev']) as Context['get'])
    await expect(router.route(request, signal)).rejects.toThrow('requires sessionProjections')
  })
})

it('requires image input from candidates only once the Session contains an image', async () => {
  const { adapter, ctx, decide, request, router, signal } = await setup()
  ctx.sessionProjections.register(system3RuntimeProjection)
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({ provider, id: model, name: model,
    context: { contextWindow: 10000 }, inputModalities: model === 'baseline' ? ['text', 'image'] : ['text'] }))
  expect(await router.route(request, signal)).toEqual({ provider: 'mock', model: 'fast' })
  request.agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'see' }, { type: 'image', attachment: { attachmentId: brandString<AttachmentId>('image-1'), mediaType: 'image/png', bytes: 4, width: 1, height: 1 } }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  decide.mockClear()
  expect(await router.route({ ...request, requestId: brandString<SessionRequestId>('after-image') }, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'no-candidates' })
})

it('blocks the remote Jev before I/O even when its URL is loopback', async () => {
  const { ctx, decide, request, signal } = await setup()
  const router = createSystem3EntryRouter(ctx, config, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'network', effort: 'low' })
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'privacy-denied', request: null })
})

it('admits the selected provider by its declared domain, pins the request to it, and records that domain', async () => {
  const { ctx, decide, request, signal } = await setup()
  const info = { id: 'reflex-local', model: 'local', endpoint: 'http://127.0.0.1:2', executionDomain: 'local' as const }
  ctx.effect(() => ctx.jev.register({ info, decide: async () => { throw new Error('the decide spy answers') } }))
  const providerInfo = vi.spyOn(ctx.jev, 'providerInfo').mockReturnValue(info)
  const router = createSystem3EntryRouter(ctx, config, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'network', effort: 'low' })
  expect(await router.route(request, signal)).toEqual({ provider: 'mock', model: 'fast' })
  expect(decide.mock.calls[0]?.[0]).toMatchObject({ providerId: 'reflex-local', model: 'local' })
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'selected', executionDomain: 'local' })

  providerInfo.mockReturnValue({ ...info, id: 'gateway', executionDomain: 'network' })
  const fallbackLocal = createSystem3EntryRouter(ctx, config, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(await fallbackLocal.route(request, signal)).toBeUndefined()
  expect(decide).toHaveBeenCalledTimes(1)
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'privacy-denied', executionDomain: 'network' })
})

it('excludes generation routes that cannot receive the classified session', async () => {
  const { decide, request, router, signal } = await setup({ sessionDataClasses: ['secret'] })
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'no-candidates' })
})

it('does not dispatch a network generation candidate in local-only mode', async () => {
  const { decide, request, router, signal } = await setup({ candidates: config.candidates.map(candidate => ({ ...candidate, executionDomain: 'network' })) })
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
})

it('requires valid and distinct configured candidates', async () => {
  const { ctx } = await setup()
  const create = (settings: System3EntryRoutingConfig) => createSystem3EntryRouter(ctx, settings, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(() => create({ ...config, candidates: [] })).toThrow('1-254')
  expect(() => create({ ...config, candidates: [...config.candidates, ...config.candidates] })).toThrow('unique')
  expect(() => create({ ...config, candidates: config.candidates.map(candidate => ({ ...candidate, id: 'abstain' })) })).toThrow('abstain')
  expect(() => create({ ...config, candidates: [...config.candidates, ...config.candidates.map(candidate => ({ ...candidate, id: 'same-model' }))] })).toThrow('distinct')
  expect(() => create({ ...config, minConfidence: 2 })).toThrow('minConfidence')
  expect(() => create({ ...config, maxInputBytes: 0 })).toThrow('maxInputBytes')
  expect(() => create({ ...config, candidates: config.candidates.map(candidate => ({ ...candidate, description: ' ' })) })).toThrow('must not be empty')
  expect(() => create({ ...config, candidates: [{ ...config.candidates[0]!, provider: ' ' } as System3EntryModelCandidate] })).toThrow('must not be empty')
  expect(() => create({ ...config, candidates: config.candidates.map(candidate => ({ ...candidate, dataClasses: [] })) })).toThrow('declare dataClasses')
  expect(() => create({ ...config, sessionDataClasses: [] })).toThrow('classify session data')
})

it('rejects an unsupported reasoning effort before sending task text to Jev', async () => {
  const { decide, request, router, signal } = await setup({ candidates: config.candidates.map(candidate => ({ ...candidate, reasoningEffort: 'unsupported' })) })
  await expect(router.route(request, signal)).rejects.toThrow('unsupported reasoning effort')
  expect(decide).not.toHaveBeenCalled()
})

it('records cancellation even when a provider resolves successfully after cancellation', async () => {
  const { ctx, decide, request, router } = await setup()
  const abort = new AbortController()
  decide.mockImplementation(async (query) => {
    abort.abort(new Error('cancelled during decision'))
    return { kind: 'ok', spec: ctx.jev.resolve(query), response: { model: 'jev-test', answers: { route: {
      type: 'choice', choice: 'fast', confidence: 1, probabilities: { fast: 1, abstain: 0 },
    } } } }
  })
  await expect(router.route(request, abort.signal)).rejects.toThrow('cancelled during decision')
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'cancelled' })
})

it('retains the baseline if every candidate has a smaller or unknown context capacity', async () => {
  const { adapter, decide, request, router, signal } = await setup()
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({ provider, id: model, name: model, context: { contextWindow: model === 'baseline' ? 10000 : 5000 }, inputModalities: ['text'] }))
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
})

it('admits the actual session data classes rather than the candidate capacity', async () => {
  const { ctx, decide, request, signal } = await setup()
  const router = createSystem3EntryRouter(ctx, {
    ...config, sessionDataClasses: ['public'],
    candidates: config.candidates.map(candidate => ({ ...candidate, dataClasses: ['public', 'sensitive'], executionDomain: 'network' })),
  }, { mode: 'controlled', approvedRemoteIds: ['fast'], approvedRemoteDataClasses: ['public'] }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(await router.route(request, signal)).toEqual({ provider: 'mock', model: 'fast' })
  expect(decide).toHaveBeenCalledTimes(1)
})

it('registers only when opted in and removes the exact registration on plugin disposal', async () => {
  const { ctx } = await setup()
  class Controller extends Service {
    router: SessionPromptRouter | undefined
    constructor(context: Context) { super(context, 'sessionController') }
    registerPromptRouter(router: SessionPromptRouter): () => void {
      this.router = router
      return () => { if (this.router === router) this.router = undefined }
    }
  }
  await ctx.plugin(Controller)
  const controller = ctx.get('sessionController')
  const disabled = await ctx.plugin(System3)
  expect(controller).not.toHaveProperty('router', expect.anything())
  await disabled.dispose()
  const enabled = await ctx.plugin(System3, { entryRouting: {
    minConfidence: config.minConfidence, maxInputBytes: config.maxInputBytes, sessionDataClasses: [...config.sessionDataClasses],
    candidates: config.candidates.map(candidate => ({ ...candidate, dataClasses: [...candidate.dataClasses] })),
  } })
  await enabled.await()
  expect(controller).toHaveProperty('router.route', expect.any(Function))
  await enabled.dispose()
  expect(controller).not.toHaveProperty('router', expect.anything())
})

it('does not dispatch an empty input', async () => {
  const { decide, request, router, signal } = await setup()
  const message = createUserMessage({ content: [], source: { kind: 'user' } })
  expect(await router.route({ ...request, message }, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
})

it('bounds the complete UTF-8 request, including candidate descriptions, without truncation', async () => {
  const { ctx, decide, request, router, signal } = await setup()
  await router.route(request, signal)
  const bytes = Buffer.byteLength(JSON.stringify(decide.mock.calls[0]?.[0]), 'utf8')
  decide.mockClear()
  const limited = (maxInputBytes: number) => createSystem3EntryRouter(ctx, { ...config, maxInputBytes },
    { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(await limited(bytes - 1).route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
  expect(await limited(bytes).route(request, signal)).toEqual({ provider: 'mock', model: 'fast' })
  expect(decide).toHaveBeenCalledTimes(1)
})

it('keeps the baseline when model capabilities are unknown', async () => {
  const { adapter, decide, request, router, signal } = await setup()
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({ provider, id: model, name: model }))
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
})

it('returns a safe unavailable receipt when Jev is not mounted', async () => {
  const { request, signal } = await setup()
  const ctx = new Context()
  contexts.push(ctx)
  const router = createSystem3EntryRouter(ctx, config, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(await router.route(request, signal)).toBeUndefined()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'provider-unavailable', request: null })
})

it('keeps the baseline when Jev is switched off during dispatch', async () => {
  const { decide, request, router, signal } = await setup()
  decide.mockRejectedValue(new JevConfigurationError('switched off'))
  expect(await router.route(request, signal)).toBeUndefined()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'provider-unavailable' })
})

it('rejects entry routing without a native model resolver', async () => {
  const { request, signal } = await setup()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const router = createSystem3EntryRouter(ctx, config, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  await expect(router.route(request, signal)).rejects.toThrow('requires the llm service')
})

it('preserves a supported candidate effort in the recommendation and receipt', async () => {
  const { adapter, request, router, signal } = await setup({ candidates: config.candidates.map(candidate => ({ ...candidate, reasoningEffort: 'high' })) })
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({
    provider, id: model, name: model, context: { contextWindow: 10000 }, inputModalities: ['text'],
    reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] },
  }))
  expect(await router.route(request, signal)).toEqual({ provider: 'mock', model: 'fast', reasoningEffort: 'high' })
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ selected: { reasoningEffort: 'high' } })
})

it.each(['unknown', 'missing-image'] as const)('excludes candidates with %s input capabilities', async (capability) => {
  const { adapter, decide, request, router, signal } = await setup()
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({
    provider, id: model, name: model, context: { contextWindow: 10000 },
    ...(model === 'baseline' ? { inputModalities: ['text', 'image'] as const }
      : capability === 'unknown' ? {} : { inputModalities: ['text'] as const }),
  }))
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
})

it('does not recommend a provider answer outside the admitted candidates', async () => {
  const { ctx, decide, request, router, signal } = await setup()
  decide.mockImplementation(async query => ({ kind: 'ok', spec: ctx.jev.resolve(query), response: {
    model: 'jev-test', answers: { route: { type: 'choice', choice: 'unavailable', confidence: 1, probabilities: { unavailable: 1 } } },
  } }))
  expect(await router.route(request, signal)).toBeUndefined()
  expect(request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'invalid-response' })
})


it('requires explicit legal baseline metadata when the current route is outside the candidate catalog', async () => {
  const h = await setup()
  expect(() => h.router.validateBaseline?.(h.request)).toThrow('baseline route')
  const allowed = createSystem3EntryRouter(h.ctx, { ...config, baseline: { executionDomain: 'local', dataClasses: ['workspace'] } },
    { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(() => allowed.validateBaseline?.(h.request)).not.toThrow()
  const denied = createSystem3EntryRouter(h.ctx, { ...config, baseline: { executionDomain: 'network', dataClasses: ['workspace'] } },
    { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  expect(() => denied.validateBaseline?.(h.request)).toThrow('baseline route')
})

it('rejects entry deadline overflow before registration', async () => {
  const h = await setup()
  expect(() => createSystem3EntryRouter(h.ctx, { ...config, deadlineMs: 2 ** 31 }, { mode: 'local-only' },
    { routeId: 'jev', executionDomain: 'local', effort: 'low' })).toThrow('timer range')
})


it('records a total-deadline timeout distinctly from user cancellation', async () => {
  const h = await setup(); const abort = new AbortController()
  abort.abort(new DOMException('deadline', 'TimeoutError'))
  await expect(h.router.route(h.request, abort.signal)).rejects.toThrow('deadline')
  expect(h.request.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'timeout' })
})

it('takes the baseline route without recording or asking Jev while front-loaded decisions are off', async () => {
  const { ctx, decide, request, signal } = await setup()
  let on = false
  const router = createSystem3EntryRouter(ctx, config, { mode: 'local-only' },
    { routeId: 'jev', executionDomain: 'local', effort: 'low', frontLoaded: () => on })
  expect(await router.route(request, signal)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
  expect(request.agent.session.snapshotEvents().filter(event => event.type.startsWith('system3/'))).toEqual([])
  on = true
  expect(await router.route(request, signal)).toEqual({ provider: 'mock', model: 'fast' })
})
