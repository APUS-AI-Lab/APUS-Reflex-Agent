import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, expandAssistantStream, LlmAdapter, LlmError, resolveRetryPolicy  } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { toStreamChunks } from '@deepseek-ai/dsh-llm-pi-ai/src/stream.ts'
import * as retry from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

class TransientOnceAdapter extends LlmAdapter {
  requests = 0
  private readonly retryPolicy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 1,
    retryableCodes: ['RATE_LIMIT', 'SERVER'],
    backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  }, 'loader test provider retryPolicy')

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.retryPolicy
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    if (this.requests === 1) throw new LlmError('temporary outage', 'SERVER')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'recovered' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'recovered' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-retry-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-llm-retry', retry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; first resolution after the host/client program split is slow enough
  // to trip the default 5s budget on cold caches.
  it('loads provider-supplied policy and records recovery through the shipping loop', { timeout: 60_000 }, async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-llm-retry'",
      "- name: '@deepseek-ai/dsh-agent-loop'",
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.agents).toBeInstanceOf(AgentRegistry)

    const adapter = new TransientOnceAdapter()
    loaded.llm.registerAdapter(['mock'], adapter)
    const agent = await loaded.agentLoop.create(SessionId('loader-retry'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'recover' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toBe(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry')).toHaveLength(1)
    expect(agent.session.deriveMessages().at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'recovered' }],
    })
  })
})

const terminalCloseMessage = 'websocket closed before terminal event (code1000)'
type PiEvent = Parameters<typeof toStreamChunks>[0] extends AsyncIterable<infer Event> ? Event : never

class TerminalCloseAdapter extends TransientOnceAdapter {
  constructor(private readonly failForever: boolean) { super() }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({
      mode: 'normal',
      maxRetries: 1,
      backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    }, 'terminal-close provider retryPolicy')
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.failForever && this.requests === 1) {
      yield* super.stream(options)
      return
    }
    this.requests += 1
    const toolCall = { type: 'toolCall' as const, id: 'failed-tool', name: 'danger', arguments: {} }
    const partial = {
      role: 'assistant' as const, content: [toolCall], api: 'openai-completions' as const,
      provider: 'mock', model: 'mock', timestamp: 0, stopReason: 'error' as const,
      errorMessage: terminalCloseMessage,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }
    async function* events(): AsyncGenerator<PiEvent> {
      yield { type: 'toolcall_start', contentIndex: 0, partial }
      yield { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial }
      yield { type: 'toolcall_end', contentIndex: 0, toolCall, partial }
      yield { type: 'error', reason: 'error', error: partial }
    }
    yield* toStreamChunks(events(), undefined, options.signal)
  }
}

describe('pi-ai terminal close through the real Loader and retry consumer', () => {
  it.each(['recover', 'exhaust', 'cancel'] as const)('%s preserves the provider retry budget and discards failed tools', { timeout: 60_000 }, async (outcome) => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-llm-retry'",
      "- name: '@deepseek-ai/dsh-agent-loop'",
    ])
    const adapter = new TerminalCloseAdapter(outcome !== 'recover')
    loaded.llm.registerAdapter(['mock'], adapter)
    let executions = 0
    loaded.tools.register(defineContentToolFixture({
      name: 'danger', description: 'must not execute a failed provider attempt', parameters: {},
      async execute() { executions += 1; return [{ type: 'text', text: 'unexpected' }] },
    }))
    const agent = await loaded.agentLoop.create(SessionId(`terminal-close-${outcome}`), { provider: 'mock', model: 'mock' })
    if (outcome === 'cancel') {
      loaded.on('session/event', (session, event) => {
        if (session === agent.session && event.type === 'llm/retry') agent.cancel({ kind: 'user' })
      })
    }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'recover safely' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    expect(adapter.requests).toBe(outcome === 'cancel' ? 1 : 2)
    expect(events.filter(event => event.type === 'llm/retry').map(event => event.data)).toEqual([
      expect.objectContaining({ retry: 1, maxRetries: 1, failure: { code: 'TRANSPORT', message: terminalCloseMessage } }),
    ])
    const failed = events.filter(event => event.type === 'assistant/attempt')
    expect(failed).toHaveLength(outcome === 'exhaust' ? 2 : 1)
    const failedChunks = failed.flatMap(event => expandAssistantStream(event.data.stream).map(item => item.chunk))
    expect(failedChunks.some(chunk => chunk.type === 'block-end'
      && chunk.block.type === 'tool-call' && chunk.block.name === 'danger')).toBe(true)
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(outcome === 'recover' ? 1 : 0)
    expect(events.some(event => event.type === 'tool/call')).toBe(false)
    expect(executions).toBe(0)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: outcome === 'recover'
      ? { kind: 'completed' } : outcome === 'cancel' ? { kind: 'aborted' }
        : { kind: 'error', error: { code: 'TRANSPORT', message: terminalCloseMessage } } } })
  })
})
