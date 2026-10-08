import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { JevRequest, JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { brandString } from '@deepseek-ai/dsh-brand'
import GoalService, { GoalId } from '@deepseek-ai/dsh-goal'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId, type MessageId,
  type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import { afterEach, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { completionEvidence, completionRefusal, installSystem3CompletionReview, system3CompletionReviewDecision,
  validateSystem3CompletionReview, type System3CompletionReviewConfig } from '../src/completion-review.ts'
import System3 from '../src/index.ts'
import * as DecisionKernel from '../src/decision-kernel.ts'
import type { System3TaskFrame, System3TaskFrameConfig } from '../src/task-frame.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const CONFIG: System3CompletionReviewConfig = { mode: 'active', yes: 0.7, no: 0.3, deadlineMs: 5000, sessionDataClasses: ['workspace'],
  maxRefusals: 2, evidenceCalls: 8, resultChars: 200 }
const OBJECTIVE = '写一个按月汇总金额的模块，测试全部通过'
const REQUIREMENT = { messageId: brandString<MessageId>('m2'), text: '不要修改 README.md' }
const FRAME: System3TaskFrame = { version: 1, goal: { goalId: GoalId('g1'), text: OBJECTIVE }, items: [REQUIREMENT] }
const CLAIM = '测试全部通过，可以标记完成了'
const COMPLETE = { goal_id: 'g1', action: 'complete' }

/** Jev yes/no answers keyed by question id. */
function nouls(values: Readonly<Record<string, number>>): JevResponse {
  return { model: 'jev-test', answers: Object.fromEntries(Object.entries(values).map(([key, noul]) => [key, { type: 'noul' as const, noul }])) }
}

it('asks about the goal and each requirement, and decides from confident answers only', () => {
  const input = { objective: OBJECTIVE, requirements: ['不要修改 README.md', '提交信息用中文'], evidence: '执行记录' }
  const questions = system3CompletionReviewDecision.questions(input)
  expect(Object.keys(questions)).toEqual(['goal', 'r1', 'r2'])
  expect(questions.goal?.instructions).toContain(`「${OBJECTIVE}」`)
  expect(questions.r2?.instructions).toContain('「提交信息用中文」')
  expect(system3CompletionReviewDecision.state(input)).toEqual({ evidence: '执行记录' })
  const decide = (response: JevResponse) => system3CompletionReviewDecision.decide(response, CONFIG, input)
  expect(decide(nouls({ goal: 0.9, r1: 0.9, r2: 0.9 }))).toBe('complete')
  expect(decide(nouls({ goal: 0.9, r1: 0.9, r2: 0.1 }))).toBe('incomplete')
  expect(decide(nouls({ goal: 0.2, r1: 0.5, r2: 0.9 }))).toBe('incomplete')
  expect(decide(nouls({ goal: 0.9, r1: 0.5, r2: 0.9 }))).toBe('unsure')
  expect(decide(nouls({ goal: 0.9, r1: 0.9 }))).toBe('unsure')
  expect(decide({ model: 'jev-test', answers: { goal: { type: 'choice', choice: 'no', probabilities: { no: 0.9 }, confidence: 0.9 },
    r1: { type: 'noul', noul: 0.9 }, r2: { type: 'noul', noul: 0.9 } } })).toBe('unsure')
  expect(system3CompletionReviewDecision.fallback).toBe('complete')
})

it('summarizes tool calls and results as evidence, leaving out what the model said', () => {
  const call = (id: string, name: string, args: string) => ({ type: 'tool-call' as const, id: ToolCallId(id), name, arguments: args })
  const result = (id: string, text: string) => createToolResultMessage({ callId: ToolCallId(id), content: [{ type: 'text', text }], isError: false })
  const messages = [
    createUserMessage({ content: [{ type: 'text', text: '写一个模块' }], source: { kind: 'user' } }),
    createAssistantMessage({ content: [{ type: 'text', text: CLAIM }, call('c1', 'bash', '{"command":"npm test"}')], source: { provider: 'mock', model: 'mock' } }),
    result('c1', `  ${'a'.repeat(7)}${'x'.repeat(10)}${'z'.repeat(7)}  `),
    createAssistantMessage({ content: [call('c2', 'edit', '{"file_path":"ledger.py","text":"x"}'), call('c3', 'search', '{"limit":3}'),
      call('c4', 'echo', '"text"'), call('c5', 'cut', '{"command":'), call('c6', 'never', 'null'),
      call('c7', 'update_goal', '{"goal_id":"g1","action":"complete"}')], source: { provider: 'mock', model: 'mock' } }),
    createToolResultMessage({ callId: ToolCallId('c2'), content: [{ type: 'text', text: 'Edited\n3 lines' },
      // An image block contributes no text.
      { type: 'image', data: 'AA==', mimeType: 'image/png' } as never], isError: false }),
    result('c3', 'ok'), result('c4', 'ok'), result('c5', 'ok'), result('c7', 'Error: [System3 完成核验]'),
  ]
  const evidence = completionEvidence(messages, 10, 7)
  expect(evidence).not.toContain(CLAIM)
  expect(evidence).not.toContain('写一个模块')
  // Goal updates are claims too, and a refused one would repeat the review's own verdict.
  expect(evidence).not.toContain('update_goal')
  expect(evidence).toBe([
    '执行记录（最近 6 次工具调用，按时间顺序）：',
    // A long result keeps its start and end; a short one is kept whole.
    '- bash: npm test\n  结果：aaaaaaa\n  …\n  zzzzzzz',
    '- edit: ledger.py\n  结果：Edited\n  3 lines',
    '- search\n  结果：ok', '- echo\n  结果：ok', '- cut\n  结果：ok',
    // A call without a result yet has no result line.
    '- never',
  ].join('\n'))
  expect(completionEvidence(messages, 2, 7)).toBe('执行记录（最近 2 次工具调用，按时间顺序）：\n- cut\n  结果：ok\n- never')
  expect(completionEvidence([], 3, 7)).toBe('执行记录（最近 0 次工具调用，按时间顺序）：')
})

it('names the unmet goal and requirements in the refusal', () => {
  expect(completionRefusal(OBJECTIVE, ['不要修改 README.md'])).toBe(['[System3 完成核验] 执行记录里还看不到以下内容已经完成的证据：',
    `- 目标：${OBJECTIVE}`, '- 用户要求：不要修改 README.md', '请先完成并验证；如果做不到或要求之间有冲突，请向用户说明并请用户决定，不要标记完成。'].join('\n'))
  expect(completionRefusal(undefined, ['不要修改 README.md'])).not.toContain('目标：')
})

it('rejects configurations that cannot work', () => {
  expect(() => { validateSystem3CompletionReview({ ...CONFIG, no: 0.8 }) }).toThrow('decisions.completionReview thresholds must satisfy 0 <= no < yes <= 1')
  expect(() => { validateSystem3CompletionReview({ ...CONFIG, maxRefusals: 0 }) }).toThrow('completionReview maxRefusals must be a positive integer')
  expect(() => { validateSystem3CompletionReview({ ...CONFIG, evidenceCalls: 1.5 }) }).toThrow('completionReview evidenceCalls must be a positive integer')
  expect(() => { validateSystem3CompletionReview({ ...CONFIG, resultChars: -1 }) }).toThrow('completionReview resultChars must be a positive integer')
})

type Decide = (request: JevRequest, signal: AbortSignal | undefined) => Promise<JevResponse | 'unknown'>

/** Hold one provider response; an ignoring provider releases only when the test supplies its late response. */
function reviewBarrier(honorAbort = true) {
  const entered = Promise.withResolvers<undefined>()
  const answer = Promise.withResolvers<JevResponse | 'unknown'>()
  let receivedSignal: AbortSignal | undefined
  const decide: Decide = (_request, signal) => {
    receivedSignal = signal
    const abort = (): void => { answer.reject(new Error('review aborted')) }
    if (honorAbort) signal?.addEventListener('abort', abort, { once: true })
    entered.resolve(undefined)
    return answer.promise.finally(() => signal?.removeEventListener('abort', abort))
  }
  return { entered: entered.promise, resolve: answer.resolve, decide, signal: () => receivedSignal }
}

/** Review settings, Jev's answer, and the tool calls the model makes after `bash`. */
interface Options {
  readonly config?: Partial<System3CompletionReviewConfig>
  readonly answer?: Decide | JevResponse
  readonly calls?: readonly (readonly [string, object])[]
  readonly nativeGoal?: boolean
}

/** An Agent whose model runs `bash`, then the given tool calls, then stops; `update_goal` counts the completions that ran. */
async function setup(options: Options = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const answer = options.answer ?? nouls({ goal: 0.9, r1: 0.9 })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async (request: JevRequest, signal?: AbortSignal) => {
    const response = typeof answer === 'function' ? await answer(request, signal) : answer
    const spec = ctx.jev.resolve(request)
    return response === 'unknown' ? { kind: 'unknown', spec, failure: { code: 'transport', message: 'jev provider request failed' } }
      : { kind: 'ok', spec, response }
  })
  const calls = options.calls ?? [['update_goal', COMPLETE]]
  // The adapter consumes this array, so a test may append the responses of a later turn.
  const script: StreamChunk[][] = [toolCallResponse('c0', 'bash', { command: 'npm test' }, CLAIM),
    ...calls.map(([name, args], index) => toolCallResponse(`c${String(index + 1)}`, name, args)), textResponse('done')]
  const adapter = new MockAdapter(script)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const output = { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] } as const
  ctx.tools.register(defineTool({ name: 'bash', description: 'Run a command.', parameters: { command: { type: 'string', required: true } }, output,
    execute: () => Promise.resolve('Ran 14 tests\n\nOK') }))
  const completed = vi.fn(() => Promise.resolve('Goal complete'))
  if (options.nativeGoal) {
    await ctx.plugin(GoalService)
    await ctx.plugin(ToolGoal)
  } else ctx.tools.register(defineTool({ name: 'update_goal', description: 'Update the goal.',
    parameters: { goal_id: { type: 'string', required: true }, action: { type: 'string', required: true } }, output, execute: completed }))
  const state = { frame: FRAME as System3TaskFrame | null }
  const reviewFiber = await ctx.plugin({ name: 'completion-review-fixture', apply(owner: Context) {
    installSystem3CompletionReview(owner, { config: { ...CONFIG, ...options.config },
      policy: { mode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'] },
      options: { routeId: 'jev', executionDomain: 'network', effort: 'low' }, frameOf: () => state.frame })
  } })
  const agent = await ctx.agentLoop.create(SessionId('reviewed'), { provider: 'mock', model: 'mock' })
  ctx.on('session/event', (session, event) => {
    if (session === agent.session && event.type === 'system3/task-frame') state.frame = event.data
  })
  const reviews = () => agent.session.snapshotEvents().flatMap(event => event.type === 'system3/completion-review' ? [event.data] : [])
  const run = async (): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '写一个模块' }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const seen = (index: number) => JSON.stringify(adapter.requests[index]?.messages ?? [])
  return { ctx, agent, script, decide, completed, state, reviews, run, seen, reviewFiber }
}

