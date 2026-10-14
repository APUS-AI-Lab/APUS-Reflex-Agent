import { describe, expect, it } from 'vitest'
import {
  compactedHuman, converse, indexedMemories, lifePadding, live, ofType, turnAnswer, turnRecall,
} from './fixtures/continuum-live-conversation.ts'

const THRESHOLD = '请记住这条要求：订单统计只算已支付订单，金额阈值是 100 美元。只回复“已记住”。'
const REGION = '另外记一下：部署区域是 us-east-1。只回复“好”。'

/** Distinct filler paragraphs, so compaction has real history to replace and nothing in it is worth remembering. */
function padding(turn: number): string {
  const topics = ['城市绿化', '图书馆排架', '咖啡烘焙', '高山徒步', '天文观测', '古籍修复', '海洋潮汐', '城市公交']
  const lines = Array.from({ length: 160 }, (_, index) =>
    `第${String(turn)}段资料第${String(index + 1)}条：关于${topics[(turn + index) % topics.length]!}的背景说明，与当前任务无关，只用于填充上下文。`)
  return `以下是一段背景资料，阅读后只回复“收到”，不要调用任何工具。\n${lines.join('\n')}`
}

const TURNS = [THRESHOLD, REGION, ...Array.from({ length: 6 }, (_, index) => padding(index + 1)),
  '上次说的金额阈值是多少？只用一句话回答。', '部署区域是哪里？只用一句话回答。', '用一句话说说你最喜欢的季节，不要调用任何工具。']
const ASK_THRESHOLD = 8

/** Everyday facts that later questions combine; the budget is stated and then corrected. */
const LIFE = {
  allergy: '我女儿小米对花生过敏，吃的东西一定要避开花生。',
  spicy: '我老婆不吃辣，一点辣都不行。',
  budget: '这次全家去杭州玩，预算先定 5000 元。',
  son: '我儿子叫乐乐，今年 6 岁，最喜欢恐龙。',
  budgetChange: '杭州旅行预算改一下，提高到 8000 元。',
}
const CHAT = ['今天加班到十点，累死了。', '哈哈，谢谢你啊。']

/** A personal-assistant conversation: facts arrive between small talk and pasted articles, then questions combine them. */
const LIFE_TURNS = [LIFE.allergy, CHAT[0]!, lifePadding(1), lifePadding(2), LIFE.spicy, lifePadding(3), LIFE.budget, CHAT[1]!,
  lifePadding(4), LIFE.son, lifePadding(5), LIFE.budgetChange, lifePadding(6), lifePadding(7), lifePadding(8), lifePadding(9),
  '周六想带全家出去吃饭，点菜要注意什么？用两三句话回答。', '这次杭州旅行预算现在是多少？一句话回答。',
  '我儿子快过生日了，送什么礼物好？一句话回答。', '帮我简单规划一下这次杭州家庭行程，要照顾到家里每个人，三四句话。',
  '用一句话说说你最喜欢的季节，不要调用任何工具。']
const ASK_DINNER = LIFE_TURNS.length - 5

