#!/usr/bin/env node
/** Live driver: one Headless session on DeepSeek's official API with the deployed APUS Reflex (Jev) endpoint judging memory. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('live memory driver requires a config path')

/** Distinct filler paragraphs, so compaction has real history to replace and nothing in it is worth remembering. */
function padding(turn: number): string {
  const topics = ['城市绿化', '图书馆排架', '咖啡烘焙', '高山徒步', '天文观测', '古籍修复', '海洋潮汐', '城市公交']
  const lines = Array.from({ length: 160 }, (_, index) =>
    `第${String(turn)}段资料第${String(index + 1)}条：关于${topics[(turn + index) % topics.length]!}的背景说明，与当前任务无关，只用于填充上下文。`)
  return `以下是一段背景资料，阅读后只回复“收到”，不要调用任何工具。\n${lines.join('\n')}`
}

const ctx = await bootProductionProfile({
  binName: 'memory-live',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
const started = Date.now()
try {
  const turns: Array<{ task: string; output: string; ms: number }> = []
  const turn = async (task: string): Promise<{ sessionId: string; output: string }> => {
    const t0 = Date.now()
    const result = await runFixtureTurn(ctx, { task })
    turns.push({ task: task.slice(0, 40), output: result.output.slice(0, 120), ms: Date.now() - t0 })
    return result
  }
  await turn('请记住这条要求：订单统计只算已支付订单，金额阈值是 100 美元。只回复“已记住”。')
  await turn('另外记一下：部署区域是 us-east-1。只回复“好”。')
  for (let index = 1; index <= 6; index += 1) await turn(padding(index))
  const answer = await turn('上次说的金额阈值是多少？只用一句话回答。')
  const region = await turn('部署区域是哪里？只用一句话回答。')
  const unrelated = await turn('用一句话说说你最喜欢的季节，不要调用任何工具。')
  const log = await ctx.sessionQuery.readSession(SessionId(answer.sessionId))
  const keep = (event: SessionEvent): boolean => ['compaction/summary', 'system3/memory-score', 'system3/memory-recall'].includes(event.type)
  const brief = log.events.flatMap((event): object[] => {
    if (event.type === 'system3/judgement') {
      const { decision, mode, outcome, reason, applied, elapsedMs } = event.data
      return [{ seq: event.seq, type: event.type, decision, mode, outcome, reason, applied, elapsedMs }]
    }
    if (event.type === 'compaction/summary') return [{ seq: event.seq, type: event.type, shadowed: event.data.shadowedSeqs.length }]
    return keep(event) ? [{ seq: event.seq, type: event.type, data: event.data }] : []
  })
  const contexts = log.events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'runtime-context'
    ? [event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : [])
  process.stdout.write(`TURNS ${JSON.stringify(turns)}\nANSWER ${JSON.stringify(answer.output)}\nREGION ${JSON.stringify(region.output)}\n`
    + `UNRELATED ${JSON.stringify(unrelated.output)}\nEVENTS ${JSON.stringify(brief)}\n`
    + `LAST_CONTEXT ${JSON.stringify(contexts.at(-1) ?? '')}\nELAPSED_MS ${String(Date.now() - started)}\n`)
} finally {
  await ctx.fiber.dispose()
}
