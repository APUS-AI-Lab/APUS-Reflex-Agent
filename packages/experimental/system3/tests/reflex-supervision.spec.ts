import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection'
import { createUserMessage, type MessageId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import GoalService from '@deepseek-ai/dsh-goal'
import type { JevRequest, JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type ResolvedSubagentStartRequest, type SubagentEvidence, type SubagentEvidenceTurnId,
  type SubagentNativeThreadId, type SubagentRecoveryState, type SubagentResult, type SubagentRun, type SubagentRunId, type SubagentActivityInfo } from '@deepseek-ai/dsh-subagent'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { installReflexRecovery } from '../src/reflex-recovery.ts'
import { reflexSupervisionStateProjection } from '../src/reflex-supervision-state.ts'
import { installReflexSupervision, validateReflexSupervision, type ReflexSupervisionConfig } from '../src/reflex-supervision.ts'

const contexts: Context[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(10000) })
afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})
const CONFIG: ReflexSupervisionConfig = { mode: 'active', yes: 0.8, no: 0.2, deadlineMs: 1000,
  sessionDataClasses: ['workspace'], intervalMs: 10, stallMs: 100, repeatedFailures: 3, evidenceLimit: 16,
  cooldownMs: 40, maxInterventions: 2, feedbackMs: 20 }
const EVIDENCE: SubagentEvidence = { turnId: brandString<SubagentEvidenceTurnId>('turn-1'), kind: 'command', operation: 'verification',
  operationDigest: 'test-a', resultDigest: 'same-failure', outcome: 'failed' }
const choice = (action: string): JevResponse => ({ model: 'reflex-test', answers: { action: { type: 'choice', choice: action,
  probabilities: { [action]: 0.99 }, confidence: 0.99 } } })

async function setup(options: { config?: Partial<ReflexSupervisionConfig>
  goal?: boolean
  approvedClasses?: readonly ('public' | 'workspace')[]
  steer?: SubagentRun['steer']
  recoveryState?: SubagentRun['recoveryState']
  recover?: SubagentRun['recover']
  decide?: (request: JevRequest) => Promise<JevResponse> } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(GoalService)
  await ctx.plugin(SubagentRuntime, {})
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'reflex-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async (request: JevRequest) => ({ kind: 'ok', spec: ctx.jev.resolve(request),
    response: options.decide === undefined ? request.questions.improved === undefined ? choice('diagnose')
      : { model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } } : await options.decide(request) }))
  let ownerContext: Context | undefined
  const fiber = await ctx.plugin({ name: 'reflex-supervision-fixture', inject: ['sessionProjections'], apply(owner: Context) {
    ownerContext = owner
    installReflexSupervision(owner, { config: { ...CONFIG, ...options.config },
      policy: { mode: 'controlled', approvedRemoteIds: ['reflex'], approvedRemoteDataClasses: options.approvedClasses ?? ['workspace'] },
      options: { routeId: 'reflex', executionDomain: 'network', effort: 'low' } })
  } })
  if (ownerContext === undefined) throw new Error('supervision fixture was not installed')
  const agent = await ctx.agentLoop.create(SessionId('supervised'), { provider: 'mock', model: 'mock' })
  if (options.goal !== false) ctx.goals.create(agent, { objective: 'Fix the failing test and verify the result.' })
  let request: ResolvedSubagentStartRequest | undefined
  let settled = Promise.withResolvers<SubagentResult>()
  const steer = vi.fn(options.steer ?? (async () => {}))
  ctx.subagents.registerProvider({ name: 'codex', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false, async start(input) {
      request = input
      settled = Promise.withResolvers<SubagentResult>()
      return { id: SessionId('child'), localAgent: undefined, result: settled.promise, async dispose() {}, steer,
        ...options.recoveryState === undefined ? {} : { recoveryState: options.recoveryState },
        ...options.recover === undefined ? {} : { recover: options.recover } }
    } })
  const start = () => ctx.subagents.start('codex', { parent: agent, prompt: [{ type: 'text', text: 'Fix the test' }], signal: new AbortController().signal })
  const report = (evidence: SubagentEvidence = EVIDENCE) => { request?.reportEvidence?.(evidence) }
  const failures = () => { report(); report(); report() }
  const events = () => agent.session.snapshotEvents().flatMap(event => event.type === 'system3/reflex-supervision' ? [event.data] : [])
  const activity = (phase: 'started' | 'completed', kind: 'command' | 'reasoning' = 'command') => { request?.reportActivity({ kind, phase }) }
  return { ctx, owner: ownerContext, agent, decide, steer, fiber, start, report, failures, events, activity, end: () => { settled.resolve({ output: [], stopReason: 'completed' }) } }
}

it('delivers attributed advice after repeated failures, then independently records demonstrated improvement', async () => {
  const h = await setup()
  const run = await h.start()
  h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledTimes(1)
  expect(h.steer.mock.calls[0]?.[0]?.[0]).toMatchObject({ type: 'text' })
  expect(JSON.stringify(h.steer.mock.calls[0]?.[0])).toContain('[Reflex 自动监督 / reflex-supervision]')
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted'])
  const events = h.agent.session.snapshotEvents()
  expect(events.filter(event => event.type === 'subagent/steer')).toHaveLength(0)
  expect(events.filter(event => event.type === 'subagent/supervision-steer')).toHaveLength(1)
  expect(events.filter(event => event.type === 'system3/reflex-evidence')).toHaveLength(3)
  h.report({ ...EVIDENCE, resultDigest: 'passed', outcome: 'succeeded' })
  await vi.advanceTimersByTimeAsync(20)
  expect(h.events().at(-1)?.state).toBe('improved')
  expect(h.decide).toHaveBeenCalledTimes(2)
  h.end()
  expect((await run.result).steers).toBeUndefined()
})

it('observes a long run with missing evidence but never sends an unsupported correction', async () => {
  for (const goal of [false, true]) {
    const h = await setup({ goal })
    await h.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.steer).not.toHaveBeenCalled()
    if (goal) {
      expect(h.decide).toHaveBeenCalledOnce()
      expect(h.events().every(event => event.state === 'inconclusive')).toBe(true)
      expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ evidenceMissing: true, elapsedRunMs: 100 })
    } else expect(h.decide).not.toHaveBeenCalled()
  }
})

it('fences a judgement when execution evidence changes while Reflex is responding', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: () => answer.promise })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, resultDigest: 'passed', outcome: 'succeeded' })
  answer.resolve(choice('diagnose'))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.steer).not.toHaveBeenCalled()
  expect(h.events().at(-1)?.state).toBe('stale')
})

it('fences an outstanding judgement when a person steers the run', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: () => answer.promise })
  let runId = ''
  h.ctx.on('subagent/start', (info) => { runId = info.runId })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  await h.ctx.subagents.steerByParent({ runId: runId as never, parentSessionId: h.agent.session.id, text: 'wait for the build' }, new AbortController().signal)
  answer.resolve(choice('diagnose'))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.steer).toHaveBeenCalledTimes(1)
  expect(h.events().some(event => event.state === 'accepted')).toBe(false)
})

it('cancels old Goal decisions and never delivers to a completed run', async () => {
  for (const change of ['pause', 'edit', 'end'] as const) {
    const answer = Promise.withResolvers<JevResponse>()
    const h = await setup({ decide: () => answer.promise })
    const run = await h.start(); h.failures()
    await vi.advanceTimersByTimeAsync(10)
    const goal = h.ctx.goals.get(h.agent)!
    if (change === 'pause') h.ctx.goals.pause(h.agent, goal)
    else if (change === 'edit') h.ctx.goals.edit(h.agent, goal, { objective: 'A changed objective' })
    else { h.end(); await run.result }
    answer.resolve(choice('diagnose'))
    await vi.advanceTimersByTimeAsync(10)
    expect(h.steer).not.toHaveBeenCalled()
  }
})

