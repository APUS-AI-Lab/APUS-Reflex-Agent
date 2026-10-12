import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { ContinuumMemory, MemoryId } from '../src/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

describe('Continuum profile service', () => {
  it('loads as a Cordis profile service with the original path off', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(ContinuumMemory, { enabled: false, mode: 'off', scopes: [], maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 })
    expect(ctx.continuumMemory.state()).toEqual({ enabled: false, mode: 'off', reason: 'disabled' })
    await ctx.fiber.dispose()
  })

  it('keeps the Reflex-only switch unavailable when Jev is not mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(ContinuumMemory, { enabled: true, mode: 'active', scopes: ['workspace'], maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 })
    expect(ctx.continuumMemory.state()).toEqual({ enabled: false, mode: 'off', reason: 'reflex-required' })
    await ctx.fiber.dispose()
  })

  it('restores records from the Agent Session and persists new transitions', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('continuum-service'))
    const service = new ContinuumMemory(ctx, { enabled: false, mode: 'off', scopes: ['workspace'], maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 })
    const agent = { session } as Agent
    const created = service.create(agent, {
      id: MemoryId('service-memory'), kind: 'fact', scope: 'workspace', content: 'Persisted through the profile service.',
      sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }],
    })
    expect(created.status).toBe('active')
    expect(session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(true)
    const restored = service.controller(agent)
    expect(restored).toBe(service.controller(agent))
    await ctx.fiber.dispose()
  })
})
