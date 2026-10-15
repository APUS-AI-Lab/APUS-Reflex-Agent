/** The Remote namespace forwards each call to the Host-owned local decision engine. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReflexLocalService, ReflexSnapshot } from '@deepseek-ai/dsh-experimental-reflex-local/types'
import ReflexLocalController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

const snapshot: ReflexSnapshot = {
  device: { supported: true, memoryBytes: 24e9, recommended: 'q8_0' },
  models: [{ variant: 'q8_0', bytes: 4.48e9 }, { variant: 'q4_k_m', bytes: 2.71e9 }],
  preparation: { phase: 'absent' }, enabled: false, providerId: 'reflex-local', downloadSources: [],
}

function fixture() {
  const ctx = new Context(); roots.push(ctx)
  const service = {
    snapshot: vi.fn(() => snapshot),
    follow: vi.fn(async function* (_signal: AbortSignal) { yield snapshot }),
    prepare: vi.fn(),
    pause: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    enable: vi.fn(async () => {}), disable: vi.fn(async () => {}), remove: vi.fn(async () => {}), acknowledge: vi.fn(async () => {}),
  } satisfies ReflexLocalService
  ctx.provide('reflexLocal', service)
  return { api: new ReflexLocalController(ctx), service }
}

it('forwards observation and every preparation and enablement command', async () => {
  const { api, service } = fixture()
  expect(api.snapshot()).toBe(snapshot)
  const lifetime = new AbortController()
  const observed: ReflexSnapshot[] = []
  for await (const item of api.follow(lifetime.signal)) observed.push(item)
  expect(observed).toEqual([snapshot])
  expect(service.follow).toHaveBeenCalledWith(lifetime.signal)
  api.prepare()
  api.prepare({ variant: 'q4_k_m', downloadSource: 'https://hf-mirror.com' })
  expect(service.prepare).toHaveBeenNthCalledWith(1, undefined)
  expect(service.prepare).toHaveBeenNthCalledWith(2, { variant: 'q4_k_m', downloadSource: 'https://hf-mirror.com' })
  await api.pause(); await api.cancel(); await api.enable(); await api.disable(); await api.remove(); await api.acknowledge()
  for (const method of [service.pause, service.cancel, service.enable, service.disable, service.remove, service.acknowledge]) {
    expect(method).toHaveBeenCalledOnce()
  }
})

it('propagates Host rejections unchanged', async () => {
  const { api, service } = fixture()
  service.prepare.mockImplementationOnce(() => { throw new Error('variant differs from the active download') })
  expect(() => { api.prepare({ variant: 'q4_k_m' }) }).toThrow('variant differs')
  service.enable.mockRejectedValueOnce(new Error('not ready'))
  await expect(api.enable()).rejects.toThrow('not ready')
})
