import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAssistantMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import Jev, { type JevRequest } from '../../apus-dsh-jev-plugin/src/index.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { delegationInstruction, installSystem3Delegation } from '../src/delegation.ts'
import { createSystem3EntryRouter, type System3EntryRoutingConfig } from '../src/entry-routing.ts'
import { handoffText, validateSystem3HandoffPack, type System3HandoffPackConfig, type System3HandoffSettings } from '../src/handoff-pack.ts'
import System3 from '../src/index.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const routing: System3EntryRoutingConfig = {
  candidates: [{ id: 'codex', description: '工程任务', label: 'Codex', delegate: { provider: 'codex', tool: 'subagent_codex' },
    executionDomain: 'local', dataClasses: ['workspace'] }],
  sessionDataClasses: ['workspace'], minConfidence: 0.5, maxInputBytes: 8000,
}
const PACK: System3HandoffPackConfig = { recentMessages: 3, maxMessageChars: 40, minProbability: 0.5, deadlineMs: 5000 }
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const text = (value: string, source: UserMessage['source'] = { kind: 'user' }) => createUserMessage({ content: [{ type: 'text', text: value }], source })

async function setup(earlier: readonly UserMessage[], settings: Partial<System3HandoffSettings> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.sessionProjections.register(system3RuntimeProjection)
  const adapter = new MockAdapter([])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  /** Probabilities Jev gives, per earlier message in request order. */
  let nouls: number[] = []
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async (query: JevRequest) => ({ kind: 'ok', spec: ctx.jev.resolve(query),
    response: { model: 'jev-test', answers: query.questions.route !== undefined
      ? { route: { type: 'choice', choice: 'codex', confidence: 0.9, probabilities: { codex: 0.9 } } }
      : Object.fromEntries(nouls.map((noul, index) => [`m${String(index + 1)}`, { type: 'noul' as const, noul }])) } }))
  const get = (name: string): unknown => ctx.reflect.get(name)
  vi.spyOn(ctx, 'get').mockImplementation(((name: string) => {
    if (name === 'subagents') return { getProvider: () => ({}) }
    if (name === 'tools') return { get: () => ({}) }
    return get(name)
  }) as Context['get'])
  const agent = await ctx.agentLoop.create(SessionId('handoff'), { provider: 'mock', model: 'fast' })
  for (const message of earlier) agent.session.append('user/message', message, { surfaceOp: 'append' })
  const reply = createAssistantMessage({ content: [{ type: 'text', text: '好的' }], source: { provider: 'mock', model: 'fast' } })
  agent.session.append('assistant/message', { turn: 1, step: 0, stream: [], message: reply }, { surfaceOp: 'append' })
  const requestId = brandString<SessionRequestId>('delegate')
  const input = text('把登录接口交给 Codex 实现', { kind: 'user', rpcId: requestId })
  const router = createSystem3EntryRouter(ctx, routing, { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  await router.route({ agent, requestId, baseline: { provider: 'mock', model: 'fast' }, message: input }, new AbortController().signal)
  installSystem3Delegation(ctx, { config: PACK, policy: { mode: 'local-only' }, options: { routeId: 'jev', executionDomain: 'local', effort: 'low' },
    dataClasses: ['workspace'], ...settings })
  const step = async (signal = new AbortController().signal) => {
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [input], turn: 2, step: 0, signal },
      () => Promise.resolve({ kind: 'enter', messages: [input] }))
    if (decision.kind !== 'enter') throw new Error('expected enter')
    const instruction = decision.messages.at(-1)!
    return instruction.content.map(block => block.type === 'text' ? block.text : '').join('')
  }
  const pack = () => agent.session.snapshotEvents().findLast(event => event.type === 'system3/handoff-pack')?.data
  const handoffCalls = () => decide.mock.calls.map(call => call[0]).filter(query => query.questions.route === undefined)
  return { ctx, agent, decide, step, pack, handoffCalls, setNouls: (value: number[]) => { nouls = value } }
}

it('forwards earlier requirements verbatim and records which messages they came from', async () => {
  const naming = text('函数名一律用 snake_case')
  const readme = text('不要改 README')
  const h = await setup([text('先介绍一下这个项目'), naming, text('x'.repeat(41)),
    createUserMessage({ content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: { attachmentId: brandString<AttachmentId>('image-1'),
      mediaType: 'image/png', bytes: 4, width: 1, height: 1 } }], source: { kind: 'user' } }),
    text('   '), createUserMessage({ content: [], source: { kind: 'user' } }), text('[System3 入口判断] ...', { kind: 'system3-delegation', requestId: brandString<SessionRequestId>('old'), candidateId: 'codex', tool: 'subagent_codex' }),
    text('今天先到这里'), readme])
  h.setNouls([0.9, 0.2, 0.8])
  expect(await h.step()).toBe(`${delegationInstruction('Codex', 'subagent_codex')}\n\n${handoffText('Codex', ['函数名一律用 snake_case', '不要改 README'])}`)
  const [query] = h.handoffCalls()
  expect(query?.state).toEqual({ task: '把登录接口交给 Codex 实现', earlier: ['函数名一律用 snake_case', '今天先到这里', '不要改 README'] })
  expect(Object.keys(query?.questions ?? {})).toEqual(['m1', 'm2', 'm3'])
  expect(h.pack()).toMatchObject({ version: 1, requestId: 'delegate', outcome: 'packed', constraints: [naming.id, readme.id], request: query })
})

