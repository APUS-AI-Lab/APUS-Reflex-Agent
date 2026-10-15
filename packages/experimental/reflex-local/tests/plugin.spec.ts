/** Plugin composition: provider registration in the real Jev service, service delegation, and disposal. */
import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { expect, it, onTestFinished } from 'vitest'
import ReflexLocal, * as module from '../src/index.ts'
import { temporaryRoot } from './harness.ts'

async function host() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(Jev, { defaultProviderId: 'reflex-local' })
  return ctx
}

it('registers the local provider while mounted and answers decisions with a transport failure until enabled', async () => {
  const ctx = await host(), dataRoot = await temporaryRoot()
  const fiber = ctx.plugin(ReflexLocal, { dataRoot, runnerPath: `${dataRoot}/absent` })
  await fiber
  expect(module.name).toBe('experimental-reflex-local')
  expect(ctx.jev.listProviders()).toEqual([{ id: 'reflex-local', model: module.REFLEX_MODEL, endpoint: 'http://127.0.0.1' }])
  const service = ctx.get('reflexLocal')!
  expect(service.snapshot()).toMatchObject({ device: { supported: false }, enabled: false, providerId: 'reflex-local' })
  const abort = new AbortController()
  const iterator = service.follow(abort.signal)[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toMatchObject({ preparation: { phase: 'unsupported' } })
  abort.abort()
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
  expect(() => { service.prepare() }).toThrow('cannot run')
  await service.pause()
  await service.cancel()
  await expect(service.enable()).rejects.toThrow('Prepare')
  await service.disable()
  await service.acknowledge()
  await service.remove()
  const outcome = await ctx.jev.decide({ state: 'x', questions: { q: { type: 'noul' } } })
  expect(outcome).toMatchObject({ kind: 'unknown', failure: { code: 'transport' } })
  expect(await ctx.jev.warm()).toBe(false)
  await fiber.dispose()
  expect(ctx.jev.listProviders()).toEqual([])
  expect(ctx.get('reflexLocal')).toBeUndefined()
})

it('fails loud at load when cloud routing lacks the configuration editor', async () => {
  const ctx = await host(), dataRoot = await temporaryRoot()
  await expect(Promise.resolve(ctx.plugin(ReflexLocal, { dataRoot, cloudProviderId: 'system-one' }))).rejects.toThrow('config-editor')
  expect(ctx.jev.listProviders()).toEqual([])
})

it('re-registers the provider across Jev reloads without stopping the engine', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  const dataRoot = await temporaryRoot()
  await ctx.plugin(ReflexLocal, { dataRoot, runnerPath: `${dataRoot}/absent` })
  const service = ctx.get('reflexLocal')!
  const abort = new AbortController()
  onTestFinished(() => { abort.abort() })
  const iterator = service.follow(abort.signal)[Symbol.asyncIterator]()
  await iterator.next()
  for (let reload = 0; reload < 2; reload++) {
    const jev = ctx.plugin(Jev, { defaultProviderId: 'reflex-local' })
    await jev
    expect(ctx.jev.listProviders().map(provider => provider.id)).toEqual(['reflex-local'])
    await jev.dispose()
    expect(ctx.get('jev')).toBeUndefined()
  }
  expect(ctx.get('reflexLocal')).toBeDefined()
  const next = iterator.next()
  await service.disable()
  expect((await next).done).toBe(false)
})
