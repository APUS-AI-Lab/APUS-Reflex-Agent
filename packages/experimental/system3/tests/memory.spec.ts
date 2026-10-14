import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { JevRequest, JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, type GenerateOptions, type MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionSeq } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { installSystem3MemoryRecall, installSystem3MemoryScoring, memoryText, recallText, selectRecallCandidates,
  system3MemoryRecallDecision, system3MemoryScoreDecision, validateSystem3MemoryRecall, validateSystem3MemoryScoring,
  type System3MemoryRecall, type System3MemoryRecallConfig, type System3MemoryScore, type System3MemoryScoringConfig } from '../src/memory.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'
import System3 from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const CONFIG: System3MemoryScoringConfig = { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 5000, sessionDataClasses: ['workspace'],
  maxCandidates: 4, maxMessageChars: 80, maxItems: 3 }
const SETTINGS = { mode: 'active' as const, deadlineMs: 1, yes: 0.5, no: 0.3 }
const candidate = (seq: number, text: string) => ({ seq, messageId: brandString<MessageId>(`m${seq}`), text })
const noul = (value: number) => ({ type: 'noul' as const, noul: value })

it('keeps a span when any message is needed and drops it only when every answer is confident', () => {
  const input = { candidates: [candidate(3, '别动 README.md'), candidate(7, '谢谢')] }
  const decide = (answers: JevResponse['answers']) => system3MemoryScoreDecision.decide({ model: 'jev', answers }, SETTINGS, input)
  expect(decide({ m3: noul(0.9), m7: noul(0.1) })).toBe('keep')
  expect(decide({ m3: noul(0.1), m7: noul(0.2) })).toBe('none')
  expect(decide({ m3: noul(0.4), m7: noul(0.1) })).toBe('unsure')
  expect(decide({ m3: noul(0.1) })).toBe('unsure')
})

it('quotes each message in its own question and sends only the texts as state', () => {
  const input = { candidates: [candidate(3, '别动 README.md'), candidate(7, '端口改成 8443')] }
  const questions = system3MemoryScoreDecision.questions(input)
  expect(Object.keys(questions)).toEqual(['m3', 'm7'])
  expect(questions.m7?.instructions).toContain('「端口改成 8443」')
  expect(system3MemoryScoreDecision.state(input)).toEqual({ messages: ['别动 README.md', '端口改成 8443'] })
})

it('renders kept messages verbatim with their checkpoints', () => {
  expect(memoryText([])).toBe('')
  expect(memoryText([{ checkpoint: 12, seq: 3, text: '别动 README.md' }])).toBe(
    '[System3 记忆] 以下用户原话所在的对话已被压缩，经评分判断之后仍须遵守或引用（均为原话）。需要上下文时，用 history_read 读取对应检查点的原文：'
    + '\n- 检查点 12，#3：别动 README.md')
})

it('rejects configurations that cannot work', () => {
  expect(() => { validateSystem3MemoryScoring({ ...CONFIG, maxCandidates: 0 }) }).toThrow('memoryScoring maxCandidates must be a positive integer')
  expect(() => { validateSystem3MemoryScoring({ ...CONFIG, maxItems: 1.5 }) }).toThrow('memoryScoring maxItems must be a positive integer')
  expect(() => { validateSystem3MemoryScoring({ ...CONFIG, yes: 0.2 }) }).toThrow('thresholds must satisfy 0 <= no < yes <= 1')
})

const RECALL: System3MemoryRecallConfig = { mode: 'active', yes: 0.7, no: 0.3, deadlineMs: 5000, sessionDataClasses: ['workspace'],
  maxCandidates: 4, maxInputChars: 80, maxMessageChars: 80 }

