import { MESSAGES_RESPONSE } from './messages-response.ts'
import { createUserMessage, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import SubagentRuntime, { type SubagentResult, type SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import type { JsonRpcTransportPeer } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'

class FakeTransport implements JsonRpcTransportPeer {
  notifications: { method: string; params?: Record<string, unknown> }[] = []

  async request(method: string, params: object): Promise<unknown> {
    throw new Error(`the SDK server should not call host JSON-RPC method ${method} with ${JSON.stringify(params)}`)
  }

  notify(method: string, params?: object): void {
    this.notifications.push(params === undefined ? { method } : { method, params: params as Record<string, unknown> })
  }
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  vi.unstubAllEnvs()
})

async function mockCompletionServer(): Promise<{ url: string; requests: unknown[]; headers: IncomingMessage['headers'][] }> {
  const requests: unknown[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      headers.push(request.headers)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(MESSAGES_RESPONSE)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, requests, headers }
}

async function makeHarness(storageDir: string) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(JsonlSessionPersistence, { root: storageDir })
  await new Promise(resolve => setTimeout(resolve, 50))
  return ctx
}

/** Drive the owning service so test lifecycle events carry the real parent scope. */
async function settleSubagent(
  ctx: Context,
  parent: Agent,
  info: Omit<SubagentRunEndInfo, 'runId' | 'local'> & { localAgent: Agent | undefined },
  beforeSettle?: () => Promise<void>,
): Promise<void> {
  const result = Promise.withResolvers<SubagentResult>()
  const disposeProvider = ctx.subagents.registerProvider({
    name: info.provider,
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    async start() {
      return {
        id: info.id,
        localAgent: info.localAgent,
        result: result.promise,
        dispose: () => Promise.resolve(),
      }
    },
  })
  try {
    const run = await ctx.subagents.start(info.provider, {
      parent,
      prompt: [],
      signal: new AbortController().signal,
    })
    await beforeSettle?.()
    if (info.lastAssistantMessage === undefined) {
      result.reject(new Error('synthetic infrastructure failure'))
    } else {
      result.resolve({ output: info.lastAssistantMessage, stopReason: info.stopReason })
    }
    await run.result.then(() => undefined, () => undefined)
    await run.dispose()
  } finally {
    disposeProvider()
  }
}

