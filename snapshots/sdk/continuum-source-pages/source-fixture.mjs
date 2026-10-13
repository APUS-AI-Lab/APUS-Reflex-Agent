/** Seed exact history through public persistence and inspect actual model source pages. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const name = 'snapshot-continuum-source-fixture'
export const inject = ['sessionPersistence', 'llm']

/** @param {import('@deepseek-ai/cordis').Context} ctx Shipped persistence and model services. */
export async function apply(ctx) {
  const fixture = JSON.parse(await readFile(new URL('./source.seed.json', import.meta.url), 'utf8'))
  const cwd = process.env.DSH_SNAPSHOT_SOURCE_CWD
  assert.equal(typeof cwd, 'string')
  const header = { ...fixture.header, cwd }
  const handle = await ctx.sessionPersistence.create(header)
  try {
    await handle.append(fixture.events)
    await handle.flush()
  } finally {
    await handle.close()
  }
  const event = fixture.events.find(row => row.type === 'user/message')
  const digest = createHash('sha256').update(JSON.stringify(event, null, 2)).digest('hex')
  ctx.on('llm/stream', (options, next) => {
    const outputs = options.messages.filter(message => message.role === 'tool' && String(message.toolCallId).startsWith('source-page-'))
    const pages = outputs.map(message => {
      assert.ok(!message.isError)
      const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      assert.ok(Buffer.byteLength(text) <= 8192)
      const page = JSON.parse(text)
      assert.equal(page.sha256, digest)
      assert.equal(page.content, event.data.content[0].text.slice(page.offset, page.end))
      return page
    })
    if (pages.at(-1)?.next_offset === null) {
      assert.ok(pages.length > 1)
      assert.equal(pages.map(page => page.content).join(''), event.data.content[0].text)
    }
    return next()
  })
}
