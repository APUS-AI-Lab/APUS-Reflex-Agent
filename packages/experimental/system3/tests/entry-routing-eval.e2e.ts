/**
 * Real-Jev evaluation of the System3 entry router over a labelled public task set.
 *
 * Self-skips without JEV_API_KEY. The run prints a JSON report and writes it to
 * SYSTEM3_ENTRY_EVAL_REPORT when that path is set; assertions cover only transport health,
 * because routing quality is reported, not gated.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterAll, describe, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSystem3EntryRouter, type System3EntryDecisionReceipt } from '../src/entry-routing.ts'

type Decision = 'fast' | 'reasoning' | 'abstain'
interface EvalCandidate { id: string; description: string; provider: string; model: string; reasoningEffort: string }
interface EvalTask { id: string; input: string; expected: Decision; tag: 'standalone' | 'follow-up' | 'adversarial' }
interface EvalSet {
  baseline: { provider: string; model: string; reasoningEffort: string }
  candidates: EvalCandidate[]
  tasks: EvalTask[]
}

const tasks = JSON.parse(readFileSync(new URL('./fixtures/entry-routing-eval.tasks.json', import.meta.url), 'utf8')) as EvalSet
const deployment = readFileSync(new URL('../../../../deploy/system3/runtime.patch.yml', import.meta.url), 'utf8')
const endpoint = /endpoint: (\S+)/.exec(deployment)?.[1]
const jevModel = /model: (APUS-\S+)/.exec(deployment)?.[1]
const minConfidence = Number(/entryRouting:[\s\S]*?minConfidence: ([\d.]+)/.exec(deployment)?.[1])

const FOLLOW_UP = /^(继续|好的|还有吗)$|刚才|上面|第[一二三四五六七八九十\d]+[段点条个]|^(这个|把它|换成|再|不对)/
const HARD = /设计|权衡|排查|死锁|证明|推导|迁移方案|重构|分析|比较|design|scheduler/i

/** Deterministic control written alongside the task set; it is an optimistic bound, not a held-out rule. */
function ruleDecision(input: string): Decision {
  if (FOLLOW_UP.test(input)) return 'abstain'
  return HARD.test(input) || input.length > 120 ? 'reasoning' : 'fast'
}

/** Model that actually answers: only a reasoning decision leaves the Flash baseline. */
function effectiveModel(decision: Decision): string {
  return decision === 'reasoning' ? 'deepseek-v4-pro' : tasks.baseline.model
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? Number.NaN
}

function score(rows: readonly { task: EvalTask; decision: Decision }[]) {
  const total = rows.length
  return {
    decisionMatch: rows.filter(row => row.decision === row.task.expected).length / total,
    effectiveModelMatch: rows.filter(row => effectiveModel(row.decision) === effectiveModel(row.task.expected)).length / total,
    leftBaseline: rows.filter(row => row.decision === 'reasoning').length / total,
    followUpMisrouted: rows.filter(row => row.task.tag === 'follow-up' && row.decision !== 'abstain').length
      / rows.filter(row => row.task.tag === 'follow-up').length,
  }
}

