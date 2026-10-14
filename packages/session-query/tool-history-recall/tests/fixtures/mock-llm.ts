import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type RequestMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Declared window small enough that the fixture's padded turns force compaction. */
const CONTEXT_WINDOW = 6_000

const MARKERS = ['ALPHA-', 'What was the access code', 'Padding request', 'Remember the access code']

function messageText(message: RequestMessage): string {
  return 'content' in message ? message.content.map(block => block.type === 'text' ? block.text : '').join('\n') : ''
}

/** Text of the newest message carrying a scripted marker; injected context messages carry none. */
function lastText(messages: readonly RequestMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messageText(messages[index]!)
    if (!text.includes('<compacted-summary>') && MARKERS.some(marker => text.includes(marker))) return text
  }
  return ''
}

function allText(messages: readonly RequestMessage[]): string {
  return messages.map(messageText).join('\n')
}

function * text(value: string): Iterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: value }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: value } }
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * Scripted model: pads ordinary turns, summarizes without the secret, and answers the recall question by
 * searching compacted history when the secret is no longer in its context.
 */
class RecallMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: CONTEXT_WINDOW } })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'compaction') {
      yield * text('The user shared an access code earlier and asked for padding replies.')
      return
    }
    const latest = lastText(options.messages)
    if (latest.includes('ALPHA-')) {
      const code = /ALPHA-\d+/u.exec(latest)?.[0] ?? 'missing'
      yield * text(`The code is ${code}.`)
      return
    }
    if (latest.includes('What was the access code')) {
      if (/ALPHA-\d+/u.test(allText(options.messages))) {
        yield * text('The code is still in context.')
        return
      }
      const call = { type: 'tool-call' as const, id: ToolCallId('recall-1'), name: 'history_search', arguments: '{"query":"ALPHA-"}' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield * text(`Acknowledged. ${'padding '.repeat(500)}`)
  }
}

export const name = 'history-recall-mock-llm'
export const inject = ['llm']

/** Register the test-only `recall-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['recall-mock'], new RecallMockAdapter())
}
