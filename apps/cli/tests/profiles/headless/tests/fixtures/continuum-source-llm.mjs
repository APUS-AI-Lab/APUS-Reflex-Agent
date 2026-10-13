/** Keyless model boundary that reads source pages through the shipped tool path. */
import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { LlmAdapter, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

function textOf(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

function* textChunks(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function* readChunks(args, number) {
  const id = ToolCallId(`source-page-${number}`)
  const argumentsText = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name: 'session_event_read', argumentsDelta: argumentsText }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'session_event_read', arguments: argumentsText } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

class SourceReadingAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF } }
  }

  async *stream(options) {
    const log = process.env.CONTINUUM_REQUEST_LOG
    if (log) await appendFile(log, `${JSON.stringify(options.messages)}\n`)
    const scenario = process.env.CONTINUUM_SOURCE_SCENARIO ?? 'seed'
    if (scenario === 'seed') {
      yield* textChunks('SOURCE_STORED')
      return
    }
    const outputs = options.messages.filter(message => message.role === 'tool' && String(message.toolCallId).startsWith('source-page-'))
    const last = outputs.at(-1)
    if (last?.isError) {
      assert.ok(scenario === 'foreign' || scenario === 'bad-hash', textOf(last))
      assert.match(textOf(last), scenario === 'foreign' ? /outside the caller workspace/ : /Event changed/)
      yield* textChunks(scenario === 'foreign' ? 'SOURCE_DENIED' : 'SOURCE_CHANGE_REJECTED')
      return
    }
    const pages = outputs.map(message => {
      const text = textOf(message)
      assert.ok(Buffer.byteLength(text) <= 8192)
      return JSON.parse(text)
    })
    const previous = pages.at(-1)
    if (previous?.next_offset === null) {
      assert.ok(pages.length > 1)
      assert.equal(pages[0].offset, 0)
      for (let index = 1; index < pages.length; index++) {
        assert.equal(pages[index].offset, pages[index - 1].end)
        assert.equal(pages[index].sha256, pages[0].sha256)
      }
      assert.equal(pages.map(page => page.content).join('').length, previous.total)
      assert.ok(pages.map(page => page.content).join('').endsWith('Quartzlaunch exact tail MERIDIAN-731.\n'))
      yield* textChunks('SOURCE_RECONSTRUCTED')
      return
    }
    let source
    if (scenario === 'foreign') {
      source = { sessionId: process.env.CONTINUUM_TARGET_SESSION, eventSeq: Number(process.env.CONTINUUM_TARGET_SEQ) }
    } else {
      const recall = options.messages.findLast(message => message.source?.kind === 'continuum-memory')
      assert.ok(recall, 'source read must start from a real Continuum recall')
      const match = / sources:(\[.*?\]) record-content-utf16:/.exec(textOf(recall))
      assert.ok(match, 'recall must provide source references')
      source = JSON.parse(match[1])[0]
    }
    yield* readChunks({ session_id: source.sessionId, seq: source.eventSeq, view: 'text-block', block: 0,
      ...(previous ? { offset: previous.next_offset, expected_sha256: scenario === 'bad-hash' ? '0'.repeat(64) : previous.sha256 } : {}),
    }, outputs.length)
  }
}

export const name = 'continuum-source-llm'
export const inject = ['llm']

/** @param {import('@deepseek-ai/cordis').Context} ctx Shipped model registry. */
export function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter(['continuum-source'], new SourceReadingAdapter()))
}
