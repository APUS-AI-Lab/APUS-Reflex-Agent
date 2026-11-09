import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { ContinuumMemoryController, MemoryId, MemoryRecordStore, installContinuumMemoryContext, installContinuumMemoryControllerContext } from '../src/index.ts'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { goalProjectionDefinition } from '@deepseek-ai/dsh-goal'
import type { Agent } from '@deepseek-ai/dsh-agent'

function records(): MemoryRecordStore {
  const store = new MemoryRecordStore()
  store.create({ id: MemoryId('migration'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled Friday.', sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }] })
  return store
}

const recallDecisions = (session: Session) => session.snapshotEvents()
  .filter(event => event.type === 'continuum/memory-recall-decision')
  .map(event => event.data)

describe('Continuum same-step context consumer', () => {
  it('appends bounded memory context to the pre-step decision with a typed source', async () => {
    const ctx = new Context()
    const store = records()
    installContinuumMemoryContext(ctx, () => store, { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') return
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1]?.source).toMatchObject({ kind: 'continuum-memory', form: 'recall', recordIds: ['migration'] })
    expect(result.messages[1]?.content).toEqual([{ type: 'text', text: '## Continuum memory\n[memory:"migration" revision:1 sources:[{"sessionId":"source","eventSeq":0}] record-content-utf16:[0,30) omitted:none]\nMigration is scheduled Friday.' }])
    await ctx.fiber.dispose()
  })

  it.each(['baseline', 'controller', 'selector', 'ordered-selector'] as const)('includes source metadata and header within the %s recall budget', async (kind) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const store = records()
    store.create({ id: MemoryId('other'), kind: 'fact', scope: 'workspace', content: 'Migration checks are pending.', sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(1) }] })
    const controller = new ContinuumMemoryController(store, { enabled: true, mode: 'active', reflexMounted: true })
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 }
    if (kind === 'baseline') installContinuumMemoryContext(ctx, () => store, bounds)
    else installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }), bounds,
      kind === 'selector' || kind === 'ordered-selector' ? () => ({ select: async () => ({ mode: 'active',
        selectedIds: kind === 'selector' ? ['other'] : ['other', 'other', 'unknown', 'migration', 'other'],
        baselineIds: ['migration', 'other'], outcome: 'jev' }) }) : undefined)
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') return
    const block = result.messages[1]?.content[0]
    expect(block?.type).toBe('text')
    if (block?.type !== 'text') return
    expect(new TextEncoder().encode(block.text).byteLength).toBeLessThanOrEqual(bounds.maxTotalBytes)
    expect(block.text.match(/## Continuum memory/g)).toHaveLength(1)
    expect(block.text).toContain('sources:[{"sessionId":"source","eventSeq":1}]')
    expect(block.text).toContain('revision:1')
    expect(block.text).toContain('omitted:none')
    if (kind === 'ordered-selector') {
      expect(result.messages[1]?.source).toMatchObject({ recordIds: ['other', 'migration'] })
      expect(block.text.match(/\[memory:/g)).toHaveLength(2)
      expect(block.text.indexOf('Migration checks')).toBeLessThan(block.text.indexOf('Migration is scheduled'))
    }
    if (kind === 'selector') {
      expect(block.text).not.toContain('Migration is scheduled Friday.')
      expect(result.messages[1]?.source).toMatchObject({ recordIds: ['other'] })
    }
  })

  it.each(['baseline', 'controller'] as const)('omits %s recall when its source metadata cannot fit', async (kind) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const store = records()
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 32 }
    const controller = new ContinuumMemoryController(store, { enabled: true, mode: 'active', reflexMounted: true })
    if (kind === 'baseline') installContinuumMemoryContext(ctx, () => store, bounds)
    else installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }), bounds)
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual([user])
  })

  it('records retrieval audit events for the direct consumer without treating trace as a budget', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('trace-direct'))
    installContinuumMemoryContext(ctx, () => records(), { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512, trace: true })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(2)
    const types = session.snapshotEvents().map(event => event.type)
    expect(types).toContain('continuum/memory-retrieval')
    expect(types).toContain('continuum/memory-injected')
  })

  it('records controller retrieval audit events without a selector when trace is enabled', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('trace-controller'))
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512, trace: true })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(2)
    const types = session.snapshotEvents().map(event => event.type)
    expect(types).toContain('continuum/memory-retrieval')
    expect(types).toContain('continuum/memory-injected')
  })

  it('does not inject when no per-agent store is available', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('recall-no-store'))
    installContinuumMemoryContext(ctx, () => undefined, { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Recall anything.' }] })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(1)
    const reasons = recallDecisions(session).map(decision => decision.reason)
    expect(reasons).toEqual(['no-store'])
    await ctx.fiber.dispose()
  })

  it('keeps permission and switch checks on the same-step consumer', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'shadow', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }), { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 })
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

  it('records a traced empty or unmatched read as a retrieval fact without injection', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('trace-empty-read'))
    installContinuumMemoryControllerContext(ctx,
      () => new ContinuumMemoryController(new MemoryRecordStore(), { enabled: true, mode: 'active', reflexMounted: true }),
      () => ({ scopes: ['workspace'] }), { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512, trace: true })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(1)
    const types = new Set(session.snapshotEvents().map(event => event.type))
    expect(types.has('continuum/memory-recall-decision')).toBe(true)
    expect(types.has('continuum/memory-retrieval')).toBe(true)
    expect(types.has('continuum/memory-injected')).toBe(false)
    expect(types.has('continuum/memory-scored')).toBe(false)

    const unmatched = Session.create(SessionId('trace-unmatched-read'))
    installContinuumMemoryContext(ctx, () => records(),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512, trace: true })
    const unrelated = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Totally unrelated words' }] })
    const second = await agentEvents(ctx, { session: unmatched } as Agent).waterfall('agent/pre-step', {
      messages: [unrelated], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [unrelated] }))
    expect(second.kind === 'enter' ? second.messages : []).toHaveLength(1)
    const unmatchedTypes = new Set(unmatched.snapshotEvents().map(event => event.type))
    expect(unmatchedTypes.has('continuum/memory-retrieval')).toBe(true)
    expect(unmatchedTypes.has('continuum/memory-injected')).toBe(false)
  })

  it('records a distinct terminal reason for each controller recall skip', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-decisions'))
    let current: ContinuumMemoryController | undefined
    installContinuumMemoryControllerContext(ctx, () => current, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 100, maxTotalBytes: 1024 })
    const ask = async (turn: number, messages: readonly ReturnType<typeof createUserMessage>[]) => {
      const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
        messages: [...messages], turn, step: 1, signal: new AbortController().signal,
      }, () => Promise.resolve({ kind: 'enter' as const, messages: [...messages] }))
      return result.kind === 'enter' ? result.messages : []
    }
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const unrelated = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Totally unrelated words' }] })
    const disabled = new ContinuumMemoryController(records(), { enabled: false, mode: 'off', reflexMounted: false })
    const empty = new ContinuumMemoryController(new MemoryRecordStore(), { enabled: true, mode: 'active', reflexMounted: true })
    const active = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    current = undefined; expect(await ask(1, [user])).toHaveLength(1)
    current = active; expect(await ask(2, [])).toHaveLength(0)
    current = disabled; expect(await ask(3, [user])).toHaveLength(1)
    current = empty; expect(await ask(4, [user])).toHaveLength(1)
    current = active; expect(await ask(5, [unrelated])).toHaveLength(1)
    current = active; expect(await ask(6, [user])).toHaveLength(2)
    const decisions = recallDecisions(session)
    expect(decisions.map(decision => decision.reason))
      .toEqual(['no-controller', 'no-query', 'unavailable', 'empty-store', 'no-candidates', 'injected'])
    expect(decisions[4]?.activeRecords).toBe(1)
    expect(decisions[5]).toMatchObject({ turn: 6, outcome: 'injected', querySource: 'latest-user-message', injectedRecords: 1 })
  })

  it('injects only candidates that share a query term when no selector is mounted', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('recall-no-match'))
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 100, maxTotalBytes: 1024, candidatePool: 'all' })
    const ask = async (text: string) => {
      const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
      const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
        messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
      }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
      return result.kind === 'enter' ? result.messages : []
    }
    const matched = await ask('When is the migration scheduled?')
    expect(matched).toHaveLength(2)
    expect(matched[1]?.source).toMatchObject({ recordIds: ['migration'] })
    expect(await ask('Unrelated words only')).toHaveLength(1)
    const reasons = recallDecisions(session).map(decision => decision.reason)
    expect(reasons).toEqual(['injected', 'no-query-match'])
    await ctx.fiber.dispose()
  })

  it('records stale, failed, cancelled and disposed recall attempts under their own reasons', async () => {
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 }
    const user = () => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const reasonsOf = (session: Session) => recallDecisions(session).map(decision => decision.reason)
    const prepare = (id: string) => {
      const ctx = new Context()
      onTestFinished(() => ctx.fiber.dispose())
      const session = Session.create(SessionId(id))
      const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
      return { ctx, session, controller }
    }
    const call = (ctx: Context, session: Session, turn: number, signal = new AbortController().signal) =>
      agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
        messages: [user()], turn, step: 1, signal,
      }, () => Promise.resolve({ kind: 'enter' as const, messages: [user()] }))

    const stale = prepare('recall-stale')
    installContinuumMemoryControllerContext(stale.ctx, () => stale.controller, () => ({ scopes: ['workspace'] }), bounds,
      () => ({ select: async () => {
        stale.controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
        return { mode: 'active', selectedIds: ['migration'], baselineIds: ['migration'], outcome: 'jev' }
      } }))
    expect((await call(stale.ctx, stale.session, 1)).kind === 'enter' ? [1] : []).toHaveLength(1)
    expect(reasonsOf(stale.session)).toEqual(['stale'])

    const failed = prepare('recall-failed')
    installContinuumMemoryControllerContext(failed.ctx, () => failed.controller, () => ({ scopes: ['workspace'] }), bounds,
      () => undefined, () => Promise.reject(new Error('admission failed')))
    await expect(call(failed.ctx, failed.session, 1)).rejects.toThrow('admission failed')
    expect(reasonsOf(failed.session)).toEqual(['error'])

    const cancelled = prepare('recall-cancelled')
    const pending = Promise.withResolvers<undefined>()
    const abort = new AbortController()
    installContinuumMemoryControllerContext(cancelled.ctx, () => cancelled.controller, () => ({ scopes: ['workspace'] }), bounds,
      () => undefined, () => pending.promise)
    const cancelledCall = call(cancelled.ctx, cancelled.session, 1, abort.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    abort.abort(new Error('turn cancelled'))
    await expect(cancelledCall).rejects.toThrow('turn cancelled')
    expect(reasonsOf(cancelled.session)).toEqual(['cancelled'])

    const disposed = prepare('recall-disposed')
    const disposedPending = Promise.withResolvers<undefined>()
    const dispose = installContinuumMemoryControllerContext(disposed.ctx, () => disposed.controller, () => ({ scopes: ['workspace'] }), bounds,
      () => undefined, () => disposedPending.promise)
    const disposedCall = call(disposed.ctx, disposed.session, 1)
    await new Promise(resolve => setTimeout(resolve, 0))
    dispose()
    disposedPending.resolve(undefined)
    expect((await disposedCall).kind === 'enter' ? [1] : []).toHaveLength(1)
    expect(reasonsOf(disposed.session)).toEqual(['consumer-inactive'])
  })

  it('waits for pending admissions before reading and honors cancellation while waiting', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    const pending = Promise.withResolvers<undefined>()
    let waiting: Promise<void> | undefined = pending.promise
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 }, () => undefined, () => waiting)
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const abort = new AbortController()
    const cancelled = agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: abort.signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    abort.abort(new Error('turn cancelled'))
    await expect(cancelled).rejects.toThrow('turn cancelled')
    const read = agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 2, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    pending.resolve(undefined)
    const result = await read
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(2)
    waiting = undefined
    await ctx.fiber.dispose()
  })

  it('leaves input unchanged when the consumer is disposed while it waits for admissions', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    const pending = Promise.withResolvers<undefined>()
    const dispose = installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 }, () => undefined, () => pending.promise)
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    const read = agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    dispose()
    pending.resolve(undefined)
    const result = await read
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('filters the same-step recall through a mounted active selector', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(
      ctx,
      () => controller,
      () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 },
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

  it('offers the selector the larger pool with tags and keeps the byte budget on what it selects', async () => {
    const store = new MemoryRecordStore()
    for (let index = 0; index < 5; index += 1) {
      store.create({ id: MemoryId(`m${index}`), kind: 'fact', scope: 'workspace', content: `fact number ${index} ${'x'.repeat(60)}`,
        sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(index) }] })
    }
    const ctx = new Context()
    const controller = new ContinuumMemoryController(store, { enabled: true, mode: 'active', reflexMounted: true })
    let offered: { id: string; tags: readonly string[] }[] = []
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxPool: 5, maxExcerptBytes: 200, maxTotalBytes: 390, candidatePool: 'all' },
      () => ({
        select: async (_agent, input) => {
          offered = input.candidates.map(candidate => ({ id: candidate.id, tags: candidate.tags }))
          const ids = input.candidates.map(candidate => candidate.id)
          return { mode: 'active', selectedIds: ids, baselineIds: ids, outcome: 'jev' }
        },
      }), () => undefined, (_agent, id) => id === 'm4' ? ['people'] : [])
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Unrelated words only' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(offered.map(candidate => candidate.id)).toEqual(['m4', 'm3', 'm2', 'm1', 'm0'])
    expect(offered[0]!.tags).toEqual(['people'])
    const recall = result.kind === 'enter' ? result.messages[1] : undefined
    const text = recall?.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(390)
    expect(recall?.source).toMatchObject({ recordIds: ['m4', 'm3'] })
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
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 },
    ) : installContinuumMemoryControllerContext(
      ctx,
      () => { resolvedControllers += 1; return controller },
      () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 },
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
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 }
    if (kind === 'baseline') installContinuumMemoryContext(ctx, unexpected, bounds)
    else installContinuumMemoryControllerContext(ctx, unexpected, () => ({ scopes: ['workspace'] }), bounds)
    const rejection = { kind: 'reject' as const }
    const session = Session.create(SessionId('recall-step-rejected'))
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => rejection)
    expect(result).toBe(rejection)
    const reasons = recallDecisions(session).map(decision => decision.reason)
    expect(reasons).toEqual(['step-rejected'])
  })

  it.each(['baseline', 'controller'] as const)('keeps %s input unchanged when only blank or generated messages exist', async (kind) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const store = records()
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 }
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
    const bounds = { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 }
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
    installContinuumMemoryControllerContext(ctx, () => undefined, () => ({ scopes: ['workspace'] }), { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration' }] })
    const result = await agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual([user])
  })

  it.each([{ selectedIds: [] }, { selectedIds: ['unavailable-record'] }])('does not inject records outside the selected candidate set $selectedIds', async ({ selectedIds }) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-selection-empty'))
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 },
      () => ({ select: async () => ({ mode: 'active', selectedIds, baselineIds: ['migration'], outcome: 'jev' }) }))
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration' }] })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual([user])
    const reasons = recallDecisions(session).map(decision => decision.reason)
    expect(reasons).toEqual(['selection-empty'])
  })

  it('rejects recall when a selector returns after cancellation', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    const abort = new AbortController()
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 },
      () => ({ select: async () => {
        abort.abort(new Error('memory request cancelled'))
        return { mode: 'active', selectedIds: ['migration'], baselineIds: ['migration'], outcome: 'jev' }
      } }))
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration' }] })
    await expect(agentEvents(ctx, {} as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: abort.signal,
    }, async () => ({ kind: 'enter' as const, messages: [user] }))).rejects.toThrow('memory request cancelled')
  })

  it('drops a late Jev selection after the controller is disabled', async () => {
    const ctx = new Context()
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    const late = Promise.withResolvers<{ mode: 'active'; selectedIds: readonly string[]; baselineIds: readonly string[]; outcome: 'jev' }>()
    installContinuumMemoryControllerContext(
      ctx,
      () => controller,
      () => ({ scopes: ['workspace'] }),
      { maxCandidates: 2, maxExcerptBytes: 100, maxTotalBytes: 512 },
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

  it('composes the recall query from the newest user message, then the session goal, then execution text', async () => {
    const session = Session.create(SessionId('recall-query-source'))
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    // Register the goal projection so the goal fallback reads the current surface state, not raw events.
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(goalProjectionDefinition)
    const store = new MemoryRecordStore()
    store.create({ id: MemoryId('migration'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled Friday.',
      sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }] })
    const controller = new ContinuumMemoryController(store, { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 100, maxTotalBytes: 1024 })
    session.append('goal/change', {
      kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: 'goal-1', revision: 1, objective: 'scheduled migration', phase: 'active', maxGoalRounds: 3 } as never,
      roundsStarted: 0, createdAt: 0, updatedAt: 0,
    })
    session.append('turn/start', { turn: 1 })
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Unrelated execution text.' }] } as never,
      stream: [],
    }, { surfaceOp: 'append' })
    const ask = async (messages: readonly ReturnType<typeof createUserMessage>[]) => {
      const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
        messages: [...messages], turn: 1, step: 1, signal: new AbortController().signal,
      }, () => Promise.resolve({ kind: 'enter' as const, messages: [...messages] }))
      return result.kind === 'enter' ? result.messages : []
    }
    // No user text in the request: the Session goal becomes the query, and the recall is the only message.
    expect(await ask([])).toHaveLength(1)
    expect(recallDecisions(session).at(-1)).toMatchObject({ queryOrigin: 'session-goal', queryChars: 'scheduled migration'.length })
    // A newer user message still wins verbatim.
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'When is the migration scheduled?' }] })
    expect(await ask([user])).toHaveLength(2)
    expect(recallDecisions(session).at(-1)).toMatchObject({ querySource: 'latest-user-message', queryOrigin: 'latest-user-message', queryChars: user.content[0]?.type === 'text' ? 'When is the migration scheduled?'.length : 0 })
  })

  it('records no-query when no user, goal, or execution text exists', async () => {
    const session = Session.create(SessionId('recall-no-query-any'))
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const controller = new ContinuumMemoryController(records(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 100, maxTotalBytes: 1024 })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    expect(result.kind === 'enter' ? result.messages : []).toEqual([])
    expect(recallDecisions(session).map(decision => decision.reason)).toEqual(['no-query'])
  })

  it('does not inject a record already present verbatim in the current request', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-already-present'))
    // The only record's full content already appears in the request message.
    const store = new MemoryRecordStore()
    store.create({ id: MemoryId('migration'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled Friday.',
      sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }] })
    installContinuumMemoryContext(ctx, () => store, { maxCandidates: 4, maxExcerptBytes: 100, maxTotalBytes: 1024 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration is scheduled Friday.' }] })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(1)
    expect(recallDecisions(session).at(-1)).toMatchObject({ reason: 'no-query-match', alreadyPresentRecords: 1 })
  })

  it('keeps a partially overlapping record and reinjects after compaction', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-reinject'))
    const store = records()
    installContinuumMemoryContext(ctx, () => store, { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024 })
    const ask = async (text: string, turn: number) => {
      const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
      const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
        messages: [user], turn, step: 1, signal: new AbortController().signal,
      }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
      return result.kind === 'enter' ? result.messages : []
    }
    // A request that only mentions part of the record still receives it.
    expect(await ask('When is the migration?', 1)).toHaveLength(2)
    // After compaction the original message leaves the request; the record is injected again.
    expect(await ask('Migration details please.', 2)).toHaveLength(2)
    expect(recallDecisions(session).map(decision => decision.outcome)).toEqual(['injected', 'injected'])
  })

  it('injects only the kept records when some were already present', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-partial-present'))
    const store = new MemoryRecordStore()
    store.create({ id: MemoryId('present'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled Friday.',
      sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }] })
    store.create({ id: MemoryId('fresh'), kind: 'fact', scope: 'workspace', content: 'Migration checks are pending.',
      sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(1) }] })
    installContinuumMemoryContext(ctx, () => store, { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Migration is scheduled Friday.' }] })
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [user], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [user] }))
    const recall = result.kind === 'enter' ? result.messages[1] : undefined
    // The model sees exactly the record the source names, never the already-present text.
    expect(recall?.source).toMatchObject({ recordIds: ['fresh'] })
    const text = recall?.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
    expect(text).toContain('Migration checks are pending.')
    expect(text).not.toContain('Migration is scheduled Friday.')
  })
})
