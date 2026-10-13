import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import ContinuumJevPlugin, {
  ContinuumJevUnavailableError, selectContinuumMemory, recordContinuumMemoryDecision, latestContinuumMemoryDecision,
  type ContinuumJev, type ContinuumJevConfig,
} from '../src/index.ts'
import { JevConfigurationError, JevProtocolError, type JevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

const first = { id: MemoryId('a'), label: 'A', excerpt: 'alpha', score: 0.8 } as const
const second = { id: MemoryId('b'), label: 'B', excerpt: 'beta', score: 0.4 } as const
const input = { isCurrent: () => true, query: 'which memory?', candidates: [first, second] } as const
const config = {
  mode: 'active', timeoutMs: 2000, maxRequestBytes: 32_768, sessionDataClasses: ['workspace'],
  privacyPolicy: { mode: 'controlled', approvedRemoteIds: ['fake'], approvedRemoteDataClasses: ['workspace'] },
} satisfies ContinuumJevConfig
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

function fake(probabilities = [0.1, 0.9]): ContinuumJev & { calls: JevRequest[] } {
  const calls: JevRequest[] = []
  return {
    calls,
    resolve: request => ({ ...request, providerId: 'fake', model: 'fake-model', effort: 'high' }),
    decide: async (request) => {
      calls.push(request)
      return { kind: 'ok', spec: { ...request, providerId: 'fake', model: 'fake-model' }, response: {
        model: 'fake-model', answers: Object.fromEntries(Object.keys(request.questions).map((key, index) =>
          [key, { type: 'noul', noul: probabilities[index] ?? 0.5 }])),
      } }
    },
  }
}

describe('Continuum coverage-preserving relevance', () => {
  it('retains the entire baseline and makes no provider call when off', async () => {
    const provider = fake()
    const result = await selectContinuumMemory(provider, { ...config, mode: 'off', privacyPolicy: { mode: 'local-only' } }, input)
    expect(result).toMatchObject({ outcome: 'off', selectedIds: ['a', 'b'], baselineIds: ['a', 'b'] })
    expect(provider.calls).toEqual([])
  })

  it('scores both candidates in one request and retains even zero-relevance candidates', async () => {
    const provider = fake([0, 1])
    const result = await selectContinuumMemory(provider, config, input)
    expect(result.selectedIds).toEqual(['b', 'a'])
    expect(result.baselineIds).toEqual(['a', 'b'])
    expect(result.evaluation).toMatchObject({ phase: 'settled', reason: 'ranked', unscoredIds: [] })
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]).toMatchObject({ providerId: 'fake', model: 'fake-model', effort: 'high' })
    expect(Object.values(provider.calls[0]!.questions).map(question => question.type)).toEqual(['noul', 'noul'])
    expect(result).not.toHaveProperty('confidence')
  })

  it('records advice in shadow mode while preserving baseline order', async () => {
    const result = await selectContinuumMemory(fake(), { ...config, mode: 'shadow' }, input)
    expect(result.selectedIds).toEqual(['a', 'b'])
    expect(result.evaluation.rankedIds).toEqual(['b', 'a'])
  })

  it.each([0, 1, 16, 17])('retains all %i candidates with at most one batch', async (count) => {
    const provider = fake(Array.from({ length: count }, (_, index) => index / Math.max(1, count)))
    const candidates = Array.from({ length: count }, (_, index) => ({ ...first, id: MemoryId(`m-${index}`) }))
    const result = await selectContinuumMemory(provider, config, { ...input, candidates })
    expect(result.selectedIds).toHaveLength(count)
    expect(new Set(result.selectedIds)).toEqual(new Set(candidates.map(candidate => candidate.id)))
    expect(provider.calls).toHaveLength(count === 0 ? 0 : 1)
    if (count > 0) expect(Object.keys(provider.calls[0]!.questions)).toHaveLength(Math.min(count, 16))
    expect(result.evaluation.unscoredIds).toEqual(candidates.slice(16).map(candidate => candidate.id))
    if (count === 17) expect(result.selectedIds[16]).toBe('m-16')
  })

  it('keeps baseline positions when relevance scores tie', async () => {
    expect((await selectContinuumMemory(fake([0.5, 0.5]), config, input)).selectedIds).toEqual(['a', 'b'])
  })

  it.each([
    { mode: 'local-only' as const },
    { mode: 'controlled' as const, approvedRemoteIds: ['other'], approvedRemoteDataClasses: ['workspace' as const] },
    { mode: 'controlled' as const, approvedRemoteIds: ['fake'], approvedRemoteDataClasses: ['public' as const] },
    { mode: 'cloud-approved' as const, approvedRemoteIds: ['fake'], approvedRemoteDataClasses: ['workspace' as const], cloudApproval: false },
  ])('refuses outbound requests under policy %j', async (privacyPolicy) => {
    const provider = fake()
    const result = await selectContinuumMemory(provider, { ...config, privacyPolicy }, input)
    expect(result).toMatchObject({ failure: 'privacy-denied', selectedIds: ['a', 'b'], evaluation: { request: null } })
    expect(provider.calls).toEqual([])
  })

  it.each([null, [], ['secret']] as const)('denies unknown or unapproved session classification %j', async (sessionDataClasses) => {
    const provider = fake()
    expect(await selectContinuumMemory(provider, { ...config, sessionDataClasses }, input)).toMatchObject({ failure: 'privacy-denied' })
    expect(provider.calls).toEqual([])
  })

  it('propagates cancellation promptly even when the provider never settles', async () => {
    const abort = new AbortController()
    const provider: ContinuumJev = { ...fake(), decide: () => {
      abort.abort(new Error('stop now'))
      return new Promise(() => {})
    } }
    await expect(selectContinuumMemory(provider, config, input, abort.signal)).rejects.toThrow('stop now')
  })

  it('does not dispatch a prepared request invalidated at its durable checkpoint', async () => {
    const provider = fake()
    let current = true
    const result = await selectContinuumMemory(provider, config, { ...input, isCurrent: () => current }, undefined, async () => {
      current = false
      return SessionSeq(3)
    })
    expect(result).toMatchObject({ failure: 'invalidated', selectedIds: ['a', 'b'], evaluation: { preparedSeq: 3 } })
    expect(provider.calls).toEqual([])
  })

  it('counts the complete resolved request at its exact byte limit', async () => {
    const provider = fake()
    await selectContinuumMemory(provider, config, input)
    const bytes = Buffer.byteLength(JSON.stringify(provider.calls[0]))
    const exact = await selectContinuumMemory(provider, { ...config, maxRequestBytes: bytes }, input)
    expect(exact.outcome).toBe('jev')
    const blocked = await selectContinuumMemory(provider, { ...config, maxRequestBytes: bytes - 1 }, input)
    expect(blocked).toMatchObject({ failure: 'request-budget', selectedIds: ['a', 'b'], evaluation: { request: null } })
    expect(provider.calls).toHaveLength(2)
  })

  it('keeps all candidates on provider failure or a missing question answer', async () => {
    const provider = fake()
    const unknown: ContinuumJev = { ...provider, decide: async request => ({ kind: 'unknown', spec: provider.resolve(request), failure: { code: 'rate-limited', message: 'busy' } }) }
    expect(await selectContinuumMemory(unknown, config, input)).toMatchObject({ failure: 'rate-limited', selectedIds: ['a', 'b'] })
    const throwing: ContinuumJev = { ...provider, decide: async () => { throw new Error('provider failed') } }
    expect(await selectContinuumMemory(throwing, config, input)).toMatchObject({ failure: 'provider-error', selectedIds: ['a', 'b'] })
    const incomplete: ContinuumJev = { ...provider, decide: async request => ({ kind: 'ok', spec: provider.resolve(request), response: { model: 'fake', answers: {} } }) }
    expect(await selectContinuumMemory(incomplete, config, input)).toMatchObject({ failure: 'invalid-response', selectedIds: ['a', 'b'] })
  })

  it('distinguishes transient resolution failure from configuration or protocol errors', async () => {
    const provider = fake()
    const failing: ContinuumJev = { ...provider, resolve: () => { throw new Error('resolver unavailable') } }
    expect(await selectContinuumMemory(failing, config, input)).toMatchObject({ failure: 'resolve-error', selectedIds: ['a', 'b'] })
    for (const error of [new JevConfigurationError('missing endpoint'), new JevProtocolError('invalid request')]) {
      await expect(selectContinuumMemory({ ...provider, resolve: () => { throw error } }, config, input)).rejects.toBe(error)
    }
  })

  it('returns the full baseline after the batch deadline', async () => {
    const provider: ContinuumJev = { ...fake(), decide: () => new Promise(() => {}) }
    expect(await selectContinuumMemory(provider, { ...config, timeoutMs: 5 }, input)).toMatchObject({ failure: 'timeout', selectedIds: ['a', 'b'] })
  })

  it('propagates cancellation before dispatch and after a provider ignores cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled before'))
    await expect(selectContinuumMemory(fake(), config, input, controller.signal)).rejects.toThrow('cancelled before')
    const late = new AbortController()
    const provider = fake()
    const ignoring: ContinuumJev = { ...provider, decide: async (request) => {
      late.abort(new Error('cancelled during'))
      return provider.decide(request)
    } }
    await expect(selectContinuumMemory(ignoring, config, input, late.signal)).rejects.toThrow('cancelled during')
  })

  it('waits for the prepared receipt checkpoint and links the settled receipt to it', async () => {
    const provider = fake()
    let prepared = false
    const wrapped: ContinuumJev = { ...provider, decide: async (request, signal) => {
      expect(prepared).toBe(true)
      return provider.decide(request, signal)
    } }
    const result = await selectContinuumMemory(wrapped, config, input, undefined, async (receipt) => {
      expect(provider.calls).toEqual([])
      expect(receipt).toMatchObject({ outcome: 'unknown', evaluation: { phase: 'prepared', reason: 'prepared' } })
      expect(receipt.evaluation.request).toMatchObject({ providerId: 'fake', effort: 'high' })
      prepared = true
      return SessionSeq(12)
    })
    expect(result.evaluation.preparedSeq).toBe(12)
  })

  it('does not dispatch without checkpoint durability or when cancelled during preparation', async () => {
    const provider = fake()
    const unavailable = await selectContinuumMemory(provider, config, input, undefined, async () => undefined)
    expect(unavailable).toMatchObject({ failure: 'persistence-unavailable', selectedIds: ['a', 'b'] })
    const abort = new AbortController()
    await expect(selectContinuumMemory(provider, config, input, abort.signal, async () => {
      abort.abort(new Error('cancelled preparing'))
      return SessionSeq(1)
    })).rejects.toThrow('cancelled preparing')
    expect(provider.calls).toEqual([])
  })

  it('fails loudly without active Jev and falls back when shadow has no provider', async () => {
    await expect(selectContinuumMemory(undefined, config, input)).rejects.toBeInstanceOf(ContinuumJevUnavailableError)
    expect(await selectContinuumMemory(undefined, { ...config, mode: 'shadow' }, input)).toMatchObject({ outcome: 'baseline', selectedIds: ['a', 'b'] })
  })

  it.each([{ minConfidence: 0.8 }, { maxSelections: 1 }])('rejects legacy single-choice config %j', async (legacy) => {
    await expect(selectContinuumMemory(fake(), { ...config, ...legacy }, input)).rejects.toThrow('remove legacy')
  })

  it.each([{ timeoutMs: 0 }, { timeoutMs: 2 ** 31 }, { maxRequestBytes: 0 }])('rejects invalid limits %j', async (limits) => {
    await expect(selectContinuumMemory(fake(), { ...config, ...limits }, input)).rejects.toThrow('must be a positive')
  })

  it('reads historical receipts and records new evaluations without invoking Jev during replay', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('continuum-receipt'))
    expect(latestContinuumMemoryDecision(session.snapshotEvents())).toBeUndefined()
    session.append('continuum/memory-decision', { version: 1, mode: 'active', selectedIds: [first.id], baselineIds: [first.id], outcome: 'jev', confidence: 0.95 })
    expect(latestContinuumMemoryDecision(session.snapshotEvents())?.confidence).toBe(0.95)
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'next user input' }] }), { surfaceOp: 'append' })
    expect(latestContinuumMemoryDecision(session.snapshotEvents())?.confidence).toBe(0.95)
    const provider = fake()
    const result = await selectContinuumMemory(provider, config, input)
    const event = recordContinuumMemoryDecision(session, result)
    expect(latestContinuumMemoryDecision(session.snapshotEvents())).toEqual(event.data)
    expect(event.data.evaluation?.response).toEqual(result.evaluation.response)
    expect(provider.calls).toHaveLength(1)
  })

  it('mounts an off profile without outbound approval and removes its selector on disposal', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const fiber = ctx.plugin(ContinuumJevPlugin, { mode: 'off' })
    await fiber
    const session = ctx.sessions.create(SessionId('continuum-off'))
    const selector = ctx.get('continuumMemorySelector')!
    const result = await selector.select({ session } as Agent, input, new AbortController().signal)
    expect(result.selectedIds).toEqual(['a', 'b'])
    expect(latestContinuumMemoryDecision(session.snapshotEvents())?.evaluation?.phase).toBe('settled')
    await fiber.dispose()
    expect(ctx.get('continuumMemorySelector')).toBeUndefined()
  })

  it('records an unknown prepared evaluation but makes no network call without a persistence backend', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const provider = fake()
    ctx.provide('jev', provider as never)
    await ctx.plugin(ContinuumJevPlugin, config)
    const session = ctx.sessions.create(SessionId('continuum-no-backend'))
    const result = await ctx.get('continuumMemorySelector')!.select({ session } as Agent, input, new AbortController().signal)
    expect(result).toMatchObject({ failure: 'persistence-unavailable', selectedIds: ['a', 'b'] })
    expect(provider.calls).toEqual([])
    const phases = session.snapshotEvents().flatMap(event => event.type === 'continuum/memory-decision' ? [event.data.evaluation?.phase] : [])
    expect(phases).toEqual(['prepared', 'settled'])
  })
})
