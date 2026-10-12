import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import System3 from '../src/index.ts'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import GoalService from '@deepseek-ai/dsh-goal'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'

describe('System3 Cordis service', () => {
  it('composes local-first route, evidence, supervision, and counters', async () => {
    const ctx = new Context()
    const plugin = await ctx.plugin(System3, { privacyMode: 'local-only' })
    try {
      const service = ctx.get('system3')!
      const route = service.route([
        { id: 'codex', executionDomain: 'network', dataClasses: ['workspace'] },
        { id: 'local-9b', executionDomain: 'local', dataClasses: ['workspace'] },
      ], 'codex')
      expect(route.selected?.id).toBe('local-9b')
      const evidence = service.evidence({ artifactRef: 'tool:1', text: 'ok', maxChars: 10 })
      expect(evidence.truncated).toBe(false)
      const baseline = service.supervise({
        currentGoalRevision: 'goal:1',
        advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['test:1'] },
        requiredChecks: [{ id: 'tests', status: 'pass', evidenceRefs: ['test:1'] }],
        availableEvidenceRefs: ['test:1'], budgetRemaining: 1,
      })
      expect(service.shadow('candidate_done', baseline).agrees).toBe(true)
      expect(service.snapshot()).toEqual({
        routes: 1,
        evidence: 1,
        supervision: 1,
        shadow: 1,
        costs: 0,
        agent: { preSteps: 0, requests: 0, requestErrors: 0, turnStops: 0 },
      })
    } finally {
      await plugin.dispose()
    }
  })

  it('does not permit the service config to override per-call policy boundaries', async () => {
    const ctx = new Context()
    const plugin = await ctx.plugin(System3, { privacyMode: 'controlled', approvedRemoteIds: ['codex'], approvedRemoteDataClasses: ['workspace'] })
    try {
      const result = ctx.get('system3')!.route([{ id: 'claude', executionDomain: 'network', dataClasses: ['workspace'] }], 'claude')
      expect(result.selected).toBeUndefined()
      expect(result.blocked[0]?.reason).toBe('route-not-approved')
    } finally {
      await plugin.dispose()
    }
  })

  it('observes AgentLoop boundaries without changing their decisions', async () => {
    const ctx = new Context()
    const plugin = await ctx.plugin(System3, { observeAgentLoop: true })
    try {
      const agent = { id: 'test-agent', ctx } as never
      const dispatch = agentEvents(ctx, agent)
      const signal = new AbortController().signal
      const messages: never[] = []

      await dispatch.waterfall('agent/pre-step', { turn: 1, step: 0, signal, messages }, () => Promise.resolve({ kind: 'enter', messages }))
      await dispatch.waterfall('agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve({} as never))
      await dispatch.serial('agent/turn-stopping', { turn: 1, signal })

      expect(ctx.system3.snapshot().agent).toEqual({ preSteps: 1, requests: 1, requestErrors: 0, turnStops: 1 })
    } finally {
      await plugin.dispose()
    }
  })

  it('observes a real AgentLoop process and leaves a durable turn trace', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const plugin = await ctx.plugin(System3, { observeAgentLoop: true })
    ctx.effect(() => ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')])))
    try {
      const agent = await ctx.agentLoop.create(SessionId('system3-real-loop'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run one bounded step' }], source: { kind: 'user' } }))
      await agent.whenIdle()

      expect(ctx.system3.snapshot().agent).toEqual({ preSteps: 1, requests: 1, requestErrors: 0, turnStops: 1 })
      expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(expect.arrayContaining(['turn/start', 'step/start', 'step/end', 'turn/end']))
    } finally {
      await plugin.dispose()
      await ctx.fiber.dispose()
    }
  })
})


it.each(['active', 'shadow', 'disabled', 'absent'] as const)('publishes actual Reflex capability settings for %s composition and removes ownership on unload', async (mode) => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(GoalService)
  await ctx.plugin(SubagentRuntime, {})
  new TokenMeter(ctx)
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'capability-test' })
  const common = { mode: mode === 'active' ? 'active' as const : 'shadow' as const, yes: 0.9, no: 0.1, deadlineMs: 1000, sessionDataClasses: ['public' as const] }
  const settings = mode === 'absent' ? {} : mode === 'disabled' ? { reflexContext: false as const, reflexSupervision: false as const, entryRouting: false as const } : {
    reflexContext: { ...common, maxRequestChars: 4000, maxCandidates: 4, maxFragmentChars: 500,
      protectRecentMessages: 4, maxRestoredChars: 1000, maxSearchResults: 4 },
    reflexSupervision: { ...common, intervalMs: 100, stallMs: 1000, repeatedFailures: 3, evidenceLimit: 16,
      cooldownMs: 100, maxInterventions: 2, feedbackMs: 200,
      ...mode === 'active' ? { recovery: { nativeSilenceMs: 5000, reassessmentMs: 1000, retryLimit: 3, interruptGraceMs: 1000, cooldownMs: 2000, maxRecoveries: 1 } } : {} },
    entryRouting: { sessionDataClasses: ['public' as const], minConfidence: 0.9, maxInputBytes: 4000,
      candidates: [{ id: 'codex', description: 'Engineering work', delegate: { provider: 'codex', tool: 'subagent_codex' }, executionDomain: 'local' as const, dataClasses: ['public' as const] }] },
  }
  const plugin = await ctx.plugin(System3, settings)
  try {
    const states = ctx.jev.readStatus().capabilities
    expect(states.find(item => item.id === 'entryRouting')).toMatchObject({ implemented: true, enabled: mode === 'active' || mode === 'shadow' })
    expect(states.find(item => item.id === 'contextMemory')).toMatchObject({ implemented: true, enabled: mode === 'active' })
    expect(states.find(item => item.id === 'codexSupervision')).toMatchObject({ implemented: true, enabled: mode === 'active' })
    if (mode === 'active' || mode === 'shadow') {
      expect(states.find(item => item.id === 'contextMemory')?.settings).toEqual({ maxCandidates: 4, maxFragmentChars: 500, maxRestoredChars: 1000, maxRequestChars: 4000 })
      expect(states.find(item => item.id === 'codexSupervision')?.settings).toMatchObject({ stallMs: 1000, cooldownMs: 100, maxInterventions: 2, feedbackMs: 200 })
      if (mode === 'active') expect(states.find(item => item.id === 'codexSupervision')?.settings).toMatchObject({ nativeSilenceMs: 5000, recoveryReassessmentMs: 1000, retryLimit: 3, interruptGraceMs: 1000, recoveryCooldownMs: 2000, maxRecoveries: 1 })
      else expect(states.find(item => item.id === 'codexSupervision')?.settings).not.toHaveProperty('nativeSilenceMs')
      expect(ctx.tools.get('reflex_memory')).toBeDefined()
    } else {
      expect(states.find(item => item.id === 'contextMemory')).not.toHaveProperty('settings')
      expect(ctx.tools.get('reflex_memory')).toBeUndefined()
    }
    await plugin.dispose()
    expect(ctx.jev.readStatus().capabilities.every(item => !item.implemented && !item.enabled)).toBe(true)
    expect(ctx.tools.get('reflex_memory')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})


it('validates cost accounting and rejects receipt reads after its projection owner is removed', async () => {
  const ctx = new Context()
  const plugin = await ctx.plugin(System3)
  const service = ctx.system3
  const session = Session.create(SessionId('receipt-dependencies'))
  try {
    const record = { requestId: 'request-1', episodeId: 'episode-1', modelRevision: 'model-1', inputTokens: 12,
      outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 0, source: 'provider' as const, elapsedMs: 20 }
    expect(service.validateCost(record)).toEqual(record)
    expect(service.sumCosts([record, { ...record, requestId: 'request-2' }])).toMatchObject({ inputTokens: 24, outputTokens: 6, elapsedMs: 40 })
    expect(service.snapshot().costs).toBe(3)
    expect(() => service.lastDecision(session)).toThrow('require sessionProjections')
    await mountAgentLoopTestDependencies(ctx)
    expect(service.lastDecision(session)).toBeNull()
    await plugin.dispose()
    expect(() => service.lastDecision(session)).toThrow('projection is not registered')
  } finally { await ctx.fiber.dispose() }
})
it('observes a failed real model request without suppressing its native failure', async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(System3, { observeAgentLoop: true })
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], new MockAdapter([() => { throw new Error('fixture model failure') }])))
  try {
    const agent = await ctx.agentLoop.create(SessionId('observed-failure'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Run the request.' }] }))
    await agent.whenIdle()
    expect(ctx.system3.snapshot().agent.requestErrors).toBe(1)
    expect(agent.session.snapshotEvents().some(event => event.type === 'turn/end' && event.data.reason.kind !== 'completed')).toBe(true)
  } finally { await ctx.fiber.dispose() }
})

