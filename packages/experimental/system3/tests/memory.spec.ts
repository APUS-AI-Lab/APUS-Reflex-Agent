import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { JevRequest, JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, type GenerateOptions, type MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { installSystem3MemoryScoring, memoryText, system3MemoryScoreDecision, validateSystem3MemoryScoring,
  type System3MemoryScore, type System3MemoryScoringConfig } from '../src/memory.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

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

async function setup(probabilities: Readonly<Record<string, number>>, config: Partial<System3MemoryScoringConfig> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  ctx.sessionProjections.register(system3RuntimeProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation((request: JevRequest) => {
    const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
      const text = /已被压缩成摘要：「(.*)」。/u.exec(question.instructions ?? '')?.[1] ?? ''
      return [key, noul(probabilities[text] ?? 0)]
    }))
    return Promise.resolve({ kind: 'ok', spec: ctx.jev.resolve(request), response: { model: 'jev-test', answers } })
  })
  const adapter = new MockAdapter(Array.from({ length: 6 }, (_, index) => textResponse(`reply ${String(index + 1)}`)))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  installSystem3MemoryScoring(ctx, { config: { ...CONFIG, ...config },
    policy: { mode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'] },
    options: { routeId: 'jev', executionDomain: 'network', effort: 'low' } })
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
  return { ctx, agent, adapter, decide, events, say, compact, context }
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