/** A native goal completion keeps the real revision and domain mutation behind the reviewed tool call. */
async function nativeReview(answer: Decide) {
  const h = await setup({ answer, nativeGoal: true })
  const goal = h.ctx.goals.create(h.agent, { objective: OBJECTIVE })
  h.agent.session.append('system3/task-frame', { ...FRAME, goal: { goalId: goal.id, text: goal.objective }, items: [] })
  h.script[1] = toolCallResponse('native-complete', 'update_goal', { goal_id: goal.id, revision: goal.revision, action: 'complete' })
  return { ...h, goal }
}

it('refuses a completion Jev confidently finds unmet and tells the model what is missing', async () => {
  const h = await setup({ answer: nouls({ goal: 0.1, r1: 0.9 }) })
  await h.run()
  expect(h.completed).not.toHaveBeenCalled()
  expect(h.reviews()).toEqual([{ version: 1, goalId: 'g1', decision: 'incomplete', unmet: [], goalUnmet: true, refused: true }])
  expect(h.seen(2)).toContain(JSON.stringify(completionRefusal(OBJECTIVE, [])).slice(1, -1))
  // Jev sees the calls and their results, not the model's claim.
  const request = h.decide.mock.calls[0]?.[0]
  expect(Object.keys(request?.questions ?? {})).toEqual(['goal', 'r1'])
  expect(request?.state).toEqual({ evidence: '执行记录（最近 1 次工具调用，按时间顺序）：\n- bash: npm test\n  结果：Ran 14 tests\n  \n  OK' })
  expect(JSON.stringify(request)).not.toContain(CLAIM)
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement').map(event => event.data))
    .toMatchObject([{ decision: 'completion.review', outcome: 'incomplete', applied: true }])
})

