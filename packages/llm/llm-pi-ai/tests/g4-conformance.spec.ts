/**
 * G4 provider-semantics conformance replay.
 *
 * Feeds every already-recorded native request view (messages/tools exactly as
 * the runtime rebuilt them) through the real pi-ai adapter against a local HTTP
 * mock, then reports what the provider actually received. The provider body is
 * the OpenAI protocol form, so the comparison covers the facts the model reads
 * — message roles, text, tool-call/result links and tool definitions — with
 * the recorded model parameters. Pre-send and HTTP-received bodies are captured
 * independently; neither includes authentication headers.
 *
 * `AE_G4_VIEW_FILE` holds either one view object or a list of them, each with
 * `sessionId`, `dispatchSeq`, `messages`, and optional `tools`. The output in
 * `AE_G4_OUT_FILE` is the `runtime_evidence` shape the trace auditor accepts:
 * one case per dispatch, plus the adapter/profile facts.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

interface RecordedView {
  sessionId: string
  dispatchSeq: number
  messages: GenerateOptions['messages']
  tools?: GenerateOptions['tools']
  header?: {
    config?: Pick<GenerateOptions, 'model' | 'maxTokens' | 'temperature' | 'reasoningEffort'>
  }
}

const VIEW_FILE = process.env.AE_G4_VIEW_FILE ?? ''
const OUT_FILE = process.env.AE_G4_OUT_FILE ?? ''
const MODEL = process.env.AE_G4_MODEL ?? 'deepseek-v4.1-flash'

/** Canonical JSON digest: the same normalization the trace auditor applies. */
const digest = (value: unknown): string => {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical)
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>).sort()
          .map(key => [key, canonical((input as Record<string, unknown>)[key])]),
      )
    }
    return input
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

const textOf = (content: unknown): string => typeof content === 'string'
  ? content
  : ((content as { type: string; text?: string }[] | undefined) ?? [])
    .filter(block => block.type === 'text').map(block => block.text ?? '').join('')