it.each([
  ['goal-edit', 'accepted'], ['goal-edit', 'unknown'],
  ['human-input', 'accepted'], ['human-input', 'unknown'],
] as const)('keeps delayed %s %s receipts on the dispatched Goal without reviving obsolete feedback', async (change, receipt) => {
  const acknowledgement = Promise.withResolvers<undefined>()
  const h = await setup({ steer: () => acknowledgement.promise })
  await h.start(); h.failures()
  try {
    await vi.advanceTimersByTimeAsync(10)
    expect(h.steer).toHaveBeenCalledOnce()
    const goal = h.ctx.goals.get(h.agent)
    if (goal === undefined) throw new Error('fixture Goal is missing')
    if (change === 'goal-edit') h.ctx.goals.edit(h.agent, goal, { objective: 'Preserve the source and verify the corrected result.' })
    else {
      h.agent.inbox.splice('next-step', 0, 0, [createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Preserve the source file.' }] })])
      h.agent.inbox.clear()
    }
    if (receipt === 'accepted') acknowledgement.resolve(undefined)
    else acknowledgement.reject(new Error('acknowledgement lost after dispatch'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.events().map(event => ({ state: event.state, goalId: event.goalId, goalRevision: event.goalRevision }))).toEqual([
      { state: 'intent', goalId: goal.id, goalRevision: goal.revision },
      { state: receipt, goalId: goal.id, goalRevision: goal.revision },
    ])
    h.report({ ...EVIDENCE, outcome: 'succeeded', resultDigest: 'passed-after-new-authority' })
    await vi.advanceTimersByTimeAsync(CONFIG.feedbackMs)
    expect(h.decide.mock.calls.some(([request]) => request.questions.improved !== undefined)).toBe(false)
    expect(h.events().some(event => event.state === 'improved')).toBe(false)
  } finally {
    acknowledgement.resolve(undefined)
    h.end()
  }
})

it('retains native progress received while a supervision acknowledgement is pending', async () => {
  const acknowledgement = Promise.withResolvers<undefined>()
  const h = await setup({ steer: () => acknowledgement.promise })
  await h.start(); h.failures()
  try {
    await vi.advanceTimersByTimeAsync(10)
    expect(h.steer).toHaveBeenCalledOnce()
    h.report({ ...EVIDENCE, outcome: 'succeeded', resultDigest: 'passed-during-acknowledgement' })
    acknowledgement.resolve(undefined)
    await vi.advanceTimersByTimeAsync(CONFIG.feedbackMs)
    expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted', 'improved'])
    const feedbackRequest = h.decide.mock.calls.find(([request]) => request.questions.improved !== undefined)?.[0]
    expect(feedbackRequest?.state).toMatchObject({ after: [{ resultDigest: 'passed-during-acknowledgement', outcome: 'succeeded' }] })
  } finally {
    acknowledgement.resolve(undefined)
    h.end()
  }
})

it('bounds unconfirmed deliveries across runs and does not mistake a lost acknowledgement for success', async () => {
  const h = await setup({ steer: async () => { throw new Error('lost acknowledgement') } })
  const first = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'unknown'])
  await vi.advanceTimersByTimeAsync(20)
  expect(h.steer).toHaveBeenCalledTimes(1)
  h.end(); await first.result
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(40)
  expect(h.steer).toHaveBeenCalledTimes(2)
  h.report()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).toHaveBeenCalledTimes(2)
  expect(h.events().at(-1)?.state).toBe('limit')
  h.report()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.events().filter(event => event.state === 'limit')).toHaveLength(1)
})

it('shadow mode records the judgement without sending advice', async () => {
  const h = await setup({ config: { mode: 'shadow' } })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide).toHaveBeenCalledOnce()
  expect(h.steer).not.toHaveBeenCalled()
})

it('disposes timers and stops publishing new evidence', async () => {
  const h = await setup()
  await h.start()
  await h.fiber.dispose()
  h.failures()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'system3/reflex-evidence')).toBe(false)
})

it('rejects nonpositive and out-of-range deployment limits', () => {
  expect(() => { validateReflexSupervision({ ...CONFIG, intervalMs: 0 }) }).toThrow('intervalMs')
  expect(() => { validateReflexSupervision({ ...CONFIG, maxInterventions: 1.5 }) }).toThrow('maxInterventions')
  expect(() => { validateReflexSupervision({ ...CONFIG, feedbackMs: 2 ** 32 }) }).toThrow('feedbackMs')
})


it('evaluates accepted advice when the run ends before the feedback timer', async () => {
  const h = await setup()
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded', resultDigest: 'passed' })
  h.end(); await run.result
  await vi.advanceTimersByTimeAsync(0)
  expect(h.events().at(-1)?.state).toBe('improved')
})

it('does not count ordinary successful commands or file changes as verified progress', async () => {
  const h = await setup({ decide: async () => choice('observe') })
  await h.start()
  h.report({ ...EVIDENCE, operation: 'command', outcome: 'succeeded', operationDigest: 'echo' })
  h.report({ ...EVIDENCE, kind: 'file-change', operation: 'file-change', outcome: 'succeeded', operationDigest: 'edit' })
  await vi.advanceTimersByTimeAsync(110)
  expect(h.decide).toHaveBeenCalled()
  expect(h.steer).not.toHaveBeenCalled()
})

it('a successful verification prevents stale failures from triggering another adjustment', async () => {
  const h = await setup()
  await h.start(); h.failures()
  h.report({ ...EVIDENCE, outcome: 'succeeded', resultDigest: 'passed' })
  await vi.advanceTimersByTimeAsync(90)
  expect(h.decide).not.toHaveBeenCalled()
})

it('keeps observing a revised active Goal while discarding evidence of the previous revision', async () => {
  const h = await setup()
  await h.start(); h.failures()
  const goal = h.ctx.goals.get(h.agent)!
  h.ctx.goals.edit(h.agent, goal, { objective: 'New goal' })
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).not.toHaveBeenCalled()
  h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledOnce()
  expect(h.events().at(-1)?.goalRevision).toBe(2)
})

it('does not send another uncertain delivery until new execution evidence arrives', async () => {
  const h = await setup({ steer: async () => { throw new Error('connection lost') } })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.steer).toHaveBeenCalledOnce()
  h.report()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledTimes(2)
})

it('keeps a low-confidence Reflex answer observational', async () => {
  const h = await setup({ decide: async () => ({ model: 'reflex-test', answers: { action: {
    type: 'choice', choice: 'diagnose', probabilities: { diagnose: 0.5, observe: 0.5 }, confidence: 0.5,
  } } }) })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).not.toHaveBeenCalled()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'system3/judgement' && event.data.reason === 'unsure')).toBe(true)
})

it('keeps observing ineffective advice without sending another adjustment', async () => {
  const h = await setup({ config: { maxInterventions: 1 }, decide: async request => request.questions.improved === undefined
    ? choice('diagnose') : { model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.01 } } } })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.failures()
  await vi.advanceTimersByTimeAsync(50)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted', 'unchanged'])
  h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted', 'unchanged', 'unchanged'])
  expect(h.steer).toHaveBeenCalledOnce()
  expect(h.ctx.goals.get(h.agent)?.phase).toBe('active')
})


it('does not steer fresh diagnostic and file-change work even when Reflex overstates a stall', async () => {
  const h = await setup()
  await h.start()
  h.report({ ...EVIDENCE, operation: 'diagnostic', outcome: 'succeeded', operationDigest: 'read' })
  h.report({ ...EVIDENCE, kind: 'file-change', operation: 'file-change', outcome: 'succeeded', operationDigest: 'edit' })
  await vi.advanceTimersByTimeAsync(110)
  expect(h.decide).toHaveBeenCalled()
  expect(h.steer).not.toHaveBeenCalled()
  expect(h.events().at(-1)?.state).toBe('inconclusive')
})