async function setup(probabilities: Readonly<Record<string, number>>, config: Partial<System3MemoryScoringConfig> = {},
  recall?: { readonly config?: Partial<System3MemoryRecallConfig>; readonly probabilities: Readonly<Record<string, number>> },
  projection = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  if (projection) ctx.sessionProjections.register(system3RuntimeProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation((request: JevRequest) => {
    const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
      const recalled = /已移出上下文的一条用户原话：「(.*)」。/u.exec(question.instructions ?? '')?.[1]
      if (recalled !== undefined) {
        const input = /用户当前输入：「(.*?)」。/u.exec(question.instructions ?? '')?.[1] ?? ''
        return [key, noul(recall?.probabilities[`${input}::${recalled}`] ?? recall?.probabilities[recalled] ?? 0)]
      }
      const text = /已被压缩成摘要：「(.*)」。/u.exec(question.instructions ?? '')?.[1] ?? ''
      return [key, noul(probabilities[text] ?? 0)]
    }))
    return Promise.resolve({ kind: 'ok', spec: ctx.jev.resolve(request), response: { model: 'jev-test', answers } })
  })
  const adapter = new MockAdapter(Array.from({ length: 10 }, (_, index) => textResponse(`reply ${String(index + 1)}`)))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const policy = { mode: 'controlled' as const, approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace' as const] }
  const options = { routeId: 'jev', executionDomain: 'network' as const, effort: 'low' as const }
  const recallConfig = recall === undefined ? undefined : { ...RECALL, ...recall.config }
  installSystem3MemoryScoring(ctx, { config: { ...CONFIG, ...config }, policy, options, recallActive: recallConfig?.mode === 'active' })
  if (recallConfig !== undefined) installSystem3MemoryRecall(ctx, { config: recallConfig, policy, options })
  const agent = await ctx.agentLoop.create(SessionId('memory'), { provider: 'mock', model: 'mock' })
  const events = (type: string) => agent.session.snapshotEvents().filter(event => event.type === type)
  const say = async (text: string): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  /** Record a compaction of every person message so far, as compaction-basic does before replacing the span. */
  const compact = (): number => {
    const seqs = events('user/message').map(event => event.seq)
    return agent.session.append('compaction/summary', { compactionId: CompactionId('c1'), summary: [{ type: 'text', text: 's' }],
      shadowedRange: { start: seqs[0]!, end: seqs.at(-1)! }, shadowedSeqs: seqs, shadowedTokenCount: 10,
      provider: 'mock', model: 'mock' }).seq
  }
  const context = (request: GenerateOptions | undefined): string => (request?.messages ?? [])
    .filter(message => message.role === 'user' && message.source?.kind === 'runtime-context')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
  /** The newest runtime-context snapshot of a request; earlier snapshots stay in history but no longer apply. */
  const latestContext = (request: GenerateOptions | undefined): string => (request?.messages ?? [])
    .filter(message => message.role === 'user' && message.source?.kind === 'runtime-context').at(-1)?.content
    .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
  return { ctx, agent, adapter, decide, events, say, compact, context, latestContext }
}

it('scores the compacted person messages and shows the kept ones to the model from the next request', async () => {
  const h = await setup({ '别动 README.md': 0.92, '端口改成 8443': 0.81 })
  await h.say('别动 README.md')
  await h.say('谢谢')
  await h.say('端口改成 8443')
  const checkpoint = h.compact()
  await h.say('继续')
  await vi.waitFor(() => { expect(h.events('system3/memory-score')).toHaveLength(1) })

  expect(h.decide).toHaveBeenCalledTimes(1)
  expect(Object.keys(h.decide.mock.calls[0]![0].questions)).toHaveLength(3)
  const score = h.events('system3/memory-score')[0]!.data as System3MemoryScore
  expect(score).toMatchObject({ version: 1, checkpoint, scanned: 3 })
  expect(score.items.map(item => [item.text, item.probability])).toEqual([['别动 README.md', 0.92], ['端口改成 8443', 0.81]])
  expect(h.events('system3/judgement').at(-1)?.data).toMatchObject({ decision: 'memory.score', applied: true, reason: 'judged' })

  await h.say('再继续')
  const latest = h.context(h.adapter.requests.at(-1))
  expect(latest).toContain(`- 检查点 ${checkpoint}，#`)
  expect(latest).toContain('：别动 README.md')
  expect(latest).not.toContain('谢谢')
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.memory).toHaveLength(2)
})

