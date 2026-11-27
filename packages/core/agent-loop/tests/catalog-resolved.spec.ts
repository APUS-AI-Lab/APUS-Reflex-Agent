/**
 * `tool/catalog-resolved` records the exact model-facing catalog one step
 * assembled: the admitted names with their schema digests, and the names the
 * scope's resolution withheld together with the stage that withheld them.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

describe('tool/catalog-resolved', () => {
  it('records the admitted catalog with schema digests and the collapsed names', async () => {
    const ctx = await harness()
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    }))
    const agent = await ctx.agentLoop.create(SessionId('catalog-resolved'), {
      provider: 'mock',
      model: 'mock',
    })

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, agent)

    const record = agent.session.snapshotEvents().find(
      event => event.type === 'tool/catalog-resolved',
    )
    expect(record).toBeDefined()
    if (record?.type !== 'tool/catalog-resolved') throw new Error('missing record')
    // `native` mode admits every visible tool, so the model's catalog is the
    // registered set and nothing is withheld in this scope.
    expect(record.data.admitted.map(tool => tool.name)).toEqual(['echo'])
    expect(record.data.admitted[0]?.schemaDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(record.data.skipped).toEqual([])
    expect(record.data.turn).toBeGreaterThan(0)
    expect(record.data.step).toBeGreaterThan(0)
  })
})
