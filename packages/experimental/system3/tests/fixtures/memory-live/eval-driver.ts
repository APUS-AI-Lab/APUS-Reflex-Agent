#!/usr/bin/env node
/**
 * Live long-horizon recall evaluation: one Headless session states many similar exact facts across several compactions,
 * corrects one, then asks for each. Prints per-question answers and correctness so runs with and without Continuum
 * memory can be compared on the same script.
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('live memory eval requires a config path')

const SERVICES = ['北极星', '青鸟', '赤霄', '玄武', '白泽', '朱雀', '麒麟', '鲲鹏', '飞廉', '烛龙', '毕方', '应龙']
const ports = SERVICES.map((_, index) => 7000 + ((index * 379) % 2000) + index)
/** The correction the person makes later; the original value must not be answered. */
const CORRECTED = { index: 3, port: 9417 }

function padding(turn: number): string {
  const topics = ['城市绿化', '图书馆排架', '咖啡烘焙', '高山徒步', '天文观测', '古籍修复', '海洋潮汐', '城市公交']
  const lines = Array.from({ length: 110 }, (_, index) =>
    `第${String(turn)}段资料第${String(index + 1)}条：关于${topics[(turn + index) % topics.length]!}的背景说明，与当前任务无关，只用于填充上下文。`)
  return `以下是一段背景资料，阅读后只回复“收到”，不要调用任何工具。\n${lines.join('\n')}`
}

const ctx = await bootProductionProfile({ binName: 'memory-eval', profile: 'headless', overlayPaths: [resolveConfigPath(configPath, undefined)] })
try {
  let sessionId = ''
  const turn = async (task: string): Promise<string> => {
    const result = await runFixtureTurn(ctx, { task })
    sessionId = result.sessionId
    return result.output
  }
  if (process.env.MEMORY_EVAL === 'spec') {
    // One long input carries every fact, so only a lossless copy of that input can answer each question.
    const spec = SERVICES.map((name, index) => `${String(index + 1)}. ${name}服务：端口 ${String(ports[index])}，副本数 ${String(2 + (index % 5))}，`
      + `超时 ${String(30 + index * 7)} 秒，日志级别 ${['info', 'warn', 'debug'][index % 3]!}，负责人工号 E${String(4100 + index * 13)}。`)
    await turn(`这是部署规格，请记住，只回复“好”，不要调用任何工具。\n${spec.join('\n')}\n${padding(0).split('\n').slice(1, 41).join('\n')}`)
  } else {
    for (const [index, name] of SERVICES.entries()) {
      await turn(`记一下：${name}服务的端口是 ${String(ports[index])}，只回复“好”，不要调用任何工具。`)
      await turn(padding(index))
    }
  }
  await turn(`更正：${SERVICES[CORRECTED.index]!}服务的端口改成 ${String(CORRECTED.port)}，只回复“好”，不要调用任何工具。`)
  for (let index = 1; index <= (process.env.MEMORY_EVAL === 'spec' ? 6 : 1); index += 1) await turn(padding(90 + index))
  const results = []
  for (const [index, name] of SERVICES.entries()) {
    const expected = index === CORRECTED.index ? CORRECTED.port : ports[index]!
    const started = Date.now()
    const answer = await turn(`${name}服务的端口是多少？只回答数字，不要调用任何工具。`)
    results.push({ name, expected, answer: answer.trim().slice(0, 60), correct: new RegExp(`\\b${String(expected)}\\b`, 'u').test(answer),
      ms: Date.now() - started })
  }
  const log = await ctx.sessionQuery.readSession(SessionId(sessionId))
  const compactions = log.events.filter(event => event.type === 'compaction/summary').length
  const recallMs = log.events.flatMap(event => event.type === 'system3/judgement' && event.data.decision === 'memory.recall'
    ? [event.data.elapsedMs] : [])
  const tools = log.events.flatMap(event => event.type === 'assistant/message'
    ? event.data.message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []) : [])
  const recalled = log.events.flatMap(event => event.type === 'system3/memory-recall' ? [event.data.items.map(item => item.text.length)] : [])
  const summaries = log.events.flatMap(event => event.type === 'compaction/summary'
    ? [event.data.summary.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : [])
  const expectedPorts = SERVICES.map((_, index) => index === CORRECTED.index ? CORRECTED.port : ports[index]!)
  const inSummary = expectedPorts.filter(port => (summaries.at(-1) ?? '').includes(String(port))).length
  process.stdout.write(`SUMMARY_HITS ${String(inSummary)}/${String(expectedPorts.length)}\n`)
  process.stdout.write(`TOOLS ${JSON.stringify(tools)}\nRECALLED_LENGTHS ${JSON.stringify(recalled)}\n`)
  process.stdout.write(`RESULTS ${JSON.stringify(results)}\nSCORE ${String(results.filter(result => result.correct).length)}/${String(results.length)}\n`
    + `COMPACTIONS ${String(compactions)}\nRECALL_MS ${JSON.stringify(recallMs)}\n`)
} finally {
  await ctx.fiber.dispose()
}
