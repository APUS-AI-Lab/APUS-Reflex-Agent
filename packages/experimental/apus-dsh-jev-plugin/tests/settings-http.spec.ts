/** Real local HTTP requests cover both decision protocols without external credentials. */
import { z } from 'zod'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it, onTestFinished } from 'vitest'
import { SystemOneProvider } from '../src/client.ts'
import { testReflexConnection } from '../src/settings.ts'

it.each(['openjev', 'typesafe'] as const)('uses matching probe and runtime HTTP requests for %s', async (protocol) => {
  const calls: { path: string | undefined; authorization: string | undefined; body: Record<string, unknown> }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf8')
      const body = z.record(z.string(), z.unknown()).parse(data ? JSON.parse(data) : {})
      calls.push({ path: request.url, authorization: request.headers.authorization, body })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/health') response.end('{"status":"ok"}')
      else if (request.url === '/v1/models') response.end('{"data":[{"id":"fixture"}]}')
      else if (request.url === '/v1/systemone') {
        if ((protocol === 'typesafe' && 'effort' in body) || (protocol === 'openjev' && body.effort !== 'high')) {
          response.writeHead(400)
          response.end('{}')
        } else response.end('{"model":"fixture","answers":{"connection":{"type":"noul","noul":0.99}}}')
      } else { response.writeHead(404); response.end('{}') }
    })
  })
  onTestFinished(async () => {
    const closed = new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    server.closeAllConnections()
    await closed
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture has no TCP address')
  const endpoint = `http://127.0.0.1:${address.port}/v1`
  const input = { endpoint, model: 'fixture', effort: 'high' as const, protocol, timeoutMs: 5000, apiKey: 'fixture-key' }
  expect(await testReflexConnection(input, async () => undefined, new AbortController().signal)).toMatchObject({ kind: 'ok', stage: 'decision' })
  const provider = new SystemOneProvider({ ...input, id: 'runtime', resolveApiKey: async () => 'fixture-key' })
  expect(await provider.decide({ state: 'The number two is even.', questions: { connection: { type: 'noul', instructions: 'Is the statement true?' } } }))
    .toMatchObject({ model: 'fixture', answers: { connection: { noul: 0.99 } } })
  expect(calls.map(call => call.path)).toEqual([
    ...protocol === 'openjev' ? ['/health'] : [], '/v1/models', '/v1/systemone', '/v1/systemone',
  ])
  expect(calls.every(call => call.authorization === 'Bearer fixture-key')).toBe(true)
  expect(calls.at(-1)?.body).toEqual(calls.at(-2)?.body)
})