const contexts: Context[] = []
afterAll(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

describe.skipIf(!process.env.JEV_API_KEY)('System3 entry routing against the deployed Jev', { retry: 0 }, () => {
  it('reports outcome distribution, latency and controls for the labelled task set', async () => {
    if (endpoint === undefined || jevModel === undefined || !Number.isFinite(minConfidence)) {
      throw new Error('deploy/system3/runtime.patch.yml no longer declares the Jev endpoint, model and entry confidence')
    }
    for (const candidate of tasks.candidates) expect(deployment).toContain(`description: ${candidate.description}`)

    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const adapter = new MockAdapter([])
    vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({
      provider, id: model, name: model, context: { contextWindow: 131072 }, inputModalities: ['text'],
      reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }] },
    }))
    ctx.effect(() => ctx.llm.registerAdapter([tasks.baseline.provider], adapter))
    await ctx.plugin(Jev, { endpoint, model: jevModel, apiKeyEnv: 'JEV_API_KEY', effort: 'high', timeoutMs: 15000 })
    const router = createSystem3EntryRouter(ctx, {
      deadlineMs: 15000, minConfidence, maxInputBytes: 16384, sessionDataClasses: ['public'],
      baseline: { executionDomain: 'network', dataClasses: ['public'] },
      candidates: tasks.candidates.map(candidate => ({ ...candidate, executionDomain: 'network' as const, dataClasses: ['public'] as const })),
    }, {
      mode: 'controlled', approvedRemoteDataClasses: ['public'],
      approvedRemoteIds: ['jev', ...tasks.candidates.map(candidate => candidate.id)],
    },
    { routeId: 'jev', executionDomain: 'network', effort: 'high' })
    const baseline = { ...tasks.baseline, reasoningEffort: ReasoningEffortId(tasks.baseline.reasoningEffort) }
    const agent = await ctx.agentLoop.create(SessionId('entry-eval'), baseline)

    const rows: { task: EvalTask; decision: Decision; outcome: string; confidence?: number; elapsedMs: number }[] = []
    const failures: string[] = []
    for (const task of tasks.tasks) {
      const requestId = brandString<SessionRequestId>(task.id)
      const routed = await router.route({
        agent, requestId, baseline,
        message: createUserMessage({ content: [{ type: 'text', text: task.input }], source: { kind: 'user' } }),
      }, AbortSignal.timeout(15000)).catch((error: unknown) => { failures.push(String(error)); return undefined })
      const receipt = agent.session.snapshotEvents()
        .findLast(event => event.type === 'system3/entry-decision' && event.data.requestId === requestId)
        ?.data as System3EntryDecisionReceipt
      const answer = receipt.response?.answers.route
      const decision = routed === undefined ? 'abstain' : tasks.candidates.find(candidate => candidate.model === routed.model)?.id as Decision
      const confidence = answer?.type === 'choice' ? { confidence: answer.confidence } : {}
      rows.push({ task, decision, outcome: receipt.outcome, ...confidence, elapsedMs: receipt.elapsedMs })
    }

    const outcomes: Record<string, number> = {}
    for (const row of rows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1
    const answered = rows.filter(row => ['selected', 'abstain', 'low-confidence'].includes(row.outcome))
    const latencies = answered.map(row => row.elapsedMs)
    const report = {
      generatedAt: new Date().toISOString(), endpoint: new URL(endpoint).host, model: jevModel, effort: 'high', minConfidence,
      tasks: rows.length, outcomes, thrown: [...new Set(failures)],
      latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: Math.max(...latencies) },
      jev: score(rows),
      alwaysBaseline: score(rows.map(row => ({ task: row.task, decision: 'abstain' as const }))),
      rule: score(rows.map(row => ({ task: row.task, decision: ruleDecision(row.task.input) }))),
      adversarial: {
        jev: score(rows.filter(row => row.task.tag === 'adversarial')).effectiveModelMatch,
        rule: score(rows.filter(row => row.task.tag === 'adversarial').map(row => ({ task: row.task, decision: ruleDecision(row.task.input) }))).effectiveModelMatch,
      },
      byExpected: Object.fromEntries((['fast', 'reasoning', 'abstain'] as const).map(expected => [expected, (() => {
        const group = rows.filter(row => row.task.expected === expected)
        const decisions: Record<string, number> = {}
        for (const row of group) decisions[row.decision] = (decisions[row.decision] ?? 0) + 1
        return decisions
      })()])),
      rows: rows.map(row => ({
        id: row.task.id, expected: row.task.expected, decision: row.decision, outcome: row.outcome,
        confidence: row.confidence, elapsedMs: row.elapsedMs,
      })),
    }
    console.log(JSON.stringify(report, null, 2))
    if (process.env.SYSTEM3_ENTRY_EVAL_REPORT) writeFileSync(process.env.SYSTEM3_ENTRY_EVAL_REPORT, `${JSON.stringify(report, null, 2)}\n`)
    expect(answered.length / rows.length).toBeGreaterThan(0.5)
  }, 900_000)
})
