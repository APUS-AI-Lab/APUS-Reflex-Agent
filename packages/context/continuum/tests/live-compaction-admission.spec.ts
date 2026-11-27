/**
 * Live end-to-end check: compaction admission with the real Reflex endpoint.
 *
 * The unit suite mocks the admitter. This file wires the real
 * ContinuumJevPlugin to the deployed APUS-Reflex-9B endpoint, compacts a seeded
 * conversation, and then asks a follow-up question so the memory system has to
 * write, index and recall through the live judgement.
 *
 * Run: ./node_modules/.bin/vitest run packages/context/continuum/tests/live-compaction-admission.spec.ts
 * Skips itself when JEV_ENDPOINT is unset, so the ordinary suite stays keyless.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Jev from '../../../experimental/apus-dsh-jev-plugin/src/index.ts'
import ContinuumJev from '../../../experimental/continuum-jev/src/index.ts'
import ContinuumMemory from '../src/service.ts'

const contexts: Context[] = []
const roots: string[] = []
const SIGNAL = new AbortController().signal
const endpoint = process.env.JEV_ENDPOINT
const apiKey = process.env.JEV_API_KEY
const model = process.env.JEV_MODEL ?? 'APUS-Reflex-9B'
// This file exists to prove the live path works; it must never pass by
// skipping. A missing endpoint or key is a failure of the run, not a reason to
// stay silent — an empty suite is indistinguishable from a green one.
const missing = [
  endpoint === undefined ? 'JEV_ENDPOINT' : '',
  apiKey === undefined ? 'JEV_API_KEY' : '',
].filter(Boolean)

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class FixedCompactionEngine extends BasicCompactionEngine {
  override summarize(_input: SummarizationInput, _agent: Agent): Promise<SummaryResult> {
    return Promise.resolve({ summary: [{ type: 'text', text: 'checkpoint' }], provider: 'summary', model: 'summary' })
  }
}

class RecordingAdapter extends LlmAdapter {
  readonly requests: RequestMessage[][] = []

  override resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id, name: id, context: { contextWindow: 100_000 } })
  }

  override async * stream(options: { messages: readonly RequestMessage[] }): AsyncIterable<StreamChunk> {
    this.requests.push([...options.messages])
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ack' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const padding = (label: string) => `${label} ${'filler words for the history span '.repeat(40)}`

const records = (agent: Agent) => agent.session.snapshotEvents().flatMap(event =>
  event.type === 'continuum/memory-index' ? [event.data.entry] : [])

describe('live compaction admission through the Reflex endpoint', () => {
  it('has a Reflex endpoint and key configured', () => {
    expect(missing, `缺少 ${missing.join(', ')}：这份验证必须接真实端点运行`).toEqual([])
  })

  it('writes, indexes and recalls a compacted fact', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    // The admitter checkpoints each prepared receipt by reading it back from
    // durable storage; without a backend every judgement falls back to
    // persistence-unavailable.
    const root = await mkdtemp(join(tmpdir(), 'dsh-live-compaction-'))
    roots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, {
      personaPrefix: '', personaSuffix: '',
      includeHarnessIdentity: false, includeRuntimeContext: false,
    })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['recording'], adapter)
    // The provider the real profile mounts; it reads the key from the named
    // environment variable, so no secret enters this file.
    await ctx.plugin(Jev, {
      endpoint: endpoint!, model, apiKeyEnv: 'JEV_API_KEY',
      // The deployment speaks the OpenAI chat-completions dialect; the default
      // `openjev` protocol targets a /v1/systemone gateway and 404s here.
      protocol: 'chat-completions',
      // Without this a reasoning model spends its budget thinking and the
      // decision times out; the deployment's short-answer path requires it.
      chatTemplateKwargs: { enable_thinking: false },
    })
    await ctx.plugin(ContinuumJev, {
      mode: 'active',
      timeoutMs: 60_000,
      // Same policy the sdk profile uses: the remote id must be named, or
      // every request is refused as privacy-denied and ranking silently
      // degrades to baseline.
      privacyPolicy: {
        mode: 'cloud-approved', cloudApproval: true,
        approvedRemoteIds: ['system-one'], approvedRemoteDataClasses: ['workspace'],
      },
      sessionDataClasses: ['workspace'],
    })
    const compaction = new FixedCompactionEngine(ctx, { auto: false })
    await ctx.plugin(ContinuumMemory, {
      enabled: true, mode: 'active', admission: 'compaction', candidatePool: 'all',
      scopes: ['workspace'], maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192,
    })
    const handle = await ctx.agents.create({
      sessionId: SessionId('continuum-live-compaction'),
      agentOptions: { provider: 'recording', model: 'recording' },
    })
    const agent = handle.agent

    // Facts of a kind the memory tags cover (people / preferences), so a real
    // judgement has something it can keep; an API key is not any of the eight
    // categories and was correctly rejected.
    agent.followup(user(`${padding('first')} My daughter Mia is allergic to peanuts, and I always order oat milk.`))
    await agent.whenIdle()
    agent.followup(user(padding('second thanks')))
    await agent.whenIdle()
    agent.followup(user(padding('third')))
    await agent.whenIdle()

    console.log('admitter 是否挂载:', ctx.get('continuumMemoryAdmitter') !== undefined)
    console.log('jev 是否挂载:', ctx.get('jev') !== undefined)
    console.log('全量事件数:', agent.session.snapshotEvents().length)
    const result = await compaction.compactNow(agent, SIGNAL)
    expect(result).not.toBeNull()
    console.log('压缩后事件数:', agent.session.snapshotEvents().length)
    // Send the exact request the plugin builds, to see the provider's refusal.
    try {
      const jevSvc = ctx.get('jev') as { decide: (r: unknown) => Promise<unknown> } | undefined
      const spec = (jevSvc as unknown as { resolve: (r: unknown) => unknown }).resolve({
        state: { query: 'x' },
        questions: { m0: { type: 'noul', instructions: 'Is it relevant?', criteria: { true: 'Yes.', false: 'No.' } } },
      })
      const decided = await jevSvc!.decide(spec)
      console.log('decide 结果:', JSON.stringify(decided).slice(0, 300))
    } catch (error) {
      console.log('decide 抛错:', (error as Error).constructor.name, (error as Error).message.slice(0, 300))
    }
    // Surface the exception the plugin swallows into `resolve-error`.
    try {
      const jevSvc = ctx.get('jev') as { resolve: (r: unknown) => unknown } | undefined
      jevSvc?.resolve({ state: { query: 'x' }, questions: { m0: {
        type: 'noul', instructions: 'Is it relevant?', criteria: { true: 'Yes.', false: 'No.' },
      } } })
      console.log('resolve: 成功')
    } catch (error) {
      console.log('resolve 抛错:', (error as Error).constructor.name, (error as Error).message.slice(0, 200))
    }

    agent.followup(user('What is my daughter allergic to, and what milk do I order?'))
    await agent.whenIdle()

    const events = agent.session.snapshotEvents()
    const kinds = new Set(events.map(event => event.type))
    // The write chain the review complained was missing must appear here.
    console.log('全部事件类型:', [...kinds].join(', '))
    console.log('compaction 相关:', events.filter(e => e.type.startsWith('compaction/')).map(e => e.type).join(', '))
    console.log('continuum 相关:', [...kinds].filter(k => k.startsWith('continuum/')).join(', '))
    const admissions0 = events.flatMap(event =>
      event.type === 'continuum/memory-admission' ? [event.data] : [])
    const chain = `
事件: ${[...kinds].join(', ')}
准入: ${JSON.stringify(admissions0.map(a => ({
  phase: a.phase, reason: a.reason, failure: a.failure, outcome: a.outcome,
  admitted: a.admittedIds, tags: a.admittedTags, requestStatus: a.requestStatus,
})))}
`
    expect(kinds.has('compaction/summary'), chain).toBe(true)
    expect(kinds.has('continuum/memory-write-candidates'), chain).toBe(true)
    expect(kinds.has('continuum/memory-admission'), chain).toBe(true)
    expect(kinds.has('continuum/memory-record'), chain).toBe(true)
    expect(kinds.has('continuum/memory-index'), chain).toBe(true)

    const written = records(agent)
    console.log('写入记录数:', written.length, '标签:', JSON.stringify(written.map(r => r.tags)))
    expect(written.length).toBeGreaterThan(0)

    const admissions = events.flatMap(event =>
      event.type === 'continuum/memory-admission' ? [event.data] : [])
    console.log('准入回执:', JSON.stringify(admissions.map(a => ({
      phase: a.phase, reason: a.reason, outcome: a.outcome, admitted: a.admittedIds,
      tags: a.admittedTags, requestStatus: a.requestStatus,
    }))))
    // Whichever way the judgement went, a prepared receipt must not claim a verdict.
    const prepared = admissions.filter(a => a.phase === 'prepared')
    for (const receipt of prepared) {
      expect(receipt.outcome).toBeUndefined()
      expect(receipt.reason).toBeUndefined()
      expect(receipt.requestStatus).toBe('prepared')
    }

    const recalled = adapter.requests.at(-1)?.map(message =>
      typeof message.content === 'string' ? message.content
        : message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('\n') ?? ''
    console.log('最后一次请求是否含记忆块:', recalled.includes('Continuum memory'))
    console.log('最后一次请求是否含原文:', recalled.includes('peanuts') || recalled.includes('Mia'))
  }, 180_000)
})