it('sends the instruction alone when no earlier message is a requirement or there is no history', async () => {
  const none = await setup([text('你好')])
  none.setNouls([0.1])
  expect(await none.step()).toBe(delegationInstruction('Codex', 'subagent_codex'))
  expect(none.pack()).toMatchObject({ outcome: 'none', constraints: [] })

  const empty = await setup([])
  expect(await empty.step()).toBe(delegationInstruction('Codex', 'subagent_codex'))
  expect(empty.handoffCalls()).toEqual([])
  expect(empty.pack()).toMatchObject({ outcome: 'no-history', request: null })
})

it('does not ask Jev when privacy forbids it or Jev is absent, and records a Jev failure', async () => {
  const denied = await setup([text('不要改 README')], { options: { routeId: 'jev', executionDomain: 'network', effort: 'low' } })
  expect(await denied.step()).toBe(delegationInstruction('Codex', 'subagent_codex'))
  expect(denied.pack()).toMatchObject({ outcome: 'privacy-denied', request: null })

  const absent = await setup([text('不要改 README')])
  vi.spyOn(absent.ctx, 'get').mockImplementation(((name: string) => {
    const value: unknown = name === 'jev' ? undefined : absent.ctx.reflect.get(name)
    return value
  }) as Context['get'])
  await absent.step()
  expect(absent.pack()).toMatchObject({ outcome: 'provider-unavailable', request: null })

  const failing = await setup([text('不要改 README')])
  failing.decide.mockImplementation(async query => ({ kind: 'unknown', spec: failing.ctx.jev.resolve(query), failure: { code: 'http', message: 'down' } }))
  expect(await failing.step()).toBe(delegationInstruction('Codex', 'subagent_codex'))
  expect(failing.pack()).toMatchObject({ outcome: 'http' })
})

it('gives up at the deadline without blocking the delegation, but rejects when the turn is cancelled', async () => {
  const slow = await setup([text('不要改 README')], { config: { ...PACK, deadlineMs: 5 } })
  const hang = (_query: JevRequest, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
    if (signal?.aborted === true) reject(signal.reason as Error)
    signal?.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
  })
  slow.decide.mockImplementation(hang)
  expect(await slow.step()).toBe(delegationInstruction('Codex', 'subagent_codex'))
  expect(slow.pack()).toMatchObject({ outcome: 'timeout' })

  const cancelled = await setup([text('不要改 README')])
  cancelled.decide.mockImplementation(hang)
  const turn = new AbortController()
  const pending = cancelled.step(turn.signal)
  turn.abort(new Error('stopped'))
  await expect(pending).rejects.toThrow('stopped')

  const broken = await setup([text('不要改 README')])
  broken.decide.mockRejectedValue(new Error('protocol'))
  await expect(broken.step()).rejects.toThrow('protocol')
})

it('rejects settings that cannot produce a valid review', () => {
  expect(() => { validateSystem3HandoffPack(PACK) }).not.toThrow()
  expect(() => { validateSystem3HandoffPack({ ...PACK, recentMessages: 17 }) }).toThrow('handoffPack recentMessages must be an integer from 1 to 16')
  expect(() => { validateSystem3HandoffPack({ ...PACK, maxMessageChars: 0 }) }).toThrow('handoffPack maxMessageChars must be a positive integer')
  expect(() => { validateSystem3HandoffPack({ ...PACK, minProbability: 0 }) }).toThrow('handoffPack minProbability must be above 0 and at most 1')
  for (const deadlineMs of [0, 1.5, 2 ** 31]) {
    expect(() => { validateSystem3HandoffPack({ ...PACK, deadlineMs }) }).toThrow('handoffPack deadlineMs must be a positive integer within the timer limit')
  }
  for (const recentMessages of [0, 2.5]) expect(() => { validateSystem3HandoffPack({ ...PACK, recentMessages }) }).toThrow('recentMessages')
})

it('loads delegation with or without a hand-off pack and fails loud on an invalid one', async () => {
  const entryRouting = (handoffPack?: System3HandoffPackConfig) => ({ sessionDataClasses: ['workspace' as const], minConfidence: 0.5, maxInputBytes: 8000,
    candidates: [{ id: 'codex', description: '工程任务', delegate: { provider: 'codex', tool: 'subagent_codex' },
      executionDomain: 'local' as const, dataClasses: ['workspace' as const] }], ...handoffPack === undefined ? {} : { handoffPack } })
  for (const handoffPack of [undefined, PACK]) {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(System3, { entryRouting: entryRouting(handoffPack) })
    expect(ctx.get('system3')).toBeDefined()
  }
  const ctx = new Context()
  contexts.push(ctx)
  await expect(ctx.plugin(System3, { entryRouting: entryRouting({ ...PACK, minProbability: 0 }) }))
    .rejects.toThrow('handoffPack minProbability must be above 0 and at most 1')
})
