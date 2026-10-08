import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { JevRequest, JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type GenerateOptions, type MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import GoalService, { GoalId } from '@deepseek-ai/dsh-goal'
import { installSystem3TaskFrame, system3TaskFrameDecision, taskFrameText, validateSystem3TaskFrame,
  type System3TaskFrameConfig } from '../src/task-frame.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const CONFIG: System3TaskFrameConfig = { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 5000, sessionDataClasses: ['workspace'], maxItems: 2, maxMessageChars: 40 }
const SETTINGS = { yes: 0.5, no: 0.3 }

/** Jev answers: intent choice and the four yes/no probabilities. */
/** Yes/no probabilities by question; omitted questions answer 0. */
type Nouls = Partial<Record<'request' | 'requirement' | 'acceptance' | 'interrupt' | 'correction', number>>

function answers(intent: string, nouls: Nouls): JevResponse {
  return { model: 'jev-test', answers: {
    intent: { type: 'choice', choice: intent, probabilities: { [intent]: 0.9 }, confidence: 0.9 },
    request: { type: 'noul', noul: nouls.request ?? 0 }, requirement: { type: 'noul', noul: nouls.requirement ?? 0 },
    acceptance: { type: 'noul', noul: nouls.acceptance ?? 0 }, interrupt: { type: 'noul', noul: nouls.interrupt ?? 0 },
    correction: { type: 'noul', noul: nouls.correction ?? 0 },
  } }
}

it('decides from the intent choice and the yes/no answers', () => {
  const decide = (response: JevResponse) => system3TaskFrameDecision.decide(response, { mode: 'active', deadlineMs: 1, ...SETTINGS }, { goal: 'g', message: 'm' })
  expect(decide(answers('switch', { request: 0.9 }))).toBe('new-task')
  expect(decide(answers('switch', { request: 0.9, correction: 0.9 }))).toBe('add')
  expect(decide(answers('switch', { request: 0.1 }))).toBe('none')
  expect(decide(answers('continue', { acceptance: 0.8 }))).toBe('add')
  expect(decide(answers('side', {}))).toBe('none')
  // Stopping an action counts while the person continues the task; a farewell or a switch also says stop.
  expect(decide(answers('continue', { interrupt: 0.9 }))).toBe('add')
  expect(decide(answers('side', { interrupt: 0.9 }))).toBe('none')
  expect(decide(answers('switch', { interrupt: 0.9, request: 0.9 }))).toBe('new-task')
  expect(decide(answers('continue', { requirement: 0.4 }))).toBe('unsure')
  expect(decide(answers('unclear', {}))).toBe('unsure')
  expect(decide({ model: 'jev-test', answers: { intent: { type: 'choice', choice: 'continue', probabilities: { continue: 0.4 }, confidence: 0.4 } } })).toBe('unsure')
  expect(decide({ model: 'jev-test', answers: {} })).toBe('unsure')
})

it('quotes the task and the message in every question', () => {
  const questions = system3TaskFrameDecision.questions({ goal: '加一个汇总命令', message: '别动 README.md' })
  expect(Object.keys(questions)).toEqual(['intent', 'request', 'requirement', 'acceptance', 'interrupt', 'correction'])
  for (const question of Object.values(questions)) expect(question.instructions).toContain('「加一个汇总命令」。用户刚刚又发来一条消息：「别动 README.md」')
  expect(system3TaskFrameDecision.state({ goal: 'g', message: 'm' })).toEqual({ task: 'g', message: 'm' })
})

it('renders the frame only when it holds a requirement', () => {
  const goal = { messageId: brandString<MessageId>('m1'), text: '加一个汇总命令' }
  expect(taskFrameText(null)).toBe('')
  expect(taskFrameText({ goal, items: [] })).toBe('')
  expect(taskFrameText({ goal, items: [{ messageId: brandString<MessageId>('m2'), text: '别动 README.md' }] })).toBe(
    '[System3 任务卡] 用户在当前任务中提出了以下要求（均为原话）。在整个任务中遵守它们，宣布完成前逐条核对：\n任务：加一个汇总命令\n- 别动 README.md')
})

it('rejects configurations that cannot work', () => {
  expect(() => { validateSystem3TaskFrame({ ...CONFIG, maxItems: 0 }) }).toThrow('taskFrame maxItems must be a positive integer')
  expect(() => { validateSystem3TaskFrame({ ...CONFIG, maxMessageChars: 0 }) }).toThrow('taskFrame maxMessageChars must be a positive integer')
  expect(() => { validateSystem3TaskFrame({ ...CONFIG, yes: 0.2 }) }).toThrow('decisions.taskFrame thresholds must satisfy 0 <= no < yes <= 1')
})

/** Answers keyed by message text; unknown messages are side remarks. */
type Script = Readonly<Record<string, JevResponse>>

async function setup(script: Script, config: Partial<System3TaskFrameConfig> = {}, turns = 6, goals = false,
  responses?: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (goals) await ctx.plugin(GoalService)
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation((request: JevRequest) => {
    const instructions = request.questions.intent?.instructions ?? ''
    const message = /又发来一条消息：「(.*)」。/u.exec(instructions)?.[1] ?? ''
    return Promise.resolve({ kind: 'ok', spec: ctx.jev.resolve(request), response: script[message] ?? answers('side', {}) })
  })
  const adapter = new MockAdapter(responses ?? Array.from({ length: turns }, (_, index) => textResponse(`reply ${String(index + 1)}`)))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  installSystem3TaskFrame(ctx, { config: { ...CONFIG, ...config },
    policy: { mode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'] },
    options: { routeId: 'jev', executionDomain: 'network', effort: 'low' } })
  const agent = await ctx.agentLoop.create(SessionId('framed'), { provider: 'mock', model: 'mock' })
  const events = (type: string) => agent.session.snapshotEvents().filter(event => event.type === type).map(event => event.data)
  const frames = () => events('system3/task-frame') as { goal: { text: string }; items: { text: string }[] }[]
  const say = async (text: string, settled = frames().length + 1): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
    await vi.waitFor(() => { expect(frames().length + events('system3/judgement').length).toBeGreaterThanOrEqual(settled) })
  }
  const card = (request: GenerateOptions | undefined): string | undefined => request?.messages
    .filter(message => message.role === 'user' && message.source?.kind === 'runtime-context')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).at(-1)
  return { ctx, agent, adapter, decide, events, frames, say, card }
}

