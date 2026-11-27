import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { currentSessionMessageProjections } from '@deepseek-ai/dsh-session-format-catalog/message-projections'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { buildRequestView, installRequestDispatchRecorder } from '../src/request-view.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  const failures: unknown[] = []
  for (const dispose of cleanups.splice(0).reverse()) {
    try { await dispose() } catch (error: unknown) { failures.push(error) }
  }
  if (failures.length > 0) throw new AggregateError(failures, '受控提供方测试资源回收失败')
})

it('replays each native view into the exact messages and tools captured at the gateway transport', async () => {
  const bodies: unknown[] = []
  const text = [
    '{"choices":[{"delta":{"role":"assistant","content":"done"},"index":0,"finish_reason":null}]}',
    '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
    '[DONE]',
  ]
  const tool = [
    '{"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_fixture","type":"function","function":{"name":"echo","arguments":"{\\"text\\":\\"one\\"}"}}]},"index":0,"finish_reason":null}]}',
    '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
    '[DONE]',
  ]
  const replies = [tool, text, text, text]
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => {
      bodies.push(JSON.parse(body))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of replies.shift() ?? text) response.write(`data: ${event}\n\n`)
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('受控提供方未取得本地端口')
  const directory = await mkdtemp(join(tmpdir(), 'dsh-provider-view-'))
  cleanups.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: directory })
  vi.stubEnv('FIXTURE_PROVIDER_KEY', 'fixture-only')
  await ctx.plugin(LlmPiAi, { providers: { gateway: {
    api: 'openai-completions',
    baseURL: `http://127.0.0.1:${address.port}`,
    apiKeyEnv: 'FIXTURE_PROVIDER_KEY',
    models: [{ id: 'deepseek-v4.1-flash', contextWindow: 1048576, maxTokens: 8192 }],
  } } })
  ctx.tools.register(defineContentToolFixture({
    name: 'echo', description: '返回本次参数中的完整文本',
    parameters: { text: { type: 'string' } },
    execute: args => Promise.resolve([{ type: 'text', text: `echo: ${String(args.text)}` }]),
  }))
  const unrecord = installRequestDispatchRecorder(ctx)
  const agent = await ctx.agentLoop.create(SessionId('provider-view-fixture'), {
    provider: 'gateway', model: 'deepseek-v4.1-flash',
  })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Use echo with one, then report the result.' }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  expect(bodies).toHaveLength(2)
  // The capture covers the transformation classes this deployment actually
  // uses: a system prompt folded into a system-role message, ordinary user
  // text, tool declarations, and a tool result fed back on the second call.
  const firstBody = bodies[0] as { messages: { role: string }[]; tools?: unknown[] }
  expect(firstBody.messages[0]?.role).toBe('system')
  expect(firstBody.messages.some(message => message.role === 'user')).toBe(true)
  expect(firstBody.tools?.length ?? 0).toBeGreaterThan(0)
  const secondBody = bodies[1] as { messages: { role: string }[] }
  expect(secondBody.messages.some(message => message.role === 'tool')).toBe(true)
  const events = agent.session.snapshotEvents()
  const dispatches = events.filter(event => event.type === 'llm/dispatch')
  expect(dispatches).toHaveLength(2)
  for (const [index, dispatch] of dispatches.entries()) {
    const view = await buildRequestView(ctx, {
      sessionId: agent.session.id, dispatchSeq: dispatch.seq,
      projections: currentSessionMessageProjections,
    })
    // 视图的 header 已经携带实际 provider/model；重复写默认值会让类型检查
    // 判断后者覆盖前者，且可能掩盖真正生效的配置。
    const replay = {
      ...view.header.config,
      messages: [...view.messages], toolHistory: view.toolHistory,
      ...(view.tools === undefined ? {} : { tools: view.tools }),
    }
    for await (const _chunk of ctx.llm.stream(replay)) { /* 消费受控响应，不触发真实模型。 */ }
    expect(bodies[index + 2]).toEqual(bodies[index])
  }
  unrecord()
}, 20_000)
