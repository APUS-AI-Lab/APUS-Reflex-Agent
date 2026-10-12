/**
 * Real-Jev entry decisions over the delegation calibration tasks, with the deployed candidates including Codex delegation.
 *
 * Covers runnable tasks and decision-only repository-scale probes; self-skips without explicit JEV_ENDPOINT and JEV_MODEL.
 * The delegate candidate uses stubbed provider and tool lookups, so only the decision is real; the arms themselves
 * run outside this suite. Writes the report to SYSTEM3_CALIBRATION_DECISIONS when that path is set.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
import { createSystem3EntryRouter, type System3EntryDecisionReceipt, type System3EntryRoutingConfig } from '../src/entry-routing.ts'

interface TierCandidate { id: string; description: string; provider: string; model: string; reasoningEffort: string }
interface TierSet { baseline: { provider: string; model: string; reasoningEffort: string }; candidates: TierCandidate[] }
interface TaskMeta { id: string; size: string; prompt: string }

const tiers = JSON.parse(readFileSync(new URL('./fixtures/entry-routing-eval.tiers.json', import.meta.url), 'utf8')) as TierSet
const tasksDir = new URL('./fixtures/delegation-calibration/tasks/', import.meta.url)
const probesDir = new URL('./fixtures/delegation-calibration/probes/', import.meta.url)
const tasks = [
  ...readdirSync(tasksDir).sort().map(id => JSON.parse(readFileSync(new URL(`${id}/meta.json`, tasksDir), 'utf8')) as TaskMeta),
  ...readdirSync(probesDir).sort().map(file => JSON.parse(readFileSync(new URL(file, probesDir), 'utf8')) as TaskMeta),
]
const deployment = readFileSync(new URL('../../../../deploy/system3/runtime.patch.yml', import.meta.url), 'utf8')
const endpoint = process.env.JEV_ENDPOINT?.trim() ?? ''
const jevModel = process.env.JEV_MODEL?.trim() ?? ''
const minConfidence = Number(/entryRouting:[\s\S]*?minConfidence: ([\d.]+)/.exec(deployment)?.[1])
// A candidate wording under evaluation may replace the deployed one; the report records which was used.
const codexDescription = process.env.SYSTEM3_CALIBRATION_CODEX_DESCRIPTION ?? /- id: codex\n\s+description: (.+)/.exec(deployment)?.[1]

const contexts: Context[] = []
afterAll(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

describe.skipIf(!endpoint || !jevModel)('System3 delegation calibration decisions against the deployed Jev', { retry: 0 }, () => {
  it('records the entry decision for every calibration task', async () => {
    if (endpoint === undefined || jevModel === undefined || !Number.isFinite(minConfidence) || codexDescription === undefined) {
      throw new Error('deploy/system3/runtime.patch.yml requires explicit Jev endpoint/model, entry confidence and codex candidate')
    }
    // The four-tier fixture exercises optional user routes; only Codex wording follows the public deployment.
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const adapter = new MockAdapter([])
    vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({
      provider, id: model, name: model, context: { contextWindow: 131072 }, inputModalities: ['text'],
      reasoning: { efforts: ['low', 'medium', 'high'].map(id => ({ id: ReasoningEffortId(id), name: id })) },
    }))
    ctx.effect(() => ctx.llm.registerAdapter([...new Set(tiers.candidates.map(candidate => candidate.provider))], adapter))
    await ctx.plugin(Jev, { endpoint, model: jevModel, ...(process.env.JEV_API_KEY_ENV || process.env.JEV_API_KEY ? { apiKeyEnv: process.env.JEV_API_KEY_ENV || 'JEV_API_KEY' } : {}), effort: 'high', timeoutMs: 15000 })
    const get = (name: string): unknown => ctx.reflect.get(name)
    vi.spyOn(ctx, 'get').mockImplementation(((name: string) => {
      if (name === 'subagents') return { getProvider: (provider: string) => (provider === 'codex' ? {} : undefined) }
      if (name === 'tools') return { get: (tool: string) => (tool === 'subagent_codex' ? {} : undefined) }
      return get(name)
    }) as Context['get'])
    const candidates: System3EntryRoutingConfig['candidates'] = [
      ...tiers.candidates.map(candidate => ({ ...candidate, executionDomain: 'network' as const, dataClasses: ['public' as const] })),
      { id: 'codex', description: codexDescription, delegate: { provider: 'codex', tool: 'subagent_codex' },
        executionDomain: 'network', dataClasses: ['public'] },
    ]
    const router = createSystem3EntryRouter(ctx, {
      deadlineMs: 15000, minConfidence, maxInputBytes: 16384, sessionDataClasses: ['public'],
      baseline: { executionDomain: 'network', dataClasses: ['public'] }, candidates,
    }, { mode: 'controlled', approvedRemoteDataClasses: ['public'], approvedRemoteIds: ['jev', ...candidates.map(candidate => candidate.id)] },
    { routeId: 'jev', executionDomain: 'network', effort: 'high' })
    const baseline = { ...tiers.baseline, reasoningEffort: ReasoningEffortId(tiers.baseline.reasoningEffort) }
    const rows = []
    for (const task of tasks) {
      const agent = await ctx.agentLoop.create(SessionId(`calibration-${task.id}`), baseline)
      const requestId = brandString<SessionRequestId>(task.id)
      await router.route({ agent, requestId, baseline,
        message: createUserMessage({ content: [{ type: 'text', text: task.prompt }], source: { kind: 'user', rpcId: requestId } }),
      }, AbortSignal.timeout(15000))
      const receipt = agent.session.snapshotEvents()
        .findLast(event => event.type === 'system3/entry-decision' && event.data.requestId === requestId)?.data as System3EntryDecisionReceipt
      const answer = receipt.response?.answers.route
      rows.push({ id: task.id, size: task.size, outcome: receipt.outcome, decision: receipt.candidate?.id ?? 'baseline',
        ...answer?.type === 'choice' ? { choice: answer.choice, confidence: answer.confidence } : {}, elapsedMs: receipt.elapsedMs })
    }
    const report = { generatedAt: new Date().toISOString(), model: jevModel, minConfidence, codexDescription, rows }
    console.log(JSON.stringify(report, null, 2))
    if (process.env.SYSTEM3_CALIBRATION_DECISIONS) writeFileSync(process.env.SYSTEM3_CALIBRATION_DECISIONS, `${JSON.stringify(report, null, 2)}\n`)
    expect(rows.filter(row => ['selected', 'abstain', 'low-confidence'].includes(row.outcome)).length).toBeGreaterThan(rows.length / 2)
  }, 300_000)
})
