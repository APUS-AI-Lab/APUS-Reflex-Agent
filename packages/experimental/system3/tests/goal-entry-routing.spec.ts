import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type SubagentResult } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { afterEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { installGoalEntryRouting } from '../src/goal-entry-routing.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'
import type { System3EntryRoutingConfig } from '../src/entry-routing.ts'
import type {} from '../src/goal-entry-state.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const config: System3EntryRoutingConfig = { sessionDataClasses: ['workspace'], minConfidence: 0.8, maxInputBytes: 10000,
  candidates: [{ id: 'codex', description: 'Code repair', delegate: { provider: 'codex', tool: 'subagent_codex' },
    explicitPatterns: ['codex'], executionDomain: 'local', dataClasses: ['workspace'] }] }
async function setup(options: {
  objective?: string
  available?: boolean
  settings?: Partial<System3EntryRoutingConfig>
  delayed?: boolean
} = {}) {
  const ctx = new Context(); contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(GoalService); await ctx.plugin(SubagentRuntime, {})
  ctx.sessionProjections.register(system3RuntimeProjection)
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'goal-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async request => ({ kind: 'ok', spec: ctx.jev.resolve(request),
    response: { model: 'goal-test', answers: { route: { type: 'choice', choice: 'codex', confidence: 0.99, probabilities: { codex: 0.99 } } } } }))
  const completed: SubagentResult = { output: [{ type: 'text', text: 'Independent verification passed.' }], stopReason: 'completed' }
  const settled = Promise.withResolvers<SubagentResult>()
  const started = Promise.withResolvers<boolean>()
  const dispose = vi.fn(async () => {})
  const start = vi.fn(async (request: Parameters<Parameters<typeof ctx.subagents.registerProvider>[0]['start']>[0]) => {
    request.signal.addEventListener('abort', () => { settled.resolve({ output: [], stopReason: 'aborted' }) }, { once: true })
    started.resolve(true)
    return { id: SessionId('codex-child'), localAgent: undefined, result: options.delayed === true ? settled.promise : Promise.resolve(completed), dispose }
  })
  if (options.available !== false) {
    ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false,
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, start })
    ctx.tools.register(defineTool({ name: 'subagent_codex', description: 'Delegate', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'unused' }))
  }
  installGoalEntryRouting(ctx, { ...config, ...options.settings }, { mode: 'local-only' }, { routeId: 'reflex', executionDomain: 'local' })
  const agent = await ctx.agentLoop.create(SessionId('goal-routing'), { provider: 'mock', model: 'mock' })
  let goal = ctx.goals.create(agent, { objective: options.objective ?? 'Use Codex to repair ledger.py and preserve the tests.' })
  const message = () => createUserMessage({ content: [{ type: 'text', text: goal.objective }], source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round: 1 } })
  const step = (messages: UserMessage[] = [message()], signal = new AbortController().signal) => agentEvents(ctx, agent).waterfall('agent/pre-step',
    { messages, turn: 1, step: 1, signal }, async () => ({ kind: 'enter', messages }))
  const events = () => agent.session.snapshotEvents().filter(event => event.type === 'system3/goal-entry').map(event => event.data)
  const edit = () => { goal = ctx.goals.edit(agent, { id: goal.id, revision: goal.revision }, { objective: 'Use Codex for the updated task.' }) }
  return { ctx, agent, goal, step, message, events, edit, start, decide, settled, started: started.promise, dispose }
}

