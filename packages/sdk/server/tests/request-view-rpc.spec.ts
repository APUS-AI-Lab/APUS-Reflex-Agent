/**
 * C09A: SDK server exposure of the recorded dispatch facts and read-only
 * request views. The runtime serves these only when the deployment enabled the
 * dispatch recorder; otherwise the capability is absent and both methods are
 * refused by name.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { currentSessionMessageProjections } from '@deepseek-ai/dsh-session-format-catalog/message-projections'
import { SDK_REQUEST_VIEW_CAPABILITY } from '@deepseek-ai/dsh-sdk-protocol'
import type { JsonRpcTransportPeer } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'

const storageDirs: string[] = []

afterEach(async () => {
  await Promise.all(storageDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

class FakeTransport implements JsonRpcTransportPeer {
  notifications: { method: string; params?: Record<string, unknown> }[] = []

  request(method: string, params: object): Promise<unknown> {
    return Promise.reject(new Error(`the SDK server should not call host method ${method} with ${JSON.stringify(params)}`))
  }

  notify(method: string, params?: object): void {
    this.notifications.push(params === undefined ? { method } : { method, params: params as Record<string, unknown> })
  }
}

class StubAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
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

async function makeHarness(adapter: LlmAdapter) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sdk-request-view-'))
  storageDirs.push(dir)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: dir })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, dir }
}

describe('SDK server request views', () => {
  it('advertises the request-view capability only when the recorder is installed', async () => {
    const adapter = new StubAdapter()
    const { ctx } = await makeHarness(adapter)
    try {
      const off = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      const initialize = await off.initialize({ cwd: process.cwd(), provider: 'mock', model: 'mock' })
      expect(initialize.capabilities).toBeUndefined()
      await expect(off.handleRequest('session/dispatches', { sessionId: 'x' }))
        .rejects.toThrow(/does not support read-only request views/)
      await off.shutdown()

      const on = new HarnessSdkJsonRpcServer(ctx, new FakeTransport(), { recordLlmDispatch: true })
      const enabled = await on.initialize({ cwd: process.cwd(), provider: 'mock', model: 'mock' }) as { capabilities?: string[] }
      expect(enabled.capabilities).toContain(SDK_REQUEST_VIEW_CAPABILITY)
      await on.shutdown()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('lists a session\'s recorded dispatches and rebuilds exactly one', async () => {
    const adapter = new StubAdapter()
    const { ctx } = await makeHarness(adapter)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport(), {
        recordLlmDispatch: true,
        requestViewProjections: currentSessionMessageProjections,
      })
      await server.initialize({ cwd: process.cwd(), provider: 'mock', model: 'mock' })
      await server.prompt({ sessionId: 'view-session', contentBlocks: [{ type: 'text', text: 'hello request view' }] })
      const agent = ctx.agents.get(SessionId('view-session'))
      if (agent === undefined) throw new Error('expected the SDK-created agent')
      await waitForIdle(ctx, agent)

      const listed = await server.handleRequest('session/dispatches', { sessionId: 'view-session' }) as {
        sessionId: string
        dispatches: { dispatchSeq: number; prefixEnd: number; turn: number; step: number }[]
      }
      expect(listed.sessionId).toBe('view-session')
      expect(listed.dispatches).toHaveLength(1)
      const dispatch = listed.dispatches[0]!

      const view = await server.handleRequest('session/request-view', {
        sessionId: 'view-session',
        dispatchSeq: dispatch.dispatchSeq,
      }) as { messages: unknown; header: { config: { model: string } }; dispatchSeq: number }
      expect(view.dispatchSeq).toBe(dispatch.dispatchSeq)
      expect(view.header.config.model).toBe('mock')
      expect(JSON.stringify(view.messages)).toContain('hello request view')
      // The rebuilt view matches what the provider adapter actually received.
      expect(view.messages).toEqual(adapter.requests[0]?.messages)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses malformed params and an unsupported projection by machine-readable code', async () => {
    const adapter = new StubAdapter()
    const { ctx } = await makeHarness(adapter)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport(), {
        recordLlmDispatch: true,
        // Deliberately omit the installed projections this log needs.
        requestViewProjections: [],
      })
      await server.initialize({ cwd: process.cwd(), provider: 'mock', model: 'mock' })
      await server.prompt({ sessionId: 'view-refusals', contentBlocks: [{ type: 'text', text: 'go' }] })
      const agent = ctx.agents.get(SessionId('view-refusals'))
      if (agent === undefined) throw new Error('expected the SDK-created agent')
      await waitForIdle(ctx, agent)

      await expect(server.handleRequest('session/dispatches', {}))
        .rejects.toThrow(/non-empty sessionId/)
      await expect(server.handleRequest('session/request-view', { sessionId: 'view-refusals' }))
        .rejects.toThrow(/dispatchSeq/)
      await expect(server.handleRequest('session/request-view', { sessionId: 'view-refusals', dispatchSeq: -1 }))
        .rejects.toThrow(/dispatchSeq/)
      await expect(server.handleRequest('session/request-view', { sessionId: 'missing', dispatchSeq: 0 }))
        .rejects.toMatchObject({ data: { code: 'SESSION_NOT_FOUND' } })
      // `session/dispatches` classifies an unknown session the same way, so a
      // client reads one code path for both methods.
      await expect(server.handleRequest('session/dispatches', { sessionId: 'missing' }))
        .rejects.toMatchObject({ data: { code: 'SESSION_NOT_FOUND' } })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
