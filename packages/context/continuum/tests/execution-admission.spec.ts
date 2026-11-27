import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../../experimental/apus-dsh-jev-plugin/src/index.ts'
import ContinuumMemory, { ContinuumConfig, ContinuumConfigFields, type ContinuumConfig as Config } from '../src/service.ts'
import { foldMemoryRecordEvents, type MemoryWriteCandidatesEventData, type MemoryWriteDecisionEventData } from '../src/persistence.ts'
import { MemoryRecordStore } from '../src/records.ts'
import type { ContinuumMemoryAdmitter } from '../src/context.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

interface HarnessOptions {
  readonly admitter?: ContinuumMemoryAdmitter
  readonly executionAdmission?: Config['executionAdmission']
  readonly admission?: Config['admission']
  /** Durability root; supplied only by restart cases. */
  readonly root?: string
  /** Overrides the default eight `ack` responses; `'hang'` keeps a step open until cancelled. */
  readonly responses?: (ReturnType<typeof textResponse> | 'hang')[]
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  if (options.root !== undefined) await ctx.plugin(JsonlSessionPersistence, { root: options.root, compression: 'none' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(options.responses ?? Array.from({ length: 8 }, () => textResponse('ack')))
  ctx.llm.registerAdapter(['recording'], adapter)
  await ctx.plugin(Jev, { endpoint: 'http://127.0.0.1:1', model: 'jev-test' })
  const admitterFiber = options.admitter === undefined
    ? undefined
    : await ctx.plugin({ name: 'test-admitter', apply: (ctx: Context) => { ctx.provide('continuumMemoryAdmitter', options.admitter) } })
  await ctx.plugin(ContinuumMemory, {
    enabled: true, mode: 'active', admission: options.admission ?? 'explicit', candidatePool: 'all', scopes: ['workspace'],
    maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192, executionAdmission: options.executionAdmission ?? 'off',
  })
  return { ctx, adapter, admitterFiber }
}

/** Execution judgements one Session recorded; absent events read as an empty list. */
const decisions = (session: { snapshotEvents(): readonly { type: string; data?: unknown }[] }) =>
  session.snapshotEvents().flatMap(event =>
    event.type === 'continuum/memory-write-decision' ? [event.data as MemoryWriteDecisionEventData] : [])

const keepAllExecution = (judge: NonNullable<ContinuumMemoryAdmitter['judgeExecution']>): ContinuumMemoryAdmitter => ({
  admit: async () => ({ admitted: [] }),
  judgeExecution: judge,
})

/** Execution candidate entries one Session recorded. */
const candidateEntries = (session: { snapshotEvents(): readonly { type: string; data?: unknown }[] }) =>
  session.snapshotEvents().flatMap(event =>
    event.type === 'continuum/memory-write-candidates' ? [event.data as MemoryWriteCandidatesEventData] : [])

/** Append one extra closed step carrying `texts` to an already idle Agent's Session. */
function appendStep(agent: { session: Session }, turn: number, texts: readonly string[]): void {
  const session = agent.session
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  for (const text of texts) {
    session.append('assistant/message', {
      turn, step: 1, stream: [],
      message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'recording', model: 'recording' } }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
}

describe('Continuum execution admission', () => {
  it('writes no judgement and no record while executionAdmission is off', async () => {
    const h = await harness()
    const agent = await h.ctx.agentLoop.create(SessionId('execution-off'), { provider: 'recording', model: 'recording' })
    agent.followup(user('The API header is X-Orbit-Key.'))
    await agent.whenIdle()
    expect(decisions(agent.session)).toEqual([])
    expect(agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  })

  it('writes one judgement per step and records only what the admitter kept', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(
      async (_agent, input) => input.candidates.map(candidate => ({ id: candidate.id, tags: ['work'] })),
    )
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-verified'), { provider: 'recording', model: 'recording' })
    agent.followup(user('The API header is X-Orbit-Key.'))
    await agent.whenIdle()
    const steps = agent.session.snapshotEvents().filter(event => event.type === 'step/end').length
    expect(steps).toBeGreaterThan(0)
    expect(decisions(agent.session)).toHaveLength(steps)
    expect(judge).toHaveBeenCalled()
    const candidates = judge.mock.calls[0]?.[1].candidates ?? []
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(candidate => candidate.content.includes('ack'))).toBe(true)
    expect(candidates.every(candidate => !candidate.content.includes('X-Orbit-Key'))).toBe(true)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')).toHaveLength(1)
  })

  it('records no-new-facts without a record when the admitter keeps nothing', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(async () => [])
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-empty'), { provider: 'recording', model: 'recording' })
    agent.followup(user('One turn.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')).toEqual([])
    expect(decisions(agent.session).map(decision => decision.reason)).toContain('no-new-facts')
  })

  it('records a cancelled decision without calling the admitter when the turn was aborted', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(async () => [])
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-aborted'), { provider: 'recording', model: 'recording' })
    agent.followup(user('Slow request.'))
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    expect(judge).not.toHaveBeenCalled()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')).toEqual([])
  })

  it('lets the next pre-step wait for the execution judgement queued by the last step', async () => {
    const gate = Promise.withResolvers<readonly { id: string; tags: readonly string[] }[]>()
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(() => gate.promise)
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-waits'), { provider: 'recording', model: 'recording' })
    agent.followup(user('First turn.'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const settled = h.ctx.continuumMemory.whenSettled(agent)
    let resolved = false
    void settled.then(() => { resolved = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(resolved).toBe(false)
    gate.resolve([{ id: 'anything', tags: [] }])
    await settled
    expect(resolved).toBe(true)
  })

  it('resolves whenSettled immediately when no admission is queued', async () => {
    const h = await harness()
    const agent = await h.ctx.agentLoop.create(SessionId('execution-idle'), { provider: 'recording', model: 'recording' })
    await expect(h.ctx.continuumMemory.whenSettled(agent)).resolves.toBeUndefined()
  })

  it('drops a proposal judged before a disable and re-enable cycle', async () => {
    const gate = Promise.withResolvers<readonly { id: string; tags: readonly string[] }[]>()
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(() => gate.promise)
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-stale'), { provider: 'recording', model: 'recording' })
    agent.followup(user('First turn.'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const controller = h.ctx.continuumMemory.controller(agent)
    controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
    controller.setSwitch({ enabled: true, mode: 'active', reflexMounted: true })
    gate.resolve([{ id: 'anything', tags: [] }])
    await h.ctx.continuumMemory.whenSettled(agent)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')).toEqual([])
  })

  it('creates each execution record once when the same facts are judged twice', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(
      async (_agent, input) => input.candidates.map(candidate => ({ id: candidate.id, tags: [] })),
    )
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-once'), { provider: 'recording', model: 'recording' })
    agent.followup(user('One turn.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    const records = agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')
    expect(records.length).toBe(new Set(records.map(record => (record as { data: { record: { id: string } } }).data.record.id)).size)
  })

  it('records a failed decision without a record when the admitter throws', async () => {
    const h = await harness({
      admitter: keepAllExecution(() => Promise.reject(new Error('judge down'))),
      executionAdmission: 'verified',
    })
    h.ctx.logger.warn = vi.fn()
    const agent = await h.ctx.agentLoop.create(SessionId('execution-failed'), { provider: 'recording', model: 'recording' })
    agent.followup(user('First turn.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')).toEqual([])
    expect(decisions(agent.session).map(decision => (decision as { outcome: string }).outcome)).toContain('failed')
  })

  it('drains its execution judgement before the turn closes', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(
      async (_agent, input) => input.candidates.map(candidate => ({ id: candidate.id, tags: [] })),
    )
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-stop'), { provider: 'recording', model: 'recording' })
    agent.followup(user('First turn.'))
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    const recordSeq = events.find(event => event.type === 'continuum/memory-record')?.seq
    const turnEndSeq = events.find(event => event.type === 'turn/end')?.seq
    // The turn-stopping listener awaited the queued judgement, so the record precedes `turn/end`.
    expect(recordSeq).toBeDefined()
    expect(turnEndSeq).toBeDefined()
    expect(Number(recordSeq)).toBeLessThan(Number(turnEndSeq))
  })

  it('restores execution records from the record event after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-continuum-execution-restart-'))
    roots.push(root)
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(
      async (_agent, input) => input.candidates.map(candidate => ({ id: candidate.id, tags: ['work'] })),
    )
    const writer = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified', root })
    const agent = await writer.ctx.agentLoop.create(SessionId('execution-restart'), { provider: 'recording', model: 'recording' })
    agent.followup(user('First turn.'))
    await agent.whenIdle()
    await writer.ctx.continuumMemory.whenSettled(agent)
    await writer.ctx.sessions.flush(agent.session)
    await writer.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(writer.ctx), 1)

    const reader = new Context()
    contexts.push(reader)
    await reader.plugin(SessionStore)
    await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const handle = await reader.sessionPersistence.open(SessionId('execution-restart'), 'read')
    try {
      const { events } = await handle.read()
      const store = foldMemoryRecordEvents(events, new MemoryRecordStore())
      expect(store.snapshot().length).toBeGreaterThan(0)
      expect(store.snapshot().every(record => record.content.includes('ack'))).toBe(true)
    } finally {
      await handle.close()
    }
  })

  it('defaults executionAdmission to off and accepts an explicit verified value', () => {
    expect(ContinuumConfig({}).executionAdmission).toBe('off')
    expect(ContinuumConfig({ executionAdmission: 'verified' })).toMatchObject({ executionAdmission: 'verified' })
    expect(ContinuumConfigFields).toHaveProperty('executionAdmission')
  })

  it('points each execution record at the message that carries its text', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(
      async (_agent, input) => input.candidates.map(candidate => ({ id: candidate.id, tags: [] })),
    )
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-source'), { provider: 'recording', model: 'recording' })
    agent.followup(user('One turn.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    const events = agent.session.snapshotEvents()
    const record = events.find(event => event.type === 'continuum/memory-record')
    const ref = record?.type === 'continuum/memory-record' ? record.data.record.sourceRefs[0] : undefined
    expect(ref).toBeDefined()
    const source = events.find(event => event.seq === ref?.eventSeq)
    // The reference resolves to the assistant message, not the step boundary.
    expect(source?.type).toBe('assistant/message')
  })

  it('records the cancelled step instead of losing its candidate event', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(async () => [])
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified', responses: ['hang'] })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-cancel-settled'), { provider: 'recording', model: 'recording' })
    agent.followup(user('Slow request.'))
    // Cancel only after the step opened, so its `step/end` reaches the execution admission.
    while (!agent.session.snapshotEvents().some(event => event.type === 'step/start')) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    const entries = candidateEntries(agent.session).filter(entry => entry.origin === 'execution')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.at(-1)).toMatchObject({
      status: 'skipped', reason: 'cancelled',
      // The judgement was skipped before any source was read, so coverage must not claim a complete window.
      coverage: { sourceWindowComplete: false, candidateListComplete: false, missingEvidence: ['cancelled: source window not inspected'] },
    })
    expect(entries.at(-1)?.unexaminedSourceRefs).toBeUndefined()
    expect(judge).not.toHaveBeenCalled()
  })

  it('records a skipped step without an admitter instead of losing its candidate event', async () => {
    const h = await harness({ executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-no-admitter-settled'), { provider: 'recording', model: 'recording' })
    agent.followup(user('One turn.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    const entries = candidateEntries(agent.session).filter(entry => entry.origin === 'execution')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.at(-1)).toMatchObject({
      status: 'skipped', reason: 'no-admitter',
      coverage: { sourceWindowComplete: false, candidateListComplete: false, missingEvidence: ['no-admitter: source window not inspected'] },
    })
  })

  it('reports a 33-source step as one unexamined source in the real candidate event', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(async () => [])
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-over-limit'), { provider: 'recording', model: 'recording' })
    agent.followup(user('First turn.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    appendStep(agent, 2, Array.from({ length: 33 }, (_, index) => `step fact ${String(index)}`))
    await h.ctx.continuumMemory.whenSettled(agent)
    const entry = candidateEntries(agent.session).filter(item => item.origin === 'execution').at(-1)
    expect(entry?.candidates).toHaveLength(32)
    expect(entry?.unexaminedSourceRefs).toHaveLength(1)
    expect(entry?.coverage).toEqual({
      sourceWindowComplete: false,
      candidateListComplete: false,
      missingEvidence: ['execution candidate limit stopped the scan before the window ended'],
    })
  })

  it('reports an exact 32-source step as a complete window', async () => {
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(async () => [])
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-exact-limit'), { provider: 'recording', model: 'recording' })
    agent.followup(user('First turn.'))
    await agent.whenIdle()
    await h.ctx.continuumMemory.whenSettled(agent)
    appendStep(agent, 2, Array.from({ length: 32 }, (_, index) => `step fact ${String(index)}`))
    await h.ctx.continuumMemory.whenSettled(agent)
    const entry = candidateEntries(agent.session).filter(item => item.origin === 'execution').at(-1)
    expect(entry?.candidates).toHaveLength(32)
    expect(entry?.unexaminedSourceRefs).toBeUndefined()
    expect(entry?.coverage).toEqual({ sourceWindowComplete: true, candidateListComplete: true, missingEvidence: [] })
  })

  it('judges no record when the switching projection went stale during the judgement', async () => {
    const gate = Promise.withResolvers<readonly { id: string; tags: readonly string[] }[]>()
    const judge = vi.fn<NonNullable<ContinuumMemoryAdmitter['judgeExecution']>>(
      async (_agent, input) => {
        await gate.promise
        return input.candidates.map(candidate => ({ id: candidate.id, tags: [] }))
      },
    )
    const h = await harness({ admitter: keepAllExecution(judge), executionAdmission: 'verified' })
    const agent = await h.ctx.agentLoop.create(SessionId('execution-stale-projection'), { provider: 'recording', model: 'recording' })
    agent.followup(user('One turn.'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const controller = h.ctx.continuumMemory.controller(agent)
    controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
    controller.setSwitch({ enabled: true, mode: 'active', reflexMounted: true })
    gate.resolve([])
    await h.ctx.continuumMemory.whenSettled(agent)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-record')).toEqual([])
    expect(decisions(agent.session).map(decision => decision.reason)).toContain('stale')
  })
})
