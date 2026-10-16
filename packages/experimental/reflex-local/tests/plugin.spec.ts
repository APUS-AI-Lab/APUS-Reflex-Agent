/** Plugin composition: provider registration in the real Jev service, service delegation, and disposal. */
import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { expect, it, onTestFinished } from 'vitest'
import { JEV_ENTRY_ID, type RoutingEditor } from '../src/engine.ts'
import ReflexLocal, * as module from '../src/index.ts'
import { temporaryRoot } from './harness.ts'

/** A profile editor holding one jev row, standing in for the config-editor plugin. */
function provideEditor(ctx: Context): void {
  const editor: RoutingEditor = {
    entries: () => [{ options: { id: JEV_ENTRY_ID, config: { defaultProviderId: 'reflex-local' } } }],
    edit: async () => {},
  }
  ctx.provide('configEditor', editor)
}

async function host() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  provideEditor(ctx)
  await ctx.plugin(Jev, { defaultProviderId: 'reflex-local' })
  return ctx
}

it('registers the local provider while mounted and answers decisions with a transport failure until enabled', async () => {
  const ctx = await host(), dataRoot = await temporaryRoot()
  const fiber = ctx.plugin(ReflexLocal, { dataRoot, runnerPath: `${dataRoot}/absent` })
  await fiber
  expect(module.name).toBe('experimental-reflex-local')
  expect(ctx.jev.listProviders()).toMatchObject([{ id: 'reflex-local', model: module.REFLEX_MODEL, endpoint: 'http://127.0.0.1' }])
  const service = ctx.get('reflexLocal')!
  expect(service.snapshot()).toMatchObject({ device: { supported: false }, enabled: false, reflexEnabled: true, providerId: 'reflex-local' })
  // Jev routes here, but the provider reports it cannot answer, so optional consumers skip decisions.
  expect(ctx.jev.isReady()).toBe(false)
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
  expect(() => { service.select({ model: '4b', quant: 'q8_0' }) }).toThrow('cannot run')
  await service.acknowledgeSwitch()
  await expect(service.chooseLocal()).rejects.toThrow('cannot run')
  expect(service.snapshot().localChosen).toBe(false)
  await service.deleteModel({ model: '4b', quant: 'q8_0' })
  await service.acknowledge()
  await service.remove()
  const outcome = await ctx.jev.decide({ state: 'x', questions: { q: { type: 'noul' } } })
  expect(outcome).toMatchObject({ kind: 'unknown', failure: { code: 'transport' } })
  expect(await ctx.jev.warm()).toBe(false)
  await fiber.dispose()
  expect(ctx.jev.listProviders()).toEqual([])
  expect(ctx.get('reflexLocal')).toBeUndefined()
})

it('fails loud at load without the configuration editor', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(Jev, {})
  const dataRoot = await temporaryRoot()
  await expect(Promise.resolve(ctx.plugin(ReflexLocal, { dataRoot }))).rejects.toThrow('config-editor')
  expect(ctx.jev.listProviders()).toEqual([])
})

it('re-registers the provider across Jev reloads without stopping the engine', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalSubprocess)
  provideEditor(ctx)
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