describe('HarnessSdkJsonRpcServer', () => {
  it('binds a requested preset before the first prompt and freezes it for the session', async () => {
    const agents = new Map<string, Agent>()
    const followups = new Map<string, number>()
    const mount = vi.fn(async () => ({ id: 'benchmark-task' }))
    const agentCtx = new Context()
    const create = vi.fn(async (options: import('@deepseek-ai/dsh-agent').CreateAgentOptions) => {
      const agent = Object.assign({} as Agent, {
        id: options.sessionId,
        followup: () => { followups.set(String(options.sessionId), (followups.get(String(options.sessionId)) ?? 0) + 1) },
      })
      await options.setup?.(agentCtx, agent)
      agents.set(String(options.sessionId), agent)
      return { agent, dispose: async () => {} }
    })
    const ctx = new Context()
    ctx.provide('agents', { create, get: (id: SessionId) => agents.get(String(id)) })
    ctx.provide('agentPresets', { mount })
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    Object.assign(server, { initialized: true })
    const contentBlocks = [{ type: 'text' as const, text: 'inspect the task' }]
    try {
      await server.prompt({ sessionId: 'task', agentPreset: 'benchmark-task', contentBlocks })
      expect(mount).toHaveBeenCalledWith(agentCtx, 'benchmark-task')
      expect(create.mock.calls[0]?.[0].meta?.agentPreset).toBe('benchmark-task')
      await server.prompt({ sessionId: 'task', contentBlocks })
      await expect(server.prompt({ sessionId: 'task', agentPreset: 'another', contentBlocks })).rejects.toThrow(/preset/)
      expect(create).toHaveBeenCalledOnce()
      expect(followups.get('task')).toBe(2)
    } finally {
      await server.shutdown()
      await agentCtx.fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('freezes a separate cwd for each SDK session before delivering prompts', async () => {
    const agents = new Map<string, Agent>()
    const followups = new Map<string, number>()
    const create = vi.fn(async (options: { sessionId: SessionId; meta?: { cwd?: string } }) => {
      const agent = Object.assign({} as Agent, {
        id: options.sessionId,
        followup: () => { followups.set(String(options.sessionId), (followups.get(String(options.sessionId)) ?? 0) + 1) },
      })
      agents.set(String(options.sessionId), agent)
      return { agent, dispose: async () => {} }
    })
    const ctx = new Context()
    ctx.provide('agents', { create, get: (id: SessionId) => agents.get(String(id)) })
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    Object.assign(server, { initialized: true })
    const contentBlocks = [{ type: 'text' as const, text: 'inspect the task' }]
    try {
      await server.prompt({ sessionId: 'task-a', cwd: '/app/task-a', contentBlocks })
      await server.prompt({ sessionId: 'task-b', cwd: '/app/task-b', contentBlocks })
      await server.prompt({ sessionId: 'task-a', contentBlocks })
      expect(create.mock.calls.map(([options]) => options.meta?.cwd)).toEqual(['/app/task-a', '/app/task-b'])
      await expect(server.prompt({ sessionId: 'task-a', cwd: '/app/another', contentBlocks })).rejects.toThrow(/cwd/)
      expect(followups.get('task-a')).toBe(2)
    } finally {
      await server.shutdown()
      await ctx.fiber.dispose()
    }
  })

  it('creates a harness agent and calls the configured OpenAI-compatible endpoint', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-'))
    const llmServer = await mockCompletionServer()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      const init = await server.handleRequest('initialize', {
        cwd: storageDir,
        provider: 'deepseek-official',
        model: 'dsagent-model',
        reasoningEffort: 'max',
        maxTokens: 321,
      }) as { serverInfo: { name: string } }
      expect(init.serverInfo.name).toBe('deepseek-harness-sdk-runtime')

      const receipt = await server.handleRequest('session/prompt', {
        sessionId: 'main',
        contentBlocks: [{ type: 'text', text: 'fix it' }],
      })
      expect((receipt as { messageId?: unknown }).messageId).toBeTypeOf('string')

      await vi.waitFor(() => { expect(llmServer.requests).toHaveLength(1) })
      const body = llmServer.requests[0] as {
        model: string
        messages: { role: string }[]
        system?: string
        output_config?: { effort: string }
        max_tokens?: number
      }
      expect(body.model).toBe('dsagent-model')
      expect(body.output_config).toEqual({ effort: 'max' })
      expect(body.max_tokens).toBe(321)
      expect(body.system).toBeTypeOf('string')
      expect(body.messages[0]?.role).toBe('user')
      expect(body.messages.at(-1)?.role).toBe('user')
      expect(llmServer.headers[0]?.['x-api-key']).toBe('test-key')
      expect(transport.notifications.some(n => n.method === 'session.event')).toBe(true)
      await vi.waitFor(() => {
        expect(transport.notifications.findLast(n => n.method === 'session.status')).toEqual({
          method: 'session.status',
          params: { sessionId: 'main', status: 'idle' },
        })
      })

      await server.handleRequest('session/prompt', {
        sessionId: 'main',
        contentBlocks: [{ type: 'text', text: 'again' }],
      })
      await vi.waitFor(() => { expect(llmServer.requests).toHaveLength(2) })

      const orphanHandle = await ctx.agents.create({
        sessionId: SessionId('orphan-session'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'dsagent-model' },
      })
      orphanHandle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'outside the sdk session map' }], source: { kind: 'user' } }))
      await orphanHandle.agent.whenIdle()
      await orphanHandle.dispose()
      expect(llmServer.requests).toHaveLength(3)

      await server.handleRequest('shutdown', undefined)
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('queues overlapping prompts for one session without blocking other sessions', async () => {
    const mainFollowup = vi.fn<Agent['followup']>()
    const mainAgent = ({
      id: SessionId('main'),
      followup: mainFollowup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const otherFollowup = vi.fn<Agent['followup']>()
    const otherAgent = ({
      id: SessionId('other'),
      followup: otherFollowup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const mainHandle = { agent: mainAgent, dispose: vi.fn(() => Promise.resolve()) }
    const otherHandle = { agent: otherAgent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(async (options: { sessionId: SessionId }) =>
      String(options.sessionId) === 'main' ? mainHandle : otherHandle)
    const liveAgents = new Map<string, Agent>([['main', mainAgent], ['other', otherAgent]])
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create, get: (id: SessionId) => liveAgents.get(String(id)) },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    // This isolated prompt test begins after the handshake boundary.
    ;(server as unknown as { initialized: boolean }).initialized = true
    const prompt = (sessionId: string, text: string) => server.prompt({
      sessionId,
      contentBlocks: [{ type: 'text', text }],
    })

    expect((await prompt('main', 'first')).messageId).toBeTypeOf('string')
    expect((await prompt('main', 'overlap')).messageId).toBeTypeOf('string')
    expect((await prompt('other', 'independent')).messageId).toBeTypeOf('string')

    expect(mainFollowup).toHaveBeenCalledTimes(2)
    expect(otherFollowup).toHaveBeenCalledOnce()
    await server.shutdown()
    expect(mainHandle.dispose).toHaveBeenCalledOnce()
    expect(otherHandle.dispose).toHaveBeenCalledOnce()
  })

  it('admits inline SDK images before the user message enters the session', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({ id: SessionId('image'), followup } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const ref = {
      attachmentId: 'sha256:image',
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    }
    const saveImages = vi.fn(async () => [ref])
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(async () => handle), get: () => agent },
      get: (name: string) => name === 'attachments' ? { saveImages } : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    // This isolated prompt test begins after the handshake boundary.
    ;(server as unknown as { initialized: boolean }).initialized = true

    await server.prompt({
      sessionId: 'image',
      contentBlocks: [
        { type: 'text', text: 'inspect' },
        { type: 'image', data: 'AQ==', mimeType: 'image/png' },
      ],
    })

    expect(saveImages).toHaveBeenCalledWith([{ data: Uint8Array.of(1), mediaType: 'image/png' }])
    expect(followup.mock.calls[0]?.[0].content).toEqual([
      { type: 'text', text: 'inspect' },
      { type: 'image', attachment: ref },
    ])
    await server.shutdown()
  })

  it('rejects inline SDK images when the composition has no attachment store', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({ id: SessionId('image'), followup } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(async () => handle), get: () => agent },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    // This isolated prompt test begins after the handshake boundary.
    ;(server as unknown as { initialized: boolean }).initialized = true

    await expect(server.prompt({
      sessionId: 'image',
      contentBlocks: [{ type: 'image', data: 'AQ==', mimeType: 'image/png' }],
    })).rejects.toThrow('SDK image prompt requires an attachment store')
    expect(followup).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('rechecks agent liveness after asynchronous image admission', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({ id: SessionId('image-race'), followup } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const admitted = Promise.withResolvers<Array<{
      attachmentId: string
      mediaType: string
      bytes: number
    }>>()
    const saveImages = vi.fn(() => admitted.promise)
    let live = true
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async () => handle),
        get: () => live ? agent : undefined,
      },
      get: (name: string) => name === 'attachments' ? { saveImages } : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    // This isolated prompt test begins after the handshake boundary.
    ;(server as unknown as { initialized: boolean }).initialized = true

    const prompting = server.prompt({
      sessionId: 'image-race',
      contentBlocks: [{ type: 'image', data: 'AQ==', mimeType: 'image/png' }],
    })
    await vi.waitFor(() => { expect(saveImages).toHaveBeenCalledOnce() })
    live = false
    admitted.resolve([{ attachmentId: 'sha256:image', mediaType: 'image/png', bytes: 1 }])

    await expect(prompting).rejects.toThrow('session agent was disposed outside the server: image-race')
    expect(followup).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('rejects a prompt for a session whose agent was disposed outside the server', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('zombie'),
      followup,
      whenIdle: vi.fn(() => Promise.resolve()),
    } satisfies Pick<Agent, 'id' | 'followup' | 'whenIdle'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    // The registry drops the agent after creation, modelling an agent-loop-only
    // reload that leaves the server's SessionRecord pointing at a detached agent.
    let live = true
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async () => handle),
        get: (id: SessionId) => (live && String(id) === 'zombie' ? agent : undefined),
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    // This isolated prompt test begins after the handshake boundary.
    ;(server as unknown as { initialized: boolean }).initialized = true
    const prompt = (text: string) => server.prompt({
      sessionId: 'zombie',
      contentBlocks: [{ type: 'text', text }],
    })

    expect((await prompt('while live')).messageId).toBeTypeOf('string')
    live = false
    await expect(prompt('after detach')).rejects.toThrow('session agent was disposed outside the server: zombie')
    // The detached agent was never driven by the rejected prompt.
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('forwards whole-agent status without attributing a turn outcome', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const transport = new FakeTransport()
    const server = new HarnessSdkJsonRpcServer(ctx, transport)
    const session = ctx.sessions.create(SessionId('message-outcome'))
    const agent = ({
      id: SessionId('message-outcome'),
      session,
    } satisfies Pick<Agent, 'id' | 'session'>) as Agent

    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    expect(transport.notifications.filter(notification => notification.method === 'session.status'))
      .toEqual([
        { method: 'session.status', params: { sessionId: 'message-outcome', status: 'running' } },
        { method: 'session.status', params: { sessionId: 'message-outcome', status: 'idle' } },
      ])
    await server.shutdown()
    await ctx.fiber.dispose()
  })

  it('notifies the host when a child session is created with parent lineage', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      ctx.sessions.create(SessionId('root-session'), {
        meta: { cwd: storageDir },
      })
      ctx.sessions.create(SessionId('child-session'), {
        meta: { cwd: storageDir, parentSession: SessionId('main') },
      })

      expect(transport.notifications).toContainEqual({
        method: 'subagent.started',
        params: {
          parentSessionId: 'main',
          childSessionId: 'child-session',
        },
      })

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('creates an SDK session without an optional system prompt', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-no-system-'))
    const llmServer = await mockCompletionServer()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
    const ctx = await makeHarness(storageDir)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await server.initialize({ cwd: storageDir, provider: 'deepseek-official', model: 'plain-model' })
      await server.prompt({
        sessionId: 'plain',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      })

      await vi.waitFor(() => { expect(llmServer.requests).toHaveLength(1) })
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('notifies the host when a subagent run settles', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-end-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('main'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      // A custom in-process provider may own its child at the provider/root
      // scope while preserving durable parent lineage.
      const handle = await ctx.agents.create({
        sessionId: SessionId('child-session'),
        meta: { cwd: storageDir, parentSession: SessionId('main') },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      expect(ctx.agents.roots()).toContain(handle.agent)
      const parentlessHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('parentless-child-session'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
        parentAgent: parentHandle.agent,
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'spawn',
        id: SessionId('child-session'),
        localAgent: handle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'child done' }],
      }, () => handle.dispose())
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'spawn',
        id: SessionId('parentless-child-session'),
        localAgent: parentlessHandle.agent,
        stopReason: 'error',
      }, () => parentlessHandle.dispose())

      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'spawn',
          agentId: 'child-session',
          parentSessionId: 'main',
          childSessionId: 'child-session',
          status: 'ok',
          stopReason: 'completed',
          lastAssistantMessage: [{ type: 'text', text: 'child done' }],
        },
      })
      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'spawn',
          agentId: 'parentless-child-session',
          parentSessionId: 'main',
          childSessionId: 'parentless-child-session',
          status: 'error',
          stopReason: 'error',
        },
      })

      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('ignores a remote run id that collides with a local child of the same parent', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-remote-collision-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('collision-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const collidingChild = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('remote-run-id'),
        meta: { cwd: storageDir, parentSession: SessionId('collision-parent') },
        agentOptions: { model: 'deepseek-official' },
        parentAgent: parentHandle.agent,
      })

      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'remote',
        id: SessionId('remote-run-id'),
        localAgent: undefined,
        stopReason: 'completed',
        lastAssistantMessage: [],
      })

      expect(transport.notifications.some(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.agentId === 'remote-run-id',
      )).toBe(false)

      await collidingChild.dispose()
      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('retains locality across continuation runs on one live child', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-continuation-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('continuation-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const childHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('continuation-child'),
        meta: { cwd: storageDir, parentSession: SessionId('continuation-parent') },
        agentOptions: { model: 'deepseek-official' },
        parentAgent: parentHandle.agent,
      })

      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'continuation',
        id: SessionId('continuation-child'),
        localAgent: childHandle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'first' }],
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'continuation',
        id: SessionId('continuation-child'),
        localAgent: childHandle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'second' }],
      }, () => childHandle.dispose())

      expect(transport.notifications.filter(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.childSessionId === 'continuation-child',
      )).toHaveLength(2)

      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('correlates reused local ids by parent scope when runs settle out of order', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-reuse-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const oldParent = await ctx.agents.create({
        sessionId: SessionId('old-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const oldChild = await oldParent.agent.ctx.agents.create({
        sessionId: SessionId('reused-child'),
        meta: { cwd: storageDir, parentSession: SessionId('old-parent') },
        agentOptions: { model: 'deepseek-official' },
        parentAgent: oldParent.agent,
      })
      const first = Promise.withResolvers<SubagentResult>()
      const sameLifetime = Promise.withResolvers<SubagentResult>()
      const replacement = Promise.withResolvers<SubagentResult>()
      const results = [first.promise, sameLifetime.promise, replacement.promise]
      let starts = 0
      let currentLocalAgent = oldChild.agent
      const disposeProvider = ctx.subagents.registerProvider({
        name: 'reused',
        capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start() {
          const result = results[starts]
          starts += 1
          if (result === undefined) throw new Error('unexpected fourth reused-id run')
          return Promise.resolve({ id: SessionId('reused-child'), localAgent: currentLocalAgent, result, dispose: () => Promise.resolve() })
        },
      })

      const firstRun = await ctx.subagents.start('reused', {
        parent: oldParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      const sameLifetimeRun = await ctx.subagents.start('reused', {
        parent: oldParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      sameLifetime.resolve({ output: [{ type: 'text', text: 'same lifetime' }], stopReason: 'completed' })
      await sameLifetimeRun.result
      await oldChild.dispose()
      const newParent = await ctx.agents.create({
        sessionId: SessionId('new-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const newChild = await newParent.agent.ctx.agents.create({
        sessionId: SessionId('reused-child'),
        meta: { cwd: storageDir, parentSession: SessionId('new-parent') },
        agentOptions: { model: 'deepseek-official' },
        parentAgent: newParent.agent,
      })
      currentLocalAgent = newChild.agent
      const secondRun = await ctx.subagents.start('reused', {
        parent: newParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })

      replacement.resolve({ output: [{ type: 'text', text: 'new lifetime' }], stopReason: 'completed' })
      await secondRun.result
      first.resolve({ output: [{ type: 'text', text: 'old lifetime' }], stopReason: 'completed' })
      await firstRun.result
      await Promise.resolve()

      const finished = transport.notifications.filter(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.childSessionId === 'reused-child',
      )
      expect(finished.map(notification => notification.params?.lastAssistantMessage)).toEqual([
        [{ type: 'text', text: 'same lifetime' }],
        [{ type: 'text', text: 'new lifetime' }],
        [{ type: 'text', text: 'old lifetime' }],
      ])
      expect(finished.map(notification => notification.params?.parentSessionId)).toEqual([
        'old-parent',
        'new-parent',
        'old-parent',
      ])

      await firstRun.dispose()
      await sameLifetimeRun.dispose()
      await secondRun.dispose()
      disposeProvider()
      await newChild.dispose()
      await oldParent.dispose()
      await newParent.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('keeps locality bound to the accepted run across provider re-registration', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-provider-reuse-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parent = await ctx.agents.create({
        sessionId: SessionId('provider-reuse-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const child = await parent.agent.ctx.agents.create({
        sessionId: SessionId('provider-reuse-child'),
        meta: { cwd: storageDir, parentSession: SessionId('provider-reuse-parent') },
        agentOptions: { model: 'deepseek-official' },
        parentAgent: parent.agent,
      })
      const localResult = Promise.withResolvers<SubagentResult>()
      const remoteResult = Promise.withResolvers<SubagentResult>()
      const unregisterLocal = ctx.subagents.registerProvider({
        name: 'reused-provider',
        capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.resolve({
          id: SessionId('provider-reuse-child'),
          localAgent: child.agent,
          result: localResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      const localRun = await ctx.subagents.start('reused-provider', {
        parent: parent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      unregisterLocal()

      const unregisterRemote = ctx.subagents.registerProvider({
        name: 'reused-provider',
        capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.resolve({
          id: SessionId('provider-reuse-child'),
          localAgent: undefined,
          result: remoteResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      const remoteRun = await ctx.subagents.start('reused-provider', {
        parent: parent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })

      remoteResult.resolve({ output: [{ type: 'text', text: 'remote' }], stopReason: 'completed' })
      await remoteRun.result
      await Promise.resolve()
      expect(transport.notifications.some(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.lastAssistantMessage !== undefined,
      )).toBe(false)

      await child.dispose()
      localResult.resolve({ output: [{ type: 'text', text: 'local' }], stopReason: 'completed' })
      await localRun.result
      await Promise.resolve()
      expect(transport.notifications.filter(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.childSessionId === 'provider-reuse-child',
      )).toEqual([{
        method: 'subagent.finished',
        params: {
          provider: 'reused-provider',
          agentId: 'provider-reuse-child',
          parentSessionId: 'provider-reuse-parent',
          childSessionId: 'provider-reuse-child',
          status: 'ok',
          stopReason: 'completed',
          lastAssistantMessage: [{ type: 'text', text: 'local' }],
        },
      }])

      await localRun.dispose()
      await remoteRun.dispose()
      unregisterRemote()
      await parent.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('uses the recorded local flag when start was missed and ignores remote runs', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-fallback-'))
    const ctx = await makeHarness(storageDir)
    let parentHandle: AgentHandle | undefined
    let handle: AgentHandle | undefined
    let failedHandle: AgentHandle | undefined
    try {
      parentHandle = await ctx.agents.create({
        sessionId: SessionId('fallback-parent'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      handle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('fallback-child-session'),
        meta: { cwd: storageDir, parentSession: SessionId('fallback-parent') },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
        parentAgent: parentHandle.agent,
      })
      const fallbackChild = handle.agent
      failedHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('failed-child-session'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
        parentAgent: parentHandle.agent,
      })
      const missedStartResult = Promise.withResolvers<SubagentResult>()
      const disposeMissedStartProvider = ctx.subagents.registerProvider({
        name: 'fork',
        capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: true,
        start: () => Promise.resolve({
          id: SessionId('fallback-child-session'),
          localAgent: fallbackChild,
          result: missedStartResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      // Start before the server subscribes. The terminal payload still carries
      // this run's exact local child without reconstructing it from ids.
      const missedStartRun = await ctx.subagents.start('fork', {
        parent: parentHandle.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport, { maxTokensAsSuccess: true })

      missedStartResult.resolve({ output: [], stopReason: 'max-tokens' })
      await missedStartRun.result
      await Promise.resolve()
      await missedStartRun.dispose()
      disposeMissedStartProvider()
      // The server also missed this agent's creation but sees the exact child
      // on the run lifecycle payload.
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork-live-fallback',
        id: SessionId('fallback-child-session'),
        localAgent: fallbackChild,
        stopReason: 'completed',
        lastAssistantMessage: [],
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork',
        id: SessionId('failed-child-session'),
        localAgent: failedHandle.agent,
        stopReason: 'error',
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork',
        id: SessionId('missing-child-agent'),
        localAgent: undefined,
        stopReason: 'error',
      })

      // A result without output omits lastAssistantMessage from the wire; it
      // never sends `[]`.
      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'fork',
          agentId: 'fallback-child-session',
          parentSessionId: 'fallback-parent',
          childSessionId: 'fallback-child-session',
          status: 'ok',
          stopReason: 'max-tokens',
        },
      })
      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'fork',
          agentId: 'failed-child-session',
          parentSessionId: 'fallback-parent',
          childSessionId: 'failed-child-session',
          status: 'error',
          stopReason: 'error',
        },
      })
      expect(transport.notifications.some(n =>
        n.method === 'subagent.finished'
        && n.params?.agentId === 'missing-child-agent',
      )).toBe(false)

      await server.shutdown()
    } finally {
      await handle?.dispose()
      await failedHandle?.dispose()
      await parentHandle?.dispose()
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not re-register an LLM adapter whose provider already has an owner', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-existing-llm-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    await ctx.plugin(LlmDeepSeek)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      const inspect = server as unknown as { hasAdapterFor(provider: string): boolean }

      expect(inspect.hasAdapterFor('deepseek-official')).toBe(true)
      expect(inspect.hasAdapterFor('missing-provider')).toBe(false)
      await server.initialize({ cwd: storageDir, provider: 'deepseek-official', model: 'preinstalled-model' })

      expect(ctx.get('llm')?.listProviders().filter(provider => provider.id === 'deepseek-official')).toEqual([{ id: 'deepseek-official', name: 'DeepSeek' }])
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('refuses the handshake when the default agent preset cannot mount', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-broken-preset-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    await ctx.plugin(LlmDeepSeek)
    try {
      ctx.provide('agentPresets', {
        resolve: async () => ({ id: 'sdk', broken: 'agent-instructions: $.maxBytes missing required value' }),
      })
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await expect(server.initialize({ cwd: storageDir, provider: 'deepseek-official', model: 'model' }))
        .rejects.toThrow(/default agent preset "sdk" cannot mount.*maxBytes/)

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('accepts the handshake when no agent preset registry is mounted', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-no-presets-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    await ctx.plugin(LlmDeepSeek)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await expect(server.initialize({ cwd: storageDir, provider: 'deepseek-official', model: 'model' }))
        .resolves.toMatchObject({ serverInfo: { name: 'deepseek-harness-sdk-runtime' } })

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('rejects a missing non-DeepSeek provider when an LLM service already exists', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-new-llm-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    await ctx.plugin(LlmDeepSeek)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await expect(server.initialize({ cwd: storageDir, provider: 'private', model: 'new-model' }))
        .rejects.toThrow('no adapter registered for provider "private"')

      expect(ctx.get('llm')?.listProviders()).toEqual([
        { id: 'deepseek-official', name: 'DeepSeek' },
      ])
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid initialize maxTokens %s at the wire boundary',
    async (maxTokens) => {
      const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-invalid-max-tokens-'))
      const ctx = await makeHarness(storageDir)
      try {
        const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
        await expect(server.initialize({
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'model',
          maxTokens,
        })).rejects.toThrow('initialize maxTokens must be a positive safe integer')
        await server.shutdown()
      } finally {
        await ctx.fiber.dispose()
        await rm(storageDir, { recursive: true, force: true })
      }
    },
  )

  it('rejects malformed initialize reasoningEffort values at the wire boundary', async () => {
    const ctx = new Context()
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    try {
      for (const reasoningEffort of ['', 42]) {
        await expect(server.handleRequest('initialize', {
          cwd: '.',
          provider: 'deepseek-official',
          model: 'model',
          reasoningEffort,
        })).rejects.toThrow('initialize reasoningEffort must be a non-empty string')
      }
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects an unavailable exact model during initialize', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-invalid-route-'))
    const ctx = await makeHarness(storageDir)
    class RejectingAdapter extends LlmAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.reject(new Error(`model unavailable: ${provider}/${model}`))
      }

      async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        throw new Error('unreachable')
      }
    }
    const disposeAdapter = ctx.llm.registerAdapter(['private'], new RejectingAdapter())
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      await expect(server.initialize({ cwd: storageDir, provider: 'private', model: 'missing' }))
        .rejects.toThrow('model unavailable: private/missing')
      await expect(server.prompt({
        sessionId: 'invalid-route',
        contentBlocks: [{ type: 'text', text: 'must not run' }],
      })).rejects.toThrow('SDK server is not initialized')
      expect((server as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0)
      await server.shutdown()
    } finally {
      disposeAdapter()
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('rejects prompts while exact-route initialization is pending', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-pending-route-'))
    const ctx = await makeHarness(storageDir)
    const resolution = Promise.withResolvers<LlmResolvedModelInfo>()
    const resolvedModel = { provider: 'private', id: 'selected', name: 'Selected' }
    let resolveModelCalled = false
    class PendingAdapter extends LlmAdapter {
      override resolveModel(): Promise<LlmResolvedModelInfo> {
        resolveModelCalled = true
        return resolution.promise
      }

      async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        throw new Error('unreachable')
      }
    }
    const disposeAdapter = ctx.llm.registerAdapter(['private'], new PendingAdapter())
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      const initialization = server.initialize({ cwd: storageDir, provider: 'private', model: 'selected' })
      await vi.waitFor(() => { expect(resolveModelCalled).toBe(true) })

      await expect(server.prompt({
        sessionId: 'too-early',
        contentBlocks: [{ type: 'text', text: 'must not run' }],
      })).rejects.toThrow('SDK server is not initialized')
      expect((server as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0)

      resolution.resolve(resolvedModel)
      await initialization
      await server.shutdown()
    } finally {
      resolution.resolve(resolvedModel)
      disposeAdapter()
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('rejects an unsupported reasoning effort during initialize', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-unsupported-reasoning-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      await expect(server.handleRequest('initialize', {
        cwd: storageDir,
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'impossible',
      })).rejects.toThrow('does not support reasoning effort "impossible"')
      expect((server as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0)
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('reports no adapter when the LLM service is absent', async () => {
    const ctx = new Context()
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
        hasAdapterFor(model: string): boolean
        shutdown(): Promise<Record<string, never>>
      }

      expect(server.hasAdapterFor('missing-model')).toBe(false)
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects unknown JSON-RPC runtime methods', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-unknown-'))
    const ctx = await makeHarness(storageDir)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await expect(server.handleRequest('does/not/exist', {}))
        .rejects
        .toThrow('unknown APUS Reflex Harness SDK runtime method: does/not/exist')

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('coalesces concurrent session creation and retries a failed creation', async () => {
    let resolveShared: ((handle: AgentHandle) => void) | undefined
    const sharedCreation = new Promise<AgentHandle>((resolve) => { resolveShared = resolve })
    const sharedHandle = { agent: {} as Agent, dispose: vi.fn(() => Promise.resolve()) }
    const retryHandle = { agent: {} as Agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn<(options: unknown) => Promise<AgentHandle>>()
      .mockReturnValueOnce(sharedCreation)
      .mockRejectedValueOnce(new Error('creation failed'))
      .mockResolvedValueOnce(retryHandle)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create, get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      getOrCreateSession(params: { sessionId: string; contentBlocks: [] }): Promise<{ handle: AgentHandle }>
      shutdown(): Promise<Record<string, never>>
    }

    const first = server.getOrCreateSession({ sessionId: 'shared', contentBlocks: [] })
    const second = server.getOrCreateSession({ sessionId: 'shared', contentBlocks: [] })
    expect(create).toHaveBeenCalledTimes(1)
    resolveShared?.(sharedHandle)
    const [firstRecord, secondRecord] = await Promise.all([first, second])
    expect(firstRecord).toBe(secondRecord)

    await expect(server.getOrCreateSession({ sessionId: 'retry', contentBlocks: [] })).rejects.toThrow('creation failed')
    await expect(server.getOrCreateSession({ sessionId: 'retry', contentBlocks: [] })).resolves.toMatchObject({ handle: retryHandle })
    expect(create).toHaveBeenCalledTimes(3)

    await server.shutdown()
    expect(sharedHandle.dispose).toHaveBeenCalledOnce()
    expect(retryHandle.dispose).toHaveBeenCalledOnce()
    await expect(server.getOrCreateSession({ sessionId: 'after-shutdown', contentBlocks: [] })).rejects.toThrow('SDK server is shutting down')
  })

  it('resolves a relative cwd before creating the session', async () => {
    const create = vi.fn<(options: unknown) => Promise<AgentHandle>>()
      .mockResolvedValue({ agent: {} as Agent, dispose: () => Promise.resolve() })
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create, get: () => undefined },
      // Name-aware: a stub that answers every service key would also answer
      // `agentPresets` with this object, which is not a preset registry.
      get: (name: string) => name === 'llm'
        ? { listProviders: () => [{ id: 'mock', name: 'Mock' }], resolveCallConfig }
        : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      initialize(params: { cwd: string; provider: string; model: string; reasoningEffort?: string; maxTokens?: number }): Promise<unknown>
      getOrCreateSession(params: { sessionId: string; contentBlocks: [] }): Promise<unknown>
      shutdown(): Promise<Record<string, never>>
    }

    await server.initialize({ cwd: '.', provider: 'mock', model: 'model', reasoningEffort: 'high', maxTokens: 123 })
    await server.getOrCreateSession({ sessionId: 'relative', contentBlocks: [] })

    expect(resolveCallConfig).toHaveBeenCalledWith({
      provider: 'mock',
      model: 'model',
      reasoningEffort: ReasoningEffortId('high'),
      maxTokens: 123,
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      meta: { cwd: process.cwd() },
      agentOptions: {
        provider: 'mock',
        model: 'model',
        reasoningEffort: ReasoningEffortId('high'),
        maxTokens: 123,
      },
    }))
    await server.shutdown()
  })

  it('settles every teardown and aggregates multiple failures', async () => {
    const firstDispose = vi.fn(() => { throw new Error('first teardown failed') })
    const secondDispose = vi.fn(() => Promise.reject(new Error('second teardown failed')))
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      sessions: Map<string, { handle: AgentHandle; lastTurnEnd: undefined; activePrompt: boolean }>
      shutdown(): Promise<Record<string, never>>
    }
    server.sessions.set('first', { handle: { agent: {} as Agent, dispose: firstDispose }, lastTurnEnd: undefined, activePrompt: false })
    server.sessions.set('second', { handle: { agent: {} as Agent, dispose: secondDispose }, lastTurnEnd: undefined, activePrompt: false })

    await expect(server.shutdown()).rejects.toThrow('SDK server teardown failed')
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(secondDispose).toHaveBeenCalledOnce()
  })

  it('stops a running agent, then settles, flushes, and only then disposes it on shutdown', async () => {
    const order: string[] = []
    const session = { id: SessionId('owned') } as unknown as Agent['session']
    const cancel = vi.fn(() => { order.push('cancel') })
    const agent = ({
      id: SessionId('owned'),
      session,
      status: 'running',
      cancel,
      whenIdle: vi.fn(async () => { order.push('whenIdle') }),
    } as unknown) as Agent
    const continuumMemory = {
      whenSettled: vi.fn(async () => { order.push('settled') }),
    }
    const sessions = {
      get: vi.fn(() => session),
      flush: vi.fn(async () => { order.push('flush') }),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      logger: { warn: vi.fn(), error: vi.fn() },
      agents: { create: vi.fn(), get: () => agent },
      get: (name: string) => name === 'continuumMemory' ? continuumMemory : name === 'sessions' ? sessions : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      sessions: Map<string, { handle: AgentHandle; cwd: string; agentPreset: undefined }>
      shutdown(): Promise<Record<string, never>>
    }
    server.sessions.set('owned', {
      handle: {
        agent,
        dispose: vi.fn(async () => { order.push('dispose') }),
      },
      cwd: '/tmp',
      agentPreset: undefined,
    })

    await server.shutdown()
    // The loop is stopped by this shutdown (as a disposed-cause cancel) while
    // the session and recorder are still mounted; settlement and durability
    // follow, and disposal is last.
    expect(order).toEqual(['cancel', 'whenIdle', 'settled', 'flush', 'dispose'])
    expect(cancel).toHaveBeenCalledWith({ kind: 'disposed' })
    expect(continuumMemory.whenSettled).toHaveBeenCalledWith(agent)
  })

  it('drains the dispatch recorder settlement queue for each session during shutdown', async () => {
    const order: string[] = []
    const whenSettled = vi.fn(async (sessionId: SessionId) => { order.push(`recorder:${String(sessionId)}`) })
    const sessions = {
      get: vi.fn(() => undefined),
      flush: vi.fn(async () => { order.push('flush') }),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      logger: { warn: vi.fn(), error: vi.fn() },
      agents: { create: vi.fn(), get: () => undefined },
      get: (name: string) => name === 'sessions' ? sessions : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      dispatchRecorder: unknown
      sessions: Map<string, { handle: AgentHandle; cwd: string; agentPreset: undefined }>
      shutdown(): Promise<Record<string, never>>
    }
    server.dispatchRecorder = Object.assign(() => { order.push('uninstall') }, { whenSettled })
    server.sessions.set('a', {
      handle: { agent: { id: SessionId('a') } as unknown as Agent, dispose: vi.fn(async () => { order.push('dispose:a') }) },
      cwd: '/tmp',
      agentPreset: undefined,
    })
    server.sessions.set('b', {
      handle: { agent: { id: SessionId('b') } as unknown as Agent, dispose: vi.fn(async () => { order.push('dispose:b') }) },
      cwd: '/tmp',
      agentPreset: undefined,
    })

    await server.shutdown()
    expect(whenSettled.mock.calls.map(([sessionId]) => String(sessionId)).sort()).toEqual(['a', 'b'])
    // Settlement records are drained while the recorder is still installed;
    // uninstalling is the last recorder action.
    expect(order.indexOf('uninstall')).toBeGreaterThan(order.indexOf('recorder:a'))
    expect(order.indexOf('uninstall')).toBeGreaterThan(order.indexOf('recorder:b'))
  })

  it('continues teardown after a subscription disposer fails', async () => {
    let subscription = 0
    const listenerFailure = new Error('listener teardown failed')
    const on = vi.fn(() => {
      subscription += 1
      return subscription === 1 ? () => { throw listenerFailure } : () => undefined
    })
    const ctx = {
      on,
      agents: { create: vi.fn(), get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    await expect(server.shutdown()).rejects.toBe(listenerFailure)
    expect(on).toHaveBeenCalledTimes(4)
  })
  it('cancels one active session and leaves the other running', async () => {
    const idle = Promise.withResolvers<undefined>()
    const mainCancel = vi.fn<Agent['cancel']>()
    const mainWhenIdle = vi.fn(() => idle.promise)
    const mainAgent = ({
      id: SessionId('main'),
      status: 'running',
      followup: vi.fn(),
      cancel: mainCancel,
      whenIdle: mainWhenIdle,
    } satisfies Pick<Agent, 'id' | 'status' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const otherCancel = vi.fn<Agent['cancel']>()
    const otherAgent = ({
      id: SessionId('other'),
      status: 'running',
      followup: vi.fn(),
      cancel: otherCancel,
      whenIdle: vi.fn(() => Promise.resolve()),
    } satisfies Pick<Agent, 'id' | 'status' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const liveAgents = new Map<string, Agent>([['main', mainAgent], ['other', otherAgent]])
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async (options: { sessionId: SessionId }) => ({
          agent: String(options.sessionId) === 'main' ? mainAgent : otherAgent,
          dispose: vi.fn(() => Promise.resolve()),
        })),
        get: (id: SessionId) => liveAgents.get(String(id)),
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    ;(server as unknown as { initialized: boolean }).initialized = true
    await server.prompt({ sessionId: 'main', contentBlocks: [{ type: 'text', text: 'work' }] })
    await server.prompt({ sessionId: 'other', contentBlocks: [{ type: 'text', text: 'work' }] })

    let settled = false
    const cancellation = server.cancel({ sessionId: 'main' }).then((result) => {
      settled = true
      return result
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    // The reply waits for the agent's own settlement, not just the request.
    expect(settled).toBe(false)
    idle.resolve(undefined)
    await expect(cancellation).resolves.toEqual({ sessionId: 'main', cancelled: true })
    expect(mainCancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(mainWhenIdle).toHaveBeenCalledOnce()
    expect(otherCancel).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('accepts a prompt sent after a cancellation and refuses one already in flight', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('pending'),
      status: 'idle',
      followup,
      cancel: vi.fn(),
      whenIdle: vi.fn(() => Promise.resolve()),
    } satisfies Pick<Agent, 'id' | 'status' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async () => ({ agent, dispose: vi.fn(() => Promise.resolve()) })),
        get: () => agent,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    ;(server as unknown as { initialized: boolean }).initialized = true

    // Cancelled before the session ever started: no agent exists yet.
    await expect(server.cancel({ sessionId: 'pending' })).resolves.toEqual({ sessionId: 'pending', cancelled: true })
    expect(followup).not.toHaveBeenCalled()
    // A prompt sent after the cancellation starts a new generation and runs,
    // so one case session can be reused for its next step.
    await server.prompt({ sessionId: 'pending', contentBlocks: [{ type: 'text', text: 'next step' }] })
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('refuses a prompt that was still being prepared when the cancel arrived', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('racing'),
      status: 'idle',
      followup,
      cancel: vi.fn(),
      whenIdle: vi.fn(() => Promise.resolve()),
    } satisfies Pick<Agent, 'id' | 'status' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const admission = Promise.withResolvers<undefined>()
    const saveImages = vi.fn(async () => {
      await admission.promise
      return [{ attachmentId: 'sha256:pending', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }]
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async () => ({ agent, dispose: vi.fn(() => Promise.resolve()) })),
        get: () => agent,
      },
      get: (name: string) => name === 'attachments' ? { saveImages } : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    ;(server as unknown as { initialized: boolean }).initialized = true

    const pending = server.prompt({
      sessionId: 'racing',
      contentBlocks: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
    })
    await vi.waitFor(() => { expect(saveImages).toHaveBeenCalledOnce() })
    // Cancel lands while the prompt awaits attachment admission.
    const cancel = server.cancel({ sessionId: 'racing' })
    admission.resolve(undefined)
    await expect(pending).rejects.toThrow('cancelled while this prompt was in flight')
    await expect(cancel).resolves.toEqual({ sessionId: 'racing', cancelled: true })
    expect(followup).not.toHaveBeenCalled()
    // The next prompt belongs to a later generation and is accepted.
    await server.prompt({ sessionId: 'racing', contentBlocks: [{ type: 'text', text: 'retry' }] })
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('reports the cancelled session idle only after its observed admissions settle and flush', async () => {
    const observed = Promise.withResolvers<undefined>()
    const flush = Promise.withResolvers<undefined>()
    const order: string[] = []
    let status: 'running' | 'idle' = 'running'
    const session = { id: SessionId('draining') } as unknown as Agent['session']
    const listeners = new Map<string, (payload: { agent: Agent; status: 'running' | 'idle' }) => void>()
    const agent = ({
      id: SessionId('draining'),
      get status(): 'running' | 'idle' { return status },
      session,
      followup: vi.fn(),
      cancel: vi.fn(),
      whenIdle: vi.fn(async () => {
        order.push('whenIdle')
        status = 'idle'
        // The loop publishes the idle transition at this point.
        listeners.get('agent/status')?.({ agent, status: 'idle' })
      }),
    } satisfies Pick<Agent, 'id' | 'status' | 'session' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const continuumMemory = {
      whenSettled: vi.fn(async () => { order.push('whenSettled'); await observed.promise }),
    }
    const sessions = {
      get: vi.fn(() => session),
      flush: vi.fn(async () => { order.push('flush'); await flush.promise }),
    }
    const ctx = {
      on: vi.fn((name: string, listener: (payload: { agent: Agent; status: 'running' | 'idle' }) => void) => {
        listeners.set(name, listener)
        return () => { listeners.delete(name) }
      }),
      logger: { warn: vi.fn() },
      agents: {
        create: vi.fn(async () => ({ agent, dispose: vi.fn(() => Promise.resolve()) })),
        get: () => agent,
      },
      get: (name: string) => name === 'continuumMemory' ? continuumMemory : name === 'sessions' ? sessions : undefined,
    } as unknown as Context
    const transport = new FakeTransport()
    const server = new HarnessSdkJsonRpcServer(ctx, transport)
    ;(server as unknown as { initialized: boolean }).initialized = true
    await server.prompt({ sessionId: 'draining', contentBlocks: [{ type: 'text', text: 'work' }] })

    let settled = false
    const cancellation = server.cancel({ sessionId: 'draining' }).then((result) => { settled = true; return result })
    await vi.waitFor(() => { expect(order).toEqual(['whenIdle', 'whenSettled']) })
    // Settlement and durability precede the reported quiescence.
    expect(settled).toBe(false)
    expect(transport.notifications.filter(n => n.method === 'session.status')).toEqual([])
    observed.resolve(undefined)
    await vi.waitFor(() => { expect(order).toContain('flush') })
    expect(settled).toBe(false)
    flush.resolve(undefined)
    await expect(cancellation).resolves.toEqual({ sessionId: 'draining', cancelled: true })
    expect(order).toEqual(['whenIdle', 'whenSettled', 'flush'])
    await vi.waitFor(() => {
      expect(transport.notifications.filter(n => n.method === 'session.status')).toEqual([
        { method: 'session.status', params: { sessionId: 'draining', status: 'idle', settlement: 'settled' } },
      ])
    })
    // The listener shared the cancel's single drain instead of awaiting again.
    expect(continuumMemory.whenSettled).toHaveBeenCalledOnce()
    expect(sessions.flush).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('holds the idle notification until a real turn\'s dispatch settlement record and log flush exist', { timeout: 20_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-settled-idle-'))
    const llmServer = await mockCompletionServer()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport, { recordLlmDispatch: true })
      await server.initialize({ cwd: storageDir, provider: 'deepseek-official', model: 'dsagent-model' })
      await server.prompt({ sessionId: 'settled-idle', contentBlocks: [{ type: 'text', text: 'fix it' }] })

      // The idle status is published only after the recorder's queued
      // settlement record exists, so the advertised barrier is observable.
      await vi.waitFor(() => {
        expect(transport.notifications.findLast(n => n.method === 'session.status')).toEqual({
          method: 'session.status',
          params: { sessionId: 'settled-idle', status: 'idle', settlement: 'settled' },
        })
      }, { timeout: 10_000 })
      const session = ctx.sessions.get(SessionId('settled-idle'))
      if (session === undefined) throw new Error('the SDK session is not live')
      const events = session.snapshotEvents()
      const dispatch = events.find(event => event.type === 'llm/dispatch')
      expect(dispatch).toBeDefined()
      expect(events.some(event => event.type === 'llm/dispatch-settled'
        && event.data.dispatchSeq === (dispatch as { seq: number }).seq)).toBe(true)
      // 屏障成功本身只是通知上的一个词；要能回答“已持久化到哪里”，这份事实
      // 必须落在会话日志里，读者才能从原生日志核对，而不是信任一次回调。
      const flush = events.find(event => event.type === 'session/flushed')
      expect(flush).toBeDefined()
      expect((flush as { data: { sessionId: string; throughSeq: number } }).data.sessionId)
        .toBe('settled-idle')
      const reported = (flush as { data: { throughSeq: number } }).data.throughSeq
      expect(reported).toBeGreaterThanOrEqual((events.at(-1) as { seq: number }).seq - 1)
      // 覆盖范围必须真的在存储里：读回已落盘的日志，确认报告到的那一条确实存在，
      // 且确认记录作为“落盘证据”本身也已被保存，而不是只在内存里。
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) throw new Error('this harness must mount session persistence')
      const handle = await persistence.open(SessionId('settled-idle'), 'read')
      try {
        const stored = await handle.read(0)
        const storedSeqs = new Set(stored.events.map(event => Number(event.seq)))
        expect(storedSeqs.has(reported)).toBe(true)
        // 确认记录本身也要真的落到存储里：它只是“报告已落盘到哪”，
        // 若自身没保存，重启后这段结论就消失了。
        const storedFlush = stored.events.find(event => event.type === 'session/flushed')
        expect(storedFlush).toBeDefined()
        expect(Number(storedFlush?.seq)).toBeGreaterThan(reported)
      } finally {
        await handle.close()
      }
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('starts a fresh settlement pass for work that began after an earlier idle drain', async () => {
    const first = Promise.withResolvers<undefined>()
    const calls: number[] = []
    let call = 0
    const session = { id: SessionId('two-turns') } as unknown as Agent['session']
    let status: 'running' | 'idle' = 'running'
    const listeners = new Map<string, (payload: { agent: Agent; status: 'running' | 'idle' }) => void>()
    const agent = ({
      id: SessionId('two-turns'),
      session,
      get status(): 'running' | 'idle' { return status },
      followup: vi.fn(),
      cancel: vi.fn(),
      whenIdle: vi.fn(() => Promise.resolve()),
    } satisfies Pick<Agent, 'id' | 'status' | 'session' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const continuumMemory = {
      whenSettled: vi.fn(() => {
        call += 1
        calls.push(call)
        // The first turn's admissions drain slowly; the second turn's settle
        // must not be answered by that same pass.
        return call === 1 ? first.promise : Promise.resolve()
      }),
    }
    const flush = vi.fn(() => Promise.resolve())
    const sessions = { get: vi.fn(() => session), flush }
    const ctx = {
      on: vi.fn((name: string, listener: (payload: { agent: Agent; status: 'running' | 'idle' }) => void) => {
        listeners.set(name, listener)
        return () => { listeners.delete(name) }
      }),
      logger: { warn: vi.fn(), error: vi.fn() },
      agents: { create: vi.fn(async () => ({ agent, dispose: vi.fn(() => Promise.resolve()) })), get: () => agent },
      get: (name: string) => name === 'continuumMemory' ? continuumMemory : name === 'sessions' ? sessions : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport(), { settlementTimeoutMs: 500 })
    ;(server as unknown as { initialized: boolean }).initialized = true
    await server.prompt({ sessionId: 'two-turns', contentBlocks: [{ type: 'text', text: 'first' }] })

    listeners.get('agent/status')?.({ agent, status: 'idle' })
    await vi.waitFor(() => { expect(continuumMemory.whenSettled).toHaveBeenCalledOnce() })
    // A new turn starts while the first drain is still waiting.
    status = 'running'
    listeners.get('agent/status')?.({ agent, status: 'running' })
    status = 'idle'
    listeners.get('agent/status')?.({ agent, status: 'idle' })

    await vi.waitFor(() => { expect(continuumMemory.whenSettled).toHaveBeenCalledTimes(2) })
    first.resolve(undefined)
    await server.shutdown()
  })

  it('reports a failed settlement on the idle notification and refuses a clean shutdown when the flush rejects', async () => {
    const flushFailure = new Error('flush failed')
    const session = { id: SessionId('flush-fails') } as unknown as Agent['session']
    let status: 'running' | 'idle' = 'running'
    const listeners = new Map<string, (payload: { agent: Agent; status: 'running' | 'idle' }) => void>()
    const agent = ({
      id: SessionId('flush-fails'),
      session,
      get status(): 'running' | 'idle' { return status },
      followup: vi.fn(),
      cancel: vi.fn(),
      whenIdle: vi.fn(async () => {
        status = 'idle'
        listeners.get('agent/status')?.({ agent, status: 'idle' })
      }),
    } satisfies Pick<Agent, 'id' | 'status' | 'session' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const sessions = {
      get: vi.fn(() => session),
      flush: vi.fn(() => Promise.reject(flushFailure)),
    }
    const ctx = {
      on: vi.fn((name: string, listener: (payload: { agent: Agent; status: 'running' | 'idle' }) => void) => {
        listeners.set(name, listener)
        return () => { listeners.delete(name) }
      }),
      logger: { warn: vi.fn(), error: vi.fn() },
      agents: { create: vi.fn(async () => ({ agent, dispose: vi.fn(() => Promise.resolve()) })), get: () => agent },
      get: (name: string) => name === 'continuumMemory'
        ? { whenSettled: vi.fn(() => Promise.resolve()) }
        : name === 'sessions' ? sessions : undefined,
    } as unknown as Context
    const transport = new FakeTransport()
    const server = new HarnessSdkJsonRpcServer(ctx, transport)
    ;(server as unknown as { initialized: boolean }).initialized = true
    await server.prompt({ sessionId: 'flush-fails', contentBlocks: [{ type: 'text', text: 'work' }] })

    await expect(server.cancel({ sessionId: 'flush-fails' })).rejects.toBe(flushFailure)
    // The loop stopped, so idle still goes out, but it is marked as unproven.
    await vi.waitFor(() => {
      expect(transport.notifications.filter(n => n.method === 'session.status')).toEqual([
        { method: 'session.status', params: { sessionId: 'flush-fails', status: 'idle', settlement: 'failed' } },
      ])
    })
    expect(ctx.logger.error).toHaveBeenCalled()
    // Shutdown re-drains the same session and reports the durability failure.
    await expect(server.shutdown()).rejects.toBe(flushFailure)
  })

  it('fails a settlement barrier that exceeds its bound instead of hanging', async () => {
    const session = { id: SessionId('slow') } as unknown as Agent['session']
    const agent = ({
      id: SessionId('slow'),
      session,
      status: 'idle',
      followup: vi.fn(),
      cancel: vi.fn(),
      whenIdle: vi.fn(() => Promise.resolve()),
    } satisfies Pick<Agent, 'id' | 'status' | 'session' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const neverSettled = Promise.withResolvers<undefined>()
    const sessions = { get: vi.fn(() => session), flush: vi.fn(() => neverSettled.promise) }
    const ctx = {
      on: vi.fn(() => () => undefined),
      logger: { warn: vi.fn(), error: vi.fn() },
      agents: { create: vi.fn(async () => ({ agent, dispose: vi.fn(() => Promise.resolve()) })), get: () => agent },
      get: (name: string) => name === 'sessions' ? sessions : undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport(), { settlementTimeoutMs: 20 })
    ;(server as unknown as { initialized: boolean }).initialized = true
    await server.prompt({ sessionId: 'slow', contentBlocks: [{ type: 'text', text: 'work' }] })

    await expect(server.cancel({ sessionId: 'slow' }))
      .rejects.toThrow('did not settle and flush within 20ms')
    await expect(server.shutdown()).rejects.toThrow('did not settle and flush within 20ms')
  })

  it('reports a cancellation failure instead of claiming success', async () => {
    const failure = new Error('agent did not stop')
    const agent = ({
      id: SessionId('stuck'),
      status: 'running',
      followup: vi.fn(),
      cancel: vi.fn(),
      whenIdle: vi.fn(() => Promise.reject(failure)),
    } satisfies Pick<Agent, 'id' | 'status' | 'followup' | 'cancel' | 'whenIdle'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(async () => handle), get: () => agent },
      get: () => undefined,
    } as unknown as Context
    const transport = new FakeTransport()
    const server = new HarnessSdkJsonRpcServer(ctx, transport)
    ;(server as unknown as { initialized: boolean }).initialized = true
    await server.prompt({ sessionId: 'stuck', contentBlocks: [{ type: 'text', text: 'work' }] })

    await expect(server.handleRequest('session/cancel', { sessionId: 'stuck' })).rejects.toBe(failure)
    // Shutdown stops the same stuck loop and must not report a clean teardown:
    // the agent never reached quiescence, so its facts were never settled.
    await expect(server.shutdown()).rejects.toBe(failure)
    expect(handle.dispose).toHaveBeenCalledOnce()
  })

  it('rejects a session/cancel without a non-empty sessionId', async () => {
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    ;(server as unknown as { initialized: boolean }).initialized = true

    await expect(server.handleRequest('session/cancel', {})).rejects.toThrow('non-empty sessionId')
    await expect(server.handleRequest('session/cancel', { sessionId: '' })).rejects.toThrow('non-empty sessionId')
    await expect(server.handleRequest('session/cancel', undefined)).rejects.toThrow('non-empty sessionId')
    await server.shutdown()
  })

  it('stops only the cancelled session while a second real session keeps streaming', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-cancel-'))
    const ctx = await makeHarness(storageDir)
    const started = new Map<string, () => void>()
    const gates = new Map<string, () => void>()
    class GatedAdapter extends LlmAdapter {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const sessionId = String(options.sessionId)
        const begin = Promise.withResolvers<undefined>()
        const gate = Promise.withResolvers<undefined>()
        started.set(sessionId, () => begin.resolve(undefined))
        gates.set(sessionId, () => gate.resolve(undefined))
        begin.resolve(undefined)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        await Promise.race([
          gate.promise,
          new Promise<void>((_resolve, reject) => {
            if (options.signal?.aborted) { reject(new Error('aborted')); return }
            options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
          }),
        ])
        yield { type: 'text-delta', index: 0, text: 'done' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const disposeAdapter = ctx.llm.registerAdapter(['gated'], new GatedAdapter())
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      await server.initialize({ cwd: storageDir, provider: 'gated', model: 'gated' })
      const waiting = (sessionId: string) => new Promise<void>((resolve) => {
        const exam = setInterval(() => {
          if (started.has(sessionId)) { clearInterval(exam); resolve() }
        }, 5)
      })

      const firstStart = waiting('first')
      const secondStart = waiting('second')
      await Promise.all([
        server.prompt({ sessionId: 'first', contentBlocks: [{ type: 'text', text: 'long work' }] }),
        server.prompt({ sessionId: 'second', contentBlocks: [{ type: 'text', text: 'other work' }] }),
      ])
      await Promise.all([firstStart, secondStart])

      await expect(server.handleRequest('session/cancel', { sessionId: 'first' }))
        .resolves.toEqual({ sessionId: 'first', cancelled: true })

      const firstEnding = transport.notifications.findLast(notification =>
        notification.method === 'session.event'
        && notification.params?.sessionId === 'first'
        && (notification.params.event as { type?: string } | undefined)?.type === 'turn/end')
      expect((firstEnding?.params?.event as { data?: { reason?: unknown } } | undefined)?.data?.reason)
        .toEqual({ kind: 'aborted', reason: { kind: 'user' } })

      // The second session never observed an abort: its gate is still open.
      expect(gates.has('second')).toBe(true)
      const secondIdleBefore = transport.notifications.filter(notification =>
        notification.method === 'session.status'
        && notification.params?.sessionId === 'second'
        && notification.params.status === 'idle')
      expect(secondIdleBefore).toHaveLength(0)

      gates.get('second')?.()
      await vi.waitFor(() => {
        expect(transport.notifications.some(notification =>
          notification.method === 'session.status'
          && notification.params?.sessionId === 'second'
          && notification.params.status === 'idle')).toBe(true)
      })
      await server.shutdown()
    } finally {
      disposeAdapter()
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

})
