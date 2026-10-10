import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import Jev from '../src/index.ts'
import { JevProviderError, resolveJevApiKey } from '../src/client.ts'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

describe('apus-dsh-jev-plugin service', () => {
  it('registers the configured provider and pins a model before I/O', async () => {
    const ctx = new Context()
    const plugin = await ctx.plugin(Jev, { endpoint: 'http://127.0.0.1:30135', model: 'APUS-OpenJev-v1-9B-5949' })
    try {
      expect(ctx.jev.listProviders()).toEqual([{ id: 'system-one', endpoint: 'http://127.0.0.1:30135', model: 'APUS-OpenJev-v1-9B-5949' }])
      expect(ctx.jev.resolve({ state: { ok: true }, questions: { decision: { type: 'noul' } } })).toMatchObject({ providerId: 'system-one', model: 'APUS-OpenJev-v1-9B-5949' })
    } finally {
      await plugin.dispose()
      expect(ctx.get('jev')).toBeUndefined()
    }
  })

  it('selects an alternate provider and redacts unexpected provider errors', async () => {
    const ctx = new Context()
    await ctx.plugin(Jev, { endpoint: 'http://localhost', model: 'default' })
    const service = ctx.get('jev')!
    const dispose = service.register({ info: { id: 'alternate', model: 'alt', endpoint: 'http://localhost' }, decide: async () => { throw new Error('secret upstream credential') } })
    const request = { providerId: 'alternate', state: null, questions: { q: { type: 'noul' as const } } }
    try {
      expect(service.resolve(request).model).toBe('alt')
      const outcome = await service.decide(request)
      expect(outcome.kind).toBe('unknown')
      expect(JSON.stringify(outcome)).not.toContain('secret upstream credential')
      dispose()
      expect(() => service.resolve(request)).toThrow('not registered')
    } finally { dispose(); await ctx.fiber.dispose() }
  })


  it('warms the default provider and reports providers without a transport or with a failure', async () => {
    const ctx = new Context()
    await ctx.plugin(Jev, { endpoint: 'http://localhost', model: 'default' })
    const service = ctx.get('jev')!
    const warmed: string[] = []
    const disposeWarm = service.register({ info: { id: 'warmable', model: 'm', endpoint: 'http://localhost' },
      decide: async () => { throw new Error('unused') }, warm: async () => { warmed.push('warmable') } })
    const disposeFailing = service.register({ info: { id: 'failing', model: 'm', endpoint: 'http://localhost' },
      decide: async () => { throw new Error('unused') }, warm: async () => { throw new Error('down') } })
    const disposeCold = service.register({ info: { id: 'cold', model: 'm', endpoint: 'http://localhost' }, decide: async () => { throw new Error('unused') } })
    try {
      expect(await service.warm('warmable')).toBe(true)
      expect(warmed).toEqual(['warmable'])
      expect(await service.warm('failing')).toBe(false)
      expect(await service.warm('cold')).toBe(false)
      expect(await service.warm('missing')).toBe(false)
      const aborted = new AbortController()
      aborted.abort(new Error('stop'))
      await expect(service.warm('failing', aborted.signal)).rejects.toThrow('down')
    } finally {
      disposeWarm(); disposeFailing(); disposeCold()
      await ctx.fiber.dispose()
    }
  })

  it('requires keepAliveMs for HTTP/2', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(Jev, { endpoint: 'http://localhost', model: 'default', http2: true })).rejects.toThrow('http2 requires keepAliveMs')
    await ctx.fiber.dispose()
  })

  it('requires keepAliveMs for reopening a stalled pool', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(Jev, { endpoint: 'http://localhost', model: 'default', resetAfterFailures: 2 })).rejects.toThrow('resetAfterFailures requires keepAliveMs')
    await ctx.fiber.dispose()
  })
})

