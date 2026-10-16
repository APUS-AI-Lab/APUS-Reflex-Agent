import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import Jev, { JevConfigurationError, type JevRequest, type JevResponse } from '../../apus-dsh-jev-plugin/src/index.ts'
import { choiceVerdict, noulVerdict, runSystem3Decision, validateSystem3DecisionSettings, type System3DecisionContext,
  type System3DecisionSettings, type System3DecisionSpec } from '../src/decision-kernel.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

/** Acts only on a confident yes. */
const spec: System3DecisionSpec<{ text: string }, 'act' | 'skip'> = {
  id: 'test.act', version: 2, fallback: 'skip',
  state: input => ({ text: input.text }),
  questions: () => ({ act: { type: 'noul', instructions: 'Should the harness act?' } }),
  decide: (response, settings) => {
    const answer = response.answers.act
    const verdict = answer?.type === 'noul' ? noulVerdict(answer.noul, settings) : 'unsure'
    return verdict === 'yes' ? 'act' : verdict === 'no' ? 'skip' : 'unsure'
  },
}
const ACTIVE: System3DecisionSettings = { mode: 'active', yes: 0.8, no: 0.2, deadlineMs: 5000 }
const SHARED: System3DecisionContext = { policy: { mode: 'local-only' }, options: { routeId: 'jev', executionDomain: 'local', effort: 'low' },
  dataClasses: ['workspace'] }

async function setup(noul = 0.9) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const response: JevResponse = { model: 'jev-test', answers: { act: { type: 'noul', noul } } }
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async (request: JevRequest) => ({ kind: 'ok', spec: ctx.jev.resolve(request), response }))
  const agent = await ctx.agentLoop.create(SessionId('kernel'), { provider: 'none', model: 'none' })
  const run = (settings: System3DecisionSettings = ACTIVE, shared: System3DecisionContext = SHARED,
    signal = new AbortController().signal) =>
    runSystem3Decision(ctx, shared, spec, settings, agent, { text: 'rename the file' }, signal)
  const judgements = () => agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement').map(event => event.data)
  return { ctx, decide, run, judgements }
}

it('acts on a confident judgement only when active, and records the full request either way', async () => {
  const active = await setup(0.95)
  const result = await active.run()
  expect(result.outcome).toBe('act')
  expect(result.judgement).toMatchObject({ version: 1, decision: 'test.act', decisionVersion: 2, mode: 'active', outcome: 'act',
    reason: 'judged', applied: true, response: { answers: { act: { noul: 0.95 } } } })
  expect(result.judgement.request).toMatchObject({ state: { text: 'rename the file' }, effort: 'low' })
  expect(active.judgements()).toEqual([result.judgement])

  const shadow = await setup(0.95)
  const watched = await shadow.run({ ...ACTIVE, mode: 'shadow' })
  expect(watched.outcome).toBe('skip')
  expect(watched.judgement).toMatchObject({ mode: 'shadow', outcome: 'act', reason: 'judged', applied: false })
})

it.each([
  [{ mode: 'local-only' } as const, 'local' as const, 'judged'],
  [{ mode: 'controlled', approvedRemoteIds: [], approvedRemoteDataClasses: [] } as const, 'local' as const, 'judged'],
  [{ mode: 'local-only' } as const, 'network' as const, 'privacy-denied'],
])('admits by the selected provider\'s declared domain under %j: %s provider is %s', async (policy, executionDomain, reason) => {
  const harness = await setup(0.95)
  vi.spyOn(harness.ctx.jev, 'providerInfo').mockReturnValue({ id: 'system-one', model: 'jev-test', endpoint: 'http://localhost:1', executionDomain })
  // The configured default is the opposite of the provider's declaration, so only the provider's domain can explain the result.
  const fallback = executionDomain === 'local' ? 'network' : 'local'
  const result = await harness.run(ACTIVE, { ...SHARED, policy, options: { ...SHARED.options, executionDomain: fallback } })
  expect(result.judgement.reason).toBe(reason)
  expect(harness.decide).toHaveBeenCalledTimes(reason === 'judged' ? 1 : 0)
})

it('falls back when the answer sits between the thresholds, and asks nothing when off', async () => {
  const unsure = await setup(0.5)
  expect((await unsure.run()).judgement).toMatchObject({ outcome: 'skip', reason: 'unsure', applied: false })
  const no = await setup(0.1)
  expect((await no.run()).judgement).toMatchObject({ outcome: 'skip', reason: 'judged', applied: true })

  const off = await setup()
  expect((await off.run({ ...ACTIVE, mode: 'off' })).judgement).toMatchObject({ reason: 'off', request: null, applied: false })
  expect(off.decide).not.toHaveBeenCalled()
})

