import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { ContinuumMemoryController, MemoryId, MemoryRecordStore, installContinuumMemoryContext, installContinuumMemoryControllerContext } from '../src/index.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

function records(): MemoryRecordStore {
  const store = new MemoryRecordStore()
  store.create({ id: MemoryId('migration'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled Friday.', sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }] })
  return store
}

describe('Continuum same-step context consumer', () => {
  it('appends bounded memory context to the pre-step decision with a typed source', async () => {
    const ctx = new Context()
    const store = records()
    installContinuumMemoryContext(ctx, () => store, { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      agent: {} as Agent, messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') return
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1]?.source).toMatchObject({ kind: 'continuum-memory', form: 'recall', recordIds: ['migration'] })
    expect(result.messages[1]?.content).toEqual([{ type: 'text', text: '## Continuum memory\n[memory:migration] Migration is scheduled Friday.' }])
    await ctx.fiber.dispose()
  })

  it('does not inject when no per-agent store is available', async () => {
    const ctx = new Context()
    installContinuumMemoryContext(ctx, () => undefined, { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Recall anything.' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      agent: {} as Agent, messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('keeps permission and switch checks on the same-step consumer', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'shadow', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }), { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      agent: {} as Agent, messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(2)
    controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
    const disabled = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      agent: {} as Agent, messages: [user], turn: 2, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(disabled.kind === 'enter' ? disabled.messages : []).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