it('lists only the unmet requirements when the goal itself is met', async () => {
  const h = await setup({ answer: nouls({ goal: 0.9, r1: 0.1 }) })
  await h.run()
  expect(h.reviews()).toEqual([{ version: 1, goalId: 'g1', decision: 'incomplete', unmet: ['m2'], goalUnmet: false, refused: true }])
  expect(h.seen(2)).toContain('- 用户要求：不要修改 README.md')
  expect(h.seen(2)).not.toContain('- 目标：')
})

it('lets a completion through when Jev finds it met or is unsure', async () => {
  const met = await setup()
  await met.run()
  expect(met.completed).toHaveBeenCalledTimes(1)
  expect(met.reviews()).toEqual([{ version: 1, goalId: 'g1', decision: 'complete', unmet: [], goalUnmet: false, refused: false }])

  const unsure = await setup({ answer: nouls({ goal: 0.5, r1: 0.9 }) })
  await unsure.run()
  expect(unsure.completed).toHaveBeenCalledTimes(1)
  expect(unsure.reviews()).toMatchObject([{ decision: 'unsure', refused: false }])

  // Without requirements only the goal is asked.
  const bare = await setup()
  bare.state.frame = { ...FRAME, items: [] }
  await bare.run()
  expect(Object.keys(bare.decide.mock.calls[0]?.[0].questions ?? {})).toEqual(['goal'])
  expect(bare.completed).toHaveBeenCalledTimes(1)
})

