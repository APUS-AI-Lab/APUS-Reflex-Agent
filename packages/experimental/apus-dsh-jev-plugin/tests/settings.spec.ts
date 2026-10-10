import { describe, expect, it, vi } from 'vitest'
import { parseReflexConnectionInput, testReflexConnection } from '../src/settings.ts'
import type { ReflexConnectionInput } from '../src/types.ts'

const input: ReflexConnectionInput = { endpoint: 'https://reflex.test', model: 'decision-model', effort: 'high', timeoutMs: 1000, protocol: 'openjev' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

describe('Reflex unsaved connection test', () => {
  it('authenticates discovery and a real semantic decision without retaining credentials', async () => {
    const calls: string[] = []
    const resolve = vi.fn(async () => 'stored-secret')
    const result = await testReflexConnection({ ...input, apiKey: 'draft-secret' }, resolve, new AbortController().signal, async (url, init) => {
      calls.push((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url))
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer draft-secret')
      if ((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/health')) return json({ ok: true })
      if ((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/models')) return json({ models: [{ name: input.model }] })
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
      expect(body).toMatchObject({ model: input.model, effort: 'high', questions: { connection: { type: 'noul' } } })
      return json({ model: input.model, answers: { connection: { type: 'noul', noul: 0.99 } } })
    })
    expect(result).toMatchObject({ kind: 'ok', stage: 'decision', model: input.model })
    expect(calls).toEqual(['https://reflex.test/health', 'https://reflex.test/v1/models', 'https://reflex.test/v1/systemone'])
    expect(resolve).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it.each([401, 403, 500])('reports HTTP %s without echoing upstream text', async (status) => {
    const result = await testReflexConnection(input, async () => 'stored-secret', new AbortController().signal,
      async () => json({ error: 'secret body' }, status))
    expect(result).toMatchObject({ kind: 'failed', stage: 'health', code: 'http', status })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('rejects a missing model before invoking decisions', async () => {
    const fetcher = vi.fn(async () => json({ data: [{ id: 'different' }] }))
    expect(await testReflexConnection(input, async () => undefined, new AbortController().signal, fetcher)).toMatchObject({ code: 'model-missing', kind: 'failed' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([{}, { data: 'secret' }])('rejects invalid model catalogs', async (catalog) => {
    expect(await testReflexConnection(input, async () => undefined, new AbortController().signal,
      async () => json(catalog))).toMatchObject({ kind: 'failed', code: 'invalid-response' })
  })

  it('does not call a semantically false answer a working decision service', async () => {
    const result = await testReflexConnection(input, async () => undefined, new AbortController().signal,
      async url => (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/models') ? json({ models: [{ name: input.model }] }) : json({ model: input.model, answers: { connection: { type: 'noul', noul: 0.01 } } }))
    expect(result).toMatchObject({ kind: 'failed', stage: 'decision', code: 'decision-rejected' })
  })

  it('bounds discovery time and propagates caller cancellation', async () => {
    const result = await testReflexConnection({ ...input, timeoutMs: 10 }, async () => undefined, new AbortController().signal,
      async (_url, init) => new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new Error('aborted'))
        else init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }))
    expect(result).toMatchObject({ kind: 'failed', code: 'timeout' })
    const resolve = vi.fn(async () => undefined)
    await expect(testReflexConnection(input, resolve, AbortSignal.abort(new Error('cancel')))).rejects.toThrow('cancel')
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each(['ftp://reflex.test', 'https://user:secret@reflex.test', 'https://reflex.test?key=secret'])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => parseReflexConnectionInput({ ...input, endpoint })).toThrow('Invalid Reflex connection settings')
  })
  it('bounds a stalled credential resolver before network access', async () => {
    const fetcher = vi.fn()
    const outcome = await testReflexConnection(
      { ...input, timeoutMs: 10 }, () => new Promise(() => {}), new AbortController().signal, fetcher,
    )
    expect(outcome).toMatchObject({ kind: 'failed', code: 'timeout' })
    expect(fetcher).not.toHaveBeenCalled()
  })

})

it('normalizes optional probe fields and rejects invalid candidate values without echoing them', () => {
  expect(parseReflexConnectionInput(input)).toEqual(input)
  expect(parseReflexConnectionInput({ ...input, apiKey: 'transient', apiKeyEnv: 'REFLEX_API_KEY' }))
    .toEqual({ ...input, apiKey: 'transient', apiKeyEnv: 'REFLEX_API_KEY' })
})

it('skips health for typesafe discovery and sanitizes transport failures', async () => {
  const fetcher = vi.fn(async () => { throw new Error('secret transport details') })
  const result = await testReflexConnection({ ...input, protocol: 'typesafe' }, async () => undefined,
    new AbortController().signal, fetcher)
  expect(fetcher).toHaveBeenCalledWith('https://reflex.test/v1/models', expect.any(Object))
  expect(result).toMatchObject({ kind: 'failed', stage: 'models', code: 'transport' })
  expect(JSON.stringify(result)).not.toContain('secret')
})

it('reports authenticated discovery failures separately from health', async () => {
  const result = await testReflexConnection(input, async () => 'stored', new AbortController().signal,
    async url => (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/health') ? json({ ok: true }) : json({}, 401))
  expect(result).toMatchObject({ kind: 'failed', stage: 'models', code: 'http', status: 401 })
})

it('rejects a semantic answer from the wrong model', async () => {
  const result = await testReflexConnection(input, async () => undefined, new AbortController().signal,
    async url => (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/models') ? json({ data: [{ id: input.model }] })
      : json({ model: 'wrong', answers: { connection: { type: 'noul', noul: 1 } } }))
  expect(result).toMatchObject({ kind: 'failed', stage: 'decision', code: 'invalid-response' })
})

it('uses typesafe authenticated discovery without requiring a health route', async () => {
  const result = await testReflexConnection({ ...input, protocol: 'typesafe', apiKey: 'transient' }, async () => undefined,
    new AbortController().signal, async () => json({ data: [{ id: 'unavailable' }] }))
  expect(result).toMatchObject({ kind: 'failed', stage: 'models', code: 'model-missing' })
})

it('completes a typesafe model check using the SDK decision endpoint', async () => {
  const calls: string[] = []
  const result = await testReflexConnection({ ...input, protocol: 'typesafe', apiKey: 'transient' }, async () => undefined,
    new AbortController().signal, async (url) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      calls.push(address)
      return address.endsWith('/models') ? json({ data: [{ id: input.model }] })
        : json({ model: input.model, answers: { connection: { type: 'noul', noul: 1 } } })
    })
  expect(result).toMatchObject({ kind: 'ok', stage: 'decision' })
  expect(calls).toEqual(['https://reflex.test/v1/models', 'https://reflex.test/v1/systemone'])
})

it('consumes rejected discovery bodies without exposing upstream details', async () => {
  const response = json({ error: 'private upstream details' }, 401)
  const result = await testReflexConnection({ ...input, protocol: 'typesafe' }, async () => 'stored',
    new AbortController().signal, async () => response)
  expect(response.bodyUsed).toBe(true)
  expect(result).toMatchObject({ kind: 'failed', stage: 'models', code: 'http', status: 401 })
  expect(JSON.stringify(result)).not.toContain('private')
})

it('cancels an in-flight discovery without sending a decision', async () => {
  const abort = new AbortController()
  const entered = Promise.withResolvers<undefined>()
  const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    entered.resolve(undefined)
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('discovery cancelled')) }, { once: true })
    })
  })
  const pending = testReflexConnection({ ...input, protocol: 'typesafe' }, async () => undefined, abort.signal, fetcher)
  const rejected = expect(pending).rejects.toThrow()
  await entered.promise
  abort.abort(new Error('caller stopped'))
  await rejected
  expect(fetcher).toHaveBeenCalledTimes(1)
})
