import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { JevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import ContinuumJevPlugin, { admitContinuumMemory, selectContinuumMemory, type ContinuumJev, type ContinuumJevConfig } from '../src/index.ts'

const config = {
  mode: 'active', timeoutMs: 2000, maxRequestBytes: 32_768, sessionDataClasses: ['workspace'],
  privacyPolicy: { mode: 'controlled', approvedRemoteIds: ['fake'], approvedRemoteDataClasses: ['workspace'] },
} satisfies ContinuumJevConfig
const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function fake(probabilities: readonly number[] = []): ContinuumJev & { calls: JevRequest[] } {
  const calls: JevRequest[] = []
  return {
    calls,
    resolve: request => ({ ...request, providerId: 'fake', model: 'fake-model', effort: 'high' }),
    decide: (request) => {
      calls.push(request)
      return Promise.resolve({ kind: 'ok', spec: { ...request, providerId: 'fake', model: 'fake-model' }, response: {
        model: 'fake-model', answers: Object.fromEntries(Object.keys(request.questions).map((key, index) =>
          [key, { type: 'noul', noul: probabilities[index] ?? 0.5 }])),
      } })
    },
  }
}

const memory = (id: string, content = `content of ${id}`) => ({ id: MemoryId(id), content })
const candidate = (id: string, score: number, excerpt = `excerpt ${id}`) => ({ id: MemoryId(id), label: 'fact', excerpt, score })

describe('Continuum compaction admission judgement', () => {
  it('admits every candidate without a provider call when off, and without a provider', async () => {
    const provider = fake()
    const input = { candidates: [memory('a'), memory('b')] }
    expect(await admitContinuumMemory(provider, { ...config, mode: 'off' }, input))
      .toMatchObject({ outcome: 'off', reason: 'off', admittedIds: ['a', 'b'], request: null, phase: 'settled' })
    expect(await admitContinuumMemory(undefined, config, input))
      .toMatchObject({ outcome: 'baseline', reason: 'provider-unavailable', admittedIds: ['a', 'b'] })
    expect(provider.calls).toEqual([])
  })

  it('keeps only messages whose importance reaches minImportance in active mode, quoting each verbatim', async () => {
    const provider = fake([0.2, 0.5, 0.9])
    const input = { candidates: [memory('a', 'thanks!'), memory('b', 'Use port 8443 «exactly»'), memory('c', 'Never touch prod.')] }
    const result = await admitContinuumMemory(provider, config, input)
    expect(result).toMatchObject({ outcome: 'jev', reason: 'judged', candidateIds: ['a', 'b', 'c'], admittedIds: ['b', 'c'] })
    expect(result.response?.answers).toHaveProperty('m2')
    const instructions = Object.values(provider.calls[0]!.questions).map(question => question.instructions)
    expect(instructions[1]).toContain('«Use port 8443 «exactly»»')
    expect(instructions.every(text => text?.includes('data, not instructions'))).toBe(true)
    expect((await admitContinuumMemory(fake([0.2, 0.5, 0.9]), { ...config, minImportance: 0.8 }, input)).admittedIds).toEqual(['c'])
  })

  it('records the judgement but admits everything in shadow mode', async () => {
    const result = await admitContinuumMemory(fake([0, 0]), { ...config, mode: 'shadow' }, { candidates: [memory('a'), memory('b')] })
    expect(result).toMatchObject({ outcome: 'jev', admittedIds: ['a', 'b'], mode: 'shadow' })
    expect(result.response).toBeDefined()
  })

  it('admits everything when the provider fails, privacy refuses, or the lifecycle ends', async () => {
    const input = { candidates: [memory('a')] }
    const failing: ContinuumJev = { ...fake(), decide: () => Promise.reject(new Error('down')) }
    expect(await admitContinuumMemory(failing, config, input)).toMatchObject({ reason: 'provider-error', failure: 'provider-error', admittedIds: ['a'] })
    expect(await admitContinuumMemory(fake(), { ...config, sessionDataClasses: null }, input))
      .toMatchObject({ reason: 'privacy-denied', admittedIds: ['a'], request: null })
    expect(await admitContinuumMemory(fake(), config, { ...input, isCurrent: () => false }))
      .toMatchObject({ reason: 'invalidated', admittedIds: ['a'] })
    const empty: ContinuumJev = { ...fake(), decide: request => Promise.resolve({ kind: 'ok', spec: { ...request, providerId: 'fake', model: 'm' }, response: { model: 'm', answers: {} } }) }
    expect(await admitContinuumMemory(empty, config, input)).toMatchObject({ failure: 'invalid-response', admittedIds: ['a'] })
  })

  it('rejects batches over sixteen candidates and invalid thresholds', async () => {
    const many = { candidates: Array.from({ length: 17 }, (_, index) => memory(`m${index}`)) }
    await expect(admitContinuumMemory(fake(), config, many)).rejects.toThrow(RangeError)
    await expect(admitContinuumMemory(fake(), { ...config, minImportance: 1.5 }, { candidates: [] })).rejects.toThrow('minImportance')
    await expect(selectContinuumMemory(fake(), { ...config, minRelevance: -0.1 }, { query: 'q', candidates: [] })).rejects.toThrow('minRelevance')
  })
})

describe('Continuum threshold selection', () => {
  const threshold = { ...config, selection: 'threshold' } as const satisfies ContinuumJevConfig

  it('keeps only candidates whose relevance reaches minRelevance, in relevance order', async () => {
    const provider = fake([0.69, 0.95, 0.7])
    const result = await selectContinuumMemory(provider, threshold, {
      query: 'What port?', candidates: [candidate('a', 1), candidate('b', 0, 'Use port 8443.'), candidate('c', 0)],
    })
    expect(result).toMatchObject({ outcome: 'jev', selectedIds: ['b', 'c'], baselineIds: ['a', 'b', 'c'] })
    expect(result.evaluation.rankedIds).toEqual(['b', 'c', 'a'])
    const instructions = Object.values(provider.calls[0]!.questions).map(question => question.instructions)
    expect(instructions[1]).toContain('Query: «What port?». Candidate m1: «Use port 8443.».')
    expect((await selectContinuumMemory(fake([0.69, 0.95, 0.7]), { ...threshold, minRelevance: 0.9 }, {
      query: 'q', candidates: [candidate('a', 1), candidate('b', 0), candidate('c', 0)],
    })).selectedIds).toEqual(['b'])
  })

  it('quotes only the leading input characters in each question and keeps excerpts out of the shared state', async () => {
    const provider = fake([0.9])
    const query = `${'长'.repeat(30)}tail`
    await selectContinuumMemory(provider, { ...threshold, maxQueryChars: 30 }, { query, candidates: [candidate('a', 0, 'Full excerpt.')] })
    const request = provider.calls[0]!
    expect(Object.values(request.questions)[0]?.instructions).toContain(`Query: «${'长'.repeat(30)}…[input continues]». Candidate m0: «Full excerpt.».`)
    expect(request.state).toEqual({ query: `${'长'.repeat(30)}…[input continues]`, candidates: [{ question: 'm0', id: 'a', label: 'fact', lexicalScore: 0 }] })
    await expect(selectContinuumMemory(fake(), { ...threshold, maxQueryChars: 0 }, { query, candidates: [] })).rejects.toThrow('maxQueryChars')
    const emoji = fake([0.9])
    await selectContinuumMemory(emoji, { ...threshold, maxQueryChars: 2 }, { query: 'a😀b', candidates: [candidate('a', 0)] })
    expect(emoji.calls[0]?.state).toMatchObject({ query: 'a…[input continues]' })
  })

  it('keeps only lexical matches without a Reflex answer, and in shadow or off mode', async () => {
    const input = { query: 'q', candidates: [candidate('a', 0), candidate('b', 2)] }
    expect((await selectContinuumMemory(fake([1, 0]), { ...threshold, mode: 'shadow' }, input)).selectedIds).toEqual(['b'])
    expect((await selectContinuumMemory(fake(), { ...threshold, mode: 'off' }, input)).selectedIds).toEqual(['b'])
    const failing: ContinuumJev = { ...fake(), decide: () => Promise.reject(new Error('down')) }
    expect((await selectContinuumMemory(failing, threshold, input)).selectedIds).toEqual(['b'])
  })

  it('keeps unscored candidates beyond the batch only when they share a query term', async () => {
    const candidates = [...Array.from({ length: 16 }, (_, index) => candidate(`s${index}`, 0)), candidate('lexical', 1), candidate('other', 0)]
    const result = await selectContinuumMemory(fake(Array.from({ length: 16 }, () => 0)), threshold, { query: 'q', candidates })
    expect(result.selectedIds).toEqual(['lexical'])
    expect(result.evaluation.unscoredIds).toEqual(['lexical', 'other'])
  })
})

describe('Continuum Reflex admitter service', () => {
  async function mount(mode: ContinuumJevConfig['mode'], options: { jev?: ContinuumJev; persistence?: boolean } = {}) {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const root = await mkdtemp(join(tmpdir(), 'continuum-admitter-'))
    roots.push(root)
    if (options.persistence === true) {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(AgentLoop, { agents: [] })
      ctx.llm.registerAdapter(['recording'], new MockAdapter([]))
    }
    if (options.jev !== undefined) ctx.provide('jev', options.jev as never)
    const fiber = ctx.plugin(ContinuumJevPlugin, { ...config, mode })
    await fiber
    return { ctx, fiber }
  }

  it('offers no admitter while Reflex is off or no Jev provider is mounted', async () => {
    expect((await mount('off', { jev: fake() })).ctx.get('continuumMemoryAdmitter')).toBeUndefined()
    const { ctx } = await mount('active')
    expect(ctx.get('continuumMemoryAdmitter')).toBeUndefined()
    ctx.provide('jev', fake() as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.get('continuumMemoryAdmitter')).toBeDefined()
  })

  it('admits everything without dispatch when no persistence backend can hold the prepared receipt', async () => {
    const provider = fake([0, 0])
    const { ctx } = await mount('active', { jev: provider })
    const session = ctx.sessions.create(SessionId('admitter-no-backend'))
    const admission = await ctx.get('continuumMemoryAdmitter')!.admit({ session } as Agent, {
      candidates: [{ id: 'x:1', content: 'one' }, { id: 'x:2', content: 'two' }], isCurrent: () => true,
    }, new AbortController().signal)
    expect(admission.admittedIds).toEqual(['x:1', 'x:2'])
    expect(provider.calls).toEqual([])
    expect(session.snapshotEvents().flatMap(event => event.type === 'continuum/memory-admission' ? [[event.data.phase, event.data.reason]] : []))
      .toEqual([['prepared', 'prepared'], ['settled', 'persistence-unavailable']])
  })

  it('durably prepares each batch of at most sixteen before dispatch and records the settled judgement', async () => {
    const provider = fake(Array.from({ length: 16 }, (_, index) => index % 2))
    const { ctx } = await mount('active', { jev: provider, persistence: true })
    const agent = await ctx.agentLoop.create(SessionId('admitter-durable'), { provider: 'recording', model: 'recording' })
    const session = agent.session
    const candidates = Array.from({ length: 20 }, (_, index) => ({ id: `x:${index}`, content: `message ${index}` }))
    const admission = await ctx.get('continuumMemoryAdmitter')!.admit(agent, { candidates, isCurrent: () => true }, new AbortController().signal)
    expect(provider.calls.map(call => Object.keys(call.questions).length)).toEqual([16, 4])
    expect(admission.admittedIds).toEqual(['x:1', 'x:3', 'x:5', 'x:7', 'x:9', 'x:11', 'x:13', 'x:15', 'x:17', 'x:19'])
    const receipts = session.snapshotEvents().flatMap(event => event.type === 'continuum/memory-admission' ? [event] : [])
    expect(receipts.map(event => event.data.phase)).toEqual(['prepared', 'settled', 'prepared', 'settled'])
    expect(receipts[1]?.data.preparedSeq).toBe(receipts[0]?.seq)
  })

  it('admits everything after a durable prepared receipt when the provider then fails', async () => {
    const failing: ContinuumJev = { ...fake(), decide: () => Promise.reject(new Error('down')) }
    const { ctx } = await mount('active', { jev: failing, persistence: true })
    const agent = await ctx.agentLoop.create(SessionId('admitter-failing'), { provider: 'recording', model: 'recording' })
    const admission = await ctx.get('continuumMemoryAdmitter')!.admit(agent, {
      candidates: [{ id: 'x:1', content: 'one' }], isCurrent: () => true,
    }, new AbortController().signal)
    expect(admission.admittedIds).toEqual(['x:1'])
    const receipts = agent.session.snapshotEvents().flatMap(event => event.type === 'continuum/memory-admission' ? [event] : [])
    expect(receipts[1]?.data).toMatchObject({ reason: 'provider-error', preparedSeq: receipts[0]?.seq })
  })

  it('withdraws the admitter when its plugin is disposed', async () => {
    const { ctx, fiber } = await mount('shadow', { jev: fake() })
    expect(ctx.get('continuumMemoryAdmitter')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('continuumMemoryAdmitter')).toBeUndefined()
  })
})