it('refuses at most maxRefusals times per goal', async () => {
  const h = await setup({ config: { maxRefusals: 1 }, answer: nouls({ goal: 0.1, r1: 0.9 }),
    calls: [['update_goal', COMPLETE], ['update_goal', COMPLETE]] })
  await h.run()
  expect(h.reviews().map(review => [review.decision, review.refused])).toEqual([['incomplete', true], ['incomplete', false]])
  expect(h.completed).toHaveBeenCalledTimes(1)
})

it('counts refusals separately for each goal', async () => {
  const h = await setup({ config: { maxRefusals: 1 }, answer: nouls({ goal: 0.1, r1: 0.9 }),
    calls: [['update_goal', COMPLETE], ['update_goal', { goal_id: 'g2', action: 'complete' }]] })
  h.ctx.on('tools/result', (exec) => {
    if (exec.name === 'update_goal') h.state.frame = { version: 1, goal: { goalId: GoalId('g2'), text: '另一个目标' }, items: [] }
  })
  await h.run()
  expect(h.reviews().map(review => [review.goalId, review.refused])).toEqual([['g1', true], ['g2', true]])
  expect(h.completed).not.toHaveBeenCalled()
})

it.each([
  ['complete', nouls({ goal: 0.9, r1: 0.9 })],
  ['incomplete', nouls({ goal: 0.1, r1: 0.1 })],
  ['unsure', nouls({ goal: 0.5, r1: 0.9 })],
] as const)('refuses a stale %s response against the latest task requirements', async (_decision, answer) => {
  const barrier = reviewBarrier()
  const h = await setup({ answer: barrier.decide })
  const pending = h.run()
  try {
    await barrier.entered
    h.agent.session.append('system3/task-frame', { ...FRAME,
      items: [{ messageId: brandString<MessageId>('new-requirement'), text: '测试文件改名为 check_ledger.py' }] })
  } finally {
    barrier.resolve(answer)
    await pending
  }
  expect(h.completed.mock.calls.length).toBe(0)
  expect(h.reviews()).toEqual([{ version: 1, goalId: 'g1', decision: 'unsure', unmet: [], goalUnmet: false, refused: true }])
  expect(h.seen(2)).toContain('任务卡在核验期间更新，请按当前目标和要求重新核验后再标记完成')
  expect(h.seen(2)).toContain('测试文件改名为 check_ledger.py')
  expect(h.seen(2)).not.toContain('- 用户要求：不要修改 README.md')
})

it.each(['replaced', 'removed'] as const)('refuses an old completion after its task frame is %s', async (change) => {
  const barrier = reviewBarrier()
  const h = await setup({ answer: barrier.decide })
  const pending = h.run()
  try {
    await barrier.entered
    if (change === 'removed') h.state.frame = null
    else h.agent.session.append('system3/task-frame', { version: 1, goal: { goalId: GoalId('new-goal'), text: '新的目标原话' }, items: [] })
  } finally {
    barrier.resolve(nouls({ goal: 0.9, r1: 0.9 }))
    await pending
  }
  expect(h.completed.mock.calls.length).toBe(0)
  expect(h.reviews()).toMatchObject([{ goalId: 'g1', decision: 'unsure', unmet: [], goalUnmet: false, refused: true }])
  expect(h.seen(2)).toContain(change === 'removed' ? '当前任务卡已移除' : '- 当前目标：新的目标原话')
  expect(h.seen(2)).not.toContain('执行记录里还看不到以下内容已经完成的证据')
})

