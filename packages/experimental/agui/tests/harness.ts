/** Real agent loop, JSONL persistence and a listening web server behind the AG-UI bridge. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { TestSessionQueryEngine } from '../../../session-query/session-query/tests/test-service.ts'
import * as AguiPlugin from '../src/index.ts'
import type { AguiEvent } from '../src/index.ts'

export const TOKEN = 'agui-test-token'

export interface AguiHarness {
  ctx: Context
  adapter: MockAdapter
  baseUrl: string
  /** Call the bridge with the test bearer token. */
  request(path: string, init?: RequestInit & { token?: string }): Promise<Response>
  /** Start a run and collect its events until the stream ends. */
  run(threadId: string, text: string, runId?: string, forwardedProps?: object): Promise<AguiEvent[]>
  /** Start a run and hand back the live event stream plus an abort handle. */
  openRun(threadId: string, text: string, runId?: string, forwardedProps?: object): Promise<{
    events: AguiEvent[]
    next(): Promise<AguiEvent | undefined>
    abort(): void
    done: Promise<void>
  }>
  dispose(): Promise<void>
}

export async function makeAguiHarness(
  script: ConstructorParameters<typeof MockAdapter>[0],
  overrides: Partial<AguiPlugin.Config> = {},
): Promise<AguiHarness> {
  process.env.AGUI_TEST_TOKEN = TOKEN
  const root = await mkdtemp(join(tmpdir(), 'dsh-agui-test-'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(ApprovalService, {})
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(AguiPlugin, {
    tokenEnv: 'AGUI_TEST_TOKEN',
    basePath: '/agui',
    provider: 'mock',
    model: 'mock',
    defaultCwd: root,
    maxBodyBytes: 1024 * 1024,
    refreshMcpServers: ['app'],
    mcpRefreshTimeoutMs: 3000,
    ...overrides,
  })
  const baseUrl = `http://127.0.0.1:${String(ctx.webServer.port)}/agui`

  const request: AguiHarness['request'] = (path, init = {}) => {
    const { token = TOKEN, ...rest } = init
    return fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...rest.headers as Record<string, string> | undefined },
    })
  }

  const openRun: AguiHarness['openRun'] = async (threadId, text, runId = `run-${String(Date.now())}`, forwardedProps = {}) => {
    const controller = new AbortController()
    const response = await request('/run', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({ threadId, runId, messages: [{ id: 'm1', role: 'user', content: text }], tools: [], context: [], state: {}, forwardedProps }),
    })
    if (response.status !== 200 || response.body === null) throw new Error(`run failed: ${String(response.status)} ${await response.text()}`)
    const events: AguiEvent[] = []
    const waiters: ((event: AguiEvent | undefined) => void)[] = []
    let finished = false
    let cursor = 0
    const push = (event: AguiEvent | undefined): void => {
      if (event !== undefined) events.push(event)
      const waiter = waiters.shift()
      if (waiter !== undefined) {
        if (event !== undefined) cursor += 1
        waiter(event)
      }
    }
    const done = (async () => {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { value, done: end } = await reader.read()
          if (end) break
          buffer += decoder.decode(value, { stream: true })
          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            for (const line of frame.split('\n')) if (line.startsWith('data:')) push(JSON.parse(line.slice(5).trim()) as AguiEvent)
            boundary = buffer.indexOf('\n\n')
          }
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) throw error
      } finally {
        finished = true
        while (waiters.length > 0) waiters.shift()!(undefined)
      }
    })()
    return {
      events,
      // Events that arrived before the caller asked are handed out first.
      next: () => {
        if (cursor < events.length) return Promise.resolve(events[cursor++])
        if (finished) return Promise.resolve(undefined)
        return new Promise((resolve) => { waiters.push(resolve) })
      },
      abort: () => { controller.abort() },
      done,
    }
  }

  return {
    ctx,
    adapter,
    baseUrl,
    request,
    openRun,
    run: async (threadId, text, runId, forwardedProps) => {
      const stream = await openRun(threadId, text, runId, forwardedProps)
      await stream.done
      return stream.events
    },
    dispose: async () => {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
