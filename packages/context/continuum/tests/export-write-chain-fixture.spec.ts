/**
 * Emit one real write chain as a fixture the AutoEval projection consumes.
 *
 * The two repositories must agree on what a write result means: APUS produces
 * `l1Status`, `appliedRecords.terms` and the record snapshot; AutoEval turns
 * them into observations. Unit tests on either side can pass while the pair is
 * inconsistent, because each side asserts against its own hand-written input.
 * Writing this log out lets the consumer test run against producer output.
 *
 * Skipped unless `DSH_WRITE_FIXTURE_OUT` names the destination file, so a
 * normal test run does not touch the working tree.
 */
import { describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
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
import ContinuumMemory from '../src/service.ts'

const out = process.env.DSH_WRITE_FIXTURE_OUT

describe.skipIf(out === undefined)('write-chain fixture export', () => {
  it('writes one user-message write chain as AutoEval input', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['recording'], new MockAdapter([textResponse('ack'), textResponse('ack')]))
    await ctx.plugin(Jev, { endpoint: 'http://127.0.0.1:1', model: 'jev-test' })
    new BasicCompactionEngine(ctx, { auto: false })
    await ctx.plugin(ContinuumMemory, {
      enabled: true, mode: 'active', admission: 'user-message', scopes: ['workspace'],
      maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192, executionAdmission: 'off',
    })
    const agent = await ctx.agentLoop.create(SessionId('fixture-write-chain'), { provider: 'recording', model: 'recording' })
    agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'The cutover window is Thursday night.' }],
    }))
    await agent.whenIdle()

    const events = agent.session.snapshotEvents().map(event => ({
      type: event.type,
      seq: event.seq,
      time: event.time,
      data: event.data,
    }))
    expect(events.some(event => event.type === 'continuum/memory-write-result')).toBe(true)
    writeFileSync(String(out), `${JSON.stringify({ sessionId: String(agent.session.id), events }, null, 2)}\n`)
    await ctx.fiber.dispose()
    vi.restoreAllMocks()
  })
})
