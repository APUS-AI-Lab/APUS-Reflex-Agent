/** Real Jev HTTP scoring, durable dispatch evidence and complementary model input. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'

export const name = 'snapshot-continuum-relevance-fixture'
export const inject = ['sessionPersistence', 'llm']

const answer = { model: 'fixture-model', answers: {
  m0: { type: 'noul', noul: 0.05 }, m1: { type: 'noul', noul: 0.95 },
} }

/** @param {import('@deepseek-ai/cordis').Context} ctx Shipped SDK services. */
export async function apply(ctx) {
  let session
  let requests = 0
  const failures = []
  const server = createServer((request, response) => {
    void (async () => {
      assert.equal(request.url, '/v1/systemone')
      let body = ''
      for await (const chunk of request) body += chunk
      const wire = JSON.parse(body)
      assert.ok(session, 'source turn must precede ranking')
      const handle = await ctx.sessionPersistence.open(session.id, 'read')
      let events
      try {
        events = (await handle.read()).events
      } finally {
        await handle.close()
      }
      const prepared = events.findLast(event => event.type === 'continuum/memory-decision')
      assert.equal(prepared?.data.evaluation.phase, 'prepared')
      assert.equal(prepared.data.outcome, 'unknown')
      const { providerId, ...recordedBody } = prepared.data.evaluation.request
      assert.equal(providerId, 'fixture-provider')
      assert.deepEqual(wire, recordedBody)
      assert.deepEqual(Object.keys(wire.questions), ['m0', 'm1'])
      assert.ok(Object.values(wire.questions).every(question => question.type === 'noul'))
      assert.deepEqual(prepared.data.baselineIds, ['a', 'b'])
      requests += 1
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer))
    })().catch(error => {
      failures.push(String(error))
      response.writeHead(500).end('{}')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  ctx.effect(() => () => new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Jev fixture has no TCP port')
  await ctx.plugin(Jev, {
    endpoint: `http://127.0.0.1:${address.port}`, providerId: 'fixture-provider',
    model: 'fixture-model', protocol: 'openjev', effort: 'high',
  })
  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (session !== undefined) return
    session = agent.session
    const source = session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.ok(source)
    const memory = ctx.get('continuumMemory')
    assert.ok(memory)
    for (const [id, content] of [['a', 'Release PIN is 7319.'], ['b', 'Release date is Friday.']]) {
      memory.create(agent, { id, kind: 'fact', scope: 'workspace', content,
        sourceRefs: [{ sessionId: session.id, eventSeq: source.seq }] })
    }
  })
  ctx.on('llm/stream', (options, next) => {
    const latest = options.messages.findLast(message => message.source?.kind === 'user')
    if (latest?.content.some(block => block.type === 'text' && block.text === 'What are the release PIN and date?')) {
      assert.deepEqual(failures, [])
      assert.equal(requests, 1, JSON.stringify(session?.snapshotEvents().filter(event => event.type.startsWith('continuum/'))))
      const memory = options.messages.findLast(message => message.source?.kind === 'continuum-memory')
      assert.deepEqual(memory?.source.recordIds, ['b', 'a'])
      const text = memory.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      assert.ok(text.indexOf('Release date is Friday.') < text.indexOf('Release PIN is 7319.'))
      assert.ok(text.includes('Release PIN is 7319.') && text.includes('Release date is Friday.'))
      assert.ok(Buffer.byteLength(text) <= 2048)
      const receipts = session.snapshotEvents().filter(event => event.type === 'continuum/memory-decision')
      assert.deepEqual(receipts.map(event => event.data.evaluation.phase), ['prepared', 'settled'])
      const [prepared, settled] = receipts
      assert.equal(settled.data.evaluation.preparedSeq, prepared.seq)
      assert.deepEqual(settled.data.evaluation.request, prepared.data.evaluation.request)
      assert.deepEqual(settled.data.evaluation.response, answer)
      assert.deepEqual(settled.data.selectedIds, ['b', 'a'])
      assert.deepEqual(settled.data.evaluation.unscoredIds, [])
      assert.equal(settled.data.outcome, 'jev')
    }
    return next()
  })
}
