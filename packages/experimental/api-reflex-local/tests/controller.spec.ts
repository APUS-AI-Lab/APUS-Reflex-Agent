/** The Remote namespace forwards each call to the Host-owned local decision engine. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { ReflexLifecycleError } from '@deepseek-ai/dsh-experimental-reflex-local'
import type { ReflexLocalService, ReflexSnapshot } from '@deepseek-ai/dsh-experimental-reflex-local/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import ReflexLocalController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

const snapshot: ReflexSnapshot = {
  device: { supported: true, memoryBytes: 24e9 },
  options: [{ model: '4b', quant: 'q8_0', bytes: 4.48e9, minMemoryBytes: 16e9, experimental: false, fits: true, inventory: { state: 'absent' } }],
  recommended: { model: '4b', quant: 'q8_0' },
  preparation: { phase: 'absent' }, runner: { state: 'stopped' },
  enabled: false, localChosen: false, reflexEnabled: true, providerId: 'reflex-local', downloadSources: [],
}

function fixture() {
  const ctx = new Context(); roots.push(ctx)
  const service = {
    snapshot: vi.fn(() => snapshot),
    follow: vi.fn(async function* (_signal: AbortSignal) { yield snapshot }),
    prepare: vi.fn(), select: vi.fn(),
    pause: vi.fn(async () => {}), cancel: vi.fn(async () => {}), chooseLocal: vi.fn(async () => {}),
    enable: vi.fn(async () => {}), disable: vi.fn(async () => {}), remove: vi.fn(async () => {}), acknowledge: vi.fn(async () => {}),
    acknowledgeSwitch: vi.fn(async () => {}), deleteModel: vi.fn(async () => {}),
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
  api.prepare({ variant: { model: '9b', quant: 'q4_k_m' }, downloadSource: 'https://hf-mirror.com' })
  expect(service.prepare).toHaveBeenNthCalledWith(1, undefined)
  expect(service.prepare).toHaveBeenNthCalledWith(2, { variant: { model: '9b', quant: 'q4_k_m' }, downloadSource: 'https://hf-mirror.com' })
  api.select({ model: '9b', quant: 'q8_0' }, undefined)
  api.select({ model: '35b-a3b', quant: 'q8_0' }, { allowUnfit: true })
  expect(service.select.mock.calls).toEqual([[{ model: '9b', quant: 'q8_0' }, undefined],
    [{ model: '35b-a3b', quant: 'q8_0' }, { allowUnfit: true }]])
  await api.pause(); await api.cancel(); await api.chooseLocal(); await api.enable(); await api.disable(); await api.acknowledge()
  await api.acknowledgeSwitch()
  const commands = [service.pause, service.cancel, service.chooseLocal, service.enable, service.disable, service.acknowledge,
    service.acknowledgeSwitch]
  for (const method of commands) {
    expect(method).toHaveBeenCalledOnce()
  }
  await api.deleteModel()
  await api.deleteModel({ model: '4b', quant: 'q8_0' })
  expect(service.deleteModel.mock.calls).toEqual([[undefined], [{ model: '4b', quant: 'q8_0' }]])
})

it('turns a typed engine refusal into a coded Remote failure', () => {
  const { api, service } = fixture()
  const details = { preparing: { model: '9b', quant: 'q8_0' }, requested: { model: '4b', quant: 'q4_k_m' } } as const
  service.select.mockImplementationOnce(() => { throw new ReflexLifecycleError('preparing-other', 'busy', details) })
  const failure = remoteErrorOf((() => { try { api.select(details.requested, undefined) } catch (error) { return error } })())
  expect(failure).toMatchObject({ code: 'reflexLocal/preparing-other', details })
  service.prepare.mockImplementationOnce(() => { throw new ReflexLifecycleError('preparing-other', 'busy', details) })
  expect(remoteErrorOf((() => { try { api.prepare() } catch (error) { return error } })())?.code).toBe('reflexLocal/preparing-other')
  const unfit = { variant: { model: '35b-a3b', quant: 'q8_0' }, requiredBytes: 64e9, deviceBytes: 24e9 } as const
  service.select.mockImplementationOnce(() => { throw new ReflexLifecycleError('unfit', 'needs more memory', unfit) })
  expect(remoteErrorOf((() => { try { api.select(unfit.variant, undefined) } catch (error) { return error } })()))
    .toMatchObject({ code: 'reflexLocal/unfit', details: unfit })
})

it('propagates Host rejections unchanged', async () => {
  const { api, service } = fixture()
  service.prepare.mockImplementationOnce(() => { throw new Error('variant differs from the active download') })
  expect(() => { api.prepare({ variant: { model: '9b', quant: 'q4_k_m' } }) }).toThrow('variant differs')
  service.enable.mockRejectedValueOnce(new Error('not ready'))
  await expect(api.enable()).rejects.toThrow('not ready')
})

it('names Remote methods apart from client namespace service members', () => {
  // The client gateway rejects a namespace whose method shadows a RemoteNamespaceService member or field.
  const reserved = new Set(['has', 'remove', 'install', 'installDirect', 'installScoped', 'assertMethodAvailable',
    'ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace'])
  const methods = Object.getOwnPropertyNames(ReflexLocalController.prototype).filter(name => name !== 'constructor')
  expect(methods.filter(name => reserved.has(name))).toEqual([])
})