it('replays bounded evidence and Goal delivery reservations after session restoration', async () => {
  const h = await setup({ config: { evidenceLimit: 3 } })
  await h.start()
  h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded', resultDigest: 'passed' })
  const restored = Session.fromRestore(h.agent.session.id, h.agent.session.snapshotEvents(), h.agent.session.header,
    SessionLogOffset(0), 'shared-frozen')
  const live = h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexSupervision')
  const replayed = h.ctx.sessionProjections.stateOf(restored, 'reflexSupervision')
  expect(replayed).toEqual(live)
  expect(replayed?.evidence).toHaveLength(3)
  expect(Object.values(replayed?.budgets ?? {}).map(budget => budget.actions)).toEqual([['diagnose']])
})

it('does not label a successful read as improvement when Reflex is overconfident', async () => {
  const h = await setup()
  await h.start()
  h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, operation: 'diagnostic', outcome: 'succeeded', operationDigest: 'read-source', resultDigest: 'source' })
  await vi.advanceTimersByTimeAsync(20)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted', 'inconclusive'])
})

it('off mode never observes or steers provider work', async () => {
  const h = await setup({ config: { mode: 'off' } })
  const run = await h.start(); h.failures(); h.activity('started')
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.events()).toEqual([])
  h.end(); await run.result
})

it('reports the actual active operation while waiting and clears only matching completions', async () => {
  const h = await setup()
  const run = await h.start()
  h.activity('started'); h.activity('completed', 'reasoning')
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide.mock.calls.at(-1)?.[0].state).toMatchObject({ currentActivity: 'command' })
  h.activity('completed')
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide).toHaveBeenCalledOnce()
  h.report()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide.mock.calls.at(-1)?.[0].state).toMatchObject({ currentActivity: null })
  h.end(); await run.result
  h.activity('started'); h.report()
  expect(h.events().every(event => event.state === 'inconclusive')).toBe(true)
})

it('stops observing when Goal activation is disarmed', async () => {
  const h = await setup()
  await h.start(); h.failures()
  h.ctx.goals.disarm(h.agent)
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.steer).not.toHaveBeenCalled()
})

it('records no-evidence feedback at both elapsed feedback deadline and run termination', async () => {
  for (const terminal of [false, true]) {
    const h = await setup()
    const run = await h.start(); h.failures()
    await vi.advanceTimersByTimeAsync(10)
    if (terminal) { h.end(); await run.result }
    else await vi.advanceTimersByTimeAsync(20)
    expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted', 'inconclusive'])
    expect(h.decide).toHaveBeenCalledOnce()
  }
})

it('does not publish obsolete feedback after a Goal edit while Reflex is responding', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: request => request.questions.improved === undefined ? Promise.resolve(choice('diagnose')) : answer.promise })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded' })
  await vi.advanceTimersByTimeAsync(20)
  h.ctx.goals.edit(h.agent, h.ctx.goals.get(h.agent)!, { objective: 'A replacement task' })
  answer.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.events().some(event => event.state === 'improved')).toBe(false)
  expect(h.events().at(-1)?.state).toBe('inconclusive')
})

it('does not attribute terminal feedback to a replacement Goal revision', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: request => request.questions.improved === undefined ? Promise.resolve(choice('diagnose')) : answer.promise })
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded' })
  h.end(); await run.result
  h.ctx.goals.edit(h.agent, h.ctx.goals.get(h.agent)!, { objective: 'A replacement task' })
  answer.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.events().at(-1)?.state).toBe('inconclusive')
})

it('passes restored Goal requirements and validates projection evidence through its durable schema', async () => {
  const h = await setup()
  const goal = h.ctx.goals.get(h.agent)!
  h.agent.session.append('system3/task-frame', { version: 1, goal: { goalId: goal.id, text: goal.objective },
    items: [{ messageId: brandString<MessageId>('requirement'), text: 'Preserve the original tests' }] })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ requirements: ['Preserve the original tests'] })
  h.report({ turnId: EVIDENCE.turnId, kind: 'command', operation: 'diagnostic', operationDigest: 'read', outcome: 'unknown' })
  const state = h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexSupervision')!
  const schema = reflexSupervisionStateProjection(16).stateSchema
  expect(schema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  expect(schema.safeParse({ ...state, evidence: [{ ...state.evidence[0], outcome: 'not-an-outcome' }] }).success).toBe(false)
  h.agent.session.append('system3/task-frame', { version: 1, goal: { messageId: brandString<MessageId>('user-task'), text: 'A user task' }, items: [] })
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexSupervision')?.requirementsGoalId).toBeNull()
})

it('requires uncertainty rather than improvement for a non-noul or unsure feedback answer', async () => {
  for (const response of [choice('observe'), { model: 'reflex-test', answers: { improved: { type: 'noul' as const, noul: 0.5 } } }]) {
    const h = await setup({ decide: request => Promise.resolve(request.questions.improved === undefined ? choice('diagnose') : response) })
    await h.start(); h.failures()
    await vi.advanceTimersByTimeAsync(10)
    h.report({ ...EVIDENCE, outcome: 'succeeded' })
    await vi.advanceTimersByTimeAsync(20)
    expect(h.events().at(-1)?.state).toBe('inconclusive')
  }
})

it('allows Reflex to diagnose repeated identical successful diagnostics after a stall', async () => {
  const h = await setup()
  await h.start()
  const evidence = { ...EVIDENCE, operation: 'diagnostic' as const, outcome: 'succeeded' as const }
  h.report(evidence); h.report(evidence); h.report(evidence)
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).toHaveBeenCalledOnce()
})

it('contains unexpected provider errors during review and terminal feedback', async () => {
  for (const failure of [new Error('provider unavailable'), 'provider unavailable']) {
    const review = await setup({ decide: async () => { throw failure } })
    await review.start(); review.failures()
    await vi.advanceTimersByTimeAsync(10)
    expect(review.steer).not.toHaveBeenCalled()
    const terminal = await setup({ decide: async (request) => {
      if (request.questions.improved !== undefined) throw failure
      return choice('diagnose')
    } })
    const run = await terminal.start(); terminal.failures()
    await vi.advanceTimersByTimeAsync(10)
    terminal.report({ ...EVIDENCE, outcome: 'succeeded' })
    terminal.end(); await run.result
    await vi.advanceTimersByTimeAsync(0)
    expect(terminal.events().at(-1)?.state).toBe('inconclusive')
  }
})

it.each(['reject', 'resolve'] as const)('awaits cancelled terminal feedback without publishing after disposal when the provider settles with %s', async (settlement) => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: request => request.questions.improved === undefined ? Promise.resolve(choice('diagnose')) : answer.promise })
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded' })
  h.end(); await run.result
  const dispose = h.fiber.dispose()
  if (settlement === 'reject') answer.reject(new Error('cancelled provider request'))
  else answer.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } })
  await dispose
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted'])
})

it('keeps at most one observation outstanding and fences an empty-state observation at Goal edit', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: () => answer.promise })
  await h.start()
  await vi.advanceTimersByTimeAsync(140)
  expect(h.decide).toHaveBeenCalledOnce()
  h.ctx.goals.edit(h.agent, h.ctx.goals.get(h.agent)!, { objective: 'Replacement' })
  answer.resolve(choice('diagnose'))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.events()).toEqual([])
})

it('contains a non-Error transport rejection and never resends the same evidence', async () => {
  const h = await setup({ steer: async () => { throw 'transport disconnected' } })
  await h.start()
  const { resultDigest: _digest, ...withoutResult } = EVIDENCE
  h.report(withoutResult); h.report(withoutResult); h.report(withoutResult)
  await vi.advanceTimersByTimeAsync(100)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'unknown'])
  expect(h.steer).toHaveBeenCalledOnce()
})

