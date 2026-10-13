/** Controlled keyless adapter: derive an artifact only from actual task tool responses. */
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

function* toolChunks(name, args, callId) {
  const id = ToolCallId(callId)
  const argumentsText = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

class TaskReadingAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF } }
  }

  async *stream(options) {
    const log = process.env.CONTINUUM_TASK_REQUEST_LOG
    assert.equal(typeof log, 'string')
    await appendFile(log, `${JSON.stringify({ sessionId: options.sessionId, purpose: options.purpose, messages: options.messages })}\n`)
    if (options.purpose === 'session-title') {
      yield* textChunks('Cross-session task recovery')
      return
    }
    assert.equal(options.purpose, undefined, 'this task fixture does not implement auxiliary compaction')
    if (process.env.CONTINUUM_TASK_PHASE === 'seed') {
      yield* textChunks('TASK_INPUT_STORED')
      return
    }
    const written = options.messages.find(message => message.role === 'tool' && message.toolCallId === 'task-artifact-write')
    if (written !== undefined) {
      assert.ok(!written.isError, textOf(written))
      yield* textChunks('TASK_ARTIFACT_WRITTEN')
      return
    }
    const results = options.messages.filter(message => message.role === 'tool' && String(message.toolCallId).startsWith('task-page-'))
    const pages = results.map(message => {
      assert.ok(!message.isError, textOf(message))
      const text = textOf(message)
      assert.ok(Buffer.byteLength(text) <= 8192)
      return JSON.parse(text)
    })
    const last = pages.at(-1)
    if (last === undefined || last.next !== null) {
      const cursor = last?.next
      yield* toolChunks('read_continuum_task', cursor === undefined ? {} : {
        entry_index: cursor.entryIndex, text_offset: cursor.textOffset, revision: cursor.revision,
      }, `task-page-${pages.length}`)
      return
    }
    const complete = new Map()
    for (const page of pages) {
      assert.equal(page.revision, last.revision)
      for (const part of page.entries) {
        const previous = complete.get(part.id)
        assert.equal(part.textOffset, previous?.text.length ?? 0)
        if (previous !== undefined) assert.deepEqual(part.source, previous.source)
        complete.set(part.id, { source: part.source, text: (previous?.text ?? '') + part.text })
      }
    }
    const priorInputs = [...complete.values()].filter(entry => entry.source.sessionId !== options.sessionId)
    assert.ok(priorInputs.length > 0, 'new Session must read at least one prior Session input')
    yield* toolChunks('write', {
      file_path: 'continued-task.json', content: JSON.stringify({ revision: last.revision, inputs: priorInputs }) + '\n',
    }, 'task-artifact-write')
  }
}

export const name = 'continuum-task-observer'
export const inject = ['llm']

/** @param {import('@deepseek-ai/cordis').Context} ctx Shipped model registry. */
export function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter(['continuum-task-test'], new TaskReadingAdapter()))
}