it('records only the judgement in shadow mode and when no message is needed', async () => {
  const shadow = await setup({ '别动 README.md': 0.92 }, { mode: 'shadow' })
  await shadow.say('别动 README.md')
  shadow.compact()
  await shadow.say('继续')
  await vi.waitFor(() => { expect(shadow.events('system3/judgement')).toHaveLength(1) })
  expect(shadow.events('system3/memory-score')).toHaveLength(0)
  expect(shadow.context(shadow.adapter.requests.at(-1))).not.toContain('System3 记忆')

  const none = await setup({})
  await none.say('谢谢')
  none.compact()
  await none.say('继续')
  await vi.waitFor(() => { expect(none.events('system3/judgement')).toHaveLength(1) })
  expect(none.events('system3/judgement')[0]?.data).toMatchObject({ outcome: 'none', applied: true })
  expect(none.events('system3/memory-score')).toHaveLength(0)
})

it('skips a compaction that replaced no person message and messages over the size limit', async () => {
  const h = await setup({ x: 1 }, { maxMessageChars: 3 })
  await h.say('a much longer message')
  h.compact()
  await h.say('继续')
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.events('system3/judgement')).toHaveLength(0)
})

it('recalls when any memory is relevant and stays silent only when every answer is confident', () => {
  const memory = (seq: number, text: string) => ({ checkpoint: 9, seq, messageId: brandString<MessageId>(`m${String(seq)}`), text })
  const input = { input: '阈值是多少？', candidates: [memory(3, '阈值 100 美元'), memory(7, '部署在 us-east-1')], maxMessageChars: 9 }
  const decide = (answers: JevResponse['answers']) => system3MemoryRecallDecision.decide({ model: 'jev', answers }, SETTINGS, input)
  expect(decide({ r3: noul(0.95), r7: noul(0.02) })).toBe('recall')
  expect(decide({ r3: noul(0.1), r7: noul(0.2) })).toBe('none')
  expect(decide({ r3: noul(0.4), r7: noul(0.1) })).toBe('unsure')
  expect(decide({ r3: noul(0.1) })).toBe('unsure')
  const questions = system3MemoryRecallDecision.questions(input)
  expect(Object.keys(questions)).toEqual(['r3', 'r7'])
  expect(questions.r3?.instructions).toContain('用户当前输入：「阈值是多少？」')
  expect(questions.r3?.instructions).toContain('已移出上下文的一条用户原话：「阈值 100 美元」')
  expect(questions.r7?.instructions).toContain('「部署在 us-ea……」')
  expect(system3MemoryRecallDecision.state(input)).toEqual({ input: '阈值是多少？', memories: ['阈值 100 美元', '部署在 us-ea……'] })
})

it('renders recalled memories verbatim with their checkpoints', () => {
  expect(recallText([], 8)).toBe('')
  expect(recallText([{ checkpoint: 12, seq: 3, text: '阈值 100 美元' }, { checkpoint: 12, seq: 5, text: '部署在 us-east-1' }], 9)).toBe(
    '[System3 记忆召回] 以下用户原话所在的对话已被压缩，经评分判断与当前输入相关（均为原话）。需要上下文时，用 history_read 读取对应检查点的原文：'
    + '\n- 检查点 12，#3：阈值 100 美元'
    + '\n- 检查点 12，#5：部署在 us-ea……（节选，原文共 13 字，完整原文用 history_read 读取检查点 12）')
})

it('prefilters candidates by shared character pairs, then kept ones, then newer ones, and keeps them oldest first', () => {
  const memories = [{ seq: 1, text: '部署在 us-east-1' }, { seq: 2, text: '金额阈值 100 美元' }, { seq: 3, text: '午饭吃面' },
    { seq: 4, text: '只统计已支付订单' }]
  const none = new Set<number>()
  expect(selectRecallCandidates('任何问题', memories, none, 4)).toEqual(memories)
  expect(selectRecallCandidates('金额阈值是多少？只统计已支付的吗', memories, none, 2).map(memory => memory.seq)).toEqual([2, 4])
  expect(selectRecallCandidates('无关', memories, none, 2).map(memory => memory.seq)).toEqual([3, 4])
  expect(selectRecallCandidates('无关', memories, new Set([1]), 2).map(memory => memory.seq)).toEqual([1, 4])
})

