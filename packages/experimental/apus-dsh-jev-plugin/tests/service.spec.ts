import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import Jev from '../src/index.ts'

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
})
