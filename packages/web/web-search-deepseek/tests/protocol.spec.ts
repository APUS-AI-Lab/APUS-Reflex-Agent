/**
 * One provider, two wire dialects.
 *
 * An Anthropic-compatible endpoint answers `/v1/messages` with the
 * `web_search_20250305` server tool. An OpenAI-compatible gateway answers
 * `/v1/responses` with `tools: [{ type: 'web_search' }]` and rejects the
 * Anthropic shape outright. A deployment may move between them when its gateway
 * or key changes, so `auto` probes once and then uses whichever answered.
 *
 * These tests serve both dialects from one local HTTP server, so the probe, the
 * fallback and the "remembered dialect" shortcut are all observed over real
 * requests rather than mocked fetch arguments.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'
import type { DeepSeekSearchProviderOptions } from '@deepseek-ai/dsh-web-search-deepseek'

const QUERY = 'deepseek api pricing'
const API_KEY = 'protocol-test-key'

/** Requests the fixture server received, in arrival order. */
const seen: { path: string; body: Record<string, unknown> }[] = []

/** Which dialects this server accepts; a test flips it to simulate a move. */
let accepts: 'anthropic' | 'openai-responses' | 'both' = 'both'

function anthropicBody(): string {
  return JSON.stringify({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: QUERY } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srv_1',
        content: [
          { type: 'web_search_result', url: 'https://a.example/pricing', title: 'Pricing A' },
          { type: 'web_search_result', url: 'https://b.example/pricing', title: 'Pricing B' },
        ],
      },
      {
        type: 'text',
        text: 'DeepSeek bills per token.',
        citations: [{ type: 'web_search_result_location', url: 'https://a.example/pricing', title: 'Pricing A' }],
      },
    ],
  })
}

function openaiBody(): string {
  return JSON.stringify({
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    output: [
      { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', queries: [QUERY] } },
      {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: 'DeepSeek bills per token.',
          annotations: [{ type: 'url_citation', url: 'https://c.example/pricing', title: 'Pricing C' }],
        }],
      },
    ],
  })
}

const server: Server = createServer((request: IncomingMessage, response) => {
  let raw = ''
  request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
  request.on('end', () => {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(raw) as Record<string, unknown> } catch { /* a malformed body is the caller's bug */ }
    seen.push({ path: request.url ?? '', body })

    const isAnthropic = (request.url ?? '').endsWith('/messages')
    const allowed = isAnthropic ? accepts !== 'openai-responses' : accepts !== 'anthropic'
    if (!allowed) {
      // A real gateway rejects the wrong dialect at the path or body boundary.
      response.writeHead(isAnthropic ? 404 : 400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'wrong dialect' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(isAnthropic ? anthropicBody() : openaiBody())
  })
})

let origin: string

beforeAll(async () => {
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { error === undefined ? resolve() : reject(error) })
  })
})

const provider = (options: Partial<DeepSeekSearchProviderOptions> = {}): DeepSeekSearchProvider =>
  new DeepSeekSearchProvider(() => ({
    apiKey: API_KEY,
    baseURL: origin,
    model: 'deepseek-v4-flash',
    apiVersion: '2023-06-01',
    maxTokens: 1024,
    maxUses: 2,
    ...options,
  }))

describe('search protocol dialects', () => {
  it('reads an Anthropic Messages answer', async () => {
    accepts = 'anthropic'
    seen.length = 0

    const result = await provider({ protocol: 'anthropic' }).search({ query: QUERY })

    expect(seen.map(r => r.path)).toEqual(['/v1/messages'])
    expect(result.sources.map(s => s.url)).toEqual([
      'https://a.example/pricing',
      'https://b.example/pricing',
    ])
    expect(result.content).toBe('DeepSeek bills per token.')
  })

  it('reads an OpenAI Responses answer, including the queries it ran', async () => {
    accepts = 'openai-responses'
    seen.length = 0

    const result = await provider({ protocol: 'openai-responses' }).search({ query: QUERY })

    expect(seen.map(r => r.path)).toEqual(['/v1/responses'])
    expect(seen[0]?.body['tools']).toEqual([{ type: 'web_search' }])
    expect(result.sources.map(s => s.url)).toEqual(['https://c.example/pricing'])
  })

  it('auto falls from Anthropic to Responses when the endpoint rejects the first', async () => {
    accepts = 'openai-responses'
    seen.length = 0

    const result = await provider().search({ query: QUERY })

    // The probe costs the rejected shape, then the working one.
    expect(seen.map(r => r.path)).toEqual(['/v1/messages', '/v1/responses'])
    expect(result.sources.map(s => s.url)).toEqual(['https://c.example/pricing'])
  })

  it('remembers the dialect so later searches do not probe again', async () => {
    accepts = 'openai-responses'
    seen.length = 0
    const one = provider()

    await one.search({ query: QUERY })
    const afterFirst = seen.length
    await one.search({ query: QUERY })

    // The second search went straight to the dialect that answered.
    expect(seen.slice(afterFirst).map(r => r.path)).toEqual(['/v1/responses'])
  })

  it('does not retry the other dialect on a credential failure', async () => {
    // 401 means the dialect exists and the key is wrong; falling through would
    // hide a real credential problem behind a second failed request.
    accepts = 'both'
    seen.length = 0
    const failing = createServer((request, response) => {
      request.resume()
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid key' } }))
    })
    await new Promise<void>((resolve) => { failing.listen(0, '127.0.0.1', resolve) })
    const failingOrigin = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`
    try {
      const one = provider({ baseURL: failingOrigin })
      await expect(one.search({ query: QUERY })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    } finally {
      await new Promise<void>((resolve) => { failing.close(() => resolve()) })
    }
  })

  it('rejects a response that answered without searching', async () => {
    // A gateway that ignores `tools` replies from the model's own knowledge.
    // Reporting that as a search result would fabricate grounding.
    const silent = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I know this.' }] }],
        }))
      })
    })
    await new Promise<void>((resolve) => { silent.listen(0, '127.0.0.1', resolve) })
    const silentOrigin = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`
    try {
      const one = provider({ baseURL: silentOrigin, protocol: 'openai-responses' })
      await expect(one.search({ query: QUERY })).rejects.toThrow(/without running a search/u)
    } finally {
      await new Promise<void>((resolve) => { silent.close(() => resolve()) })
    }
  })
})