it('rejects recall configurations that cannot work', () => {
  expect(() => { validateSystem3MemoryRecall({ ...RECALL, maxCandidates: 17 }) }).toThrow('memoryRecall maxCandidates must be an integer from 1 to 16')
  expect(() => { validateSystem3MemoryRecall({ ...RECALL, maxCandidates: 0 }) }).toThrow('memoryRecall maxCandidates must be an integer from 1 to 16')
  expect(() => { validateSystem3MemoryRecall({ ...RECALL, maxInputChars: 0 }) }).toThrow('memoryRecall maxInputChars must be a positive integer')
  expect(() => { validateSystem3MemoryRecall({ ...RECALL, maxMessageChars: 0 }) }).toThrow('memoryRecall maxMessageChars must be a positive integer')
  expect(() => { validateSystem3MemoryRecall({ ...RECALL, yes: 0.2 }) }).toThrow('thresholds must satisfy 0 <= no < yes <= 1')
})

/** Keep two memories through one scored compaction, then return the harness for recall turns. */
async function remembered(recall: {
  readonly config?: Partial<System3MemoryRecallConfig>
  readonly probabilities: Readonly<Record<string, number>>
}) {
  const h = await setup({ '金额阈值 100 美元': 0.92, '部署在 us-east-1': 0.85 }, {}, recall)
  await h.say('金额阈值 100 美元')
  await h.say('部署在 us-east-1')
  const checkpoint = h.compact()
  await h.say('继续')
  await vi.waitFor(() => { expect(h.events('system3/memory-score')).toHaveLength(1) })
  return { ...h, checkpoint }
}

it('judges kept memories against each new input and shows only the recalled ones to the model in that request', async () => {
  const h = await remembered({ probabilities: { '金额阈值是多少？::金额阈值 100 美元': 0.97, '部署在 us-east-1': 0.02 } })
  await h.say('金额阈值是多少？')
  const recalls = h.events('system3/memory-recall')
  expect(recalls).toHaveLength(1)
  const recall = recalls[0]!.data as System3MemoryRecall
  expect(recall).toMatchObject({ version: 1, scanned: 2 })
  expect(recall.items.map(item => [item.text, item.probability, item.checkpoint])).toEqual([['金额阈值 100 美元', 0.97, h.checkpoint]])
  expect(recall.messageId).toBe(h.events('user/message')
    .flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user' ? [event.data.id] : []).at(-1))
  expect(h.events('system3/judgement').at(-1)?.data).toMatchObject({ decision: 'memory.recall', applied: true, reason: 'judged', outcome: 'recall' })
  const shown = h.context(h.adapter.requests.at(-1))
  expect(shown).toContain('[System3 记忆召回]')
  expect(shown).toContain('：金额阈值 100 美元')
  expect(shown).not.toContain('us-east-1')
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.recall?.items).toHaveLength(1)

  await h.say('今天天气如何？')
  expect(h.events('system3/memory-recall')).toHaveLength(2)
  expect((h.events('system3/memory-recall')[1]!.data as System3MemoryRecall).items).toEqual([])
  expect(h.latestContext(h.adapter.requests.at(-1))).toBe('Current runtime context: none. Earlier runtime-context snapshots no longer apply.')

  await h.say('还是不相关')
  expect(h.events('system3/memory-recall')).toHaveLength(2)
})

it('records only the judgement in shadow mode and keeps the scored memories in the context', async () => {
  const h = await remembered({ config: { mode: 'shadow' }, probabilities: { '金额阈值 100 美元': 0.97 } })
  await h.say('金额阈值是多少？')
  expect(h.events('system3/memory-recall')).toHaveLength(0)
  expect(h.events('system3/judgement').at(-1)?.data).toMatchObject({ decision: 'memory.recall', mode: 'shadow', applied: false })
  const shown = h.context(h.adapter.requests.at(-1))
  expect(shown).toContain('[System3 记忆] ')
  expect(shown).toContain('us-east-1')
})

