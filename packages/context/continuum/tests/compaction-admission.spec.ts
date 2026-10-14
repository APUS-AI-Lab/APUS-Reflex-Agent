import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Jev from '../../../experimental/apus-dsh-jev-plugin/src/index.ts'
import ContinuumMemory, { type ContinuumConfig } from '../src/service.ts'
import type { ContinuumMemoryAdmitter } from '../src/context.ts'

const contexts: Context[] = []
const SIGNAL = new AbortController().signal

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

/** A fixed checkpoint; the summarizer makes no model call. */
class FixedCompactionEngine extends BasicCompactionEngine {
  override summarize(_input: SummarizationInput, _agent: Agent): Promise<SummaryResult> {
    return Promise.resolve({ summary: [{ type: 'text', text: 'checkpoint' }], provider: 'summary', model: 'summary' })
  }
}

/** Records every request and answers each with one text block. */
class RecordingAdapter extends LlmAdapter {
  readonly requests: RequestMessage[][] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(options: { messages: readonly RequestMessage[] }): AsyncIterable<StreamChunk> {
    this.requests.push([...options.messages])
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer '.repeat(200) } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const padding = (label: string) => `${label} ${'filler words for the history span '.repeat(40)}`

interface HarnessOptions {
  readonly admitter?: ContinuumMemoryAdmitter
  readonly admission?: ContinuumConfig['admission']
  readonly scopes?: string[]
  readonly lateMount?: boolean
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['recording'], adapter)
  const jev = await ctx.plugin(Jev, { endpoint: 'http://127.0.0.1:1', model: 'jev-test' })
  const admitterFiber = options.admitter === undefined
    ? undefined
    : await ctx.plugin({ name: 'test-admitter', apply: (ctx: Context) => { ctx.provide('continuumMemoryAdmitter', options.admitter) } })
  const compaction = new FixedCompactionEngine(ctx, { auto: false })
  const memory = () => ctx.plugin(ContinuumMemory, {
    enabled: true, mode: 'active', admission: options.admission ?? 'compaction', candidatePool: 'all', scopes: options.scopes ?? ['workspace'],
    maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192,
  })
  if (options.lateMount !== true) await memory()
  const handle = await ctx.agents.create({ sessionId: SessionId('continuum-compaction'), agentOptions: { provider: 'recording', model: 'recording' } })
  if (options.lateMount === true) await memory()
  return { ctx, agent: handle.agent, handle, adapter, compaction, admitterFiber, jev }
}

/** Two closed turns whose human inputs compaction can replace. */
async function seed(agent: Agent): Promise<void> {
  agent.followup(user(`${padding('first')} The API key header is X-Orbit-Key.`))
  await agent.whenIdle()
  agent.followup(user(padding('second thanks')))
  await agent.whenIdle()
  agent.followup(user(padding('third')))
  await agent.whenIdle()
}

const records = (agent: Agent) => agent.session.snapshotEvents().flatMap(event =>
  event.type === 'continuum/memory-record' ? [event.data.record] : [])

/** Admitter that keeps every compacted message. */
const keepAll: ContinuumMemoryAdmitter = {
  admit: (_agent, input) => Promise.resolve({ admittedIds: input.candidates.map(candidate => candidate.id) }),
}

const recalled = (adapter: RecordingAdapter) => (adapter.requests.at(-1) ?? []).filter(message => message.source?.kind === 'continuum-memory')
  .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))