it('starts the frame from the first message, keeps later requirements, and shows them to the model from the next step', async () => {
  const h = await setup({ '别动 README.md': answers('continue', { requirement: 0.9 }), '谢谢': answers('side', {}),
    '测试必须全部通过': answers('continue', { acceptance: 0.9 }), '函数用 snake_case': answers('continue', { requirement: 0.9 }) })
  await h.say('加一个汇总命令', 1)
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.frames()).toMatchObject([{ version: 1, goal: { text: '加一个汇总命令' }, items: [] }])
  expect(h.frames()[0]?.goal).toHaveProperty('messageId')
  await h.say('别动 README.md', 3)
  await h.say('谢谢', 4)
  expect(h.frames().at(-1)?.items.map(item => item.text)).toEqual(['别动 README.md'])
  expect(h.card(h.adapter.requests[1])).toBeUndefined()
  expect(h.card(h.adapter.requests[2])).toContain(taskFrameText(h.frames().at(-1) as never))
  // An assembly outside any Agent has no frame to show.
  expect((await h.ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'system3:task-frame')?.text).toBe('')
  await h.say('测试必须全部通过', 6)
  await h.say('函数用 snake_case', 8)
  // The oldest requirement leaves once more than maxItems are kept.
  expect(h.frames().at(-1)?.items.map(item => item.text)).toEqual(['测试必须全部通过', '函数用 snake_case'])
  expect(h.events('system3/judgement')).toHaveLength(4)
  expect(h.events('system3/judgement')[1]).toMatchObject({ decision: 'task.frame', mode: 'active', outcome: 'none', applied: true })
})

