/** Local acceptance relay: forwards real Reflex traffic and records only request metadata. */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const [upstreamEndpoint, tracePath] = process.argv.slice(2)
if (!upstreamEndpoint || !tracePath) throw new Error('Provide upstream endpoint and trace path')
const upstreamBase = new URL(upstreamEndpoint)
const requests = new Set()
const server = createServer((request, response) => {
  const path = request.url
  if (!['/health', '/v1/models', '/v1/systemone'].includes(path)) {
    response.writeHead(404).end()
    return
  }
  const abort = new AbortController()
  requests.add(abort)
  response.once('close', () => abort.abort())
  void (async () => {
    const parts = []
    for await (const part of request) parts.push(part)
    const body = Buffer.concat(parts)
    const metadata = body.length ? JSON.parse(body.toString()) : {}
    const start = Date.now()
    const headers = { 'content-type': 'application/json' }
    if (request.headers.authorization) headers.authorization = request.headers.authorization
    const upstream = await fetch(new URL(path, upstreamBase), {
      method: request.method, headers, signal: abort.signal,
      ...(body.length ? { body } : {}),
    })
    const content = Buffer.from(await upstream.arrayBuffer())
    let responseModel = null
    try { responseModel = JSON.parse(content.toString()).model ?? null }
    catch (_error) { /* Health responses need not be JSON. */ }
    appendFileSync(tracePath, JSON.stringify({
      at: start, path, requestModel: metadata.model ?? null, effort: metadata.effort ?? null,
      responseModel, status: upstream.status, elapsedMs: Date.now() - start,
      requestBytes: body.length, responseBytes: content.length,
    }) + '\n')
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
    response.end(content)
  })().catch(error => {
    appendFileSync(tracePath, JSON.stringify({ at: Date.now(), path, error: error instanceof Error ? error.name : 'Error' }) + '\n')
    response.destroy()
  }).finally(() => requests.delete(abort))
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No listening port')
  console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}` }))
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const request of requests) request.abort()
  server.close()
  server.closeAllConnections()
})