it('records a stale shadow response without refusing or consuming the goal refusal allowance', async () => {
  const barrier = reviewBarrier()
  const h = await setup({ answer: barrier.decide, config: { mode: 'shadow', maxRefusals: 1 },
    calls: [['update_goal', COMPLETE], ['update_goal', COMPLETE]] })
  const pending = h.run()
  try {
    await barrier.entered
    h.agent.session.append('system3/task-frame', { ...FRAME, items: [] })
  } finally {
    barrier.resolve(nouls({ goal: 0.1, r1: 0.1 }))
    await pending
  }
  expect(h.completed).toHaveBeenCalledTimes(2)
  expect(h.reviews()).toEqual([
    { version: 1, goalId: 'g1', decision: 'unsure', unmet: [], goalUnmet: false, refused: false },
    { version: 1, goalId: 'g1', decision: 'incomplete', unmet: [], goalUnmet: true, refused: false },
  ])
})

it('shares the refusal cap with stale reviews only inside one Session', async () => {
  const barrier = reviewBarrier()
  let reviews = 0
  const h = await setup({ config: { maxRefusals: 1 }, calls: [['update_goal', COMPLETE], ['update_goal', COMPLETE]],
    answer: (request, signal) => {
      reviews += 1
      return reviews === 1 ? Promise.resolve(nouls({ goal: 0.1, r1: 0.9 })) : barrier.decide(request, signal)
    } })
  const pending = h.run()
  try {
    await barrier.entered
    h.agent.session.append('system3/task-frame', { ...FRAME, items: [] })
  } finally {
    barrier.resolve(nouls({ goal: 0.9, r1: 0.9 }))
    await pending
  }
  expect(h.completed).toHaveBeenCalledTimes(1)
  expect(h.reviews().map(review => [review.decision, review.refused, review.goalUnmet, review.unmet]))
    .toEqual([['incomplete', true, true, []], ['unsure', false, false, []]])
})

it('consumes the goal refusal allowance when a stale response refuses completion', async () => {
  const barrier = reviewBarrier()
  let reviews = 0
  const h = await setup({ config: { maxRefusals: 1 }, calls: [['update_goal', COMPLETE], ['update_goal', COMPLETE]],
    answer: (request, signal) => {
      reviews += 1
      return reviews === 1 ? barrier.decide(request, signal) : Promise.resolve(nouls({ goal: 0.1 }))
    } })
  const pending = h.run()
  try {
    await barrier.entered
    h.agent.session.append('system3/task-frame', { ...FRAME, items: [] })
  } finally {
    barrier.resolve(nouls({ goal: 0.9, r1: 0.9 }))
    await pending
  }
  expect(h.completed).toHaveBeenCalledTimes(1)
  expect(h.reviews().map(review => [review.decision, review.refused]))
    .toEqual([['unsure', true], ['incomplete', false]])
})

it('gives a root fork with the same inherited GoalId its own refusal allowance', async () => {
  const h = await setup({ config: { maxRefusals: 1 }, answer: nouls({ goal: 0.1, r1: 0.9 }) })
  await h.ctx.plugin(GoalService)
  const goal = h.ctx.goals.create(h.agent, { objective: OBJECTIVE })
  h.state.frame = { ...FRAME, goal: { goalId: goal.id, text: OBJECTIVE } }
  h.agent.session.append('system3/task-frame', h.state.frame)
  const complete = { goal_id: goal.id, action: 'complete' }
  h.script[1] = toolCallResponse('source-complete', 'update_goal', complete)
  await h.run()
  expect(h.reviews().at(-1)?.refused).toBe(true)
  const sourceFork = h.ctx.sessions.fork(h.agent.session, undefined, SessionId('fork-seed'))
  const { agent: fork } = await h.ctx.agents.create({
    sessionId: SessionId('fork-reviewer'), seed: sourceFork.snapshotEvents(), inheritedEventCount: sourceFork.inheritedEventCount,
    meta: { parentSession: h.agent.session.id, isSeeded: true }, agentOptions: { provider: 'mock', model: 'mock' },
  })
  expect(h.ctx.goals.get(fork)?.id).toBe(goal.id)
  expect(fork.session.header.delegationDepth ?? 0).toBe(0)
  h.script.push(toolCallResponse('fork-complete', 'update_goal', complete), textResponse('done'))
  fork.followup(createUserMessage({ content: [{ type: 'text', text: '继续核验' }], source: { kind: 'user' } }))
  await fork.whenIdle()
  const ownReviews = fork.session.snapshotEvents(fork.session.inheritedEventCount)
    .flatMap(event => event.type === 'system3/completion-review' ? [event.data] : [])
  expect(ownReviews).toMatchObject([{ goalId: goal.id, refused: true }])
  expect(h.completed).not.toHaveBeenCalled()
  h.script.push(toolCallResponse('source-capped', 'update_goal', complete), textResponse('done'))
  await h.run()
  h.script.push(toolCallResponse('fork-capped', 'update_goal', complete), textResponse('done'))
  fork.followup(createUserMessage({ content: [{ type: 'text', text: '再次核验' }], source: { kind: 'user' } }))
  await fork.whenIdle()
  expect(h.completed).toHaveBeenCalledTimes(2)
})

