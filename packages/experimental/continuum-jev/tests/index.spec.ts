import { describe, expect, it } from 'vitest'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { ContinuumJevUnavailableError, selectContinuumMemory, recordContinuumMemoryDecision, latestContinuumMemoryDecision, type ContinuumJev } from '../src/index.ts'
import { Context } from '@deepseek-ai/cordis'

const first = { id: MemoryId('a'), label: 'A', excerpt: 'alpha', score: 0.8 } as const
const second = { id: MemoryId('b'), label: 'B', excerpt: 'beta', score: 0.4 } as const
const input = { query: 'which memory?', candidates: [first, second] } as const

function fake(choice: string, confidence = 0.95): ContinuumJev {
  const request = { model: 'fake', state: {}, questions: {} } as never
  return {
    resolve: () => ({ ...request, providerId: 'fake', model: 'fake' }),
    decide: async () => ({ kind: 'ok', spec: { ...request, providerId: 'fake', model: 'fake' }, response: { model: 'fake', answers: { memory: { type: 'choice', choice, confidence, probabilities: { [choice]: 1 } } } } }),
  } as ContinuumJev
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

  it('falls back on low confidence and invalid choices', async () => {
    const low = await selectContinuumMemory(fake(String(second.id), 0.2), { mode: 'active', minConfidence: 0.8 }, input)
    const invalid = await selectContinuumMemory(fake('invented'), { mode: 'active', minConfidence: 0.8 }, input)
    expect(low).toMatchObject({ outcome: 'unknown', failure: 'low-confidence', selectedIds: [first.id] })
    expect(invalid).toMatchObject({ outcome: 'unknown', failure: 'invalid-choice', selectedIds: [first.id] })
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
})