it('falls back and records why when privacy, Jev, or the deadline prevent a judgement', async () => {
  const denied = await setup()
  const result = await denied.run(ACTIVE, { ...SHARED, options: { ...SHARED.options, executionDomain: 'network' } })
  expect(result).toMatchObject({ outcome: 'skip', judgement: { reason: 'privacy-denied', request: null } })

  const absent = await setup()
  const get = absent.ctx.get.bind(absent.ctx)
  vi.spyOn(absent.ctx, 'get').mockImplementation(((name: string) => {
    const value: unknown = name === 'jev' ? undefined : Reflect.apply(get, absent.ctx, [name])
    return value
  }) as Context['get'])
  expect((await absent.run()).judgement).toMatchObject({ reason: 'provider-unavailable', request: null })

  const failing = await setup()
  failing.decide.mockImplementation(async request => ({ kind: 'unknown', spec: failing.ctx.jev.resolve(request), failure: { code: 'http', message: 'down' } }))
  expect((await failing.run()).judgement).toMatchObject({ reason: 'http', outcome: 'skip', applied: false })

  const slow = await setup()
  slow.decide.mockImplementation((_request, signal) => new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
  }))
  expect((await slow.run({ ...ACTIVE, deadlineMs: 5 })).judgement).toMatchObject({ reason: 'deadline', outcome: 'skip' })
})

it('rejects without a record when the caller cancels or Jev throws unexpectedly', async () => {
  const cancelled = await setup()
  cancelled.decide.mockImplementation((_request, signal) => new Promise<never>((_resolve, reject) => {
    if (signal?.aborted === true) reject(signal.reason as Error)
    signal?.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
  }))
  const turn = new AbortController()
  const pending = cancelled.run(ACTIVE, SHARED, turn.signal)
  turn.abort(new Error('stopped'))
  await expect(pending).rejects.toThrow('stopped')

  const broken = await setup()
  broken.decide.mockRejectedValue(new Error('protocol'))
  await expect(broken.run()).rejects.toThrow('protocol')
  const resolver = await setup()
  vi.spyOn(resolver.ctx.jev, 'resolve').mockImplementation(() => { throw new Error('resolver bug') })
  await expect(resolver.run()).rejects.toThrow('resolver bug')
  expect([...cancelled.judgements(), ...broken.judgements(), ...resolver.judgements()]).toEqual([])
})

it('answers like a missing provider when Jev is switched off during dispatch', async () => {
  const h = await setup()
  h.decide.mockRejectedValue(new JevConfigurationError('switched off'))
  expect((await h.run()).judgement).toMatchObject({ reason: 'provider-unavailable', outcome: 'skip', applied: false })
})

it('does not ask the provider or record when the caller is already cancelled', async () => {
  const h = await setup()
  const abort = new AbortController()
  abort.abort(new Error('cancelled before review'))
  await expect(h.run(ACTIVE, SHARED, abort.signal)).rejects.toThrow('cancelled before review')
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.judgements()).toEqual([])
})

it.each(['success', 'unknown'] as const)('rejects a late %s without a record after caller cancellation', async (outcome) => {
  const h = await setup()
  const entered = Promise.withResolvers<undefined>()
  const held = Promise.withResolvers<undefined>()
  h.decide.mockImplementation(async (request) => {
    entered.resolve(undefined)
    await held.promise
    const resolved = h.ctx.jev.resolve(request)
    return outcome === 'unknown' ? { kind: 'unknown', spec: resolved, failure: { code: 'transport', message: 'late failure' } }
      : { kind: 'ok', spec: resolved, response: { model: 'jev-test', answers: { act: { type: 'noul', noul: 0.9 } } } }
  })
  const abort = new AbortController()
  const pending = h.run(ACTIVE, SHARED, abort.signal)
  const rejected = expect(pending).rejects.toThrow('cancelled during review')
  try {
    await entered.promise
    abort.abort(new Error('cancelled during review'))
  } finally {
    held.resolve(undefined)
    await rejected
  }
  expect(h.judgements()).toEqual([])
})

it('reads yes/no answers against the thresholds and rejects unusable settings', () => {
  expect([0.8, 0.79, 0.2, 0.21].map(p => noulVerdict(p, ACTIVE))).toEqual(['yes', 'unsure', 'no', 'unsure'])
  const choice = (probabilities: Record<string, number>) => ({ type: 'choice' as const, choice: 'switch', probabilities, confidence: 0 })
  expect(choiceVerdict(choice({ switch: 0.8 }), ACTIVE)).toBe('switch')
  expect(choiceVerdict(choice({ switch: 0.79 }), ACTIVE)).toBeUndefined()
  expect(choiceVerdict(choice({ other: 0.9 }), ACTIVE)).toBeUndefined()
  expect(choiceVerdict({ type: 'noul', noul: 0.9 }, ACTIVE)).toBeUndefined()
  expect(choiceVerdict(undefined, ACTIVE)).toBeUndefined()
  expect(() => { validateSystem3DecisionSettings('x', ACTIVE) }).not.toThrow()
  for (const thresholds of [{ yes: 0.5, no: 0.5 }, { yes: 1.2, no: 0.1 }, { yes: 0.8, no: -0.1 }]) {
    expect(() => { validateSystem3DecisionSettings('x', { ...ACTIVE, ...thresholds }) }).toThrow('decisions.x thresholds must satisfy 0 <= no < yes <= 1')
  }
  for (const deadlineMs of [0, 1.5, 2 ** 31]) {
    expect(() => { validateSystem3DecisionSettings('x', { ...ACTIVE, deadlineMs }) }).toThrow('decisions.x deadlineMs must be a positive integer within the timer limit')
  }
})