it('asks nothing before compaction moves an input out of the context, and in off mode', async () => {
  const empty = await setup({}, {}, { probabilities: {} })
  await empty.say('金额阈值 100 美元')
  await empty.say('金额阈值是多少？')
  expect(empty.decide).not.toHaveBeenCalled()

  const off = await remembered({ config: { mode: 'off' }, probabilities: { '金额阈值 100 美元': 0.97 } })
  await off.say('金额阈值是多少？')
  expect(off.events('system3/judgement').filter(event => event.type === 'system3/judgement' && event.data.decision === 'memory.recall'))
    .toHaveLength(0)
})

it('recalls compacted inputs that scoring did not keep, judging a long input by its beginning', async () => {
  const h = await remembered({ config: { maxInputChars: 6 }, probabilities: { '金额阈值是多……::部署在 us-east-1': 0.9 } })
  h.decide.mockClear()
  await h.say('金额阈值是多少？我还想问部署区域')
  const asked = Object.values(h.decide.mock.calls[0]![0].questions).map(question => question.instructions ?? '')
  expect(asked).toHaveLength(2)
  expect(asked.every(text => text.includes('用户当前输入：「金额阈值是多……」'))).toBe(true)
  expect((h.events('system3/memory-recall')[0]!.data as System3MemoryRecall).items.map(item => item.text)).toEqual(['部署在 us-east-1'])
})

it('recalls without memory scoring, from the compacted inputs alone', async () => {
  const h = await setup({}, { mode: 'off' }, { probabilities: { '部署在 us-east-1': 0.9 } })
  await h.say('部署在 us-east-1')
  h.compact()
  await h.say('部署在哪？')
  expect(h.events('system3/memory-score')).toHaveLength(0)
  expect((h.events('system3/memory-recall')[0]!.data as System3MemoryRecall).items.map(item => item.text)).toEqual(['部署在 us-east-1'])
  expect(h.context(h.adapter.requests.at(-1))).toContain('：部署在 us-east-1')
})

it('recalls nothing when Jev misses the deadline', async () => {
  const h = await remembered({ config: { deadlineMs: 20 }, probabilities: {} })
  h.decide.mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { reject(new Error('Jev request aborted', { cause: signal.reason })) }, { once: true })
  }))
  await h.say('金额阈值是多少？')
  expect(h.events('system3/memory-recall')).toHaveLength(0)
  expect(h.events('system3/judgement').at(-1)?.data).toMatchObject({ decision: 'memory.recall', reason: 'deadline', applied: false })
})

it('scores only known plain-text person messages and skips spans with none left', async () => {
  const h = await setup({ '别动 README.md': 0.9 })
  h.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: {
    attachmentId: brandString<AttachmentId>('image-1'), mediaType: 'image/png', bytes: 4, width: 1, height: 1 } }],
  source: { kind: 'user' } }), { surfaceOp: 'append' })
  await h.say('别动 README.md')
  const assistant = h.events('assistant/message').at(-1)!.seq
  const seqs = h.events('user/message').map(event => event.seq)
  const span = (shadowedSeqs: SessionSeq[]) => h.agent.session.append('compaction/summary', { compactionId: CompactionId('c2'),
    summary: [{ type: 'text', text: 's' }], shadowedRange: { start: shadowedSeqs[0]!, end: shadowedSeqs.at(-1)! }, shadowedSeqs,
    shadowedTokenCount: 10, provider: 'mock', model: 'mock' })
  span([...seqs, assistant].sort((a, b) => a - b))
  await h.say('继续')
  await vi.waitFor(() => { expect(h.events('system3/memory-score')).toHaveLength(1) })
  expect(h.events('system3/memory-score')[0]!.data).toMatchObject({ scanned: 1 })
  span(seqs)
  await h.say('再继续')
  expect(h.decide).toHaveBeenCalledTimes(1)
})