it('starts a new frame when the person switches to unrelated work', async () => {
  const h = await setup({ '别动 README.md': answers('continue', { requirement: 0.9 }), '帮我写一封请假邮件': answers('switch', { request: 0.9 }) })
  await h.say('加一个汇总命令', 1)
  await h.say('别动 README.md', 3)
  await h.say('帮我写一封请假邮件', 5)
  expect(h.frames().at(-1)).toMatchObject({ goal: { text: '帮我写一封请假邮件' }, items: [] })
})

it('takes the task from a DSH goal and keeps it while the goal is open', async () => {
  const h = await setup({ '别动 README.md': answers('continue', { requirement: 0.9 }), '帮我写一封请假邮件': answers('switch', { request: 0.9 }) }, {}, 6, true)
  const created = h.ctx.goals.create(h.agent, { objective: '把记账工具的测试覆盖率提到 90%' })
  expect(h.frames()).toMatchObject([{ goal: { goalId: created.id, text: '把记账工具的测试覆盖率提到 90%' }, items: [] }])
  await h.say('别动 README.md', 2)
  // While the goal is open, a request for other work does not replace it.
  await h.say('帮我写一封请假邮件', 3)
  expect(h.frames().at(-1)).toMatchObject({ goal: { goalId: created.id }, items: [{ text: '别动 README.md' }] })
  const edited = h.ctx.goals.edit(h.agent, created, { objective: '把记账工具的测试覆盖率提到 95%' })
  expect(h.frames().at(-1)).toMatchObject({ goal: { text: '把记账工具的测试覆盖率提到 95%' }, items: [{ text: '别动 README.md' }] })
  const count = h.frames().length
  h.ctx.goals.edit(h.agent, edited, { maxGoalRounds: 3 })
  expect(h.frames()).toHaveLength(count)
  h.ctx.goals.complete(h.agent, h.ctx.goals.get(h.agent)!)
  await h.say('帮我写一封请假邮件', count + 2)
  expect(h.frames().at(-1)).toMatchObject({ goal: { text: '帮我写一封请假邮件' }, items: [] })
})

it('restores whether a goal is open from the Session log', async () => {
  const h = await setup({ '帮我写一封请假邮件': answers('switch', { request: 0.9 }) }, {}, 6, true)
  const goal = h.ctx.goals.create(h.agent, { objective: '整理发布说明' })
  h.ctx.goals.clear(h.agent, goal)
  await h.say('帮我写一封请假邮件', 3)
  expect(h.frames().at(-1)).toMatchObject({ goal: { text: '帮我写一封请假邮件' } })

  // A Session loaded with an open goal in its history keeps that goal as the task.
  const restored = await setup({ '帮我写一封请假邮件': answers('switch', { request: 0.9 }) }, {}, 6)
  const { agent } = await restored.ctx.agents.create({ sessionId: SessionId('loaded'), agentOptions: { provider: 'mock', model: 'mock' }, seed: [
    { type: 'goal/change', seq: SessionSeq(0), time: 1, data: { kind: 'goal/change', version: 1, operation: 'create', roundsStarted: 0, createdAt: 1,
      updatedAt: 1, goal: { id: GoalId('g1'), revision: 1, objective: '整理发布说明', phase: 'active', maxGoalRounds: 5 } } },
    { type: 'system3/task-frame', seq: SessionSeq(1), time: 2, data: { version: 1, goal: { goalId: GoalId('g1'), text: '整理发布说明' }, items: [] } },
  ] })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '帮我写一封请假邮件' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const loaded = (type: string) => agent.session.snapshotEvents().filter(event => event.type === type).map(event => event.data)
  await vi.waitFor(() => { expect(loaded('system3/judgement')).toMatchObject([{ outcome: 'new-task' }]) })
  expect(loaded('system3/task-frame')).toHaveLength(1)
})