it('executes explicit Codex before the model step and records attributed results exactly once', async () => {
  const h = await setup()
  const result = await h.step()
  expect(h.decide).toHaveBeenCalledOnce(); expect(h.start).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(h.decide.mock.calls[0]?.[0].questions)).toContain('不论任务大小')
  expect(result.kind).toBe('enter')
  if (result.kind !== 'enter') throw new Error('Expected model entry')
  expect(result.messages.at(-1)?.source).toEqual({ kind: 'system3-goal-delegation' })
  expect(JSON.stringify(result.messages.at(-1))).toContain('Independent verification passed')
  expect(h.events().map(event => event.state)).toEqual(['reserved', 'started', 'completed'])
  await h.step(); expect(h.start).toHaveBeenCalledTimes(1); expect(h.dispose).toHaveBeenCalledOnce()
})
it('lets Reflex select an ordinary Goal using its actual objective', async () => {
  const h = await setup({ objective: 'Repair ledger.py.', settings: { deadlineMs: 1000 } }); await h.step()
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ objective: 'Repair ledger.py.' })
  expect(h.start).toHaveBeenCalledOnce()
})
it.each([{ available: false }, { settings: { maxInputBytes: 1 } }])('abstains when delegation cannot be evaluated: %o', async (options) => {
  const h = await setup(options); expect((await h.step()).kind).toBe('enter')
  expect(h.ctx.goals.get(h.agent)?.phase).toBe('active'); expect(h.start).not.toHaveBeenCalled()
})
it('abstains once for an ordinary Goal when no delegate is available', async () => {
  const h = await setup({ objective: 'Explain CSV.', available: false }); expect((await h.step()).kind).toBe('enter')
  await h.step(); expect(h.events().map(event => event.state)).toEqual(['abstained'])
})
it('preserves a new human input and cancels stale delegated execution', async () => {
  const h = await setup({ delayed: true }); const result = h.step(); await h.started
  const human = createUserMessage({ content: [{ type: 'text', text: 'Stop and use Chinese headers.' }], source: { kind: 'user' } })
  h.agent.inbox.append('next-turn', human)
  expect((await result).kind).toBe('reject')
  expect([...h.agent.inbox.nextStep, ...h.agent.inbox.nextTurn].some(message => message.id === human.id)).toBe(true)
  expect(h.events().at(-1)?.state).toBe('interrupted')
})
it('fences a changed Goal revision and permits its independent new decision', async () => {
  const h = await setup({ delayed: true }); const result = h.step(); await h.started; h.edit()
  expect((await result).kind).toBe('reject'); expect(h.ctx.goals.get(h.agent)?.revision).toBe(2)
  expect(h.events().at(-1)?.goalRevision).toBe(1)
})
it('propagates parent cancellation after cleaning the native run', async () => {
  const h = await setup({ delayed: true }); const abort = new AbortController(); const result = h.step(undefined, abort.signal)
  await h.started; abort.abort(); await expect(result).rejects.toThrow(); expect(h.dispose).toHaveBeenCalledOnce()
})
it('restores reservations without repeating external side effects and makes interruption visible', async () => {
  const h = await setup()
  h.agent.session.append('system3/goal-entry', { version: 1, goalId: h.goal.id, goalRevision: h.goal.revision, round: 1,
    state: 'reserved', candidateId: 'codex', provider: 'codex', childSessionId: null, reason: null, input: 'Reserved request', output: null })
  const restored = Session.fromRestore(h.agent.session.id, h.agent.session.snapshotEvents(), h.agent.session.header, SessionLogOffset(0), 'shared-frozen')
  expect(h.ctx.sessionProjections.stateOf(restored, 'goalEntryRouting')).toEqual(h.ctx.sessionProjections.stateOf(h.agent.session, 'goalEntryRouting'))
  expect((await h.step()).kind).toBe('reject'); expect(h.start).not.toHaveBeenCalled()
  expect(h.ctx.goals.get(h.agent)?.phase).toBe('blocked'); expect(h.events().at(-1)?.state).toBe('interrupted')
})
it('does not treat human messages as automatic Goal authority', async () => {
  const h = await setup(); const human = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  await h.step([human]); await h.step([h.message(), human]); expect(h.start).not.toHaveBeenCalled()
})

