import { describe, expect, it } from 'vitest'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ContinuumJevPlugin, { ContinuumJevTimeoutError, ContinuumJevUnavailableError, selectContinuumMemory, recordContinuumMemoryDecision, latestContinuumMemoryDecision, type ContinuumJev } from '../src/index.ts'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

const first = { id: MemoryId('a'), label: 'A', excerpt: 'alpha', score: 0.8 } as const
const second = { id: MemoryId('b'), label: 'B', excerpt: 'beta', score: 0.4 } as const
const input = { query: 'which memory?', candidates: [first, second] } as const

function fake(choice: string, confidence = 0.95): ContinuumJev {
  const request = { state: {}, questions: {} }
  const provider: ContinuumJev = {
    resolve: () => ({ ...request, providerId: 'fake', model: 'fake' }),
    decide: async () => ({ kind: 'ok', spec: { ...request, providerId: 'fake', model: 'fake' }, response: { model: 'fake', answers: { memory: { type: 'choice', choice, confidence, probabilities: { [choice]: 1 } } } } }),
  }
  return provider
}

describe('Continuum Jev controller', () => {
  it('keeps the original behavior when Reflex is off', async () => {
    const result = await selectContinuumMemory(undefined, { mode: 'off', minConfidence: 0.8 }, input)
    expect(result).toMatchObject({ outcome: 'off', selectedIds: [first.id], baselineIds: [first.id] })
  })

  it('uses baseline in shadow while exposing Jev advice', async () => {
    const result = await selectContinuumMemory(fake(String(second.id)), { mode: 'shadow', minConfidence: 0.8 }, input)
    expect(result).toMatchObject({ outcome: 'jev', selectedIds: [first.id], baselineIds: [first.id] })
  })

  it('lets active Jev choose only a supplied candidate', async () => {
    const result = await selectContinuumMemory(fake(String(second.id)), { mode: 'active', minConfidence: 0.8 }, input)
    expect(result).toMatchObject({ outcome: 'jev', selectedIds: [second.id], baselineIds: [first.id] })
  })

  it('treats an explicit abstain as an empty active selection', async () => {
    const abstain = await selectContinuumMemory(fake('none'), { mode: 'active', minConfidence: 0.8 }, input)
    expect(abstain).toMatchObject({ outcome: 'jev', selectedIds: [], baselineIds: [first.id] })
  })

  it('falls back on low confidence and invalid choices', async () => {
    const low = await selectContinuumMemory(fake(String(second.id), 0.2), { mode: 'active', minConfidence: 0.8 }, input)
    const invalid = await selectContinuumMemory(fake('invented'), { mode: 'active', minConfidence: 0.8 }, input)
    expect(low).toMatchObject({ outcome: 'unknown', failure: 'low-confidence', selectedIds: [first.id] })
    expect(invalid).toMatchObject({ outcome: 'unknown', failure: 'invalid-choice', selectedIds: [first.id] })
  })

  it('falls back to baseline when the configured Jev deadline expires', async () => {
    const provider: ContinuumJev = {
      resolve: fake(String(second.id)).resolve,
      decide: async (_request, signal) => {
        await new Promise<void>((resolve) => { signal?.addEventListener('abort', () => { resolve() }, { once: true }) })
        throw new ContinuumJevTimeoutError()
      },
    }
    const result = await selectContinuumMemory(provider, { mode: 'active', minConfidence: 0.8, timeoutMs: 5 }, input)
    expect(result).toMatchObject({ outcome: 'unknown', failure: 'timeout', selectedIds: [first.id] })
  })

  it('propagates cancellation before a Jev request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(selectContinuumMemory(fake(String(first.id)), { mode: 'active', minConfidence: 0.8 }, input, controller.signal)).rejects.toThrow('cancelled')
  })

  it('persists and replays a decision receipt without Jev', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('continuum-decision'))
    const result = await selectContinuumMemory(fake(String(second.id)), { mode: 'active', minConfidence: 0.8 }, input)
    const event = recordContinuumMemoryDecision(session, result)
    expect(event.type).toBe('continuum/memory-decision')
    expect(latestContinuumMemoryDecision(session.snapshotEvents())).toEqual(event.data)
    await ctx.fiber.dispose()
  })

  it('rejects the Reflex-only active switch when Jev is not mounted', async () => {
    await expect(selectContinuumMemory(undefined, { mode: 'active', minConfidence: 0.8 }, input)).rejects.toBeInstanceOf(ContinuumJevUnavailableError)
  })

  it('mounts the profile selector and records its receipt in the Agent Session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('jev', fake(String(second.id)) as never)
    await ctx.plugin(ContinuumJevPlugin, { mode: 'active', minConfidence: 0.8 })
    const session = ctx.sessions.create(SessionId('continuum-selector'))
    const result = await ctx.continuumMemorySelector!.select({ session } as Agent, {
      query: input.query,
      candidates: input.candidates.map(candidate => ({
        id: String(candidate.id), label: candidate.label, excerpt: candidate.excerpt, score: candidate.score,
      })),
    }, new AbortController().signal)
    expect(result.selectedIds).toEqual([second.id])
    expect(session.snapshotEvents().some(event => event.type === 'continuum/memory-decision')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('keeps the baseline when the mounted selector runs in shadow mode', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('jev', fake(String(second.id)) as never)
    await ctx.plugin(ContinuumJevPlugin, { mode: 'shadow', minConfidence: 0.8 })
    const session = ctx.sessions.create(SessionId('continuum-shadow-selector'))
    const result = await ctx.continuumMemorySelector!.select({ session } as Agent, {
      query: input.query,
      candidates: input.candidates.map(candidate => ({
        id: String(candidate.id), label: candidate.label, excerpt: candidate.excerpt, score: candidate.score,
      })),
    }, new AbortController().signal)
    expect(result.selectedIds).toEqual([first.id])
    expect(result.baselineIds).toEqual([first.id])
    await ctx.fiber.dispose()
  })
})