it('reports absent capabilities separately and removes disposed runtime readers', async () => {
  const ctx = new Context()
  await ctx.plugin(Jev, { endpoint: 'http://localhost', model: 'default' })
  try {
    expect(ctx.jev.readStatus().capabilities).toHaveLength(3)
    expect(ctx.jev.readStatus().capabilities.every(item => !item.implemented && !item.enabled)).toBe(true)
    let semanticEnabled = false
    const dispose = ctx.jev.registerCapability('codexSupervision', () => ({ implemented: true, enabled: true, semanticSupervision: { enabled: semanticEnabled } }))
    expect(ctx.jev.readStatus().capabilities.find(item => item.id === 'codexSupervision')).toEqual({ id: 'codexSupervision', implemented: true, enabled: true, semanticSupervision: { enabled: false } })
    semanticEnabled = true
    expect(ctx.jev.readStatus().capabilities.find(item => item.id === 'codexSupervision')?.semanticSupervision).toEqual({ enabled: true })
    expect(() => ctx.jev.registerCapability('codexSupervision', () => ({ implemented: true, enabled: true }))).toThrow('already registered')
    dispose()
    expect(ctx.jev.readStatus().capabilities.find(item => item.id === 'codexSupervision')?.implemented).toBe(false)
  } finally { await ctx.fiber.dispose() }
})

it('pins an in-flight decision while subsequent requests read updated volatile configuration', async () => {
  const ctx = new Context()
  let endpoint = 'https://first.test'
  let model = 'first-model'
  let effort: 'high' | 'low' = 'low'
  const reached = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const requests: { endpoint: string; model: string; effort: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = z.object({ model: z.string(), effort: z.string() }).parse(JSON.parse(typeof init.body === 'string' ? init.body : '{}'))
    requests.push({ endpoint: url, model: body.model, effort: body.effort })
    if (requests.length === 1) { reached.resolve(undefined); await release.promise }
    return new Response(JSON.stringify({ model: body.model, answers: { q: { type: 'noul', noul: 1 } } }), { headers: { 'content-type': 'application/json' } })
  })
  new Jev(ctx, { endpoint: { get: () => endpoint }, model: { get: () => model }, effort: { get: () => effort },
    protocol: { get: () => 'openjev' }, timeoutMs: { get: () => 1000 }, apiKeyEnv: { get: () => undefined } })
  try {
    const request = { state: 'safe fixture', questions: { q: { type: 'noul' as const } } }
    const first = ctx.jev.decide(request)
    await reached.promise
    endpoint = 'https://second.test'; model = 'second-model'; effort = 'high'
    const second = await ctx.jev.decide(request)
    release.resolve(undefined)
    expect((await first).spec).toMatchObject({ model: 'first-model', effort: 'low' })
    expect(second.spec).toMatchObject({ model: 'second-model', effort: 'high' })
    expect(requests).toEqual([
      { endpoint: 'https://first.test/v1/systemone', model: 'first-model', effort: 'low' },
      { endpoint: 'https://second.test/v1/systemone', model: 'second-model', effort: 'high' },
    ])
  } finally { release.resolve(undefined); await ctx.fiber.dispose(); vi.unstubAllGlobals() }
})


class ReadOnlyFixtureCredentials extends CredentialProvider {
  value: string | undefined = 'managed-key'
  override async resolve() { return this.value === undefined ? undefined : { value: this.value, source: 'fixture' } }
  override describe(): never { throw new Error('unused') }
  override set(): never { throw new Error('unused') }
  override unset(): never { throw new Error('unused') }
  override readRecord(): never { throw new Error('unused') }
  override describeRecord(): never { throw new Error('unused') }
  override listRecords(): never { throw new Error('unused') }
  override modifyRecord(): never { throw new Error('unused') }
  override deleteRecord(): never { throw new Error('unused') }
}

it('resolves declared credentials from the managed store before launch values and rejects absent or empty values', async () => {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { REFLEX_KEY: 'launch-key', EMPTY_KEY: '' } }]))
  try {
    expect(await resolveJevApiKey(ctx, undefined)).toBeUndefined()
    expect(await resolveJevApiKey(ctx, 'REFLEX_KEY')).toBe('launch-key')
    await expect(resolveJevApiKey(ctx, 'ABSENT_KEY')).rejects.toMatchObject({ failure: { code: 'missing-credential' } })
    await expect(resolveJevApiKey(ctx, 'EMPTY_KEY')).rejects.toMatchObject({ failure: { code: 'missing-credential' } })
    const store = new ReadOnlyFixtureCredentials(ctx)
    expect(await resolveJevApiKey(ctx, 'REFLEX_KEY')).toBe('managed-key')
    store.value = undefined
    await expect(resolveJevApiKey(ctx, 'REFLEX_KEY')).rejects.toMatchObject({ failure: { code: 'missing-credential' } })
  } finally { await ctx.fiber.dispose() }
})