it('ignores goal changes of delegated Agents, clears, and an off task frame', async () => {
  const off = await setup({}, { mode: 'off' }, 6, true)
  off.ctx.goals.create(off.agent, { objective: '整理发布说明' })
  expect(off.frames()).toEqual([])
  const h = await setup({}, {}, 6, true)
  const goal = h.ctx.goals.create(h.agent, { objective: '整理发布说明' })
  h.ctx.goals.clear(h.agent, goal)
  const { agent: child } = await h.ctx.agents.create({ sessionId: SessionId('child-goal'), meta: { delegationDepth: 1 }, agentOptions: { provider: 'mock', model: 'mock' } })
  h.ctx.goals.create(child, { objective: '子任务目标' })
  expect(h.frames()).toHaveLength(1)
  expect(child.session.snapshotEvents().filter(event => event.type === 'system3/task-frame')).toEqual([])
})

it('skips long, non-text, and delegated messages', async () => {
  const h = await setup({})
  await h.say('加一个汇总命令', 1)
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'x'.repeat(41) }], source: { kind: 'user' } }))
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '  ' }], source: { kind: 'user' } }))
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'see' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }] as never, source: { kind: 'user' } }))
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'advice' }], source: { kind: 'system3-supervision', rule: 'no-progress' } as never }))
  await h.agent.whenIdle()
  const { agent: child } = await h.ctx.agents.create({ sessionId: SessionId('child'), meta: { delegationDepth: 1 }, agentOptions: { provider: 'mock', model: 'mock' } })
  child.followup(createUserMessage({ content: [{ type: 'text', text: '子任务' }], source: { kind: 'user' } }))
  await child.whenIdle()
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.frames()).toHaveLength(1)
})

it('records judgements without changing the frame or the requests in shadow mode, and does nothing when off', async () => {
  const shadow = await setup({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { mode: 'shadow' })
  await shadow.say('加一个汇总命令', 0)
  await shadow.say('别动 README.md', 1)
  await shadow.say('谢谢', 2)
  await shadow.say('测试要通过', 3)
  expect(shadow.frames()).toEqual([])
  expect(shadow.events('system3/judgement')).toHaveLength(3)
  expect(shadow.events('system3/judgement')[0]).toMatchObject({ mode: 'shadow', outcome: 'add', applied: false })
  expect(shadow.card(shadow.adapter.requests[3])).toBeUndefined()

  const off = await setup({}, { mode: 'off' })
  await off.say('加一个汇总命令', 0)
  await off.say('别动 README.md', 0)
  expect(off.decide).not.toHaveBeenCalled()
  expect(off.events('system3/judgement')).toEqual([])
})

it('continues a frame restored from the Session log', async () => {
  const h = await setup({ '别动 README.md': answers('continue', { requirement: 0.9 }) })
  h.agent.session.append('system3/task-frame', { version: 1, goal: { messageId: 'earlier' as never, text: '加一个汇总命令' }, items: [] })
  await h.say('别动 README.md', 2)
  expect(h.decide).toHaveBeenCalledTimes(1)
  expect(h.frames().at(-1)).toMatchObject({ goal: { text: '加一个汇总命令' }, items: [{ text: '别动 README.md' }] })
})

it('logs an unexpected failure and stays quiet after disposal', async () => {
  const h = await setup({})
  const warn = vi.spyOn(h.ctx.logger, 'warn')
  await h.say('加一个汇总命令', 1)
  h.decide.mockRejectedValueOnce(new Error('socket hang up'))
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '别动 README.md' }], source: { kind: 'user' } }))
  await h.agent.whenIdle()
  await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('system3 task frame: Error: socket hang up') })

  const blocked = Promise.withResolvers<never>()
  h.decide.mockReturnValueOnce(blocked.promise)
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '谢谢' }], source: { kind: 'user' } }))
  await h.agent.whenIdle()
  await vi.waitFor(() => { expect(h.decide).toHaveBeenCalledTimes(2) })
  warn.mockClear()
  await h.ctx.fiber.dispose()
  blocked.reject(new Error('aborted'))
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(warn).not.toHaveBeenCalled()
})