it.each(['transport', 'deadline'] as const)('retains the %s fallback when the task card changes during the request', async (failure) => {
  const barrier = reviewBarrier()
  const h = await setup({ answer: barrier.decide, config: failure === 'deadline' ? { deadlineMs: 20 } : {} })
  const pending = h.run()
  try {
    await barrier.entered
    h.agent.session.append('system3/task-frame', { ...FRAME, items: [] })
    if (failure === 'transport') barrier.resolve('unknown')
    await pending
  } finally {
    barrier.resolve('unknown')
    await pending
  }
  expect(h.completed).toHaveBeenCalledTimes(1)
  expect(h.reviews()).toEqual([{ version: 1, goalId: 'g1', decision: 'unsure', unmet: [], goalUnmet: false, refused: false }])
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement').map(event => event.data))
    .toMatchObject([{ reason: failure, applied: false }])
})

it('records neither a completion review nor a judgement after cancellation of a stale request', async () => {
  const barrier = reviewBarrier()
  const h = await setup({ answer: barrier.decide })
  const pending = h.run()
  try {
    await barrier.entered
    h.agent.session.append('system3/task-frame', { ...FRAME, items: [] })
    h.agent.cancel({ kind: 'user' })
    await pending
  } finally {
    barrier.resolve('unknown')
    await pending
  }
  expect(h.completed.mock.calls.length).toBe(0)
  expect(h.reviews()).toEqual([])
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement')).toEqual([])
})

it('continues the native completion when only the review plugin is unloaded', async () => {
  const barrier = reviewBarrier()
  const h = await nativeReview(barrier.decide)
  const pending = h.run()
  try {
    await barrier.entered
    await h.reviewFiber.dispose()
    expect(barrier.signal()?.aborted).toBe(true)
    await pending
  } finally {
    barrier.resolve('unknown')
    await pending
  }
  expect(h.ctx.goals.get(h.agent)).toMatchObject({ id: h.goal.id, revision: 2, phase: 'complete' })
  expect(h.reviews()).toEqual([])
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement')).toEqual([])
})

it.each(['success', 'unknown'] as const)('ignores a late %s from an unloaded review and completes the native goal', async (outcome) => {
  const barrier = reviewBarrier(false)
  const h = await nativeReview(barrier.decide)
  const pending = h.run()
  try {
    await barrier.entered
    await h.reviewFiber.dispose()
    expect(barrier.signal()?.aborted).toBe(true)
  } finally {
    barrier.resolve(outcome === 'success' ? nouls({ goal: 0.1 }) : 'unknown')
    await pending
  }
  expect(h.ctx.goals.get(h.agent)).toMatchObject({ id: h.goal.id, revision: 2, phase: 'complete' })
  expect(h.reviews()).toEqual([])
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement')).toEqual([])
})

it('does not apply a completed judgement when the plugin unloads before the review resumes', async () => {
  const h = await nativeReview(() => Promise.resolve(nouls({ goal: 0.1 })))
  const run = DecisionKernel.runSystem3Decision
  const spy = vi.spyOn(DecisionKernel, 'runSystem3Decision').mockImplementation(async (...args) => {
    const result = await run(...args)
    await h.reviewFiber.dispose()
    return result
  })
  try {
    await h.run()
  } finally {
    spy.mockRestore()
  }
  expect(h.ctx.goals.get(h.agent)).toMatchObject({ id: h.goal.id, revision: 2, phase: 'complete' })
  expect(h.reviews()).toEqual([])
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement')).toHaveLength(1)
})