it('uses the configured key for decisions and authenticated warmup while candidate tests leave status untouched', async () => {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { REFLEX_KEY: 'fixture-key' } }]))
  const authorization: (string | null)[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    authorization.push(new Headers(init.headers).get('authorization'))
    if (url.endsWith('/health')) return new Response('{}')
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'default' }] })
    const body = z.object({ questions: z.record(z.string(), z.unknown()) }).parse(JSON.parse(z.string().parse(init.body)))
    const answers = Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'noul', noul: 1 }]))
    return Response.json({ model: 'default', answers })
  })
  try {
    await ctx.plugin(Jev, { endpoint: 'https://reflex.test', model: 'default', apiKeyEnv: 'REFLEX_KEY' })
    expect(await ctx.jev.warm()).toBe(true)
    expect((await ctx.jev.decide({ state: null, questions: { q: { type: 'noul' } } })).kind).toBe('ok')
    const before = ctx.jev.readStatus()
    expect(await ctx.jev.testConnection({ endpoint: 'https://reflex.test', model: 'default', apiKeyEnv: 'REFLEX_KEY',
      protocol: 'openjev', effort: 'high', timeoutMs: 1000 }, new AbortController().signal)).toMatchObject({ kind: 'ok' })
    expect(ctx.jev.readStatus()).toEqual(before)
    expect(authorization.every(value => value === 'Bearer fixture-key')).toBe(true)
    const dispose = ctx.jev.registerCapability('entryRouting', () => ({ implemented: true, enabled: false }))
    dispose()
    const release = ctx.jev.registerCapability('entryRouting', () => ({ implemented: true, enabled: true }))
    dispose()
    expect(ctx.jev.readStatus().capabilities[0]?.enabled).toBe(true)
    release()
    expect(() => ctx.jev.register({ info: { id: 'system-one', model: 'default', endpoint: 'https://reflex.test' },
      decide: async () => ({ model: 'default', answers: {} }) })).toThrow('already registered')
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
})

it('preserves structured provider failures and caller cancellation without exposing arbitrary error text', async () => {
  const ctx = new Context()
  await ctx.plugin(Jev, { endpoint: 'http://localhost', model: 'default' })
  const abort = new AbortController()
  let cancel = false
  ctx.jev.register({ info: { id: 'fixture', model: 'fixture', endpoint: 'http://localhost' }, decide: async () => {
    if (cancel) { abort.abort(new Error('caller cancelled')); throw abort.signal.reason }
    throw new JevProviderError({ code: 'rate-limited', message: 'busy', status: 429 })
  } })
  try {
    const request = { providerId: 'fixture', state: null, questions: { q: { type: 'noul' as const } } }
    expect(await ctx.jev.decide(request)).toMatchObject({ kind: 'unknown', failure: { code: 'rate-limited', status: 429 } })
    cancel = true
    await expect(ctx.jev.decide(request, abort.signal)).rejects.toThrow('caller cancelled')
    await expect(ctx.jev.decide(request, abort.signal)).rejects.toThrow('caller cancelled')
  } finally { await ctx.fiber.dispose() }
})


it.each([undefined, false, true])('constructs the pooled service with HTTP/2 selection %s', async (http2) => {
  const ctx = new Context()
  new Jev(ctx, { endpoint: { get: () => 'http://localhost' }, model: { get: () => 'fixture' }, effort: { get: () => 'low' },
    protocol: { get: () => 'openjev' }, timeoutMs: { get: () => 1000 }, apiKeyEnv: { get: () => undefined }, keepAliveMs: 1000, ...http2 === undefined ? {} : { http2 } })
  try { expect(ctx.jev.readStatus().provider.model).toBe('fixture') } finally { await ctx.fiber.dispose() }
})
