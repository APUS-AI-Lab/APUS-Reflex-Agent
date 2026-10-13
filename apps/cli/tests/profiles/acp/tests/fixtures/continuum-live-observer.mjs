/** Isolated live acceptance control and observation; every model call delegates unchanged. */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'continuum-live-observer'
export const inject = ['sessions', 'sessionPersistence', 'agents', 'compaction', 'continuumMemory']

/** Install a loopback control endpoint and record provider-neutral model inputs. */
export async function apply(ctx) {
  const directory = process.env.APUS_CONTINUUM_LIVE_STAGE
  const controlToken = process.env.APUS_CONTINUUM_LIVE_CONTROL
  if (!directory || !controlToken) throw new Error('live acceptance needs isolated stage and control settings')
  ctx.on('llm/stream', (options, next) => {
    const session = options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId)
    const auxiliary = options.purpose !== undefined
    const reconstructionMatches = auxiliary || session === undefined ? null
      : JSON.stringify(options.messages) === JSON.stringify(session.deriveMessages())
    appendFileSync(join(directory, 'requests.jsonl'), `${JSON.stringify({
      pid: process.pid, sessionId: options.sessionId, provider: options.provider, model: options.model,
      purpose: options.purpose ?? null, messages: options.messages, reconstructionMatches,
      capturedAt: new Date().toISOString(), evidence: 'provider-neutral-input-not-http-wire',
    })}\n`, { mode: 0o600 })
    if (!auxiliary && reconstructionMatches !== true) throw new Error('live request differs from durable Session derivation')
    return next()
  }, { global: true, prepend: true })
  await ctx.effect(async function* () {
    const server = createServer((request, response) => {
      const operation = async () => {
        if (request.headers.authorization !== `Bearer ${controlToken}`) throw new Error('control authorization rejected')
        const url = new URL(request.url, 'http://127.0.0.1')
        const agent = ctx.agents.get(url.searchParams.get('sessionId'))
        if (!agent) throw new Error('live session is not attached')
        let compaction
        if (request.method === 'POST' && url.pathname === '/compact') {
          compaction = await ctx.compaction.compactNow(agent, AbortSignal.timeout(180000))
          if (compaction === null) throw new Error('native compaction had no useful range')
        } else if (request.method !== 'GET' || url.pathname !== '/snapshot') {
          throw new Error('unknown control operation')
        }
        await ctx.sessions.flush(agent.session)
        const handle = await ctx.sessionPersistence.open(agent.session.id, 'read')
        let events
        try { ({ events } = await handle.read()) }
        finally { await handle[Symbol.asyncDispose]() }
        const body = { pid: process.pid, sessionId: agent.session.id, events,
          messages: agent.session.deriveMessages(), ...(compaction === undefined ? {} : { compaction }) }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      void operation().catch(error => {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      })
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('control listener did not bind TCP')
      await writeFile(join(directory, 'control.json'), JSON.stringify({ port: address.port, pid: process.pid }), { mode: 0o600 })
      yield () => new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeIdleConnections()
      })
    } catch (error) {
      await new Promise(resolve => server.close(resolve))
      throw error
    }
  }, 'live acceptance control')
}