it.each([
  ['success', false], ['unknown', false], ['success', true], ['unknown', true],
] as const)('preserves caller cancellation for a late %s response with plugin unload %s', async (outcome, unload) => {
  const barrier = reviewBarrier(false)
  const h = await nativeReview(barrier.decide)
  const pending = h.run()
  try {
    await barrier.entered
    h.agent.cancel({ kind: 'user' })
    if (unload) await h.reviewFiber.dispose()
    expect(barrier.signal()?.aborted).toBe(true)
  } finally {
    barrier.resolve(outcome === 'success' ? nouls({ goal: 0.1 }) : 'unknown')
    await pending
  }
  expect(h.ctx.goals.get(h.agent)).toMatchObject({ id: h.goal.id, revision: 1, phase: 'active' })
  expect(h.reviews()).toEqual([])
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement')).toEqual([])
})

it('records but never refuses in shadow mode, and does nothing when off', async () => {
  const shadow = await setup({ config: { mode: 'shadow' }, answer: nouls({ goal: 0.1, r1: 0.1 }) })
  await shadow.run()
  expect(shadow.completed).toHaveBeenCalledTimes(1)
  expect(shadow.reviews()).toEqual([{ version: 1, goalId: 'g1', decision: 'incomplete', unmet: ['m2'], goalUnmet: true, refused: false }])

  const off = await setup({ config: { mode: 'off' }, answer: nouls({ goal: 0.1, r1: 0.1 }) })
  await off.run()
  expect(off.decide).not.toHaveBeenCalled()
  expect(off.completed).toHaveBeenCalledTimes(1)
  expect(off.reviews()).toEqual([])
})

it('lets a completion through when Jev misses the deadline or fails', async () => {
  const late = await setup({ config: { deadlineMs: 20 }, answer: (_request, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
  }) })
  await late.run()
  expect(late.completed).toHaveBeenCalledTimes(1)
  expect(late.reviews()).toEqual([{ version: 1, goalId: 'g1', decision: 'unsure', unmet: [], goalUnmet: false, refused: false }])
  expect(late.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement').map(event => event.data))
    .toMatchObject([{ reason: 'deadline', applied: false }])

  const failing = await setup({ answer: () => Promise.resolve('unknown') })
  await failing.run()
  expect(failing.completed).toHaveBeenCalledTimes(1)
  expect(failing.reviews()).toMatchObject([{ decision: 'unsure', refused: false }])
})

it('reviews only completions of the goal the task frame follows', async () => {
  const h = await setup({ answer: nouls({ goal: 0.1, r1: 0.1 }), calls: [
    ['bash', { command: 'git status' }], ['update_goal', { goal_id: 'g1', action: 'pause' }], ['update_goal', { goal_id: 'other', action: 'complete' }],
  ] })
  await h.run()
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.completed).toHaveBeenCalledTimes(2)

  const unframed = await setup({ answer: nouls({ goal: 0.1, r1: 0.1 }) })
  unframed.state.frame = null
  await unframed.run()
  // A frame started by a message rather than a DSH goal has no goal id to match.
  unframed.state.frame = { version: 1, goal: { messageId: brandString<MessageId>('m1'), text: '写一个模块' }, items: [] }
  unframed.script.push(toolCallResponse('c9', 'update_goal', COMPLETE), textResponse('done'))
  await unframed.run()
  expect(unframed.decide).not.toHaveBeenCalled()
  expect(unframed.completed).toHaveBeenCalledTimes(2)
  expect(unframed.reviews()).toEqual([])
})

it('leaves delegated Agents, nested calls, calls without an Agent, and malformed arguments alone', async () => {
  const h = await setup({ answer: nouls({ goal: 0.1, r1: 0.1 }), calls: [] })
  const { agent: child } = await h.ctx.agents.create({ sessionId: SessionId('child'), meta: { delegationDepth: 1 },
    agentOptions: { provider: 'mock', model: 'mock' } })
  h.script.splice(0, h.script.length, toolCallResponse('c1', 'update_goal', COMPLETE), textResponse('done'))
  child.followup(createUserMessage({ content: [{ type: 'text', text: '子任务' }], source: { kind: 'user' } }))
  await child.whenIdle()
  expect(h.completed).toHaveBeenCalledTimes(1)
  const execute = (args: unknown, extra: { readonly parent?: ToolExecutionToken } = {}) => h.ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId('direct'), name: 'update_goal', arguments: args, ...extra })
  await execute(COMPLETE)
  await execute(COMPLETE, { parent: Symbol('outer') as ToolExecutionToken })
  await execute(null)
  await execute('complete')
  await execute({ goal_id: 1, action: 'complete' })
  expect(h.decide).not.toHaveBeenCalled()
  expect(child.session.snapshotEvents().filter(event => event.type === 'system3/completion-review')).toEqual([])
})

