/** HTTP response classification through the production adapter, retry plugin, and AgentLoop. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, expandAssistantStream } from '@deepseek-ai/dsh-llm'
import * as Retry from '@deepseek-ai/dsh-llm-retry'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function harness(baseURL: string): Promise<Context> {
  vi.stubEnv('PI_RESPONSE_KEY', 'test-key')
  const ctx = new Context()
  context = ctx
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(LlmPiAi, {
    providers: {
      gateway: {
        api: 'openai-completions', baseURL, apiKeyEnv: 'PI_RESPONSE_KEY',
        models: [{ id: 'test-model', contextWindow: 32768, maxTokens: 1024 }],
        retryPolicy: {
          mode: 'normal', maxRetries: 5,
          backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
        },
      },
    },
  })
  await ctx.plugin(Retry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

describe('HTTP response recovery through the production loop', () => {
  it('sends an HTML endpoint error once despite the five-retry policy', async () => {
    const server = await mockServer(Array.from({ length: 6 }, () => ({
      body: '<html><title>Gateway console</title></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })))
    const ctx = await harness(server.url)
    const agent = await ctx.agentLoop.create(SessionId('html-endpoint'), {
      provider: 'gateway', model: 'test-model',
    })
    agent.followup(createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Complete the task.' }],
    }))
    await agent.whenIdle()

    expect(server.requests).toHaveLength(1)
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(0)
    const attempts = events.filter(event => event.type === 'assistant/attempt')
    expect(attempts).toHaveLength(1)
    if (attempts[0]?.type !== 'assistant/attempt') throw new Error('失败请求应保留尝试事件')
    expect(expandAssistantStream(attempts[0].data.stream)).toContainEqual(expect.objectContaining({
      chunk: {
        type: 'finish', reason: expect.objectContaining({
          kind: 'error', failure: expect.objectContaining({ code: 'INVALID_REQUEST' }),
        }),
      },
    }))
    expect(events.at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'error' } },
    })
  }, 15000)

  it('records another step after a model tool call instead of ending the task at step one', async () => {
    const server = await mockServer([
      { events: [
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-inspect","type":"function","function":{"name":"inspect_fact","arguments":"{}"}}]},"index":0,"finish_reason":null}]}',
        '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}',
        '[DONE]',
      ] },
      { events: textEvents },
    ])
    const ctx = await harness(server.url)
    let executions = 0
    ctx.effect(() => ctx.tools.register(defineContentToolFixture({
      name: 'inspect_fact', description: 'Return one fact for the next model request.',
      parameters: {},
      async execute() {
        executions += 1
        return [{ type: 'text', text: 'The inspected fact is ready.' }]
      },
    })))
    const agent = await ctx.agentLoop.create(SessionId('two-step-recovery'), {
      provider: 'gateway', model: 'test-model',
    })
    agent.followup(createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect the fact, then answer.' }],
    }))
    await agent.whenIdle()

    expect(executions).toBe(1)
    expect(server.requests).toHaveLength(2)
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'step/start').map(event => event.data.step))
      .toEqual([1, 2])
    expect(events.filter(event => event.type === 'step/end').map(event => event.data.step))
      .toEqual([1, 2])
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
    expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(0)
  }, 15000)

  it('still retries a genuinely truncated SSE stream and keeps the recovered response', async () => {
    const server = await mockServer([
      { events: ['{"choices":[{"delta":{"content":"unfinished"},"index":0,"finish_reason":null}]}'] },
      { events: textEvents },
    ])
    const ctx = await harness(server.url)
    const agent = await ctx.agentLoop.create(SessionId('truncated-sse'), {
      provider: 'gateway', model: 'test-model',
    })
    agent.followup(createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Complete the task.' }],
    }))
    await agent.whenIdle()

    expect(server.requests).toHaveLength(2)
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'llm/retry').map(event => event.data.failure.code))
      .toEqual(['TRANSPORT'])
    expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
    const messages = agent.session.deriveMessages().filter(message => message.role === 'assistant')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(events.at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'completed' } },
    })
  }, 15000)
})
