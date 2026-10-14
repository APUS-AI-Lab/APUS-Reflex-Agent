/** Scripted main model for the Continuum lossless headless e2e; its declared window forces compaction. */
import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type RequestMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const CONTEXT_WINDOW = 6_000
const CODE = /ALPHA-\d+/u

function messageText(message: RequestMessage): string {
  return 'content' in message ? message.content.map(block => block.type === 'text' ? block.text : '').join('\n') : ''
}

function * text(value: string): Iterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: value }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: value } }
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * Answers the code question from a Continuum recall in the request, else from a history search when the history
 * tools are offered, else reports that the code is unknown.
 */
class LosslessMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: CONTEXT_WINDOW } })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'compaction') {
      yield * text('The user shared an access code earlier and asked for padding replies.')
      return
    }
    const messages = options.messages
    const last = messages.at(-1)
    if (last !== undefined && 'role' in last && last.role === 'tool') {
      const found = CODE.exec(messageText(last))?.[0]
      yield * text(found === undefined ? 'History has no code.' : `From history: the code is ${found}.`)
      return
    }
    const toolCall = function * (name: string, args: unknown): Iterable<StreamChunk> {
      const call = { type: 'tool-call' as const, id: ToolCallId(`${name}-1`), name, arguments: JSON.stringify(args) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
    const offered = (name: string): boolean => options.tools?.some(tool => tool.name === name) === true
    const human = messages.filter(message => 'source' in message && message.source?.kind === 'user').at(-1)
    const latest = human === undefined ? '' : messageText(human)
    if (latest.includes('Remember the access code')) {
      yield * text('Noted.')
      return
    }
    if (latest.includes('What was the access code')) {
      const recalled = messages.filter(message => 'source' in message && message.source?.kind === 'continuum-memory').map(messageText).join('\n')
      const code = CODE.exec(recalled)?.[0]
      if (code !== undefined) {
        yield * text(`From memory: the code is ${code}.`)
        return
      }
      if (offered('history_search')) {
        yield * toolCall('history_search', { query: 'ALPHA-' })
        return
      }
      yield * text('I do not know the code.')
      return
    }
    if (latest.includes('Quote the original access-code message')) {
      // A recalled memory names its source event; the original is read from there.
      const event = /"eventSeq":(\d+)/u.exec(messages.map(messageText).join('\n'))?.[1]
      if (offered('history_read') && event !== undefined) {
        yield * toolCall('history_read', { event: Number(event) })
        return
      }
      yield * text('I do not know the code.')
      return
    }
    yield * text(`Acknowledged. ${'padding '.repeat(500)}`)
  }
}

export const name = 'lossless-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `lossless-mock` adapter.
 * @param ctx - plugin context with the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['lossless-mock'], new LosslessMockAdapter())
}
