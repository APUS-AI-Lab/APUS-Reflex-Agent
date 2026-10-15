/** The live front-loaded decision switch: native path and no Jev while off, capability rows, default, and disposal. */
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Skills from '@deepseek-ai/dsh-skill'
import GoalService from '@deepseek-ai/dsh-goal'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { afterEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import System3, { type Config } from '../src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

const skillSelection = { sessionDataClasses: ['public'], minConfidence: 0.8, maxInputBytes: 8000, maxContentBytes: 8000,
  maxCandidates: 12, deadlineMs: 500 } as const

/** Mount Skill selection and Jev, then System3 from `config` inside a child plugin whose disposal the tests can observe. */
async function setup(config: Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Skills)
  await ctx.plugin(GoalService)
  await ctx.plugin(SubagentRuntime, {})
  ctx.effect(() => ctx.skills.register({ name: 'csv-reconciliation', description: 'Reconcile public CSV rows and report discrepancies.',
    source: 'runtime', content: 'Read every CSV row and independently verify aggregate totals.',
    invocation: { modelInvocable: true, userInvocable: true } }))
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async query => ({ kind: 'ok', spec: ctx.jev.resolve(query),
    response: { model: 'jev-test', answers: { intent: { type: 'choice', choice: 'action', confidence: 1, probabilities: { action: 1 } },
      skill: { type: 'choice', choice: 'skill-0', confidence: 1, probabilities: { 'skill-0': 1, abstain: 0 } } } } }))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('first'), textResponse('second')])))
  const fiber = ctx.plugin({ apply: (inner: Context) => { new System3(inner, { jevExecutionDomain: 'local', skillSelection, ...config }) } })
  await fiber
  const agent = await ctx.agentLoop.create(SessionId('front-loaded'), { provider: 'mock', model: 'mock' })
  const capability = (id: string) => ctx.jev.readStatus().capabilities.find(item => item.id === id)
  const injected = () => agent.session.snapshotEvents()
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-invocation').length
  const send = async (text: string): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  return { ctx, decide, fiber, agent, capability, injected, send }
}

it('takes the native path without asking Jev while off, and decides again once switched on without a reload', async () => {
  let on = false
  const h = await setup({ frontLoadedDecisions: { get: () => on } })
  expect(h.capability('skillSelection')).toEqual({ id: 'skillSelection', implemented: true, enabled: false, suspended: true })
  expect(h.capability('entryRouting')).toEqual({ id: 'entryRouting', implemented: true, enabled: false })
  await h.send('Reconcile the CSV rows.')
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.injected()).toBe(0)
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill ?? null).toBeNull()
  on = true
  expect(h.capability('skillSelection')).toEqual({ id: 'skillSelection', implemented: true, enabled: true })
  await h.send('Reconcile the CSV rows again.')
  expect(h.decide).toHaveBeenCalledOnce()
  expect(h.injected()).toBe(1)
})

it('treats the Reflex master switch off like the switch off: no Jev request, no record, suspended rows', async () => {
  const h = await setup({})
  const master = vi.spyOn(h.ctx.jev, 'isEnabled').mockReturnValue(false)
  expect(h.capability('skillSelection')).toEqual({ id: 'skillSelection', implemented: true, enabled: false, suspended: true })
  await h.send('Reconcile the CSV rows.')
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.injected()).toBe(0)
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill ?? null).toBeNull()
  master.mockReturnValue(true)
  await h.send('Reconcile the CSV rows again.')
  expect(h.decide).toHaveBeenCalledOnce()
})

it('runs front-loaded decisions when the switch is absent', async () => {
  const h = await setup({})
  expect(h.capability('skillSelection')?.enabled).toBe(true)
  await h.send('Reconcile the CSV rows.')
  expect(h.decide).toHaveBeenCalledOnce()
})

it('reports entry routing off with the switch and removes every capability when System3 unloads', async () => {
  let on = true
  const h = await setup({ frontLoadedDecisions: { get: () => on }, entryRouting: {
    candidates: [{ id: 'codex', description: 'Engineering work', delegate: { provider: 'codex', tool: 'subagent_codex' },
      executionDomain: 'local', dataClasses: ['public'] }],
    sessionDataClasses: ['public'], minConfidence: 0.8, maxInputBytes: 4000,
  } })
  expect(h.capability('entryRouting')).toMatchObject({ implemented: true, enabled: true })
  on = false
  expect(h.capability('entryRouting')).toMatchObject({ implemented: true, enabled: false, suspended: true })
  await h.fiber.dispose()
  expect(h.ctx.jev.readStatus().capabilities.every(item => !item.implemented && !item.enabled)).toBe(true)
})
