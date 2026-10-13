/** Read-only checks at the provider boundary; the real task service owns every saved entry. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const name = 'snapshot-continuum-task-request-check'
export const inject = ['llm']

function textOf(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/** @param {import('@deepseek-ai/cordis').Context} ctx Shipped SDK services. */
export function apply(ctx) {
  const sources = []
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
    sources.push({ sessionId: session.id, seq: event.seq, text: event.data.content[0].text })
  })
  ctx.on('llm/stream', (options, next) => {
    if (sources.length < 2) return next()
    const context = options.messages.findLast(message => message.source?.kind === 'runtime-context')
    assert.ok(context, 'follow-up must receive the persisted task context')
    const contextPage = textOf(context).split('\n').find(line => line.startsWith('{"taskId":'))
    assert.ok(contextPage)
    const adopted = JSON.parse(contextPage)
    assert.equal(adopted.taskId, 'snapshot-task')
    assert.ok(adopted.revision >= 1)
    assert.equal(adopted.entries[0].text, sources[0].text)
    assert.equal(adopted.entries[0].source.sessionId, sources[0].sessionId)
    assert.equal(adopted.entries[0].source.eventSeq, sources[0].seq)
    const result = options.messages.findLast(message => message.role === 'tool' && message.toolCallId === 'task-page-0')
    if (result !== undefined) {
      assert.ok(!result.isError, textOf(result))
      assert.ok(Buffer.byteLength(textOf(result)) <= 1024)
      const page = JSON.parse(textOf(result))
      assert.equal(page.revision, 2)
      assert.equal(page.pending, false)
      assert.equal(page.next, null)
      assert.equal(page.entries.length, 2)
      for (const [index, entry] of page.entries.entries()) {
        const source = sources[index]
        assert.equal(entry.text, source.text)
        assert.deepEqual(entry.source, {
          sessionId: source.sessionId, eventSeq: source.seq, blockIndex: 0,
          digest: createHash('sha256').update(source.text).digest('hex'),
        })
      }
    }
    return next()
  })
}
