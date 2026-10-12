import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
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
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
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
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
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
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(2)
    if (result.kind === 'enter') expect(result.messages[1]?.source).toMatchObject({ recordIds: ['migration'] })
    controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
    const disabled = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 2, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(disabled.kind === 'enter' ? disabled.messages : []).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('filters the same-step recall through a mounted active selector', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(
      ctx,
      () => controller,
      () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 },
      () => ({
        select: async (_agent, input) => ({
          mode: 'active',
          selectedIds: [input.candidates[0]!.id],
          baselineIds: [input.candidates[0]!.id],
          outcome: 'jev',
          confidence: 0.99,
        }),
      }),
    )
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it.each([
    ['baseline', 'listener'], ['baseline', 'context'],
    ['next', 'listener'], ['next', 'context'], ['selector', 'listener'], ['selector', 'context'],
  ] as const)('drops a pending %s result when its %s is disposed', async (stage, owner) => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    let resolvedControllers = 0
    const dispose = stage === 'baseline' ? installContinuumMemoryContext(
      ctx,
      () => { resolvedControllers += 1; return records() },
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 },
    ) : installContinuumMemoryControllerContext(
      ctx,
      () => { resolvedControllers += 1; return controller },
      () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 },
      stage === 'next' ? undefined : () => ({ select: async () => {
        entered.resolve(undefined)
        await released.promise
        return { mode: 'active', selectedIds: ['migration'], baselineIds: ['migration'], outcome: 'jev' }
      } }),
    )
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const request = agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => {
      if (stage !== 'selector') {
        entered.resolve(undefined)
        await released.promise
      }
      return { kind: 'enter' as const, messages: [user] }
    })
    try {
      await entered.promise
      if (owner === 'context') await ctx.fiber.dispose()
      else { dispose(); dispose() }
      released.resolve(undefined)
      const result = await request
      expect(result.kind === 'enter' ? result.messages : []).toEqual([user])
      expect(resolvedControllers).toBe(stage === 'selector' ? 1 : 0)
      expect(controller.state().enabled).toBe(true)
      if (owner === 'listener') {
        const next = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
          messages: [user], turn: 2, step: 1, signal: new AbortController().signal,
        }, async () => ({ kind: 'enter' as const, messages: [user] }))
        expect(next.kind === 'enter' ? next.messages : []).toEqual([user])
      }
    } finally {
      released.resolve(undefined)
      await request
      await ctx.fiber.dispose()
    }
  })

  it.each(['baseline', 'controller'] as const)('preserves a rejected pre-step without resolving %s memory', async (kind) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const unexpected = (): never => { throw new Error('Rejected pre-step resolved memory') }
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 }
    if (kind === 'baseline') installContinuumMemoryContext(ctx, unexpected, bounds)
    else installContinuumMemoryControllerContext(ctx, unexpected, () => ({ scopes: ['workspace'] }), bounds)
    const rejection = { kind: 'reject' as const }
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => rejection)
    expect(result).toBe(rejection)
  })

  it.each(['baseline', 'controller'] as const)('keeps %s input unchanged when only blank or generated messages exist', async (kind) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const store = records()
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 }
    if (kind === 'baseline') installContinuumMemoryContext(ctx, () => store, bounds)
    else installContinuumMemoryControllerContext(ctx,
      () => new ContinuumMemoryController(store, { enabled: true, mode: 'active', reflexMounted: true }),
      () => ({ scopes: ['workspace'] }), bounds)
    const messages = [
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '  ' }] }),
      createUserMessage({ source: { kind: 'continuum-memory', form: 'recall', version: 1, recordIds: ['migration'] }, content: [{ type: 'text', text: 'Migration is scheduled Friday.' }] }),
    ]
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages, turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual(messages)
  })

  it.each(['baseline', 'controller'] as const)('keeps %s input unchanged when no record matches the human query', async (kind) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const store = records()
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 }
    if (kind === 'baseline') installContinuumMemoryContext(ctx, () => store, bounds)
    else installContinuumMemoryControllerContext(ctx,
      () => new ContinuumMemoryController(store, { enabled: true, mode: 'active', reflexMounted: true }),
      () => ({ scopes: ['workspace'] }), bounds)
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Unrelated topic' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual([user])
  })

  it('leaves input unchanged when the Agent has no controller', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    installContinuumMemoryControllerContext(ctx, () => undefined, () => ({ scopes: ['workspace'] }), { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual([user])
  })

  it.each([{ selectedIds: [] }, { selectedIds: ['unavailable-record'] }])('does not inject records outside the selected candidate set $selectedIds', async ({ selectedIds }) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 },
      () => ({ select: async () => ({ mode: 'active', selectedIds, baselineIds: ['migration'], outcome: 'jev' }) }))
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual([user])
  })

  it('drops a late Jev selection after the controller is disabled', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    const late = Promise.withResolvers<{ mode: 'active'; selectedIds: readonly string[]; baselineIds: readonly string[]; outcome: 'jev' }>()
    installContinuumMemoryControllerContext(
      ctx,
      () => controller,
      () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 200 },
      () => ({ select: async () => late.promise }),
    )
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const request = agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
    late.resolve({ mode: 'active', selectedIds: ['migration'], baselineIds: ['migration'], outcome: 'jev' })
    const result = await request
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