it('stops observation of the previous Goal after replacing it with a new one', async () => {
  const h = await setup()
  await h.start(); h.failures()
  h.ctx.goals.complete(h.agent, h.ctx.goals.get(h.agent)!)
  h.ctx.goals.create(h.agent, { objective: 'New Goal' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.steer).not.toHaveBeenCalled()
})

it('ignores unrelated provider lifecycle events and another agent changing its Goal', async () => {
  const h = await setup()
  let observed: SubagentActivityInfo | undefined
  h.ctx.on('subagent/activity', (info) => { observed = info })
  const run = await h.start(); h.activity('started')
  expect(observed).toBeDefined()
  if (observed === undefined) throw new Error('missing activity')
  const foreignRun = brandString<SubagentRunId>('foreign-run')
  h.ctx.emit('subagent/activity', { ...observed, runId: foreignRun })
  h.ctx.emit('subagent/evidence', { ...EVIDENCE, id: SessionId('other-child'), provider: 'other', runId: foreignRun })
  h.ctx.emit('subagent/start', { id: SessionId('other-child'), provider: 'other', runId: foreignRun, local: false, steerable: false })
  const other = await h.ctx.agentLoop.create(SessionId('other-parent'), { provider: 'mock', model: 'mock' })
  h.ctx.goals.create(other, { objective: 'Other Goal' })
  h.ctx.goals.disarm(other)
  other.session.append('subagent/steer', { version: 1, runId: foreignRun, provider: 'codex', text: 'Other session input' })
  h.end(); await run.result
  h.ctx.emit('subagent/end', { id: SessionId('other-child'), provider: 'other', runId: foreignRun, local: false, stopReason: 'completed' })
  expect(h.events()).toEqual([])
})

it('fails closed when the owned projection is unavailable at run admission', async () => {
  const h = await setup()
  const registry = h.ctx.sessionProjections
  const read = registry.stateOf.bind(registry)
  vi.spyOn(registry, 'stateOf').mockImplementation(<K extends keyof SessionProjectionStateMap>(session: Session, key: K) => {
    return key === 'reflexSupervision' ? undefined : read(session, key)
  })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).not.toHaveBeenCalled()
})

it('fences review when the Goal service no longer returns a live Goal', async () => {
  const h = await setup()
  await h.start(); h.failures()
  vi.spyOn(h.ctx.goals, 'get').mockReturnValueOnce(undefined)
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide).not.toHaveBeenCalled()
})

it('records uncertain delivery if the subagent service disappears before transport lookup', async () => {
  let onDecision = (): void => {}
  const h = await setup({ decide: async () => { onDecision(); return choice('diagnose') } })
  onDecision = () => {
    const get = vi.spyOn(h.owner, 'get')
    get.mockReturnValueOnce(h.ctx.goals).mockReturnValueOnce(undefined)
  }
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'unknown'])
  expect(h.steer).not.toHaveBeenCalled()
})

it('does not reschedule a timer when Goal cancellation occurs inside an in-flight decision', async () => {
  let cancel = (): void => {}
  const h = await setup({ decide: async () => { cancel(); return choice('diagnose') } })
  cancel = () => { h.ctx.goals.pause(h.agent, h.ctx.goals.get(h.agent)!) }
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.decide).toHaveBeenCalledOnce()
  expect(h.steer).not.toHaveBeenCalled()
})

it('stops safely when a Goal change notification has no remaining current Goal', async () => {
  const h = await setup()
  await h.start(); h.failures()
  const goal = h.ctx.goals.get(h.agent)!
  vi.spyOn(h.ctx.goals, 'get').mockReturnValueOnce(undefined)
  h.ctx.emit('goal/changed', { agent: h.agent, change: { operation: 'clear', ref: goal } })
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide).not.toHaveBeenCalled()
})

it('retains inconclusive feedback without repolling unchanged evidence and later recognizes verification', async () => {
  const h = await setup()
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  await vi.advanceTimersByTimeAsync(100)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted', 'inconclusive'])
  expect(h.decide).toHaveBeenCalledOnce()
  h.report({ ...EVIDENCE, operation: 'diagnostic', outcome: 'succeeded' })
  await vi.advanceTimersByTimeAsync(10)
  expect(h.events().at(-1)?.state).toBe('inconclusive')
  const reviews = h.decide.mock.calls.length
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide).toHaveBeenCalledTimes(reviews)
  h.report({ ...EVIDENCE, outcome: 'succeeded', resultDigest: 'verified-repair' })
  await vi.advanceTimersByTimeAsync(10)
  expect(h.events().at(-1)?.state).toBe('improved')
  expect(h.steer).toHaveBeenCalledOnce()
})

it.each(['poll', 'termination'] as const)('keeps an unverified adjustment under observation until later Goal-related verification: %s', async (review) => {
  const h = await setup({ config: { semantic: { minObservations: 2 } }, decide: async (request) => {
    if (request.questions.improved === undefined) return semanticChoice('unrelated')
    const state = request.state
    const after = typeof state === 'object' && state !== null && !Array.isArray(state) && 'after' in state && Array.isArray(state.after)
      ? state.after : []
    const verified = after.some(item => typeof item === 'object' && item !== null
      && 'operation' in item && item.operation === 'verification')
    return { model: 'reflex-test', answers: {
      improved: { type: 'noul', noul: verified ? 0.99 : 0.01 },
      relevantVerification: { type: 'noul', noul: verified ? 0.99 : 0.01 },
    } }
  } })
  const run = await h.start()
  h.report(semanticEvidence('marketing/banner.svg', 'one'))
  h.report(semanticEvidence('marketing/campaign.txt', 'two'))
  await vi.advanceTimersByTimeAsync(10)
  h.report(semanticEvidence('finance/invoices.csv', 'repair-started'))
  await vi.advanceTimersByTimeAsync(CONFIG.feedbackMs)
  expect(h.events().at(-1)?.state).toBe('unchanged')
  const reviews = h.decide.mock.calls.length
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide).toHaveBeenCalledTimes(reviews)
  h.report(semanticEvidence('finance/test_remaining.py', 'verified-repair', 'verification'))
  if (review === 'termination') { h.end(); await run.result; await vi.advanceTimersByTimeAsync(0) }
  else await vi.advanceTimersByTimeAsync(CONFIG.intervalMs)
  expect(h.events().at(-1)?.state).toBe('improved')
  expect(h.steer).toHaveBeenCalledOnce()
})

it('retains the existing inconclusive verdict at termination when no newer evidence exists', async () => {
  const h = await setup()
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, operation: 'diagnostic', outcome: 'succeeded' })
  await vi.advanceTimersByTimeAsync(20)
  const reviews = h.decide.mock.calls.length
  h.end(); await run.result
  await vi.advanceTimersByTimeAsync(0)
  expect(h.decide).toHaveBeenCalledTimes(reviews)
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted', 'inconclusive'])
})


const recoveryAnswer = (noul: number): JevResponse => ({ model: 'reflex-test', answers: { recover: { type: 'noul', noul } } })
const RECOVERY = { reassessmentMs: 40, nativeSilenceMs: 30, retryLimit: 3, interruptGraceMs: 20, cooldownMs: 40, maxRecoveries: 1 }
function nativeObservation(): SubagentRecoveryState {
  return { threadId: brandString<SubagentNativeThreadId>('thread-1'), turnId: EVIDENCE.turnId,
    lastActivityAt: Date.now(), retryCount: 0, waiting: false, activeSideEffects: 0 }
}
it('reserves native recovery durably, continues once, and never treats the receipt as verified progress', async () => {
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async (request) => {
    expect(JSON.stringify(request.continuation())).toContain('reflex-supervision')
    return { state: 'continued', threadId: observation.threadId, previousTurnId: observation.turnId,
      turnId: brandString<SubagentEvidenceTurnId>('turn-2') }
  })
  const h = await setup({ config: { recovery: RECOVERY }, recoveryState: () => observation, recover,
    decide: async () => recoveryAnswer(0.99) })
  await h.start()
  await vi.advanceTimersByTimeAsync(100)
  expect(recover).toHaveBeenCalledTimes(1)
  const events = h.agent.session.snapshotEvents()
  expect(events.flatMap(event => event.type === 'system3/reflex-recovery' ? [event.data.state] : [])).toEqual(['intent', 'continued'])
  expect(events.flatMap(event => event.type === 'subagent/supervision-recovery' ? [event.data.state] : [])).toEqual(['intent', 'continued'])
  expect(events.filter(event => event.type === 'subagent/steer')).toHaveLength(0)
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexSupervision')?.recoveryBudgets).toEqual({
    [h.ctx.goals.get(h.agent)!.id]: { attempts: 1, lastAt: 10030 } })
  const restored = Session.fromRestore(h.agent.session.id, h.agent.session.snapshotEvents(), h.agent.session.header, SessionLogOffset(0), 'shared-frozen')
  expect(h.ctx.sessionProjections.stateOf(restored, 'reflexSupervision')?.recoveryBudgets).toEqual(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexSupervision')?.recoveryBudgets)
  h.end()
})

