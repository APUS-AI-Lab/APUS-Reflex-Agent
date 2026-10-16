import { Context } from '@deepseek-ai/cordis'
import Projections from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import Jev, { JevConfigurationError } from '../../apus-dsh-jev-plugin/src/index.ts'
import System3, { type System3DecisionRequest } from '../src/index.ts'
import { system3DecisionProjection } from '../src/decision-projection.ts'

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

  it('admits a registered provider declaring local execution in local-only mode and records its domain', async () => {
    const ctx = new Context()
    await ctx.plugin(Projections)
    await ctx.plugin(Jev, { defaultProviderId: 'reflex-local' })
    await ctx.plugin(System3, { privacyMode: 'local-only', jevExecutionDomain: 'network' })
    const decide = vi.fn(async () => ({ model: 'local', answers: { action: { type: 'choice' as const, choice: 'retry',
      probabilities: { continue: 0, retry: 1, escalate: 0, candidate_done: 0, unknown: 0 }, confidence: 1 } } }))
    const dispose = ctx.jev.register({ info: { id: 'reflex-local', model: 'local', endpoint: 'http://127.0.0.1:1', executionDomain: 'local' }, decide })
    try {
      const receipt = await ctx.system3.shadowDecision(Session.create(SessionId('local-provider')), input)
      expect(receipt).toMatchObject({ outcome: { kind: 'ok' }, advice: 'retry', executionDomain: 'local', providerId: 'reflex-local' })
      expect(decide).toHaveBeenCalledTimes(1)
      dispose()
      const unavailable = await ctx.system3.shadowDecision(Session.create(SessionId('local-provider-gone')), input)
      expect(unavailable).toMatchObject({ outcome: { kind: 'unknown', code: 'privacy-denied' }, executionDomain: 'network' })
    } finally { dispose(); await ctx.fiber.dispose() }
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

it('records and restores the actual configured effort on each new decision', async () => {
  const ctx = new Context()
  await ctx.plugin(Projections)
  let effort: 'low' | 'high' = 'high'
  new Jev(ctx, { enabled: { get: () => true }, endpoint: { get: () => 'https://reflex.test' }, model: { get: () => 'reflex-test' },
    effort: { get: () => effort }, protocol: { get: () => 'openjev' },
    timeoutMs: { get: () => 1000 }, apiKeyEnv: { get: () => undefined } })
  await ctx.plugin(System3, { jevExecutionDomain: 'local' })
  const sent: unknown[] = []
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'))
    return new Response(JSON.stringify({ model: 'reflex-test', answers: { action: {
      type: 'choice', choice: 'retry', probabilities: { retry: 1 }, confidence: 1,
    } } }))
  })
  const session = Session.create(SessionId('configured-effort'))
  try {
    const first = await ctx.system3.shadowDecision(session, input)
    effort = 'low'
    const second = await ctx.system3.shadowDecision(session, input)
    expect(first).toMatchObject({ effort: 'high', request: { effort: 'high' } })
    expect(second).toMatchObject({ effort: 'low', request: { effort: 'low' } })
    expect(sent).toMatchObject([{ effort: 'high' }, { effort: 'low' }])
    expect(system3DecisionProjection.stateSchema.parse(first)).toEqual(first)
    expect(system3DecisionProjection.stateSchema.parse(second)).toEqual(second)
  } finally { transport.mockRestore(); await ctx.fiber.dispose() }
})

it('restores a denied decision without inventing an effective effort', async () => {
  const { ctx } = await mount({ privacyMode: 'local-only', jevExecutionDomain: 'network' })
  try {
    const receipt = await ctx.system3.shadowDecision(Session.create(SessionId('denied-no-effort')), input)
    expect(receipt.outcome).toEqual({ kind: 'unknown', code: 'privacy-denied' })
    expect(receipt.effort).toBeUndefined()
    expect(system3DecisionProjection.stateSchema.parse(receipt)).toEqual(receipt)
  } finally { await ctx.fiber.dispose() }
})