describe.skipIf(!live)('Continuum lossless memory on DeepSeek and the deployed APUS Reflex endpoint', () => {
  it('keeps the constraints compaction removed and recalls each only for the question that needs it', async () => {
    const { events, elapsed } = await converse(TURNS)
    const compacted = compactedHuman(events)
    const records = indexedMemories(events).map(memory => memory.text)
    const admissions = ofType(events, 'continuum/memory-admission').filter(event => event.data.phase === 'settled')
    const decisions = ofType(events, 'continuum/memory-decision').filter(event => event.data.evaluation?.phase === 'settled')
    process.stdout.write(`LIVE ${JSON.stringify({
      elapsed, compacted: compacted.map(text => text.slice(0, 24)), records: records.map(text => text.slice(0, 24)),
      admissions: admissions.map(({ data }) => ({
        reason: data.reason, candidates: data.candidateIds.length, admitted: data.admittedIds.length,
      })),
      decisions: decisions.map(({ data }) => ({
        reason: data.evaluation?.reason, selected: data.selectedIds.length, baseline: data.baselineIds.length,
      })),
      answers: [ASK_THRESHOLD, ASK_THRESHOLD + 1, ASK_THRESHOLD + 2].map(turn => turnAnswer(events, turn)),
    })}\n`)

    expect(compacted).toEqual(expect.arrayContaining([THRESHOLD, REGION]))
    expect(admissions.length).toBeGreaterThan(0)
    expect(admissions.every(event => event.data.outcome === 'jev')).toBe(true)
    expect(records).toEqual(expect.arrayContaining([THRESHOLD, REGION]))
    expect(records.filter(text => text.startsWith('以下是一段背景资料'))).toEqual([])

    expect(turnRecall(events, ASK_THRESHOLD)).toContain('100 美元')
    expect(turnRecall(events, ASK_THRESHOLD)).not.toContain('us-east-1')
    expect(turnAnswer(events, ASK_THRESHOLD)).toContain('100')
    expect(turnRecall(events, ASK_THRESHOLD + 1)).toContain('us-east-1')
    expect(turnRecall(events, ASK_THRESHOLD + 1)).not.toContain('100 美元')
    expect(turnAnswer(events, ASK_THRESHOLD + 1)).toContain('us-east-1')
    expect(turnRecall(events, ASK_THRESHOLD + 2)).toBe('')
    expect(decisions.every(event => event.data.outcome === 'jev')).toBe(true)
  }, 1_800_000)

  it('accumulates everyday facts across compactions and combines them for later questions', async () => {
    const { events, elapsed } = await converse(LIFE_TURNS)
    const compacted = compactedHuman(events)
    const records = indexedMemories(events).map(memory => memory.text)
    const admissions = ofType(events, 'continuum/memory-admission').filter(event => event.data.phase === 'settled')
    const answers = [0, 1, 2, 3, 4].map(offset => turnAnswer(events, ASK_DINNER + offset))
    process.stdout.write(`LIFE ${JSON.stringify({
      elapsed, compactions: ofType(events, 'compaction/summary').length, compacted: compacted.map(text => text.slice(0, 16)),
      records, batches: admissions.map(({ data }) => `${String(data.admittedIds.length)}/${String(data.candidateIds.length)}`),
      recalls: [0, 1, 2, 3, 4].map(offset => turnRecall(events, ASK_DINNER + offset).split('\n').filter(line => line.startsWith('[memory:')).length),
      answers,
    })}\n`)

    const facts = Object.values(LIFE)
    // Every compacted fact became a verbatim record; small talk and pasted articles did not.
    expect(compacted).toEqual(expect.arrayContaining(Object.values(LIFE)))
    expect(records).toEqual(facts.filter(fact => compacted.includes(fact)))
    expect(records.some(text => CHAT.includes(text) || text.startsWith('转给你一篇文章'))).toBe(false)
    // Memory accumulated over several compactions rather than one.
    expect(admissions.filter(event => event.data.admittedIds.length > 0).length).toBeGreaterThanOrEqual(2)

    const dinner = turnRecall(events, ASK_DINNER)
    expect(dinner).toContain('花生')
    expect(dinner).toContain('不吃辣')
    expect(answers[0]).toContain('花生')
    expect(answers[0]).toContain('辣')
    // Both budget originals are recalled verbatim; the model resolves the later correction.
    expect(turnRecall(events, ASK_DINNER + 1)).toContain('5000')
    expect(turnRecall(events, ASK_DINNER + 1)).toContain('8000')
    expect(answers[1]).toContain('8000')
    expect(turnRecall(events, ASK_DINNER + 2)).toContain('恐龙')
    expect(answers[2]).toContain('恐龙')
    // One planning request draws on facts kept by different compactions.
    const plan = turnRecall(events, ASK_DINNER + 3)
    expect(['花生', '不吃辣', '恐龙', '8000'].filter(fact => plan.includes(fact)).length).toBeGreaterThanOrEqual(3)
    expect(turnRecall(events, ASK_DINNER + 4)).toBe('')
  }, 2_400_000)
})