it.each(['streaming', 'approval', 'tool', 'disabled'] as const)('never interrupts healthy or protected native work: %s', async (kind) => {
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: kind === 'disabled' ? {} : { recovery: RECOVERY }, recover,
    recoveryState: () => ({ ...observation, lastActivityAt: kind === 'streaming' ? Date.now() : observation.lastActivityAt,
      waiting: kind === 'approval', activeSideEffects: kind === 'tool' ? 1 : 0 }), decide: async () => recoveryAnswer(0.99) })
  await h.start()
  await vi.advanceTimersByTimeAsync(200)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})

it('invalidates a recovery decision when a newer human constraint is admitted', async () => {
  const decision = Promise.withResolvers<JevResponse>()
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: { recovery: RECOVERY }, recover, recoveryState: () => observation, decide: async () => decision.promise })
  await h.start()
  await vi.advanceTimersByTimeAsync(30)
  h.agent.session.append('subagent/steer', { version: 1, runId: brandString<SubagentRunId>('human'), provider: 'codex', text: 'Do not change revenue.csv' })
  decision.resolve(recoveryAnswer(0.99))
  await vi.advanceTimersByTimeAsync(10)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})

it.each([0.01, 0.5])('honors an observing or uncertain native recovery decision: %s', async (answer) => {
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: { recovery: RECOVERY }, recover, recoveryState: () => observation,
    decide: async () => recoveryAnswer(answer) })
  await h.start()
  await vi.advanceTimersByTimeAsync(40)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})

it('requires an active Goal before considering native inactivity', async () => {
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ goal: false, config: { recovery: RECOVERY }, recover, recoveryState: () => observation })
  await h.start()
  await vi.advanceTimersByTimeAsync(60)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})

it.each([new Error('ack lost'), 'transport closed'])('records an unconfirmed recovery without returning its reserved budget', async (failure) => {
  const observation = { ...nativeObservation(), retryCount: 3 }
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async () => { throw failure })
  const h = await setup({ config: { recovery: RECOVERY }, recover, recoveryState: () => observation,
    decide: async () => recoveryAnswer(0.99) })
  const goal = h.ctx.goals.get(h.agent)!
  h.agent.session.append('system3/task-frame', { version: 1, goal: { goalId: goal.id, text: goal.objective },
    items: [{ text: 'Keep financial inputs unchanged.', messageId: brandString<MessageId>('constraint') }] })
  await h.start()
  await vi.advanceTimersByTimeAsync(100)
  expect(recover).toHaveBeenCalledTimes(1)
  expect(h.agent.session.snapshotEvents().flatMap(event => event.type === 'system3/reflex-recovery' ? [event.data.state] : [])).toEqual(['intent', 'unknown'])
  const decisions = h.agent.session.snapshotEvents().filter(event => event.type === 'system3/reflex-recovery')
  expect(JSON.stringify(decisions)).toContain('retry-budget')
  h.end()
})

it('discards a recovery when meaningful native activity arrives during the Reflex decision', async () => {
  let observation = nativeObservation()
  const decision = Promise.withResolvers<JevResponse>()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: { recovery: RECOVERY }, recover, recoveryState: () => observation, decide: async () => decision.promise })
  await h.start()
  await vi.advanceTimersByTimeAsync(50)
  observation = { ...observation, lastActivityAt: Date.now() }
  decision.resolve(recoveryAnswer(0.99))
  await vi.advanceTimersByTimeAsync(10)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})

it('cancels a pending native recovery review on owner unload', async () => {
  const decision = Promise.withResolvers<JevResponse>()
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: { recovery: RECOVERY }, recover, recoveryState: () => observation, decide: async () => decision.promise })
  await h.start()
  await vi.advanceTimersByTimeAsync(40)
  const disposed = h.fiber.dispose()
  decision.resolve(recoveryAnswer(0.99))
  await disposed
  expect(recover).not.toHaveBeenCalled()
  h.end()
})


it('leaves the optional recovery installer inert without policy and rejects invalid deployment budgets', () => {
  const ctx = new Context()
  contexts.push(ctx)
  const settings = { config: CONFIG, policy: { mode: 'controlled' as const, approvedRemoteIds: ['reflex'], approvedRemoteDataClasses: ['workspace' as const] },
    options: { routeId: 'reflex', executionDomain: 'network' as const, effort: 'low' as const } }
  expect(() => { installReflexRecovery(ctx, settings) }).not.toThrow()
  expect(() => { installReflexRecovery(ctx, { ...settings, config: { ...CONFIG, recovery: { ...RECOVERY, nativeSilenceMs: 0 } } }) }).toThrow('nativeSilenceMs')
})

it.each([new Error('native observation unavailable'), 'unavailable'])('contains a failed native observation without dispatching recovery', async (failure) => {
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: { recovery: RECOVERY }, recover, recoveryState: () => { throw failure } })
  await h.start()
  await vi.advanceTimersByTimeAsync(40)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})

it('fails closed when supervision projection becomes unavailable and ignores unrelated lifecycle edges', async () => {
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: { recovery: RECOVERY }, recover, recoveryState: () => observation })
  await h.start()
  const registry = h.ctx.sessionProjections
  const read = registry.stateOf.bind(registry)
  vi.spyOn(registry, 'stateOf').mockImplementation(<K extends keyof SessionProjectionStateMap>(session: Session, key: K) => {
    return key === 'reflexSupervision' ? undefined : read(session, key)
  })
  const foreignRun = brandString<SubagentRunId>('foreign-run')
  h.ctx.emit('subagent/start', { id: SessionId('foreign'), provider: 'other', runId: foreignRun, local: false, steerable: false })
  h.ctx.emit('subagent/end', { id: SessionId('foreign'), provider: 'other', runId: foreignRun, local: false, stopReason: 'completed' })
  await vi.advanceTimersByTimeAsync(40)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})


it.each(['observe', 'unsure', 'missing-answer', 'provider-failure'] as const)('bounds repeated native assessments after %s', async (outcome) => {
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>()
  const h = await setup({ config: { recovery: RECOVERY, stallMs: 1000 }, recover, recoveryState: () => observation, decide: async () => {
    if (outcome === 'provider-failure') throw new Error('unavailable')
    if (outcome === 'missing-answer') return { model: 'reflex-test', answers: {} }
    return recoveryAnswer(outcome === 'observe' ? 0.01 : 0.5)
  } })
  await h.start()
  await vi.advanceTimersByTimeAsync(30)
  expect(h.decide).toHaveBeenCalledTimes(1)
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ objective: 'Fix the failing test and verify the result.', requirements: [],
    millisecondsWithoutNativeActivity: 30, nativeInactivityBudgetMs: 30, consecutiveRetries: 0, retryBudget: 3,
    waitingForApprovalOrUser: false, runningSideEffects: 0, recoveriesRemaining: 1 })
  expect(JSON.stringify(h.decide.mock.calls[0]?.[0].state)).not.toContain('thread-1')
  expect(JSON.stringify(h.decide.mock.calls[0]?.[0].state)).not.toContain('lastActivityAt')
  await vi.advanceTimersByTimeAsync(30)
  expect(h.decide).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(50)
  expect(h.decide).toHaveBeenCalledTimes(3)
  expect(recover).not.toHaveBeenCalled()
  h.end()
})