describe('Continuum compaction admission', () => {
  it('admits and recalls nothing without a Reflex admitter, as the base profile does', async () => {
    const h = await harness()
    await seed(h.agent)
    expect(await h.compaction.compactNow(h.agent, SIGNAL)).not.toBeNull()
    h.agent.followup(user('Which API key header did I name?'))
    await h.agent.whenIdle()
    expect(records(h.agent)).toEqual([])
    expect(recalled(h.adapter)).toEqual([])
  })

  it('admits only the compacted human messages the admitter keeps, and the next read waits for them', async () => {
    const admit = vi.fn<ContinuumMemoryAdmitter['admit']>(async (_agent, input) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return { admittedIds: [...input.candidates.filter(candidate => candidate.content.includes('X-Orbit-Key')).map(candidate => candidate.id), 'unknown'] }
    })
    const h = await harness({ admitter: { admit } })
    await seed(h.agent)
    const result = await h.compaction.compactNow(h.agent, SIGNAL)
    expect(result).not.toBeNull()
    h.agent.followup(user('Which API key header did I name?'))
    await h.agent.whenIdle()
    expect(admit).toHaveBeenCalledTimes(1)
    const candidates = admit.mock.calls[0]?.[1].candidates ?? []
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(candidate => candidate.content.length > 0 && !candidate.content.includes('answer'))).toBe(true)
    expect(admit.mock.calls[0]?.[1].isCurrent()).toBe(true)
    const admitted = records(h.agent)
    expect(admitted).toHaveLength(1)
    expect(admitted[0]?.content).toContain('X-Orbit-Key')
    const source = h.agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    expect(admitted[0]).toMatchObject({ id: `${String(h.agent.session.id)}:${String(source?.seq)}`, kind: 'fact', scope: 'workspace' })
    expect(admitted[0]?.sourceRefs).toEqual([{ sessionId: h.agent.session.id, eventSeq: source?.seq }])
    expect(recalled(h.adapter).join('\n')).toContain('X-Orbit-Key')

    // A second compaction of the same span admits nothing twice.
    await h.compaction.compactNow(h.agent, SIGNAL)
    h.agent.followup(user('And again?'))
    await h.agent.whenIdle()
    expect(records(h.agent)).toHaveLength(1)
  })

  it('admits every compacted human message when the admitter fails', async () => {
    const warn = vi.fn()
    const h = await harness({ admitter: { admit: () => Promise.reject(new Error('provider down')) } })
    h.ctx.logger.warn = warn
    await seed(h.agent)
    await h.compaction.compactNow(h.agent, SIGNAL)
    h.agent.followup(user('Next request.'))
    await h.agent.whenIdle()
    expect(records(h.agent).length).toBeGreaterThan(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('admitting every compacted message'))
  })

  it('admits nothing when the admitter is removed before its judgement starts', async () => {
    const admit = vi.fn<ContinuumMemoryAdmitter['admit']>(() => Promise.resolve({ admittedIds: [] }))
    const h = await harness({ admitter: { admit } })
    await seed(h.agent)
    h.ctx.on('session/event', (_session, event) => {
      // The admission queued for this checkpoint starts after the admitter is gone.
      if (event.type === 'compaction/summary') void h.admitterFiber?.dispose()
    })
    await h.compaction.compactNow(h.agent, SIGNAL)
    h.agent.followup(user('Next request.'))
    await h.agent.whenIdle()
    expect(admit).not.toHaveBeenCalled()
    expect(records(h.agent)).toEqual([])
  })

  it('stops a pending admission without a warning when the Agent is disposed', async () => {
    const warn = vi.fn()
    const gate = Promise.withResolvers<{ admittedIds: string[] }>()
    const h = await harness({ admitter: { admit: () => gate.promise } })
    h.ctx.logger.warn = warn
    await seed(h.agent)
    await h.compaction.compactNow(h.agent, SIGNAL)
    await new Promise(resolve => setTimeout(resolve, 0))
    const events = h.agent.session.snapshotEvents().length
    await h.handle.dispose()
    gate.resolve({ admittedIds: ['anything'] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.agent.session.snapshotEvents()).toHaveLength(events)
    expect(warn).not.toHaveBeenCalled()
  })

  it('admits for an Agent created before the service mounted, and not without a scope', async () => {
    const late = await harness({ admitter: keepAll, lateMount: true })
    await seed(late.agent)
    await late.ctx.agents.withInitiator(late.agent, () => late.compaction.compactNow(late.agent, SIGNAL))
    late.agent.followup(user('Next request.'))
    await late.agent.whenIdle()
    expect(records(late.agent).length).toBeGreaterThan(0)

    const admit = vi.fn<ContinuumMemoryAdmitter['admit']>(() => Promise.resolve({ admittedIds: [] }))
    const unscoped = await harness({ admitter: { admit }, scopes: [] })
    await seed(unscoped.agent)
    await unscoped.compaction.compactNow(unscoped.agent, SIGNAL)
    expect(admit).not.toHaveBeenCalled()
  })

  it('offers nothing when the replaced span holds no human text', async () => {
    const admit = vi.fn<ContinuumMemoryAdmitter['admit']>(() => Promise.resolve({ admittedIds: [] }))
    const h = await harness({ admitter: { admit } })
    for (let turn = 0; turn < 3; turn += 1) {
      h.agent.followup(user('   '))
      await h.agent.whenIdle()
    }
    expect(await h.compaction.compactNow(h.agent, SIGNAL)).not.toBeNull()
    h.agent.followup(user('Next request.'))
    await h.agent.whenIdle()
    expect(admit).not.toHaveBeenCalled()
  })

  it('discards a judgement that settles after Reflex was removed, and warns when admission itself fails', async () => {
    const gate = Promise.withResolvers<{ admittedIds: string[] }>()
    const h = await harness({ admitter: { admit: () => gate.promise } })
    await seed(h.agent)
    await h.compaction.compactNow(h.agent, SIGNAL)
    await new Promise(resolve => setTimeout(resolve, 0))
    await h.jev.dispose()
    gate.resolve({ admittedIds: [`${String(h.agent.session.id)}:1`] })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(records(h.agent)).toEqual([])

    const warn = vi.fn()
    const failing = await harness({ admitter: keepAll })
    failing.ctx.logger.warn = warn
    vi.spyOn(ContinuumMemory.prototype, 'create').mockImplementation(() => { throw new Error('append failed') })
    await seed(failing.agent)
    await failing.compaction.compactNow(failing.agent, SIGNAL)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('continuum compaction admission failed: Error: append failed'))
  })

  it('ignores checkpoints in the other admission modes', async () => {
    const admit = vi.fn<ContinuumMemoryAdmitter['admit']>(() => Promise.resolve({ admittedIds: [] }))
    const h = await harness({ admitter: { admit }, admission: 'explicit' })
    await seed(h.agent)
    await h.compaction.compactNow(h.agent, SIGNAL)
    h.agent.followup(user('Next request.'))
    await h.agent.whenIdle()
    expect(admit).not.toHaveBeenCalled()
  })
})