/** A turn held open by a tool until released, so a new message queues behind it. */
async function running(script: Script, config: Partial<System3TaskFrameConfig>, controller: 'real' | 'failing' | 'none' = 'real',
  services: Readonly<Record<string, unknown>> = {}) {
  const h = await setup(script, config, 0, false, [toolCallResponse('c1', 'wait', {}), textResponse('step after the tool'), textResponse('next turn')])
  const gate = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  h.ctx.tools.register(defineTool({ name: 'wait', description: 'Wait.', parameters: {}, output: { schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }] },
  execute: async () => { entered.resolve(undefined); await gate.promise; return 'released' } }))
  const updateQueue = vi.fn(({ itemId }: { itemId: MessageId }) => {
    if (controller === 'failing') return Promise.reject(new Error('session/steer-unavailable'))
    const message = h.agent.inbox.nextTurn.find(queued => queued.id === itemId)!
    h.agent.inbox.remove(itemId)
    h.agent.steer(message)
    return Promise.resolve({ accepted: true })
  })
  const get = h.ctx.get.bind(h.ctx)
  vi.spyOn(h.ctx, 'get').mockImplementation(((name: string) => {
    const value: unknown = name === 'sessionController' ? controller === 'none' ? undefined : { updateQueue }
      : name in services ? services[name] : Reflect.apply(get, h.ctx, [name])
    return value
  }) as Context['get'])
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '加一个汇总命令' }], source: { kind: 'user' } }))
  await entered.promise
  const queue = async (text: string): Promise<void> => {
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(h.events('system3/interjection').length + h.decide.mock.calls.length).toBeGreaterThan(0) })
  }
  const release = async (): Promise<void> => { gate.resolve(undefined); await h.agent.whenIdle() }
  const seen = (index: number) => JSON.stringify(h.adapter.requests[index]?.messages ?? [])
  return { ...h, updateQueue, queue, release, seen }
}

it('moves a queued requirement into the running turn and does not judge it again when claimed', async () => {
  const h = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { interjection: 'active' })
  await h.queue('别动 README.md')
  await vi.waitFor(() => { expect(h.events('system3/interjection')).toHaveLength(1) })
  expect(h.events('system3/interjection')[0]).toMatchObject({ decision: 'steer', delivered: true })
  expect(h.updateQueue.mock.calls[0]?.[0]).toMatchObject({ sessionId: h.agent.session.id, action: { kind: 'steer' } })
  await h.release()
  // The step right after the tool already carries the requirement, inside the same turn.
  expect(h.seen(1)).toContain('别动 README.md')
  expect(h.adapter.requests).toHaveLength(2)
  expect(h.decide).toHaveBeenCalledTimes(1)
  expect(h.frames().at(-1)?.items.map(item => item.text)).toEqual(['别动 README.md'])
})

it('keeps a queued side question for the next turn', async () => {
  const h = await running({ '这个命令要多久？': answers('side', {}) }, { interjection: 'active' })
  await h.queue('这个命令要多久？')
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '谢谢' }], source: { kind: 'user' } }))
  await vi.waitFor(() => { expect(h.events('system3/interjection')).toMatchObject([{ decision: 'keep' }, { decision: 'keep', delivered: false }]) })
  await h.release()
  expect(h.updateQueue).not.toHaveBeenCalled()
  expect(h.seen(1)).not.toContain('这个命令要多久？')
  expect(h.seen(2)).toContain('这个命令要多久？')
  expect(h.decide).toHaveBeenCalledTimes(2)
})

it('records without moving in shadow mode, and leaves the item queued when the move fails or no controller exists', async () => {
  const shadow = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { interjection: 'shadow' })
  await shadow.queue('别动 README.md')
  await vi.waitFor(() => { expect(shadow.events('system3/interjection')).toMatchObject([{ decision: 'steer', delivered: false }]) })
  expect(shadow.updateQueue).not.toHaveBeenCalled()
  await shadow.release()

  const failing = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { interjection: 'active' }, 'failing')
  const info = vi.spyOn(failing.ctx.logger, 'info')
  await failing.queue('别动 README.md')
  await vi.waitFor(() => { expect(failing.events('system3/interjection')).toMatchObject([{ decision: 'steer', delivered: false }]) })
  expect(info).toHaveBeenCalledWith('system3 interjection not delivered: Error: session/steer-unavailable')
  await failing.release()
  expect(failing.seen(2)).toContain('别动 README.md')

  const absent = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { interjection: 'active' }, 'none')
  await absent.queue('别动 README.md')
  await vi.waitFor(() => { expect(absent.events('system3/interjection')).toMatchObject([{ decision: 'steer', delivered: false }]) })
  await absent.release()
})