it('bounds new retry observations and reassesses the latest measured values', async () => {
  let observation = { ...nativeObservation(), retryCount: 3 }
  const h = await setup({ config: { recovery: RECOVERY, stallMs: 1000 }, recoveryState: () => observation,
    recover: vi.fn<NonNullable<SubagentRun['recover']>>(), decide: async () => recoveryAnswer(0.5) })
  await h.start()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide).toHaveBeenCalledTimes(1)
  observation = { ...observation, retryCount: 4, lastActivityAt: Date.now() }
  await vi.advanceTimersByTimeAsync(30)
  expect(h.decide).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide).toHaveBeenCalledTimes(2)
  expect(h.decide.mock.calls[1]?.[0].state).toMatchObject({ consecutiveRetries: 4, retryBudget: 3, millisecondsWithoutNativeActivity: 40 })
  h.end()
})

it.each(['observe', 'unsure', 'failure'] as const)('judges each evidence snapshot once after %s and reopens on evidence or Goal revision', async (outcome) => {
  const h = await setup({ decide: async () => {
    if (outcome === 'failure') throw new Error('provider unavailable')
    return outcome === 'observe' ? choice('observe') : { model: 'reflex-test', answers: {} }
  } })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.decide).toHaveBeenCalledOnce()
  expect(h.steer).not.toHaveBeenCalled()
  h.report()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.decide).toHaveBeenCalledTimes(2)
  const goal = h.ctx.goals.get(h.agent)!
  h.ctx.goals.edit(h.agent, goal, { objective: 'Inspect the corrected ledger goal.' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.decide).toHaveBeenCalledTimes(3)
})
it('does not consume evidence arriving while an observation is awaiting Reflex', async () => {
  const response = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: async () => response.promise })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.decide).toHaveBeenCalledOnce()
  h.report({ ...EVIDENCE, resultDigest: 'new-evidence' })
  response.resolve(choice('observe'))
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(h.decide.mock.calls[1]?.[0].state)).toContain('new-evidence')
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide).toHaveBeenCalledTimes(2)
})
it('reviews newer feedback evidence after an in-flight assessment becomes stale', async () => {
  const response = Promise.withResolvers<JevResponse>()
  let feedbacks = 0
  const h = await setup({ decide: async (request) => {
    if (request.questions.improved === undefined) return choice('diagnose')
    feedbacks += 1
    return feedbacks === 1 ? response.promise : { model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } }
  } })
  await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, operation: 'diagnostic', outcome: 'succeeded' })
  await vi.advanceTimersByTimeAsync(20)
  expect(feedbacks).toBe(1)
  h.report({ ...EVIDENCE, resultDigest: 'verified', outcome: 'succeeded' })
  response.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.5 } } })
  await vi.advanceTimersByTimeAsync(10)
  expect(feedbacks).toBe(2)
  expect(h.events().at(-1)?.state).toBe('improved')
})


it('invalidates old supervision while native recovery is pending and requires new evidence afterwards', async () => {
  const assessment = Promise.withResolvers<JevResponse>()
  const release = Promise.withResolvers<undefined>()
  let observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async () => {
    await release.promise
    const previousTurnId = observation.turnId
    observation = { ...observation, turnId: brandString<SubagentEvidenceTurnId>('turn-2'), lastActivityAt: Date.now() }
    return { state: 'continued', threadId: observation.threadId, previousTurnId, turnId: observation.turnId }
  })
  let ordinary = 0
  const h = await setup({ config: { recovery: RECOVERY }, recoveryState: () => observation, recover,
    decide: async request => request.questions.recover !== undefined ? recoveryAnswer(0.99)
      : ++ordinary === 1 ? assessment.promise : choice('diagnose') })
  await h.start()
  h.failures()
  await vi.advanceTimersByTimeAsync(30)
  expect(recover).toHaveBeenCalledOnce()
  assessment.resolve(choice('diagnose'))
  await vi.advanceTimersByTimeAsync(20)
  expect(h.steer).not.toHaveBeenCalled()
  release.resolve(undefined)
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).not.toHaveBeenCalled()
  h.report({ ...EVIDENCE, turnId: observation.turnId })
  h.report({ ...EVIDENCE, turnId: observation.turnId })
  h.report({ ...EVIDENCE, turnId: observation.turnId })
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledOnce()
  h.end()
})

it('records queued supervisor advice as stale when new human input arrives before native dispatch', async () => {
  const gate = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  const h = await setup({ steer: async () => { entered.resolve(undefined); await gate.promise } })
  const run = await h.start()
  if (run.steer === undefined) throw new Error('Expected steerable fixture')
  const occupying = run.steer([{ type: 'text', text: 'earlier control' }], new AbortController().signal)
  await entered.promise
  h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.events().map(event => event.state)).toEqual(['intent'])
  h.agent.session.append('subagent/steer', { version: 1, runId: h.events()[0]!.runId, provider: 'codex', text: 'new human constraint' })
  gate.resolve(undefined)
  await occupying
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledOnce()
  expect(h.events().map(event => event.state)).toEqual(['intent', 'stale'])
  h.end()
})


it('retires pending feedback and durable evidence when native recovery supersedes advice', async () => {
  const observation = nativeObservation()
  const h = await setup({ config: { recovery: RECOVERY }, recoveryState: () => observation,
    recover: async () => ({ state: 'continued', threadId: observation.threadId, previousTurnId: observation.turnId }),
    decide: async request => request.questions.recover !== undefined ? recoveryAnswer(0.99) : choice('diagnose') })
  const run = await h.start()
  h.failures()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.events().at(-1)?.state).toBe('accepted')
  await vi.advanceTimersByTimeAsync(20)
  expect(h.events().at(-1)?.state).toBe('inconclusive')
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexSupervision')?.evidence).toEqual([])
  const receipt = h.agent.session.snapshotEvents().findLast(event => event.type === 'system3/reflex-recovery')
  if (receipt?.type !== 'system3/reflex-recovery') throw new Error('Expected recovery receipt')
  h.end()
  await run.result
  h.agent.session.append('system3/reflex-recovery', receipt.data)
})


it.each(['steer', 'recover'] as const)('prioritizes queued human input before %s and resumes observation after real admission', async (mode) => {
  const decision = Promise.withResolvers<JevResponse>()
  const observation = nativeObservation()
  const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async () => ({ state: 'continued',
    threadId: observation.threadId, previousTurnId: observation.turnId }))
  let first = true
  const answer = () => mode === 'steer' ? choice('diagnose') : recoveryAnswer(0.99)
  const h = await setup({ config: mode === 'recover' ? { recovery: RECOVERY, stallMs: 10000 } : {},
    recover, recoveryState: () => observation, decide: async () => {
      if (first) { first = false; return decision.promise }
      return answer()
    } })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const adapter = new MockAdapter([toolCallResponse('delegate', 'delegate_wait', {}), textResponse('read the correction'),
    textResponse('human correction admitted')])
  h.ctx.effect(() => h.ctx.llm.registerAdapter(['mock'], adapter))
  h.ctx.effect(() => h.ctx.tools.register(defineTool({ name: 'delegate_wait', description: 'Wait for delegated work.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { await h.start(); entered.resolve(undefined); await release.promise; return 'observed' } })))
  h.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Start the Goal work.' }] }))
  await entered.promise
  if (mode === 'steer') h.failures()
  await vi.advanceTimersByTimeAsync(50)
  expect(h.decide).toHaveBeenCalledOnce()
  const correction = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Preserve the input file.' }] })
  h.agent.followup(correction)
  expect([...h.agent.inbox.nextStep, ...h.agent.inbox.nextTurn].some(message => message.id === correction.id)).toBe(true)
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.id === correction.id)).toBe(false)
  decision.resolve(answer())
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).not.toHaveBeenCalled()
  expect(recover).not.toHaveBeenCalled()
  const claimed = Promise.withResolvers<undefined>()
  const admit = Promise.withResolvers<undefined>()
  h.ctx.on('agent/pre-step', async (_args, next) => {
    const result = await next()
    if (result.kind === 'enter' && result.messages.some(message => message.id === correction.id)) {
      claimed.resolve(undefined)
      await admit.promise
    }
    return result
  })
  release.resolve(undefined)
  await claimed.promise
  expect([...h.agent.inbox.nextStep, ...h.agent.inbox.nextTurn].some(message => message.id === correction.id)).toBe(false)
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).not.toHaveBeenCalled()
  expect(recover).not.toHaveBeenCalled()
  admit.resolve(undefined)
  await h.agent.whenIdle()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.id === correction.id)).toBe(true)
  await vi.advanceTimersByTimeAsync(50)
  expect(mode === 'steer' ? h.steer : recover).toHaveBeenCalledOnce()
  h.end()
})

