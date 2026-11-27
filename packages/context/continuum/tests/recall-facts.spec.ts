import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { ContinuumMemoryController, MemoryId, MemoryRecordStore, installContinuumMemoryContext, installContinuumMemoryControllerContext } from '../src/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

function store(): MemoryRecordStore {
  const records = new MemoryRecordStore()
  records.create({ id: MemoryId('migration'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled Friday.', sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }] })
  records.create({ id: MemoryId('office'), kind: 'fact', scope: 'workspace', content: 'Badge pickup at reception.', sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(1) }] })
  return records
}

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

function eventsOf(session: Session, type: string): readonly { readonly data: Record<string, unknown> }[] {
  return session.snapshotEvents().flatMap(event =>
    event.type === type ? [{ data: event.data as Record<string, unknown> }] : [])
}

describe('Continuum recall source facts', () => {
  it('writes query, retrieval and filter facts on the read that ran, with one recall id', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-facts-controller'))
    const controller = new ContinuumMemoryController(store(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024, trace: true })
    const request = user('When is the migration scheduled?')
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [request], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [request] }))
    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') return

    const retrieval = eventsOf(session, 'continuum/memory-retrieval').at(-1)?.data
    expect(retrieval).toBeDefined()
    const recallId = retrieval?.['recallId']
    expect(typeof recallId).toBe('string')
    expect((recallId as string).length).toBeGreaterThan(0)

    // Query facts: the request message is the source, identified by its native id.
    const query = retrieval?.['queryFacts'] as Record<string, unknown>
    expect(query['status']).toBe('resolved')
    expect(query['origin']).toBe('latest-user-message')
    expect(query['sourceLocation']).toBe('pre_step_messages')
    expect(query['queryText']).toBe('When is the migration scheduled?')
    expect(query['requestMessages']).toEqual([
      { messageId: request.id, role: 'user', sourceKind: 'user', text: 'When is the migration scheduled?' },
    ])
    expect(query['selectedSource']).toEqual({ messageId: request.id })
    const checks = query['sourceChecks'] as readonly { readonly location: string; readonly result: string }[]
    expect(checks.slice(0, 1)).toEqual([{ location: 'pre_step_messages', result: 'selected' }])
    expect(checks.slice(1).every(check => check.result === 'not_consulted')).toBe(true)
    expect(query['lengthUtf16']).toBe('When is the migration scheduled?'.length)

    // Retrieval facts: complete participation, one real channel, and the exclusion cause.
    const facts = retrieval?.['retrievalFacts'] as Record<string, unknown>
    expect(facts['status']).toBe('completed')
    const participants = facts['participants'] as readonly { record: { recordId: string; revision: number }; score: number }[]
    expect(participants.map(entry => [entry.record.recordId, entry.record.revision, entry.score])).toEqual([
      ['migration', 1, 3],
    ])
    expect((facts['routes'] as readonly { routeId: string }[]).map(route => route.routeId)).toEqual(['lexical'])
    expect(facts['excluded']).toEqual([{ recordId: 'office', reason: 'index-prefilter' }])
    expect((facts['handoff'] as readonly { recordId: string }[]).map(record => record.recordId)).toEqual(['migration'])

    // Filter facts: the request carries no record text, so nothing was excluded here.
    const filter = retrieval?.['filterFacts'] as Record<string, unknown>
    expect(filter['status']).toBe('completed')
    expect(filter['comparisonScope']).toBe('pre_step_messages')
    expect(filter['comparisonMessages']).toEqual([
      { messageId: request.id, role: 'user', sourceKind: 'user', content: [{ type: 'text', text: 'When is the migration scheduled?' }] },
    ])
    expect(filter['kept']).toEqual([{ record: { recordId: 'migration', revision: 1 }, inputRank: 1, outputRank: 1 }])
    expect(filter['excluded']).toEqual([])
    expect(filter['alreadyPresentCount']).toBe(0)

    // The appended recall message carries the same recall id through the decision.
    const decision = eventsOf(session, 'continuum/memory-recall-decision').at(-1)?.data
    expect(decision?.['recallId']).toBe(recallId)
    expect(decision?.['queryFacts']).toBeUndefined()
    const recallMessage = result.messages[1]
    expect(decision?.['resultMessageId']).toBe(recallMessage?.id)

    const injected = eventsOf(session, 'continuum/memory-injected').at(-1)?.data
    expect(injected?.['recallId']).toBe(recallId)
  })

  it('keeps the query facts when the retrieval event could not be written', async () => {
    // 回执省略查询依据的前提是“检索事件真的写进去了”。append 被吞掉后仍按
    // trace 开关省略，读者就再也看不到这次召回的查询全文。
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-facts-append-failed'))
    const controller = new ContinuumMemoryController(store(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024, trace: true })
    const original = session.append.bind(session)
    // 只让这次检索事件写失败，其余事件照常，才能只观察该分支的后果。
    ;(session as unknown as { append: typeof original }).append = ((type: string, ...rest: unknown[]) => {
      if (type === 'continuum/memory-retrieval') throw new Error('append unavailable')
      return (original as unknown as (type: string, ...rest: unknown[]) => unknown)(type, ...rest)
    }) as typeof original
    const request = user('When is the migration scheduled?')
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [request], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [request] }))
    expect(result.kind).toBe('enter')
    const decision = eventsOf(session, 'continuum/memory-recall-decision').at(-1)?.data
    // 检索事件没写成，回执必须自己带着查询依据。
    expect(eventsOf(session, 'continuum/memory-retrieval')).toHaveLength(0)
    expect(decision?.['queryFacts']).toBeDefined()
  })

  it('names the message that already contained a record instead of only counting it', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-facts-present'))
    const records = new MemoryRecordStore()
    records.create({ id: MemoryId('migration'), kind: 'fact', scope: 'workspace', content: 'Migration is scheduled Friday.', sourceRefs: [{ sessionId: SessionId('source'), eventSeq: SessionSeq(0) }] })
    installContinuumMemoryContext(ctx, () => records, { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024, trace: true })
    const present = user('Migration is scheduled Friday. Anything else?')
    const result = await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [present], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [present] }))
    expect(result.kind === 'enter' ? result.messages : []).toHaveLength(1)
    const filter = eventsOf(session, 'continuum/memory-retrieval').at(-1)?.data['filterFacts'] as Record<string, unknown>
    expect(filter['excluded']).toEqual([
      { record: { recordId: 'migration', revision: 1 }, inputRank: 1, reason: 'already_in_pre_step_messages', matchedMessageId: present.id },
    ])
    expect(filter['alreadyPresentCount']).toBe(1)
    expect(filter['kept']).toEqual([])
    const decision = eventsOf(session, 'continuum/memory-recall-decision').at(-1)?.data
    expect(decision?.['resultMessageId']).toBeUndefined()
    // 检索事实已经写在独立事件里；判断回执不再复制同一份查询。
    expect(decision?.['queryFacts']).toBeUndefined()
  })

  it('leaves query facts to the read event on a no-query-match judgement', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-facts-no-match'))
    installContinuumMemoryContext(ctx, () => store(), { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024, trace: true })
    const request = user('Unrelated question about the weather.')
    await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [request], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [request] }))
    const decision = eventsOf(session, 'continuum/memory-recall-decision').at(-1)?.data
    // 无相关命中与无候选是不同原因，本例只要求“已有检索事件时回执不复制查询”。
    expect(['no-query-match', 'no-candidates']).toContain(decision?.['reason'])
    expect(eventsOf(session, 'continuum/memory-retrieval')).toHaveLength(1)
    expect(decision?.['queryFacts']).toBeUndefined()
  })

  it('records the source it actually fell back to and leaves later sources not consulted', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-facts-fallback'))
    const surface = user('Session surface question, not the request.')
    session.append('user/message', surface, { surfaceOp: 'append' })
    installContinuumMemoryContext(ctx, () => store(), { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024, trace: true })
    await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    const query = eventsOf(session, 'continuum/memory-retrieval').at(-1)?.data['queryFacts'] as Record<string, unknown>
    expect(query['status']).toBe('resolved')
    expect(query['sourceLocation']).toBe('session_surface')
    expect(query['requestMessages']).toEqual([])
    expect(query['surfaceMessages']).toEqual([
      { messageId: surface.id, role: 'user', sourceKind: 'user', text: 'Session surface question, not the request.' },
    ])
    const fallbackChecks = query['sourceChecks'] as readonly { readonly location: string; readonly result: string }[]
    expect(fallbackChecks.slice(0, 2)).toEqual([
      { location: 'pre_step_messages', result: 'empty' },
      { location: 'session_surface', result: 'selected' },
    ])
    expect(fallbackChecks.slice(2).every(check => check.result === 'not_consulted')).toBe(true)
  })

  it('keeps the no-query outcome without inventing a query or a later source read', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-facts-empty'))
    const controller = new ContinuumMemoryController(store(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024, trace: true })
    await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    const decision = eventsOf(session, 'continuum/memory-recall-decision').at(-1)?.data
    expect(decision?.['reason']).toBe('no-query')
    const query = decision?.['queryFacts'] as Record<string, unknown>
    expect(query['status']).toBe('no_query')
    expect(query['queryText']).toBeUndefined()
    const emptyChecks = query['sourceChecks'] as readonly { readonly location: string; readonly result: string }[]
    expect(emptyChecks.slice(0, 3)).toEqual([
      { location: 'pre_step_messages', result: 'empty' },
      { location: 'session_surface', result: 'empty' },
      { location: 'goal_projection', result: 'absent' },
    ])
    expect(emptyChecks[3]).toEqual({ location: 'surface_execution_text', result: 'empty' })
    expect(eventsOf(session, 'continuum/memory-retrieval')).toEqual([])
  })

  it('records selection facts on the judgement, after the read and its filter', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const session = Session.create(SessionId('recall-facts-selection'))
    const controller = new ContinuumMemoryController(store(), { enabled: true, mode: 'active', reflexMounted: true })
    installContinuumMemoryControllerContext(ctx, () => controller, () => ({ scopes: ['workspace'] }),
      { maxCandidates: 4, maxExcerptBytes: 200, maxTotalBytes: 1024, trace: true },
      () => ({ select: async () => ({
        mode: 'active', selectedIds: ['migration', 'migration', 'unknown'], baselineIds: ['migration'], outcome: 'jev',
      }) }))
    const request = user('Migration')
    await agentEvents(ctx, { session } as Agent).waterfall('agent/pre-step', {
      messages: [request], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [request] }))
    const order = session.snapshotEvents()
      .map(event => event.type)
      .filter(type => type === 'continuum/memory-retrieval' || type === 'continuum/memory-recall-decision')
    // The read is written before the judgement, so a selector wait cannot delay it.
    expect(order).toEqual(['continuum/memory-retrieval', 'continuum/memory-recall-decision'])
    const decision = eventsOf(session, 'continuum/memory-recall-decision').at(-1)?.data
    const selection = decision?.['selectionFacts'] as Record<string, unknown>
    expect(selection['selectionPath']).toBe('controller_with_selector')
    expect(selection['selectorResult']).toEqual({
      mode: 'active', selectedIds: ['migration', 'migration', 'unknown'], baselineIds: ['migration'], outcome: 'jev',
    })
    expect(selection['duplicateSelections']).toEqual([{ recordId: 'migration', selectedInputIndex: 1, retainedInputIndex: 0 }])
    expect(selection['invalidSelections']).toEqual([{ recordId: 'unknown', selectedInputIndex: 2, reason: 'outside_fresh_candidates' }])
    expect(selection['appliedOrder']).toEqual([{ record: { recordId: 'migration', revision: 1 }, appliedRank: 1 }])
    expect(selection['selected']).toEqual([{ record: { recordId: 'migration', revision: 1 }, finalRank: 1, excerptStart: 0, excerptEnd: 30 }])
    expect(selection['topKApplied']).toBe(false)
    expect(selection['actualSelectedCount']).toBe(1)
    expect(selection['renderedBytes']).toBe(Buffer.byteLength('## Continuum memory\n[memory:"migration" revision:1 sources:[{"sessionId":"source","eventSeq":0}] record-content-utf16:[0,30) omitted:none]\nMigration is scheduled Friday.'))
    expect(decision?.['queryFacts']).toBeUndefined()
  })
})
