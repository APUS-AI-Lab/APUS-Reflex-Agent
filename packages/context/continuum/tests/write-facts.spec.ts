import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import Jev from '../../../experimental/apus-dsh-jev-plugin/src/index.ts'
import ContinuumMemory, { type ContinuumConfig } from '../src/service.ts'
import type { ContinuumMemoryAdmitter } from '../src/context.ts'
import { MemoryId, MemoryRecordIndex, MemoryRecordStore } from '../src/index.ts'
import type { MemoryWriteCandidatesEventData, MemoryWriteResultEventData } from '../src/persistence.ts'
import { SessionSeq } from '@deepseek-ai/dsh-session'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

async function harness(options: {
  readonly admitter?: ContinuumMemoryAdmitter
  readonly executionAdmission?: ContinuumConfig['executionAdmission']
  readonly admission?: ContinuumConfig['admission']
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([textResponse('ack'), textResponse('ack'), textResponse('ack'), textResponse('ack')])
  ctx.llm.registerAdapter(['recording'], adapter)
  await ctx.plugin(Jev, { endpoint: 'http://127.0.0.1:1', model: 'jev-test' })
  const compaction = new BasicCompactionEngine(ctx, { auto: false })
  if (options.admitter !== undefined) {
    await ctx.plugin({ name: 'test-admitter', apply: (ctx: Context) => { ctx.provide('continuumMemoryAdmitter', options.admitter as ContinuumMemoryAdmitter) } })
  }
  await ctx.plugin(ContinuumMemory, {
    enabled: true, mode: 'active', admission: options.admission ?? 'user-message', scopes: ['workspace'],
    maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192, executionAdmission: options.executionAdmission ?? 'off',
  })
  return { ctx, adapter, compaction }
}

type SessionEvents = { snapshotEvents(): readonly { type: string; data: unknown }[] }

const writeCandidates = (session: SessionEvents): readonly MemoryWriteCandidatesEventData[] =>
  session.snapshotEvents().flatMap(event => event.type === 'continuum/memory-write-candidates'
    ? [event.data as MemoryWriteCandidatesEventData] : [])

const writeResults = (session: SessionEvents): readonly MemoryWriteResultEventData[] =>
  session.snapshotEvents().flatMap(event => event.type === 'continuum/memory-write-result'
    ? [event.data as MemoryWriteResultEventData] : [])

describe('Continuum write-chain facts', () => {
  it('attributes the record, L1 entry and lexical index events of one user message to one write trigger', async () => {
    const h = await harness()
    const agent = await h.ctx.agentLoop.create(SessionId('write-attribution'), { provider: 'recording', model: 'recording' })
    agent.followup(user('The cutover window is Thursday night.'))
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    const candidates = writeCandidates(agent.session)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ version: 1, origin: 'user-message', status: 'candidates_ready' })
    const writeId = candidates[0]?.writeId ?? ''
    expect(writeId.length).toBeGreaterThan(0)
    const message = events.find(event => event.type === 'user/message')
    expect(candidates[0]?.triggerRef).toEqual({
      sessionId: agent.session.id, eventSeq: message?.seq, eventType: 'user/message',
    })
    // The candidate names the source, its normalization and the record it targets.
    expect(candidates[0]?.candidates).toEqual([{
      candidateId: `${String(agent.session.id)}:${String(message?.seq)}`,
      sourceRefs: [{ sessionId: agent.session.id, eventSeq: message?.seq }],
      normalization: {
        textBlocksOnly: true, joinSeparator: '\n', trim: true,
        sourceChars: 'The cutover window is Thursday night.'.length,
        candidateChars: 'The cutover window is Thursday night.'.length, truncated: false,
      },
      targetRecordId: `${String(agent.session.id)}:${String(message?.seq)}`,
    }])

    const record = events.find(event => event.type === 'continuum/memory-record')
    const recordData = record?.type === 'continuum/memory-record' ? record.data : undefined
    expect(recordData).toMatchObject({ operation: 'create', writeId, origin: 'user-message' })
    expect(typeof recordData?.attemptId).toBe('string')
    const attemptId = recordData?.attemptId
    const l1 = events.find(event => event.type === 'continuum/memory-index')
    expect(l1?.type === 'continuum/memory-index' ? l1.data : undefined).toMatchObject({
      operation: 'add', writeId, attemptId, origin: 'user-message',
    })
    const queued = events.find(event => event.type === 'continuum/memory-index-queued')
    expect(queued?.type === 'continuum/memory-index-queued' ? queued.data : undefined).toMatchObject({
      recordId: record?.type === 'continuum/memory-record' ? record.data.record.id : undefined, revision: 1, writeId,
    })
    const bounded = events.filter(event => event.type === 'continuum/memory-index-rebuilt')
      .map(event => event.type === 'continuum/memory-index-rebuilt' ? event.data : undefined)
    expect(bounded.at(-1)).toMatchObject({ scope: 'bounded', consumed: 1 })
    // The applied entry names the search terms the index actually holds for that
    // version; without them the result cannot answer "what can be recalled".
    expect(bounded.at(-1)?.appliedRecords).toEqual([{
      recordId: record?.type === 'continuum/memory-record' ? record.data.record.id : undefined, revision: 1,
      terms: ['fact', 'workspace', 'the', 'cutover', 'window', 'is', 'thursday', 'night'],
    }])
    expect(typeof bounded.at(-1)?.startedAt).toBe('number')
    expect(typeof bounded.at(-1)?.endedAt).toBe('number')

    const result = writeResults(agent.session)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ version: 1, writeId, origin: 'user-message' })
    expect(result[0]?.candidateResults).toEqual([{
      candidateId: `${String(agent.session.id)}:${String(message?.seq)}`,
      status: 'record_accepted',
      record: { recordId: `${String(agent.session.id)}:${String(message?.seq)}`, revision: 1 },
      attemptId,
    }])
    expect(result[0]?.attemptResults).toEqual([{
      attemptId, proposedRecordId: `${String(agent.session.id)}:${String(message?.seq)}`,
      candidateId: `${String(agent.session.id)}:${String(message?.seq)}`, origin: 'user-message',
      storeStatus: 'created', appendStatus: 'accepted', indexStatus: 'observed', l1Status: 'added',
      recordEventRef: { sessionId: agent.session.id, seq: record?.seq },
    }])
    // Only this attempt's own queued and bounded events are attributed; the cold-start `full` report stays unattributed.
    const lexicalSeqs = events
      .filter(event => event.type === 'continuum/memory-index-queued')
      .map(event => event.seq)
      .concat(events.filter(event => event.type === 'continuum/memory-index-rebuilt').at(-1)?.seq ?? [])
    expect(result[0]?.indexEventRefs).toEqual([
      ...lexicalSeqs.map(seq => ({ sessionId: agent.session.id, seq, kind: 'lexical' })),
      { sessionId: agent.session.id, seq: l1?.seq, kind: 'l1' },
    ])
    expect(result[0]?.recordEventRefs).toEqual([{ sessionId: agent.session.id, seq: record?.seq }])
    expect(result[0]?.missingEvidence).toEqual([])
  })

  it('records the compaction decision as a rejection without inventing a create attempt', async () => {
    const admit = vi.fn<ContinuumMemoryAdmitter['admit']>(async () => ({ admitted: [] }))
    const h = await harness({ admitter: { admit }, admission: 'compaction' })
    const agent = await h.ctx.agentLoop.create(SessionId('write-compaction-rejected'), { provider: 'recording', model: 'recording' })
    for (let turn = 0; turn < 3; turn += 1) {
      agent.followup(user(`Fact number ${String(turn)} ${'context padding words '.repeat(40)}`))
      await agent.whenIdle()
    }
    await h.compaction.compactNow(agent, new AbortController().signal)
    await new Promise(resolve => setTimeout(resolve, 10))
    const candidates = writeCandidates(agent.session)
      .filter(entry => entry.origin === 'compaction')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.candidates.length).toBeGreaterThan(0)
    const result = writeResults(agent.session)
      .filter(entry => entry.origin === 'compaction')
    expect(result).toHaveLength(1)
    // Every offered candidate is rejected by the judge, and nothing was ever attempted.
    expect(result[0]?.candidateResults.every(entry => entry.status === 'rejected')).toBe(true)
    expect(result[0]?.candidateResults).toHaveLength(candidates[0]?.candidates.length ?? 0)
    expect(result[0]?.attemptResults).toEqual([])
    expect(result[0]?.recordEventRefs).toEqual([])
    expect(agent.session.snapshotEvents().some(event =>
      event.type === 'continuum/memory-record' && event.data.origin === 'compaction')).toBe(false)
  })

  it('settles an execution write with its native decision and per-attempt record references', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(
      async (_agent, input) => input.candidates.map(candidate => ({ id: candidate.id, tags: ['work'] })),
    )
    const h = await harness({ admitter: { admit: async () => ({ admitted: [] }), judgeExecution: judge }, executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('write-execution'), { provider: 'recording', model: 'recording' })
    agent.followup(user('Record what the step produced.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    const records = agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')
    expect(records.length).toBeGreaterThan(0)
    const results = writeResults(agent.session)
      .filter(entry => entry.origin === 'execution')
    expect(results).toHaveLength(1)
    const decision = agent.session.snapshotEvents().find(event => event.type === 'continuum/memory-write-decision')
    expect(results[0]?.nativeWriteDecisionRef).toEqual({ sessionId: agent.session.id, seq: decision?.seq })
    expect(results[0]?.reportedCounts).toEqual({
      candidateRecords: decision?.type === 'continuum/memory-write-decision' ? decision.data.candidateRecords : undefined,
      writtenRecords: decision?.type === 'continuum/memory-write-decision' ? decision.data.writtenRecords : undefined,
    })
    const executionRecords = records.filter(event =>
      event.type === 'continuum/memory-record' && event.data.origin === 'execution')
    expect(results[0]?.recordEventRefs).toHaveLength(executionRecords.length)
    expect(executionRecords.length).toBeGreaterThan(0)
    expect(results[0]?.attemptResults.every(attempt => attempt.origin === 'execution' && attempt.appendStatus === 'accepted')).toBe(true)
    // Execution candidates are truncated prefixes, so their normalization says so when it truncated.
    const candidates = writeCandidates(agent.session)
      .filter(entry => entry.origin === 'execution')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.window).toMatchObject({ kind: 'execution' })
  })

  it('reports a truncated execution candidate instead of presenting a prefix as the whole text', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(async () => [])
    const h = await harness({ admitter: { admit: async () => ({ admitted: [] }), judgeExecution: judge }, executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('write-execution-truncated'), { provider: 'recording', model: 'recording' })
    agent.followup(user('Produce a long answer.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    const candidates = writeCandidates(agent.session)
      .filter(entry => entry.origin === 'execution')
    for (const candidate of candidates.flatMap(entry => entry.candidates)) {
      if (candidate.normalization.sourceChars > candidate.normalization.candidateChars) {
        expect(candidate.normalization.truncated).toBe(true)
      }
    }
  })

  it('reports which queued version a bounded rebuild applied instead of assuming the newest', () => {
    const index = new MemoryRecordIndex()
    const store = new MemoryRecordStore()
    const older = store.create({ id: MemoryId('older'), kind: 'fact', scope: 'workspace', content: 'Older fact.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
    const newer = store.create({ id: MemoryId('newer'), kind: 'fact', scope: 'workspace', content: 'Newer fact.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(1) }] })
    index.enqueue(older)
    index.enqueue(newer)
    const { result, applied } = index.rebuildPendingWithApplied(1)
    // The bounded batch drained the first queued snapshot, not the most recently enqueued one.
    expect(applied).toEqual([{ recordId: MemoryId('older'), revision: 1, terms: ['fact', 'workspace', 'older'] }])
    expect(result).toEqual({ indexedRecords: 1, pendingRecords: 1 })
  })

  it('reports a rejected L1 index entry as a failed attempt stage, not as added', async () => {
    const h = await harness()
    const agent = await h.ctx.agentLoop.create(SessionId('write-l1-rejected'), { provider: 'recording', model: 'recording' })
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => undefined)
    const original = agent.session.append.bind(agent.session)
    vi.spyOn(agent.session, 'append').mockImplementation(((type: string, ...rest: unknown[]) => {
      // Only the L1 entry fails; the record and lexical events still reach the log.
      if (type === 'continuum/memory-index') throw new Error('Session append unavailable')
      return (original as unknown as (type: string, ...rest: unknown[]) => unknown)(type, ...rest)
    }) as never)
    agent.followup(user('This fact still needs an L1 failure recorded.'))
    await agent.whenIdle()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('continuum L1 index entry was not written: Error: Session append unavailable'))
    const result = writeResults(agent.session)
    expect(result).toHaveLength(1)
    expect(result[0]?.attemptResults).toEqual([
      expect.objectContaining({ appendStatus: 'accepted', l1Status: 'failed' }),
    ])
    expect(result[0]?.candidateResults).toEqual([
      expect.objectContaining({ status: 'record_accepted', reason: 'l1-index-rejected' }),
    ])
    // 记录已建、L1 条目没写成属于“部分提交”；汇总层面必须说出来，
    // 否则对账会判定这次失败被隐藏（memory_partial_commit_hidden）。
    expect(result[0]?.partialFailures).toEqual([expect.stringContaining(': l1')])
  })

  it('keeps the original record snapshot intact while adding the write attribution', async () => {
    const h = await harness()
    const agent = await h.ctx.agentLoop.create(SessionId('write-record-snapshot'), { provider: 'recording', model: 'recording' })
    const source = agent.session.append('user/message', user('Explicitly stored fact.'), { surfaceOp: 'append' })
    const created = h.ctx.continuumMemory.create(agent, {
      id: MemoryId('explicit-record'), kind: 'fact', scope: 'workspace', content: 'Explicitly stored fact.',
      sourceRefs: [{ sessionId: agent.session.id, eventSeq: source.seq }],
    })
    const record = agent.session.snapshotEvents().find(event => event.type === 'continuum/memory-record')
    expect(record?.type === 'continuum/memory-record' ? record.data.record : undefined).toEqual(created)
    expect(record?.type === 'continuum/memory-record' ? record.data : undefined).toMatchObject({
      operation: 'create', origin: 'explicit',
    })
    const explicit = record?.type === 'continuum/memory-record' ? record.data : undefined
    expect(typeof explicit?.writeId).toBe('string')
    expect(typeof explicit?.attemptId).toBe('string')
    // An explicit caller writes no candidate or result event: there was no automatic entry to describe.
    expect(agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-write-candidates')).toBe(false)
  })
})