it('does not treat automatic memory input as a new human authority revision', async () => {
  const h = await setup()
  await h.start(); h.failures()
  const memory = createUserMessage({ source: { kind: 'reflex-memory' }, content: [{ type: 'text', text: 'Recovered evidence.' }] })
  h.ctx.effect(() => h.ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('memory noted')])))
  h.agent.followup(memory)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexSupervision')?.humanRevision).toBe(0)
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledOnce()
  h.end()
})

it('resumes supervision when a queued human correction is canceled without admission', async () => {
  const h = await setup()
  await h.start(); h.failures()
  h.agent.inbox.splice('next-step', 0, 0, [createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Withdrawn correction.' }] })])
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide).not.toHaveBeenCalled()
  h.agent.inbox.clear()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledOnce()
  h.end()
})

const semanticEvidence = (path: string, operationDigest: string, operation: SubagentEvidence['operation'] = 'file-change'): SubagentEvidence => ({
  ...EVIDENCE, kind: operation === 'file-change' ? 'file-change' : 'command', operation, outcome: 'succeeded', operationDigest,
  resultDigest: operationDigest, semantic: { version: 1, actions: [{ kind: operation === 'verification' ? 'verification-target' : 'file-update', path }], truncated: false },
})
const semanticChoice = (alignment: 'related' | 'unrelated' | 'uncertain', confidence = 0.99): JevResponse => ({
  ...choice('observe'), answers: { ...choice('observe').answers, alignment: { type: 'choice', choice: alignment,
    probabilities: { [alignment]: confidence }, confidence } },
})

it('realigns distinct successful unrelated work using logged semantic evidence without requiring repeated failures', async () => {
  const h = await setup({ config: { semantic: { minObservations: 2 } }, decide: async () => semanticChoice('unrelated') })
  await h.start()
  h.report(semanticEvidence('holiday/itinerary.md', 'trip-edit'))
  h.report(semanticEvidence('holiday/hotels.md', 'hotel-edit'))
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).toHaveBeenCalledOnce()
  expect(h.events()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'realign', state: 'accepted' })]))
  const judgement = h.agent.session.snapshotEvents().find(event => event.type === 'system3/judgement')
  expect(JSON.stringify(judgement)).toContain('holiday/itinerary.md')
  const restored = Session.fromRestore(h.agent.session.id, h.agent.session.snapshotEvents(), h.agent.session.header, SessionLogOffset(0), 'shared-frozen')
  expect(h.ctx.sessionProjections.stateOf(restored, 'reflexSupervision')?.evidence[0]?.semantic?.actions[0]?.path).toBe('holiday/itinerary.md')
  h.end()
})

it('assesses a sufficient semantic suffix at the deployment interval before the inactivity deadline', async () => {
  const h = await setup({ config: { intervalMs: 15000, stallMs: 180000, evidenceLimit: 16,
    semantic: { minObservations: 2 } }, decide: async () => semanticChoice('unrelated') })
  await h.start()
  h.report(semanticEvidence('holiday/one.md', 'one'))
  h.report(semanticEvidence('holiday/two.md', 'two'))
  await vi.advanceTimersByTimeAsync(15000)
  expect(h.steer).toHaveBeenCalledOnce()
  h.end()
})

it('uses a contiguous complete suffix while retaining opaque startup evidence in the default audit window', async () => {
  const h = await setup({ config: { evidenceLimit: 16, semantic: { minObservations: 2 } }, decide: async () => semanticChoice('unrelated') })
  await h.start()
  h.report({ ...EVIDENCE, operationDigest: 'startup', outcome: 'succeeded' })
  h.report(semanticEvidence('holiday/itinerary.md', 'trip'))
  h.report(semanticEvidence('holiday/hotels.md', 'hotels'))
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).toHaveBeenCalledOnce()
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({
    evidence: [{ operationDigest: 'startup' }, { operationDigest: 'trip' }, { operationDigest: 'hotels' }],
    semanticEvidence: [{ operationDigest: 'trip' }, { operationDigest: 'hotels' }], semanticReady: true,
  })
  const restored = Session.fromRestore(h.agent.session.id, h.agent.session.snapshotEvents(), h.agent.session.header, SessionLogOffset(0), 'shared-frozen')
  expect(h.ctx.sessionProjections.stateOf(restored, 'reflexSupervision')?.evidence).toHaveLength(3)
  h.end()
})

it.each([false, true])('never joins complete evidence across a new opaque observation: trailing=%s', async (trailing) => {
  const h = await setup({ config: { evidenceLimit: 16, semantic: { minObservations: 2 } }, decide: async () => semanticChoice('unrelated') })
  await h.start()
  h.report(semanticEvidence('holiday/one.md', 'one'))
  if (trailing) h.report(semanticEvidence('holiday/two.md', 'two'))
  h.report({ ...EVIDENCE, operationDigest: 'opaque', outcome: 'succeeded' })
  if (!trailing) h.report(semanticEvidence('holiday/two.md', 'two'))
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).not.toHaveBeenCalled()
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ semanticReady: false,
    semanticEvidence: trailing ? [] : [{ operationDigest: 'two' }] })
  expect(h.decide.mock.calls[0]?.[0].questions.alignment).toBeUndefined()
  h.end()
})

it.each(['related', 'uncertain', 'low-confidence'] as const)('does not realign a semantic window classified as %s', async (verdict) => {
  const h = await setup({ config: { semantic: { minObservations: 2 } }, decide: async () =>
    semanticChoice(verdict === 'low-confidence' ? 'unrelated' : verdict, verdict === 'low-confidence' ? 0.4 : 0.99) })
  await h.start()
  h.report(semanticEvidence('src/parser.ts', 'parser'))
  h.report(semanticEvidence('tests/parser.test.ts', 'test'))
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).not.toHaveBeenCalled()
  h.end()
})

it.each(['missing', 'truncated', 'no-path', 'empty', 'too-few'] as const)('abstains from semantic correction with %s evidence', async (kind) => {
  const h = await setup({ config: { semantic: { minObservations: 2 } }, decide: async () => semanticChoice('unrelated') })
  await h.start()
  h.report(semanticEvidence('holiday/trip.md', 'one'))
  if (kind !== 'too-few') h.report(kind === 'missing' ? { ...EVIDENCE, operationDigest: 'two', outcome: 'succeeded' }
    : { ...semanticEvidence('holiday/hotels.md', 'two'), semantic: { version: 1,
      actions: kind === 'empty' ? [] : [kind === 'no-path' ? { kind: 'read' } : { kind: 'read', path: 'holiday/hotels.md' }],
      truncated: kind === 'truncated' } })
  await vi.advanceTimersByTimeAsync(100)
  expect(h.decide.mock.calls[0]?.[0].questions.alignment).toBeUndefined()
  expect(h.steer).not.toHaveBeenCalled()
  h.end()
})

it('does not count unrelated successful verification as semantic progress', async () => {
  const h = await setup({ config: { semantic: { minObservations: 2 } }, decide: async () => semanticChoice('unrelated') })
  await h.start()
  h.report(semanticEvidence('holiday/tests/a.ts', 'test-a', 'verification'))
  await vi.advanceTimersByTimeAsync(90)
  h.report(semanticEvidence('holiday/tests/b.ts', 'test-b', 'verification'))
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledOnce()
  h.end()
})

