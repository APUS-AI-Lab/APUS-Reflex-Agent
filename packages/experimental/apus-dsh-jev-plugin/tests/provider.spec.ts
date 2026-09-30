import { describe, expect, it } from 'vitest'
import { JevProviderError, SystemOneProvider } from '../src/client.ts'
import type { JevRequest } from '../src/types.ts'

const request: JevRequest = {
  state: { scene: 'provider-test' },
  questions: { decision: { type: 'choice', criteria: { keep: 'Keep local', escalate: 'Escalate' } } },
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('System One provider', () => {
  it('sends the typed request to /v1/systemone and validates the answer', async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined
    const provider = new SystemOneProvider({
      id: 'test', endpoint: 'http://127.0.0.1:30135', model: 'jev-test', effort: 'low', timeoutMs: 1000,
      resolveApiKey: async () => 'test-key',
      fetcher: async (input, init) => {
        captured = { url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init }
        return response({ model: 'jev-test', answers: { decision: { type: 'choice', choice: 'keep', probabilities: { keep: 0.8, escalate: 0.2 }, confidence: 0.9 } } })
      },
    })
    const result = await provider.decide(request)
    expect(result.answers.decision).toMatchObject({ type: 'choice', choice: 'keep' })
    expect(captured?.url).toBe('http://127.0.0.1:30135/v1/systemone')
    expect(new Headers(captured?.init?.headers).get('authorization')).toBe('Bearer test-key')
    expect(new Headers(captured?.init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(typeof captured?.init?.body === 'string' ? captured.init.body : '{}')).toMatchObject({ model: 'jev-test', effort: 'low' })
  })

  it('classifies HTTP and timeout failures without exposing response text', async () => {
    const limited = new SystemOneProvider({
      id: 'test', endpoint: 'https://gateway.example/v1', model: 'jev-test', effort: 'low', timeoutMs: 1000,
      fetcher: async () => response({ error: 'private upstream detail' }, 429),
    })
    await expect(limited.decide(request)).rejects.toMatchObject({ failure: { code: 'rate-limited', status: 429 } })

    const timed = new SystemOneProvider({
      id: 'test', endpoint: 'https://gateway.example', model: 'jev-test', effort: 'low', timeoutMs: 5,
      fetcher: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      }),
    })
    await expect(timed.decide(request)).rejects.toSatisfy((error: unknown) => error instanceof JevProviderError && error.failure.code === 'timeout')
  })

  it('classifies non-JSON throttling and body timeouts before response parsing errors', async () => {
    const throttled = new SystemOneProvider({
      id: 'test', endpoint: 'http://localhost/v1', model: 'jev-test', effort: 'low', timeoutMs: 10,
      fetcher: async () => new Response('upstream sensitive HTML', { status: 429 }),
    })
    await expect(throttled.decide(request)).rejects.toMatchObject({ failure: { code: 'rate-limited', status: 429 } })
    const stalledBody = new SystemOneProvider({
      id: 'test', endpoint: 'http://localhost', model: 'jev-test', effort: 'low', timeoutMs: 5,
      fetcher: async (_input, init) => new Response(new ReadableStream({
        start(controller) { init?.signal?.addEventListener('abort', () => { controller.error(new Error('aborted')) }, { once: true }) },
      })),
    })
    await expect(stalledBody.decide(request)).rejects.toMatchObject({ failure: { code: 'timeout' } })
  })

  it('does no credential or network work for an already cancelled caller', async () => {
    let calls = 0
    const provider = new SystemOneProvider({
      id: 'test', endpoint: 'http://localhost', model: 'jev-test', effort: 'low', timeoutMs: 1000,
      resolveApiKey: async () => { calls += 1; return 'test' },
      fetcher: async () => { calls += 1; return response({}) },
    })
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(provider.decide(request, abort.signal)).rejects.toThrow('cancelled')
    expect(calls).toBe(0)
  })

  it('uses the official SDK without OpenJev effort or automatic retries', async () => {
    let calls = 0
    const provider = new SystemOneProvider({
      id: 'official', endpoint: 'https://api.typesafe.ai/v1', protocol: 'typesafe',
      model: 'jev-latest', effort: 'high', timeoutMs: 1000,
      resolveApiKey: async () => 'fixture-key',
      fetcher: async (input, init) => {
        calls += 1
        expect(String(input)).toBe('https://api.typesafe.ai/v1/systemone')
        expect(JSON.parse(String(init?.body))).not.toHaveProperty('effort')
        expect(new Headers(init?.headers).get('x-typesafe-sdk')).toBe('typesafe-sdk/0.6.0')
        return response({ error: 'private detail' }, 503)
      },
    })
    await expect(provider.decide(request)).rejects.toMatchObject({ failure: { code: 'http', status: 503 } })
    expect(calls).toBe(1)
  })

  it('includes credential resolution in the timeout and prevents late network dispatch', async () => {
    let resolveKey: ((key: string) => void) | undefined
    let calls = 0
    const provider = new SystemOneProvider({
      id: 'test', endpoint: 'http://localhost', model: 'jev-test', effort: 'high', timeoutMs: 5,
      resolveApiKey: () => new Promise((resolve) => { resolveKey = resolve }),
      fetcher: async () => { calls += 1; return response({}) },
    })
    await expect(provider.decide(request)).rejects.toMatchObject({ failure: { code: 'timeout' } })
    resolveKey?.('late-key')
    await Promise.resolve()
    expect(calls).toBe(0)
  })

  it('never sends a placeholder credential and validates malformed SDK responses', async () => {
    const provider = new SystemOneProvider({
      id: 'test', endpoint: 'http://localhost', model: 'jev-test', effort: 'high', timeoutMs: 1000,
      fetcher: async (_input, init) => {
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        return new Response('private upstream HTML', { status: 200 })
      },
    })
    await expect(provider.decide(request)).rejects.toMatchObject({ failure: { code: 'invalid-response' } })
  })

})