it('asks nothing in off mode and keeps nothing when scoring misses its deadline or fails', async () => {
  const off = await setup({ '别动 README.md': 0.9 }, { mode: 'off' })
  await off.say('别动 README.md')
  off.compact()
  await off.say('继续')
  expect(off.decide).not.toHaveBeenCalled()

  const late = await setup({}, { deadlineMs: 20 })
  late.decide.mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { reject(new Error('Jev request aborted', { cause: signal.reason })) }, { once: true })
  }))
  await late.say('别动 README.md')
  late.compact()
  await late.say('继续')
  await vi.waitFor(() => { expect(late.events('system3/judgement')[0]?.data).toMatchObject({ reason: 'deadline' }) })
  expect(late.events('system3/memory-score')).toHaveLength(0)

  const failing = await setup({})
  const warn = vi.spyOn(failing.ctx.logger, 'warn')
  failing.decide.mockRejectedValue(new Error('gateway exploded'))
  await failing.say('别动 README.md')
  failing.compact()
  await failing.say('继续')
  await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('system3 memory scoring: Error: gateway exploded') })
})

it('drops a pending scoring silently when the plugin is disposed', async () => {
  const h = await setup({})
  const warn = vi.spyOn(h.ctx.logger, 'warn')
  let started!: () => void
  const asked = new Promise<void>((resolve) => { started = resolve })
  h.decide.mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
    started()
    signal?.addEventListener('abort', () => { reject(new Error('Jev request aborted', { cause: signal.reason })) }, { once: true })
  }))
  await h.say('别动 README.md')
  h.compact()
  await h.say('继续')
  await asked
  await h.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(h.ctx), 1)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(warn).not.toHaveBeenCalled()
})

it('renders no memory context outside an Agent assembly or without Session projections', async () => {
  const h = await remembered({ probabilities: {} })
  expect((await h.ctx.systemPrompt.assemble({})).contexts.find(entry => entry.name === 'system3:memory')?.text).toBe('')

  const bare = await setup({}, {}, { config: { mode: 'shadow' }, probabilities: {} }, false)
  await bare.say('金额阈值是多少？')
  expect(bare.decide).not.toHaveBeenCalled()
  expect(bare.latestContext(bare.adapter.requests.at(-1))).toBe('')
})

/** The System3 service itself, as the Loader mounts it, with memory scoring and recall configured. */
async function service(memoryScoring: false | System3MemoryScoringConfig, memoryRecall: false | System3MemoryRecallConfig) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation((request: JevRequest) => Promise.resolve({ kind: 'ok',
    spec: ctx.jev.resolve(request), response: { model: 'jev-test', answers: Object.fromEntries(Object.keys(request.questions)
      .map(key => [key, noul(0.95)])) } }))
  await ctx.plugin(System3, { privacyMode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'],
    memoryScoring: memoryScoring === false ? false : { ...memoryScoring, sessionDataClasses: [...memoryScoring.sessionDataClasses] },
    memoryRecall: memoryRecall === false ? false : { ...memoryRecall, sessionDataClasses: [...memoryRecall.sessionDataClasses] } })
  return { ctx, decide }
}

it('wires scoring and recall through the System3 service, each on its own or together', async () => {
  await expect(service(false, RECALL)).resolves.toBeDefined()
  await expect(service(CONFIG, false)).resolves.toBeDefined()

  const { ctx, decide } = await service(CONFIG, RECALL)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: 4 }, (_, index) => textResponse(`r${String(index)}`)))))
  const agent = await ctx.agentLoop.create(SessionId('service'), { provider: 'mock', model: 'mock' })
  const say = async (text: string): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  await say('金额阈值 100 美元')
  const seqs = agent.session.snapshotEvents().filter(event => event.type === 'user/message').map(event => event.seq)
  agent.session.append('compaction/summary', { compactionId: CompactionId('c1'), summary: [{ type: 'text', text: 's' }],
    shadowedRange: { start: seqs[0]!, end: seqs.at(-1)! }, shadowedSeqs: seqs, shadowedTokenCount: 10, provider: 'mock', model: 'mock' })
  await say('继续')
  await vi.waitFor(() => { expect(agent.session.snapshotEvents().some(event => event.type === 'system3/memory-score')).toBe(true) })
  await say('金额阈值是多少？')
  // The compacted input is judged for both later inputs, and this Jev stub finds it relevant to each.
  expect(agent.session.snapshotEvents().filter(event => event.type === 'system3/memory-recall')).toHaveLength(2)
  expect(decide.mock.calls.some(([request]) => Object.keys(request.questions).some(key => key.startsWith('r')))).toBe(true)
})