const TASK_FRAME: System3TaskFrameConfig = { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 2000, sessionDataClasses: ['workspace'],
  maxItems: 4, maxMessageChars: 200 }

/** System3 configured with a task frame and the given completion review. */
async function service(completionReview: false | undefined | System3CompletionReviewConfig,
  taskFrame: false | System3TaskFrameConfig = TASK_FRAME) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation((request: JevRequest) =>
    Promise.resolve({ kind: 'ok', spec: ctx.jev.resolve(request), response: nouls({ goal: 0.1 }) }))
  const fiber = await ctx.plugin(System3, { privacyMode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'],
    taskFrame: taskFrame === false ? false : { ...taskFrame, sessionDataClasses: [...taskFrame.sessionDataClasses] },
    ...completionReview === undefined ? {} : { completionReview: completionReview === false ? false
      : { ...completionReview, sessionDataClasses: [...completionReview.sessionDataClasses] } } })
  return { ctx, decide, fiber }
}

it('reviews completions against the task frame the System3 service keeps', async () => {
  const { ctx, decide } = await service(CONFIG)
  const adapter = new MockAdapter([toolCallResponse('c1', 'update_goal', COMPLETE), textResponse('done')])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const completed = vi.fn(() => Promise.resolve('Goal complete'))
  ctx.tools.register(defineTool({ name: 'update_goal', description: 'Update the goal.',
    parameters: { goal_id: { type: 'string', required: true }, action: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: completed }))
  const agent = await ctx.agentLoop.create(SessionId('service'), { provider: 'mock', model: 'mock' })
  agent.session.append('system3/task-frame', { version: 1, goal: { goalId: GoalId('g1'), text: OBJECTIVE }, items: [] })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '完成了吗' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  // The task frame also judges the message; the review asks once, about the goal.
  expect(decide.mock.calls.filter(([request]) => 'goal' in request.questions)).toHaveLength(1)
  expect(completed).not.toHaveBeenCalled()
  expect(agent.session.snapshotEvents().filter(event => event.type === 'system3/completion-review').map(event => event.data))
    .toMatchObject([{ goalId: 'g1', goalUnmet: true, refused: true }])
})

it('installs the task frame without a review when completionReview is off or omitted, and requires a task frame for one', async () => {
  for (const review of [false, undefined] as const) {
    const { ctx } = await service(review)
    const adapter = new MockAdapter([toolCallResponse('c1', 'update_goal', COMPLETE), textResponse('done')])
    ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
    const completed = vi.fn(() => Promise.resolve('Goal complete'))
    ctx.tools.register(defineTool({ name: 'update_goal', description: 'Update the goal.',
      parameters: { goal_id: { type: 'string', required: true }, action: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: completed }))
    const agent = await ctx.agentLoop.create(SessionId('service'), { provider: 'mock', model: 'mock' })
    agent.session.append('system3/task-frame', { version: 1, goal: { goalId: GoalId('g1'), text: OBJECTIVE }, items: [] })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '完成了吗' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(completed).toHaveBeenCalledTimes(1)
  }
  await expect(service(false, false)).resolves.toBeDefined()
  await expect(service(CONFIG, false)).rejects.toThrow('completionReview needs taskFrame')
})

it.each(['active', 'shadow'] as const)('rejects an %s completion review when its task frame is off', async (mode) => {
  await expect(service({ ...CONFIG, mode }, { ...TASK_FRAME, mode: 'off' }).then(() => 'loaded'))
    .rejects.toThrow('completionReview needs taskFrame mode shadow or active')
})

it('allows both decisions to be off and a shadow task frame to support active or shadow completion review', async () => {
  await expect(service({ ...CONFIG, mode: 'off' }, { ...TASK_FRAME, mode: 'off' })).resolves.toBeDefined()
  for (const mode of ['active', 'shadow'] as const) {
    await expect(service({ ...CONFIG, mode }, { ...TASK_FRAME, mode: 'shadow' })).resolves.toBeDefined()
  }
})
