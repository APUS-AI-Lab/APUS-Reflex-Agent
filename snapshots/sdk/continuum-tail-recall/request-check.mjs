/** Verify the actual provider input before delegating to recorded model responses. */
import assert from 'node:assert/strict'

export const name = 'snapshot-continuum-tail-request-check'
export const inject = ['llm', 'agents']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Shipped SDK services. */
export function apply(ctx) {
  let originalId
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'continuum/memory-record' && event.data.record.content.endsWith('Quartzlaunch release code MERIDIAN-731.')) {
      originalId = event.data.record.id
    }
  })
  ctx.on('llm/stream', (options, next) => {
    const latest = options.messages.findLast(message => message.source?.kind === 'user')
    if (latest?.content.some(block => block.type === 'text' && block.text === 'Quartzlaunch')) {
      assert.equal(typeof originalId, 'string')
      const memory = options.messages.findLast(message => message.source?.kind === 'continuum-memory')
      assert.ok(memory)
      assert.ok(memory.source.recordIds.includes(originalId))
      assert.ok(memory.content.some(block => block.type === 'text'
        && block.text.includes(`[memory:${JSON.stringify(originalId)} revision:1`)
        && block.text.includes('Quartzlaunch release code MERIDIAN-731.')
        && block.text.includes('omitted:before')
        && !block.text.includes('背景资料。🌿')
        && !block.text.includes('\uFFFD')
        && Buffer.byteLength(block.text, 'utf8') <= 8192))
    }
    return next()
  })
}