it('uses local-only policy when the service is constructed without deployment configuration', async () => {
  const ctx = new Context()
  const service = new System3(ctx)
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'unconfigured-capabilities' })
  try {
    expect(ctx.jev.readStatus().capabilities.every(item => !item.enabled)).toBe(true)
    expect(service.privacyPolicy).toEqual({ mode: 'local-only' })
    expect(service.route([{ id: 'remote', executionDomain: 'network', dataClasses: ['public'] }]).selected).toBeUndefined()
    const receipt = await service.shadowDecision(Session.create(SessionId('default-service')), {
      dataClasses: ['public'], supervisor: { currentGoalRevision: 'g1', advice: { action: 'continue', goalRevision: 'g1', evidenceRefs: [] },
        requiredChecks: [], availableEvidenceRefs: [], budgetRemaining: 1 },
    })
    expect(receipt).toMatchObject({ routeId: 'jev', executionDomain: 'network', outcome: { kind: 'unknown', code: 'privacy-denied' } })
    expect(receipt).not.toHaveProperty('effort')
  } finally { await ctx.fiber.dispose() }
})


it('keeps configured capabilities disabled until dependencies arrive and disables them again on dependency removal', async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'late-dependencies' })
  const common = { mode: 'active' as const, yes: 0.9, no: 0.1, deadlineMs: 1000, sessionDataClasses: ['public' as const] }
  await ctx.plugin(System3, { jevEffort: 'low',
    reflexContext: { ...common, maxRequestChars: 4000, maxCandidates: 4, maxFragmentChars: 500,
      protectRecentMessages: 4, maxRestoredChars: 1000, maxSearchResults: 4 },
    reflexSupervision: { ...common, intervalMs: 100, stallMs: 1000, repeatedFailures: 3, evidenceLimit: 16,
      cooldownMs: 100, maxInterventions: 2, feedbackMs: 200 },
  })
  const enabled = (id: string) => ctx.jev.readStatus().capabilities.find(item => item.id === id)?.enabled
  try {
    expect(enabled('contextMemory')).toBe(false)
    expect(enabled('codexSupervision')).toBe(false)
    expect(ctx.tools.get('reflex_memory')).toBeUndefined()
    const meter = await ctx.plugin(TokenMeter)
    expect(enabled('contextMemory')).toBe(true)
    expect(ctx.tools.get('reflex_memory')).toBeDefined()
    const goals = await ctx.plugin(GoalService)
    expect(enabled('codexSupervision')).toBe(false)
    await ctx.plugin(SubagentRuntime, {})
    expect(enabled('codexSupervision')).toBe(true)
    await meter.dispose()
    expect(enabled('contextMemory')).toBe(false)
    expect(ctx.tools.get('reflex_memory')).toBeUndefined()
    await goals.dispose()
    expect(enabled('codexSupervision')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})

it.each([true, false])('reports semantic supervision only when workspace admission is effective (%s)', async (workspaceAllowed) => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(GoalService)
  await ctx.plugin(SubagentRuntime, {})
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'semantic-status' })
  await ctx.plugin(System3, {
    privacyMode: 'controlled', approvedRemoteIds: ['reflex'],
    approvedRemoteDataClasses: workspaceAllowed ? ['public', 'workspace'] : ['public'],
    jevRouteId: 'reflex', jevExecutionDomain: 'network',
    reflexSupervision: { mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 1000,
      sessionDataClasses: ['public'], intervalMs: 100, stallMs: 1000, repeatedFailures: 3,
      evidenceLimit: 16, cooldownMs: 100, maxInterventions: 2, feedbackMs: 200,
      semantic: { minObservations: 2 } },
  })
  try {
    expect(ctx.jev.readStatus().capabilities.find(item => item.id === 'codexSupervision'))
      .toMatchObject({ implemented: true, enabled: true, semanticSupervision: { enabled: workspaceAllowed } })
  } finally { await ctx.fiber.dispose() }
})