describe('G4 conformance replay', () => {
  // Replaying needs a view recorded by a real run; an ordinary test run has
  // none, and inventing one would defeat the purpose of external evidence.
  it.skipIf(VIEW_FILE === '')('sends the messages and tools each native view records', async () => {
    const parsed = JSON.parse(readFileSync(VIEW_FILE, 'utf8')) as RecordedView | RecordedView[]
    const views = Array.isArray(parsed) ? parsed : [parsed]
    expect(views.length).toBeGreaterThan(0)

    const cases: Record<string, unknown>[] = []
    for (const view of views) {
      const server = await mockServer([{ events: textEvents }])
      const ctx = new Context()
      const fetchImpl = globalThis.fetch
      let serialized: unknown
      const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        expect(request.url.startsWith(server.url)).toBe(true)
        serialized = await request.clone().json()
        return fetchImpl(input, init)
      })
      try {
        await ctx.plugin(LlmRuntime)
        await ctx.plugin(LlmPiAi, {
          providers: {
            gateway: {
              apiKeyEnv: 'AE_G4_KEY',
              baseURL: server.url,
              api: 'openai-completions',
              models: [{ id: MODEL, name: MODEL }],
            },
          },
        })
        vi.stubEnv('AE_G4_KEY', 'test-key')
        expect(view.header?.config?.model ?? MODEL).toBe(MODEL)
        await assemble(ctx, {
          ...view.header?.config,
          provider: 'gateway',
          model: MODEL,
          messages: view.messages,
          ...view.tools === undefined ? {} : { tools: view.tools },
        })
        const sent = server.requests[0] as {
          model?: string
          max_tokens?: number
          max_completion_tokens?: number
          temperature?: number
          reasoning_effort?: string
          messages?: {
            role: string
            content: unknown
            tool_call_id?: string
            reasoning_content?: string
            tool_calls?: { id: string; function: { name: string; arguments: string } }[]
          }[]
          tools?: { function?: { name: string; description: string; parameters: unknown } }[]
        } | undefined
        expect(serialized).toBeDefined()
        expect(sent).toBeDefined()
        expect(digest(serialized)).toBe(digest(sent))
        expect(sent?.model).toBe(MODEL)
        expect(sent?.messages?.map(message => message.role))
          .toEqual(view.messages.map(message => message.role))
        const nativeReasoning = view.messages.filter(message => message.role === 'assistant')
          .map(message => message.content.filter(block => block.type === 'reasoning')
            .filter(block => block.text.trim().length > 0).map(block => block.text).join('\n'))
        const sentReasoning = (sent?.messages ?? [])
          .filter(message => message.role === 'assistant')
          .map(message => message.reasoning_content ?? '')
        expect(sentReasoning).toEqual(nativeReasoning)
        const requestedEffort = view.header?.config?.reasoningEffort
        expect(sent?.reasoning_effort)
          .toBe(requestedEffort === 'off' ? undefined : requestedEffort)
        const nativeCalls = view.messages.flatMap(message =>
          Array.isArray(message.content)
            ? message.content.filter(block => block.type === 'tool-call')
              .map(block => [block.id, block.name,
                typeof block.arguments === 'string' ? JSON.parse(block.arguments) : block.arguments])
            : [])
        const sentCalls = (sent?.messages ?? []).flatMap(message =>
          (message.tool_calls ?? []).map(call =>
            [call.id, call.function.name, JSON.parse(call.function.arguments)]))
        expect(sentCalls).toEqual(nativeCalls)
        const nativeResults = view.messages.filter(message => message.role === 'tool')
          .map(message => message.toolCallId)
        expect((sent?.messages ?? []).filter(message => message.role === 'tool')
          .map(message => message.tool_call_id)).toEqual(nativeResults)
        if (view.header?.config?.maxTokens !== undefined) {
          expect(sent?.max_tokens ?? sent?.max_completion_tokens)
            .toBe(view.header.config.maxTokens)
        }
        if (view.header?.config?.temperature !== undefined) {
          expect(sent?.temperature).toBe(view.header.config.temperature)
        }
        const sentTexts = (sent?.messages ?? []).map(message => textOf(message.content))
        const viewTexts = view.messages.map(message => textOf(message.content))
        const sentTools = (sent?.tools ?? []).map(tool => [
          tool.function?.name, tool.function?.description, tool.function?.parameters,
        ])
        const viewTools = (view.tools ?? []).map(tool => [
          tool.name, tool.description, tool.parameters,
        ])
        const result = {
          dispatch: { sessionId: view.sessionId, dispatchSeq: view.dispatchSeq },
          replay_log: process.env.AE_G4_LOG_FILE || OUT_FILE || 'stdout',
          native_view_sha256: digest({ messages: view.messages, tools: view.tools ?? null }),
          serialized_body_sha256: digest(serialized),
          sent_body_sha256: digest(sent),
          view_message_count: viewTexts.length,
          sent_message_count: sentTexts.length,
          view_tool_count: viewTools.length,
          sent_tool_count: sentTools.length,
          reasoning_history_equal: JSON.stringify(nativeReasoning) === JSON.stringify(sentReasoning),
          reasoning_block_count: view.messages.reduce((count, message) => count
            + message.content.filter(block => block.type === 'reasoning').length, 0),
          reasoning_effort_requested: requestedEffort ?? null,
          messages_text_equal: JSON.stringify(viewTexts) === JSON.stringify(sentTexts),
          tools_semantics_equal: JSON.stringify(viewTools) === JSON.stringify(sentTools),
        }
        expect(result.messages_text_equal).toBe(true)
        expect(result.tools_semantics_equal).toBe(true)
        cases.push(result)
      } finally {
        transport.mockRestore()
        vi.unstubAllEnvs()
        try {
          await ctx.fiber.dispose()
        } finally {
          await closeMockServers()
        }
      }
    }

    const evidence = {
      adapter: { id: 'dsh-llm-pi-ai', profile: 'openai-completions',
        version: digest(readFileSync(new URL('../src/adapter.ts', import.meta.url), 'utf8')) },
      runtime: { source: 'packages/llm/llm-pi-ai/tests/g4-conformance.spec.ts',
        log: process.env.AE_G4_LOG_FILE || OUT_FILE || 'stdout' },
      transform_basis: ['chat-completions context mapping', 'tool schema projection'],
      cases,
    }
    if (OUT_FILE) writeFileSync(OUT_FILE, JSON.stringify(evidence, null, 2))
  })
})
