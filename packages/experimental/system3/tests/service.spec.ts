import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import System3 from '../src/index.ts'

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
})