it('retains the baseline after an uncertain Reflex answer and never starts a delegate', async () => {
  const h = await setup({ objective: 'Explain this task.' })
  h.decide.mockImplementation(async request => ({ kind: 'ok', spec: h.ctx.jev.resolve(request),
    response: { model: 'goal-test', answers: { route: { type: 'choice', choice: 'abstain', probabilities: { abstain: 1 }, confidence: 1 } } } }))
  expect((await h.step()).kind).toBe('enter'); expect(h.start).not.toHaveBeenCalled(); expect(h.events().at(-1)?.state).toBe('abstained')
})
it('blocks a failed native run and exposes its result without pretending completion', async () => {
  const h = await setup({ delayed: true }); const next = h.step(); await h.started
  h.settled.resolve({ output: [{ type: 'text', text: 'Provider disconnected.' }], stopReason: 'error' })
  const result = await next
  expect(h.events().at(-1)?.state).toBe('failed'); expect(h.ctx.goals.get(h.agent)?.phase).toBe('blocked')
  expect(JSON.stringify(result)).toContain('Provider disconnected.')
})
it.each([new Error('transport'), 'transport'])('records provider startup failure and blocks rather than retrying every round: %s', async (error) => {
  const h = await setup(); h.start.mockRejectedValueOnce(error)
  expect((await h.step()).kind).toBe('reject'); expect(h.events().at(-1)?.state).toBe('failed')
  expect(h.ctx.goals.get(h.agent)?.phase).toBe('blocked'); await h.step(); expect(h.start).toHaveBeenCalledOnce()
})
it('refuses explicit delegation outside the allowed privacy domain', async () => {
  const h = await setup({ settings: { candidates: [{ ...config.candidates[0]!, executionDomain: 'network' }] } })
  expect((await h.step()).kind).toBe('enter'); expect(h.start).not.toHaveBeenCalled()
})
it('does not restart an interrupted delegation until the user resumes a new Goal revision', async () => {
  const h = await setup({ delayed: true }); const first = h.step(); await h.started
  h.settled.resolve({ output: [], stopReason: 'error' }); await first
  const blocked = h.ctx.goals.get(h.agent)!
  h.ctx.goals.resume(h.agent, { id: blocked.id, revision: blocked.revision })
  const resumed = h.ctx.goals.get(h.agent)!
  const message = createUserMessage({ source: { kind: 'goal', goalId: resumed.id, revision: resumed.revision, round: 2 }, content: [{ type: 'text', text: resumed.objective }] })
  await h.step([message]); expect(h.start).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(h.start.mock.calls[1]?.[0].prompt)).toContain('do not blindly repeat')
})
it('skips stale Goal messages and gives queued human messages the next admission', async () => {
  const h = await setup(); const old = h.message(); h.edit(); await h.step([old]); expect(h.start).not.toHaveBeenCalled()
  h.agent.inbox.append('next-turn', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'new requirement' }] }))
  expect((await h.step()).kind).toBe('reject'); expect(h.start).not.toHaveBeenCalled()
})

