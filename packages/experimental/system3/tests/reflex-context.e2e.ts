/** Real Reflex decisions over a finance task; primary-model transport is recorded locally for exact request assertions. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { afterEach, describe, expect, it } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { installReflexContext, type ReflexContextConfig } from '../src/reflex-context.ts'
import { waitForIdle } from '../../../../apps/cli/tests/profiles/headless/tests/harness.ts'

const endpoint = process.env.REFLEX_E2E_ENDPOINT
const model = process.env.REFLEX_E2E_MODEL
const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
const config: ReflexContextConfig = { mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 15000,
  sessionDataClasses: ['public'], maxCandidates: 16, maxRequestChars: 4000, maxFragmentChars: 1000,
  protectRecentMessages: 1, maxRestoredChars: 5000, maxSearchResults: 5 }
async function harness() {
  if (endpoint === undefined || model === undefined) throw new Error('REFLEX_E2E_ENDPOINT and REFLEX_E2E_MODEL must declare the tested route')
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  new TokenMeter(ctx)
  const adapter = new MockAdapter([textResponse('Recorded request accepted.')])
  ctx.effect(() => ctx.llm.registerAdapter(['recording'], adapter))
  await ctx.plugin(Jev, { endpoint, model, apiKeyEnv: 'JEV_API_KEY', effort: 'high', timeoutMs: 15000 })
  installReflexContext(ctx, config, { policy: { mode: 'controlled', approvedRemoteIds: ['reflex'], approvedRemoteDataClasses: ['public'] },
    options: { routeId: 'reflex', executionDomain: 'network', effort: 'high' }, dataClasses: ['public'] })
  return { ctx, adapter }
}
const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

describe.skipIf(!process.env.JEV_API_KEY)('Reflex finance-context semantics with real service', { retry: 0 }, () => {
  it('keeps Decimal and immutable CSV constraints, omits unrelated travel history, then restores it after a fresh Host', async () => {
    const first = await harness()
    const agent = await first.ctx.agentLoop.create(SessionId('reflex-finance-context'), { provider: 'recording', model: 'recording' })
    const constraint = '财务 CSV 工具必须使用 Decimal 处理金额，不能使用浮点数。原始 CSV 文件不可修改，汇总结果写入新的文件。'
    const travel = '去年休假我在京都住过三条河原町的旅馆，旅馆叫樱花小舍。我最喜欢那里的抹茶早餐。这是已结束的私人旅行，与软件项目无关。'
    agent.session.append('user/message', user(constraint), { surfaceOp: 'append' })
    agent.session.append('user/message', user(travel), { surfaceOp: 'append' })
    agent.session.append('user/message', user('现在回到财务 CSV 项目。'), { surfaceOp: 'append' })
    agent.followup(user('请给出按月份汇总财务 CSV 金额的实现方案，遵守此前的金额精度与原文件保护要求，不讨论旅行。'))
    await waitForIdle(first.ctx, agent)
    const outgoing = JSON.stringify(first.adapter.requests[0]?.messages)
    if (process.env.REFLEX_CONTEXT_REPORT) await writeFile(`${process.env.REFLEX_CONTEXT_REPORT}-remove.json`,
      JSON.stringify(agent.session.snapshotEvents()), { mode: 0o600 })
    expect(outgoing).toContain('Decimal')
    expect(outgoing).toContain('不可修改')
    expect(outgoing, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement').map(event => event.data))).not.toContain('樱花小舍')
    expect(agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(true)
    const directory = await mkdtemp(join(tmpdir(), 'reflex-context-e2e-'))
    directories.push(directory)
    const path = join(directory, 'session.json')
    await writeFile(path, JSON.stringify(agent.session.snapshotEvents()), { mode: 0o600 })
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    const second = await harness()
    const seed = JSON.parse(await readFile(path, 'utf8')) as SessionEvent[]
    const handle = await second.ctx.agents.create({ sessionId: SessionId('reflex-finance-context'), seed,
      agentOptions: { provider: 'recording', model: 'recording' } })
    const resumed = handle.agent
    resumed.followup(user('切换话题：我去年在京都住的旅馆叫什么名字，喜欢那里的什么早餐？请从之前的聊天记录找回。'))
    await waitForIdle(second.ctx, resumed)
    if (process.env.REFLEX_CONTEXT_REPORT) await writeFile(`${process.env.REFLEX_CONTEXT_REPORT}-restore.json`,
      JSON.stringify(resumed.session.snapshotEvents()), { mode: 0o600 })
    expect(JSON.stringify(second.adapter.requests[0]?.messages), JSON.stringify(resumed.session.snapshotEvents().filter(event => event.type === 'system3/judgement').map(event => event.data))).toContain('樱花小舍')
    expect(JSON.stringify(second.adapter.requests[0]?.messages)).toContain('抹茶早餐')
    expect(resumed.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'reflex-memory')).toBe(true)
  }, 120000)
})
