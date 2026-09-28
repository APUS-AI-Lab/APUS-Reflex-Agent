import { Context } from '@deepseek-ai/cordis'
import Projections from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import System3, { type System3DecisionRequest } from '../src/index.ts'

/** Plugin input config: the schema's mutable input shape, not the readonly service `Config`. */
type MountConfig = Parameters<typeof System3.Config>[0]

const input: System3DecisionRequest = {
  dataClasses: ['workspace'],
  supervisor: {
    currentGoalRevision: 'g1', advice: { action: 'candidate_done', goalRevision: 'g1', evidenceRefs: ['check:1'] },
    requiredChecks: [{ id: 'checks', status: 'fail', evidenceRefs: ['check:1'] }], availableEvidenceRefs: ['check:1'], budgetRemaining: 10,
  }, turn: 1, step: 0,
}

async function mount(config: MountConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(Projections)
  const jev = await ctx.plugin(Jev, { endpoint: 'http://localhost:30135', model: 'jev-test', providerId: 'unused' })
  const system3 = await ctx.plugin(System3, config)
  return { ctx, jev, system3 }
}

describe('System3 Jev shadow receipts', () => {
  it('retains independent checks and restores receipts without raw state or new I/O', async () => {
    const ctx = new Context()
    await ctx.plugin(Projections)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ model: 'jev-test', answers: { action: {
      type: 'choice', choice: 'candidate_done', probabilities: { continue: 0, retry: 0, escalate: 0, candidate_done: 1, unknown: 0 }, confidence: 1,
    } }, usage: { input_tokens: 11 } })))
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(fetcher)
    await ctx.plugin(Jev, { endpoint: 'http://localhost:30135', model: 'jev-test' })
    await ctx.plugin(System3, { jevExecutionDomain: 'local' })
    const session = Session.create(SessionId('shadow'))
    try {
      const receipt = await ctx.get('system3')!.shadowDecision(session, input)
      expect(receipt.outcome.kind).toBe('ok')
      expect(receipt.advice).toBe('candidate_done')
      expect(receipt.baseline).toMatchObject({ action: 'retry', reason: 'failed-checks' })
      expect(receipt.comparison.divergence).toBe('model-premature-done')
      expect(receipt.request.state).toEqual(input.supervisor)
      expect(receipt.request.questions.action?.type).toBe('choice')
      expect(session.deriveMessages()).toEqual([])
      const restored = Session.fromRestore(session.id, session.snapshotEvents(), session.header, SessionLogOffset(0), 'shared-frozen')
      expect(ctx.get('system3')!.lastDecision(restored)).toEqual(receipt)
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      transport.mockRestore(); await ctx.fiber.dispose()
    }
  })

  it('blocks a loopback tunnel declared as remote in local-only mode before I/O', async () => {
    const { ctx } = await mount({ privacyMode: 'local-only', jevExecutionDomain: 'network' })
    const transport = vi.spyOn(ctx.get('jev')!, 'decide')
    try {
      const receipt = await ctx.get('system3')!.shadowDecision(Session.create(SessionId('denied')), input)
      expect(receipt.outcome).toEqual({ kind: 'unknown', code: 'privacy-denied' })
      expect(receipt.baseline.action).toBe('retry')
      expect(transport).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('records a cancelled operation and preserves caller cancellation', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local' })
    const session = Session.create(SessionId('cancelled'))
    const abort = new AbortController()
    abort.abort(new Error('caller cancelled'))
    try {
      await expect(ctx.get('system3')!.shadowDecision(session, input, abort.signal)).rejects.toThrow('caller cancelled')
      expect(ctx.get('system3')!.lastDecision(session)?.outcome).toEqual({ kind: 'unknown', code: 'cancelled' })
    } finally { await ctx.fiber.dispose() }
  })

  it('records unknown with the deterministic baseline when the provider times out', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local' })
    vi.spyOn(ctx.get('jev')!, 'decide').mockResolvedValue({ kind: 'unknown', spec: { state: null, questions: {}, providerId: 'unused', model: 'jev-test' }, failure: { code: 'timeout', message: 'safe' } })
    try {
      const receipt = await ctx.get('system3')!.shadowDecision(Session.create(SessionId('timeout')), input)
      expect(receipt.outcome).toEqual({ kind: 'unknown', code: 'timeout' })
      expect(receipt.baseline.action).toBe('retry')
    } finally { await ctx.fiber.dispose() }
  })
})