it('a real running Agent preserves human input while its Goal pre-step awaits the native child', async () => {
  const h = await setup({ delayed: true })
  const adapter = new MockAdapter([textResponse('Acknowledged the new requirement.'), textResponse('Continuing.')])
  h.ctx.llm.registerAdapter(['mock'], adapter)
  h.agent.followup(h.message()); await h.started
  expect(adapter.requests).toHaveLength(0)
  const human = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Stop the old work; report what changed.' }] })
  h.agent.followup(human); await h.agent.whenIdle()
  expect(h.ctx.goals.get(h.agent)?.phase).toBe('blocked')
  expect(adapter.requests).toHaveLength(0)
  expect(h.agent.inbox.nextTurn.some(message => message.id === human.id)).toBe(true)
  h.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue with my queued request.' }] }))
  await h.agent.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('Stop the old work; report what changed.')
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.id === human.id)).toBe(true)
  expect(h.start).toHaveBeenCalledOnce(); expect(h.dispose).toHaveBeenCalledOnce()
})
it('carries confirmed Goal constraints into the delegated request', async () => {
  const h = await setup()
  const requirement = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Preserve test_ledger.py.' }] })
  h.agent.session.append('system3/task-frame', { version: 1, goal: { goalId: h.goal.id, text: h.goal.objective },
    items: [{ messageId: requirement.id, text: 'Preserve test_ledger.py.' }] })
  await h.step(); expect(JSON.stringify(h.start.mock.calls[0]?.[0].prompt)).toContain('- Preserve test_ledger.py.')
})
it('falls back once when an ordinary Goal exceeds its input budget', async () => {
  const h = await setup({ objective: 'Repair files.', settings: { maxInputBytes: 1 } })
  expect((await h.step()).kind).toBe('enter'); expect(h.start).not.toHaveBeenCalled()
})
it('rejects a candidate removed while Reflex is deciding', async () => {
  const h = await setup({ objective: 'Repair files.' })
  h.decide.mockImplementation(async (request) => {
    vi.spyOn(h.ctx.tools, 'get').mockReturnValue(undefined)
    return { kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'goal-test', answers: {
      route: { type: 'choice', choice: 'codex', confidence: 1, probabilities: { codex: 1 } },
    } } }
  })
  expect((await h.step()).kind).toBe('reject'); expect(h.start).not.toHaveBeenCalled(); expect(h.events().at(-1)?.reason).toBe('route-removed')
})
it('supports candidates without explicit patterns and the existing default decision deadline', async () => {
  const settings = config
  const candidate = config.candidates[0]!
  if (candidate.delegate === undefined) throw new Error('Expected delegate')
  const { explicitPatterns: _patterns, ...implicit } = candidate
  const h = await setup({ objective: 'Repair files.', settings: { ...settings, candidates: [implicit] } })
  await h.step(); expect(h.start).toHaveBeenCalledOnce()
})
it('cancels live work when Goal activation is withdrawn', async () => {
  const h = await setup({ delayed: true }); const work = h.step(); await h.started
  h.ctx.goals.disarm(h.agent); expect((await work).kind).toBe('reject'); expect(h.events().at(-1)?.state).toBe('interrupted')
})
it('respects an existing pre-step rejection', async () => {
  const h = await setup()
  h.ctx.on('agent/pre-step', async (_payload, next) => { await next(); return { kind: 'reject' } })
  expect((await h.step()).kind).toBe('reject'); expect(h.start).not.toHaveBeenCalled()
})
it('does not cancel a live delegation when another Goal loses activation', async () => {
  const h = await setup({ delayed: true }); const work = h.step(); await h.started
  const other = await h.ctx.agentLoop.create(SessionId('other-goal'), { provider: 'mock', model: 'mock' })
  h.ctx.goals.create(other, { objective: 'Unrelated goal' }); h.ctx.goals.disarm(other)
  expect(h.start.mock.calls[0]?.[0].signal.aborted).toBe(false)
  h.settled.resolve({ output: [], stopReason: 'completed' }); expect((await work).kind).toBe('enter')
})
it('plugin teardown cancels and releases an outstanding native delegation', async () => {
  const h = await setup({ delayed: true }); const work = h.step(); await h.started
  const released = Promise.withResolvers<undefined>()
  const disposing = Promise.withResolvers<undefined>()
  h.dispose.mockImplementation(async () => { disposing.resolve(undefined); await released.promise })
  let finished = false
  const disposal = h.ctx.fiber.dispose().then(() => { finished = true })
  await disposing.promise
  expect(finished).toBe(false)
  released.resolve(undefined)
  await disposal
  expect(h.dispose).toHaveBeenCalledOnce()
  expect((await work).kind).toBe('reject')
})
it('recovers completed output after an admission crash without replaying provider side effects', async () => {
  const h = await setup(); const first = await h.step()
  expect(first.kind).toBe('enter')
  const replay = await h.step()
  if (replay.kind !== 'enter') throw new Error('Expected recovered result')
  expect(JSON.stringify(replay.messages)).toContain('[Reflex recovered Goal result]')
  const recovered = replay.messages.at(-1)!
  h.ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Verified archived result.')]))
  h.agent.followup(recovered); await h.agent.whenIdle()
  const next = await h.step()
  expect(next.kind === 'enter' && next.messages).toHaveLength(1)
  expect(h.start).toHaveBeenCalledOnce()
  expect(h.start.mock.calls[0]?.[0].prompt).toEqual([{ type: 'text', text: h.events().at(-1)?.input }])
})

it.each(['不要用 Codex，直接解释原理', '分析文档中的“用 Codex”这句话'])('requires semantic authorization for a keyword match: %s', async (objective) => {
  const h = await setup({ objective })
  h.decide.mockImplementation(async request => ({ kind: 'ok', spec: h.ctx.jev.resolve(request),
    response: { model: 'goal-test', answers: { route: { type: 'choice', choice: 'abstain', confidence: 1, probabilities: { abstain: 1 } } } } }))
  expect((await h.step()).kind).toBe('enter')
  expect(h.decide).toHaveBeenCalledOnce()
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ objective })
  expect(h.start).not.toHaveBeenCalled()
})
it('waits for a suspended inner admission on disposal and never starts after it returns', async () => {
  const h = await setup()
  const entered = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  h.ctx.on('agent/pre-step', async (_args, next) => { entered.resolve(undefined); await released.promise; return next() })
  const work = h.step()
  await entered.promise
  let finished = false
  const disposal = h.ctx.fiber.dispose().then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  released.resolve(undefined)
  await disposal
  expect((await work).kind).toBe('reject')
  expect(h.start).not.toHaveBeenCalled()
  expect(h.decide).not.toHaveBeenCalled()
})