describe('System3 Jev shadow receipt failure paths', () => {
  const spec = { state: null, questions: {}, providerId: 'unused', model: 'jev-test' }
  const answer = (action: unknown) => ({ kind: 'ok' as const, spec, response: { model: 'jev-test', answers: { action } } }) as Awaited<ReturnType<Jev['decide']>>

  it('reads advice only from a known choice', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local' })
    const decide = vi.spyOn(ctx.jev, 'decide')
    try {
      decide.mockResolvedValueOnce(answer({ type: 'noul', noul: 1 }))
      expect((await ctx.system3.shadowDecision(Session.create(SessionId('noul')), input)).advice).toBe('unknown')
      decide.mockResolvedValueOnce(answer({ type: 'choice', choice: 'invent', probabilities: { invent: 1 }, confidence: 1 }))
      expect((await ctx.system3.shadowDecision(Session.create(SessionId('invented')), input)).advice).toBe('unknown')
    } finally { await ctx.fiber.dispose() }
  })

  it('records a provider HTTP status and treats a configuration error during dispatch as unavailable', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local' })
    const decide = vi.spyOn(ctx.jev, 'decide')
    try {
      decide.mockResolvedValueOnce({ kind: 'unknown', spec, failure: { code: 'http', message: 'safe', status: 503 } })
      expect((await ctx.system3.shadowDecision(Session.create(SessionId('http')), input)).outcome).toEqual({ kind: 'unknown', code: 'http', status: 503 })
      decide.mockRejectedValueOnce(new JevConfigurationError('switched off'))
      expect((await ctx.system3.shadowDecision(Session.create(SessionId('switched-off')), input)).outcome)
        .toEqual({ kind: 'unknown', code: 'provider-unavailable' })
    } finally { await ctx.fiber.dispose() }
  })

  it('records nothing and rethrows unexpected resolver and provider failures', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local' })
    const session = Session.create(SessionId('unexpected'))
    try {
      const resolve = vi.spyOn(ctx.jev, 'resolve').mockImplementationOnce(() => { throw new Error('resolver bug') })
      await expect(ctx.system3.shadowDecision(session, input)).rejects.toThrow('resolver bug')
      resolve.mockRestore()
      vi.spyOn(ctx.jev, 'decide').mockRejectedValueOnce(new Error('provider bug'))
      await expect(ctx.system3.shadowDecision(session, input)).rejects.toThrow('provider bug')
      expect(session.snapshotEvents().filter(event => event.type === 'system3/decision')).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('records cancellation for non-Error abort reasons and for a provider that settles after cancellation', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local' })
    const decide = vi.spyOn(ctx.jev, 'decide')
    try {
      await expect(ctx.system3.shadowDecision(Session.create(SessionId('pre-aborted')), input, AbortSignal.abort('gone')))
        .rejects.toMatchObject({ name: 'AbortError' })
      const rejecting = new AbortController()
      decide.mockImplementationOnce(async () => {
        rejecting.abort('gone')
        throw 'aborted by caller'
      })
      const rejected = Session.create(SessionId('rejected'))
      await expect(ctx.system3.shadowDecision(rejected, input, rejecting.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(ctx.system3.lastDecision(rejected)?.outcome).toEqual({ kind: 'unknown', code: 'cancelled' })
      const settling = new AbortController()
      decide.mockImplementationOnce(async () => {
        settling.abort('gone')
        return answer({ type: 'choice', choice: 'retry', probabilities: { retry: 1 }, confidence: 1 })
      })
      await expect(ctx.system3.shadowDecision(Session.create(SessionId('settled')), input, settling.signal))
        .rejects.toMatchObject({ name: 'AbortError' })
    } finally { await ctx.fiber.dispose() }
  })

  it('sends the configured effort and records continue advice', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local', jevEffort: 'high' })
    const decide = vi.spyOn(ctx.jev, 'decide').mockResolvedValueOnce(answer({ type: 'choice', choice: 'continue', probabilities: { continue: 1 }, confidence: 1 }))
    try {
      const receipt = await ctx.system3.shadowDecision(Session.create(SessionId('effort')), input)
      expect(receipt).toMatchObject({ advice: 'continue', effort: 'high' })
      expect(decide.mock.calls[0]?.[0]).toMatchObject({ effort: 'high' })
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps the provider error as the cancellation when it rejects with an Error after the caller aborts', async () => {
    const { ctx } = await mount({ jevExecutionDomain: 'local' })
    const abort = new AbortController()
    vi.spyOn(ctx.jev, 'decide').mockImplementationOnce(async () => {
      abort.abort('gone')
      throw new Error('request aborted')
    })
    try {
      await expect(ctx.system3.shadowDecision(Session.create(SessionId('error-abort')), input, abort.signal)).rejects.toThrow('request aborted')
    } finally { await ctx.fiber.dispose() }
  })

  it('records unavailable without dispatch when Jev is not mounted or not configured', async () => {
    const ctx = new Context()
    await ctx.plugin(Projections)
    await ctx.plugin(System3, { jevExecutionDomain: 'local' })
    try {
      expect((await ctx.system3.shadowDecision(Session.create(SessionId('no-jev')), input)).outcome)
        .toEqual({ kind: 'unknown', code: 'provider-unavailable' })
      await ctx.plugin(Jev, {})
      expect((await ctx.system3.shadowDecision(Session.create(SessionId('unconfigured')), input)).outcome)
        .toEqual({ kind: 'unknown', code: 'provider-unavailable' })
    } finally { await ctx.fiber.dispose() }
  })
})
