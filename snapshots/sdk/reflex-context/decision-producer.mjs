/** Recorded SDK context projection: production policy and memory tool with a bounded local decision fixture. */
import { createServer } from 'node:http'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import System3 from '@deepseek-ai/dsh-experimental-system3'

export const name = 'snapshot-reflex-context-producer'
export const inject = ['sessions', 'sessionProjections', 'tokenMeter', 'tools', 'agents']
const travel = 'Archived tool output: the old travel diary says the Kyoto hotel was Sakura House, and breakfast was matcha pancakes. This trip is finished and unrelated to the current task.'

/** @param {import('@deepseek-ai/cordis').Context} ctx - Shipped SDK runtime services. */
export async function apply(ctx) {
  let requests = 0
  const originals = new Map()
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const query = JSON.parse(body)
    if (request.url !== '/v1/systemone' || query.model !== 'reflex-snapshot') {
      response.writeHead(400).end('unexpected Reflex request')
      return
    }
    if (query.questions.intent !== undefined) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'reflex-snapshot', answers: {
        intent: { type: 'choice', choice: 'switch', probabilities: { continue: 0, side: 0, switch: 1, unclear: 0 }, confidence: 1 },
        ...Object.fromEntries(['request', 'requirement', 'acceptance', 'interrupt', 'correction'].map(key => [key,
          { type: 'noul', noul: key === 'request' ? 1 : 0 }])),
      } }))
      return
    }
    requests += 1
    const answers = Object.fromEntries(query.state.fragments.map((fragment, index) => [`f${index}`, {
      type: 'noul', noul: fragment.text === travel && fragment.action === 'remove' ? 1 : 0,
    }]))
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'reflex-snapshot', answers }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  ctx.effect(() => () => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Reflex fixture has no port')
  await ctx.plugin(Jev, { endpoint: `http://127.0.0.1:${address.port}`, model: 'reflex-snapshot' })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'tool/result'
      && event.data.message.content.some(block => block.type === 'text' && block.text === travel)) {
      originals.set(session.id, event.seq)
    }
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const append = agent.session.append
    agent.session.append = function (type, data, ...options) {
      return append.call(this, type, type === 'system3/judgement' ? { ...data, elapsedMs: 0 } : data, ...options)
    }
    try { return await next() } finally { agent.session.append = append }
  })
  await ctx.plugin(System3, { jevExecutionDomain: 'local', jevRouteId: 'reflex-snapshot', taskFrame: {
    mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 2000, sessionDataClasses: ['public'], maxItems: 4, maxMessageChars: 2000,
  }, reflexContext: {
    mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 2000, sessionDataClasses: ['public'],
    maxCandidates: 16, maxRequestChars: 4000, maxFragmentChars: 1000, protectRecentMessages: 4,
    maxRestoredChars: 5000, maxSearchResults: 5,
  } })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'reflex_fixture_observation', description: 'Return one deterministic observation for the cache-preservation snapshot.',
    parameters: { index: { type: 'number', description: 'Observation index from one to five.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, output) => [{ type: 'text', text: output.text }] },
    execute: args => Promise.resolve({ text: args.index === 1 ? travel : `Relevant observation ${args.index}: keep the current finance constraints.` }),
    presentCall: () => ({ card: 'generic', title: 'Fixture observation', kind: 'other' }),
  })))
  let calls = 0
  let prefix
  ctx.on('llm/stream', async function* (options, next) {
    if (options.purpose !== undefined) { yield* next(); return }
    calls += 1
    if (prefix !== undefined && JSON.stringify(options.messages.slice(0, prefix.length)) !== JSON.stringify(prefix)) {
      throw new Error('Submitted prefix changed between adjacent requests')
    }
    prefix = structuredClone(options.messages)
    if (calls === 1) { yield* next(); return }
    if (calls === 2) {
      if (process.env.DSH_SNAPSHOT_FILE !== undefined) { for await (const chunk of next()) void chunk }
      for (let index = 0; index < 5; index += 1) {
        const id = ToolCallId(`cache-observation-${index}`)
        const args = JSON.stringify({ index: index + 1 })
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: 'reflex_fixture_observation', argumentsDelta: args }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'reflex_fixture_observation', arguments: args } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (calls === 3) {
      if (JSON.stringify(options.messages).includes(travel) || requests !== 1) throw new Error('Unsubmitted tool tail was not omitted')
      const session = ctx.sessions.get(options.sessionId)
      const seq = originals.get(session.id)
      if (seq === undefined) throw new Error('Original tool memory reference missing')
      if (process.env.DSH_SNAPSHOT_FILE !== undefined) { for await (const chunk of next()) void chunk }
      const id = ToolCallId('reflex-snapshot-restore')
      const args = JSON.stringify({ reference: `${seq}:0` })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'reflex_memory', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'reflex_memory', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (!options.messages.some(message => message.source?.kind === 'reflex-memory') || !JSON.stringify(options.messages).includes(travel)) {
      throw new Error('Frozen memory was not restored as appended context')
    }
    yield* next()
  })
}