it('leaves queued messages to the next turn without interjection, and skips steered, attached, and failed ones', async () => {
  const plain = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, {})
  await plain.queue('别动 README.md').catch(() => undefined)
  await plain.release()
  expect(plain.events('system3/interjection')).toEqual([])
  expect(plain.seen(2)).toContain('别动 README.md')

  const h = await running({}, { interjection: 'active' })
  h.agent.steer(createUserMessage({ content: [{ type: 'text', text: '直接插入的话' }], source: { kind: 'user' } }))
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'see' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }] as never,
    source: { kind: 'user' } }))
  h.decide.mockRejectedValueOnce(new Error('socket hang up'))
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '失败的判断' }], source: { kind: 'user' } }))
  await vi.waitFor(() => { expect(h.decide).toHaveBeenCalledTimes(1) })
  await h.release()
  expect(h.events('system3/interjection')).toEqual([])
})

/** Session projections whose System3 runtime state shows one delegated run. */
const delegated = (run: { readonly state: string; readonly steerable: boolean }) => ({
  stateOf: () => ({ subagentRun: { runId: 'run-1', provider: 'codex', ...run } }),
})

it('also sends a moved requirement to a running delegated run that accepts input', async () => {
  const steerByParent = vi.fn(() => Promise.resolve({ accepted: true }))
  const h = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { interjection: 'active' }, 'real',
    { sessionProjections: delegated({ state: 'running', steerable: true }), subagents: { steerByParent } })
  await h.queue('别动 README.md')
  await vi.waitFor(() => { expect(h.events('system3/interjection')).toMatchObject([{ delivered: true, forwardedTo: 'codex' }]) })
  expect(steerByParent).toHaveBeenCalledWith({ runId: 'run-1', parentSessionId: h.agent.session.id, text: '别动 README.md' }, expect.any(AbortSignal))
  await h.release()
})

it('does not forward to a finished or non-steerable run, a run that refuses, or without the subagent service', async () => {
  const refused = vi.fn(() => Promise.reject(new Error('subagent/not-steerable')))
  const cases: readonly Readonly<Record<string, unknown>>[] = [
    { sessionProjections: delegated({ state: 'completed', steerable: false }), subagents: { steerByParent: refused } },
    { sessionProjections: delegated({ state: 'running', steerable: false }), subagents: { steerByParent: refused } },
    { sessionProjections: delegated({ state: 'running', steerable: true }), subagents: undefined },
  ]
  for (const services of cases) {
    const h = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { interjection: 'active' }, 'real', services)
    await h.queue('别动 README.md')
    await vi.waitFor(() => { expect(h.events('system3/interjection')).toMatchObject([{ delivered: true }]) })
    expect(h.events('system3/interjection')[0]).not.toHaveProperty('forwardedTo')
    await h.release()
  }
  expect(refused).not.toHaveBeenCalled()

  const h = await running({ '别动 README.md': answers('continue', { requirement: 0.9 }) }, { interjection: 'active' }, 'real',
    { sessionProjections: delegated({ state: 'running', steerable: true }), subagents: { steerByParent: refused } })
  const info = vi.spyOn(h.ctx.logger, 'info')
  await h.queue('别动 README.md')
  await vi.waitFor(() => { expect(info).toHaveBeenCalledWith('system3 interjection not forwarded: Error: subagent/not-steerable') })
  expect(h.events('system3/interjection')[0]).not.toHaveProperty('forwardedTo')
  await h.release()
})