it.each(['related', 'unrelated', 'missing-summary', 'read-only', 'echo-pytest'] as const)('requires Goal-related verification before reporting semantic improvement: %s', async (kind) => {
  const h = await setup({ config: { semantic: { minObservations: 2 } }, decide: async request =>
    request.questions.improved === undefined ? semanticChoice('unrelated') : { model: 'reflex-test', answers: {
      improved: { type: 'noul', noul: 0.99 }, relevantVerification: { type: 'noul', noul: kind === 'unrelated' ? 0.01 : 0.99 } } } })
  await h.start()
  h.report(semanticEvidence('holiday/trip.md', 'one')); h.report(semanticEvidence('holiday/hotels.md', 'two'))
  await vi.advanceTimersByTimeAsync(100)
  h.report(kind === 'read-only' || kind === 'echo-pytest' ? { ...semanticEvidence('tests/parser.py', 'verification', 'verification'),
    semantic: { version: 1, actions: [{ kind: 'read', path: 'tests/parser.py' }], truncated: false } }
    : kind === 'missing-summary' ? { ...EVIDENCE, outcome: 'succeeded' }
      : semanticEvidence(kind === 'related' ? 'tests/parser.test.ts' : 'holiday/test.ts', 'verification', 'verification'))
  await vi.advanceTimersByTimeAsync(20)
  expect(h.events().at(-1)?.state).toBe(kind === 'related' ? 'improved' : 'inconclusive')
  await vi.advanceTimersByTimeAsync(100)
  expect(h.steer).toHaveBeenCalledOnce()
  h.end()
})

it('keeps semantic collection opt-in and strips summaries before logging or sending fingerprint-only observations', async () => {
  const h = await setup()
  await h.start()
  h.report(semanticEvidence('private/project-name.ts', 'one'))
  await vi.advanceTimersByTimeAsync(100)
  expect(JSON.stringify(h.decide.mock.calls)).not.toContain('private/project-name.ts')
  expect(JSON.stringify(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/reflex-evidence'))).not.toContain('private/project-name.ts')
  h.end()
})

it.each([0, 1, 1.5, 17])('rejects an unusable semantic observation window: %s', (minObservations) => {
  expect(() => { validateReflexSupervision({ ...CONFIG, semantic: { minObservations } }) }).toThrow('semantic.minObservations')
})


it('keeps fingerprint corrections available when workspace semantics lack remote approval', async () => {
  const h = await setup({ config: { semantic: { minObservations: 2 }, sessionDataClasses: ['public'] }, approvedClasses: ['public'] })
  await h.start()
  for (let i = 0; i < 3; i += 1) h.report({ ...semanticEvidence('confidential/revenue.csv', 'repeated'), outcome: 'failed' })
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).toHaveBeenCalledOnce()
  expect(JSON.stringify(h.decide.mock.calls)).not.toContain('confidential')
  expect(h.decide.mock.calls[0]?.[0].questions.alignment).toBeUndefined()
  h.end()
})

it('validates persisted semantic evidence with present and omitted target paths', async () => {
  const h = await setup({ config: { semantic: { minObservations: 2 } } })
  const definition = reflexSupervisionStateProjection(16)
  const state = definition.init(h.agent.session.header, h.agent.session.inheritedEventCount)
  const evidence = { ...semanticEvidence('src/parser.ts', 'parser'), runId: brandString<SubagentRunId>('run'),
    provider: 'codex', id: SessionId('child') }
  expect(definition.stateSchema.parse({ ...state, evidence: [evidence,
    { ...evidence, semantic: { version: 1, actions: [{ kind: 'read' }], truncated: true } }] }).evidence).toHaveLength(2)
  expect(() => definition.stateSchema.parse({ ...state, evidence: [{ ...evidence,
    semantic: { version: 1, actions: [{ kind: 'execute-raw-command', path: 'src/parser.ts' }], truncated: false } }] })).toThrow()
  h.end()
})


it('invalidates semantic judgement when accepted requirements change during the model request', async () => {
  const pending = Promise.withResolvers<JevResponse>()
  const h = await setup({ config: { semantic: { minObservations: 2 } }, decide: async () => pending.promise })
  await h.start()
  h.report(semanticEvidence('marketing/copy.md', 'one')); h.report(semanticEvidence('marketing/home.html', 'two'))
  await vi.advanceTimersByTimeAsync(100)
  h.agent.session.append('system3/task-frame', { version: 1, goal: { goalId: h.ctx.goals.get(h.agent)!.id,
    text: 'Fix the failing test and verify the result.' }, items: [{ text: 'The marketing integration is required.',
    messageId: brandString<MessageId>('accepted-requirement') }] })
  pending.resolve(semanticChoice('unrelated'))
  await vi.advanceTimersByTimeAsync(10)
  expect(h.steer).not.toHaveBeenCalled()
  h.end()
})

it.each(['human', 'task-frame', 'claimed', 'disarmed'] as const)('invalidates terminal feedback after %s changes without changing the Goal revision', async (change) => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: request => request.questions.improved === undefined ? Promise.resolve(choice('diagnose')) : answer.promise })
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded' })
  h.end(); await run.result
  expect(h.decide).toHaveBeenCalledTimes(2)
  const goal = h.ctx.goals.get(h.agent)!
  if (change === 'human') h.agent.inbox.splice('next-step', 0, 0, [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'New requirement: preserve the original CSV.' }] })])
  else if (change === 'claimed') await h.ctx.parallel('agent/inbox/claimed', { agent: h.agent, message: createUserMessage({ source: { kind: 'user' }, content: [] }), turn: 1 })
  else if (change === 'disarmed') h.ctx.goals.disarm(h.agent)
  else h.agent.session.append('system3/task-frame', { version: 1, goal: { goalId: goal.id, text: goal.objective }, items: [{ messageId: brandString<MessageId>('new-constraint'), text: 'Preserve the original CSV.' }] })
  expect(h.ctx.goals.get(h.agent)?.revision).toBe(goal.revision)
  answer.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.events().at(-1)?.state).toBe('inconclusive')
})

it('keeps terminal feedback for its original session when another session changes or automatic memory is claimed', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: request => request.questions.improved === undefined ? Promise.resolve(choice('diagnose')) : answer.promise })
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded' })
  h.end(); await run.result
  const other = await h.ctx.agentLoop.create(SessionId('unrelated-terminal-session'), { provider: 'mock', model: 'mock' })
  h.ctx.goals.create(other, { objective: 'An unrelated task' })
  other.inbox.splice('next-step', 0, 0, [createUserMessage({ source: { kind: 'user' }, content: [] })])
  const memory = createUserMessage({ source: { kind: 'reflex-memory' }, content: [] })
  await h.ctx.parallel('agent/inbox/claimed', { agent: h.agent, message: memory, turn: 1 })
  h.agent.session.append('user/message', memory, { surfaceOp: 'append' })
  answer.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.events().at(-1)?.state).toBe('improved')
})

it('does not revive terminal feedback when an already queued human correction is cancelled before the answer', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: request => request.questions.improved === undefined ? Promise.resolve(choice('diagnose')) : answer.promise })
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded' })
  h.end(); await run.result
  h.agent.inbox.splice('next-step', 0, 0, [createUserMessage({ source: { kind: 'user' }, content: [] })])
  h.agent.inbox.clear()
  answer.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.events().at(-1)?.state).toBe('inconclusive')
})

it('publishes no terminal feedback if disposal starts while the judgment receipt is appended', async () => {
  const answer = Promise.withResolvers<JevResponse>()
  const h = await setup({ decide: request => request.questions.improved === undefined ? Promise.resolve(choice('diagnose')) : answer.promise })
  const run = await h.start(); h.failures()
  await vi.advanceTimersByTimeAsync(10)
  h.report({ ...EVIDENCE, outcome: 'succeeded' })
  h.end(); await run.result
  let disposal: Promise<void> | undefined
  h.ctx.on('session/event', (_session, event) => {
    if (event.type === 'system3/judgement' && event.data.decision === 'reflex.supervision-feedback') disposal = h.fiber.dispose()
  })
  answer.resolve({ model: 'reflex-test', answers: { improved: { type: 'noul', noul: 0.99 } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(disposal).toBeDefined()
  await disposal
  expect(h.events().map(event => event.state)).toEqual(['intent', 'accepted'])
})
