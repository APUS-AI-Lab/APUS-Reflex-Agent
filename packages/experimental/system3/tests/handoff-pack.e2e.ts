/** Hand-off requirement recognition against the deployed Jev; skipped without explicit JEV_ENDPOINT and JEV_MODEL. */
import { readFileSync, writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterAll, describe, expect, it } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { prepareSystem3HandoffPack } from '../src/handoff-pack.ts'

const deployment = readFileSync(new URL('../../../../deploy/system3/runtime.patch.yml', import.meta.url), 'utf8')
const endpoint = process.env.JEV_ENDPOINT?.trim() ?? ''
const jevModel = process.env.JEV_MODEL?.trim() ?? ''
const minProbability = Number(/handoffPack:[\s\S]*?minProbability: (\S+)/.exec(deployment)?.[1])

/** Earlier messages, the delegated task, and which earlier messages are requirements. */
const CASES: readonly { readonly earlier: readonly string[]; readonly task: string; readonly requirements: readonly number[] }[] = [
  { earlier: ['我们在做一个 Python 记账命令行工具', '函数名一律用 snake_case', '今天有点累', '不要改 README.md'],
    task: '把导出 CSV 的功能交给 codex 实现', requirements: [1, 3] },
  { earlier: ['先帮我看看这个报错', '好的谢谢，已经修好了', '以后提交前必须让 pytest 全部通过'],
    task: '让 codex 加一个按日期过滤账单的功能', requirements: [2] },
  { earlier: ['不许引入新的第三方依赖', '你觉得 React 和 Vue 哪个好？', '哈哈有道理'],
    task: '交给 codex 把注册表单的校验做完', requirements: [0] },
  { earlier: ['帮我翻译一句话：hello world', '刚才的翻译不错'],
    task: '交给 codex 重构 utils 模块', requirements: [] },
  { earlier: ['接口返回的错误信息要用中文', '日志里不能打印用户手机号', '上周的会议纪要发我一下'],
    task: '让 codex 实现用户注册接口', requirements: [0, 1] },
  { earlier: ['数据库迁移脚本放在 migrations/ 目录下', '天气真好', '写完记得把 CHANGELOG 更新一下'],
    task: '委派给 codex：给订单表加一个状态字段', requirements: [0, 2] },
]

const contexts: Context[] = []
afterAll(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

describe.skipIf(!endpoint || !jevModel)('System3 hand-off requirements against the deployed Jev', { retry: 0 }, () => {
  it('forwards the labelled requirements and little else', { timeout: 300_000 }, async () => {
    if (!Number.isFinite(minProbability)) {
      throw new Error('runtime.patch.yml must declare handoffPack minProbability')
    }
    const results: { task: string; expected: string[]; forwarded: string[]; nouls: number[]; elapsedMs: number }[] = []
    for (const [index, sample] of CASES.entries()) {
      const ctx = new Context()
      contexts.push(ctx)
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Jev, { endpoint, model: jevModel, ...(process.env.JEV_API_KEY_ENV || process.env.JEV_API_KEY ? { apiKeyEnv: process.env.JEV_API_KEY_ENV || 'JEV_API_KEY' } : {}), effort: 'high', timeoutMs: 15000 })
      const agent = await ctx.agentLoop.create(SessionId(`handoff-e2e-${String(index)}`), { provider: 'none', model: 'none' })
      for (const text of sample.earlier) {
        agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      }
      const started = Date.now()
      const forwarded = await prepareSystem3HandoffPack(ctx, agent, brandString<SessionRequestId>(`r${String(index)}`), sample.task, {
        config: { recentMessages: 12, maxMessageChars: 500, minProbability, deadlineMs: 15000 },
        policy: { mode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'] },
        options: { routeId: 'jev', executionDomain: 'network', effort: 'high' }, dataClasses: ['workspace'],
      }, AbortSignal.timeout(30_000))
      const answers = agent.session.snapshotEvents().findLast(event => event.type === 'system3/handoff-pack')?.data.response?.answers ?? {}
      const nouls = sample.earlier.map((_text, position) => {
        const answer = answers[`m${String(position + 1)}`]
        return answer?.type === 'noul' ? Math.round(answer.noul * 1000) / 1000 : -1
      })
      results.push({ task: sample.task, expected: sample.requirements.map(position => sample.earlier[position]!), forwarded, nouls,
        elapsedMs: Date.now() - started })
    }
    const truePositives = results.reduce((sum, result) => sum + result.forwarded.filter(text => result.expected.includes(text)).length, 0)
    const forwarded = results.reduce((sum, result) => sum + result.forwarded.length, 0)
    const expected = results.reduce((sum, result) => sum + result.expected.length, 0)
    const report = { minProbability, precision: forwarded === 0 ? 1 : truePositives / forwarded, recall: truePositives / expected, results }
    if (process.env.SYSTEM3_HANDOFF_REPORT) writeFileSync(process.env.SYSTEM3_HANDOFF_REPORT, `${JSON.stringify(report, null, 2)}\n`)
    expect(report.recall).toBeGreaterThanOrEqual(0.8)
    expect(report.precision).toBeGreaterThanOrEqual(0.8)
  })
})
