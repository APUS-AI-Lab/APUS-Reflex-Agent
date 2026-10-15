/** The optional namespace, its three slot entries, and the enablement notice follow Client plugin disposal. */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, vi } from 'vitest'
import { apply as hostApply } from '../src/index.ts'
import { mountReflexLocal, inject } from '../src/client/mount.ts'
import type { ReflexLocalInjected, ReflexToast } from '../src/client/injected.ts'
import { ActivationPrompt } from '../src/client/ActivationPrompt.tsx'
import { EnabledToast } from '../src/client/EnabledToast.tsx'
import { PreparationChip } from '../src/client/PreparationChip.tsx'
import { EngineCard } from '../src/client/EngineCard.tsx'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import { FAST, Q4, Q8, snapshotOf } from './snapshot-fixture.client.ts'

const REMOTE: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-api-reflex-local', descriptors: [] }
const BUNDLE = '@deepseek-ai/dsh-experimental-reflex-local-bundle'

const observed = vi.hoisted(() => ({ onSnapshot: (_snapshot: ReflexSnapshot): void => {} }))
vi.mock('../src/client/readiness.ts', () => ({ observeReadiness: (_ctx: unknown, onSnapshot: (snapshot: ReflexSnapshot) => void) => {
  observed.onSnapshot = onSnapshot
  return { state: createSnapshotStore({ snapshot: null, connected: true, error: null }), dispose: async () => {} }
} }))

/** Narrow the erased registry payload before exercising its registered actions. */
function assertActions(value: Record<string, unknown>): asserts value is Record<string, unknown> & ReflexLocalInjected {
  for (const name of ['prepare', 'pause', 'cancel', 'enable', 'disable', 'remove', 'openDetails', 'reportFailure', 'dismissSlowChip', 'dismissToast', 'undoEnable']) {
    assert(typeof value[name] === 'function', name)
  }
  assert(typeof value.hooks === 'object' && value.hooks !== null)
}

async function fixture(fail = false) {
  const ctx = new Context(), unmount = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution).toBe(REMOTE)
      return unmount
    }
  }
  new Remote()
  const ok = () => vi.fn(async (..._args: unknown[]) => ({ ok: true, value: undefined }))
  const remote = { prepare: ok(), pause: ok(), cancel: ok(), enable: ok(), disable: ok(), deleteModel: ok(), acknowledge: ok() }
  ctx.provide('remote.reflexLocal', remote)
  const openBundle = vi.fn()
  ctx.provide('pluginNavigation', { openBundle })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'conversation.input.dock': { kind: 'list', scope: 'session' },
    'settings.reflex.local': { kind: 'single', scope: 'root' },
  } } as never, () => null)
  if (fail) vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
  return { ctx, unmount, remote, openBundle }
}

it('registers the card, prompt, and notice, forwards commands, and withdraws everything on disposal', async () => {
  hostApply()
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountReflexLocal(ctx, REMOTE) })
    await fiber
    const config = b.ctx.slots.entries('plugins.bundle.config')[0]!
    const activation = b.ctx.slots.entries('plugins.bundle.activation')[0]!
    const overlay = b.ctx.slots.entries('shell.overlay').find(entry => entry.component === EnabledToast)!
    expect(config).toMatchObject({ component: EngineCard, locale: 'reflex-local', options: { key: BUNDLE } })
    expect(activation).toMatchObject({ component: ActivationPrompt, locale: 'reflex-local', options: { key: BUNDLE } })
    expect(overlay).toMatchObject({ locale: 'reflex-local', options: { id: 'reflex-local.enabled-toast' } })
    const dock = b.ctx.slots.entries('conversation.input.dock')[0]!
    expect(dock).toMatchObject({ component: PreparationChip, locale: 'reflex-local', options: { id: 'reflex-local.preparation', order: 6 } })
    const actions = config.inject!()
    assertActions(actions)
    expect(activation.inject!()).toBe(actions)
    expect(overlay.inject!()).toBe(actions)
    expect(dock.inject!()).toBe(actions)
    const local = b.ctx.slots.entries('settings.reflex.local')[0]!
    expect(local).toMatchObject({ component: EngineCard, locale: 'reflex-local' })
    expect(local.inject!()).toBe(actions)
    actions.openDetails()
    expect(b.openBundle).toHaveBeenCalledWith(BUNDLE)
    expect(actions.hooks.reflexSlowChipDismissed.getSnapshot()).toBe(false)
    actions.dismissSlowChip()
    expect(actions.hooks.reflexSlowChipDismissed.getSnapshot()).toBe(true)
    actions.reportFailure(new Error('offline'))
    expect(actions.hooks.reflexToast.getSnapshot()).toEqual({ seq: 1, kind: 'actionFailed', message: 'offline' })
    actions.reportFailure('closed')
    expect(actions.hooks.reflexToast.getSnapshot()).toEqual({ seq: 2, kind: 'actionFailed', message: 'closed' })
    await actions.prepare({ variant: Q4 })
    expect(b.remote.prepare).toHaveBeenCalledWith({ variant: Q4 })
    await actions.pause(); await actions.cancel(); await actions.enable(); await actions.disable(); await actions.remove()
    for (const method of [b.remote.pause, b.remote.cancel, b.remote.enable, b.remote.disable, b.remote.deleteModel]) {
      expect(method).toHaveBeenCalledOnce()
    }
    const failure = { ok: false, error: new RemoteError('gateway/internal', 'offline', {}) }
    for (const [name, method] of [['prepare', 'prepare'], ['pause', 'pause'], ['cancel', 'cancel'], ['enable', 'enable'],
      ['disable', 'disable'], ['remove', 'deleteModel']] as const) {
      b.remote[method].mockResolvedValueOnce(failure as never)
      await expect(actions[name]()).rejects.toThrow('offline')
    }
    await fiber.dispose()
    for (const slot of ['plugins.bundle.config', 'plugins.bundle.activation', 'shell.overlay', 'conversation.input.dock', 'settings.reflex.local'] as const) {
      expect(b.ctx.slots.entries(slot)).toHaveLength(0)
    }
    expect(b.unmount).toHaveBeenCalledOnce()
  } finally { await b.ctx.fiber.dispose() }
})

it('announces each unacknowledged automatic enablement once and acknowledges it only when the notice closes', async () => {
  const b = await fixture()
  const pending = (at?: number) => snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST },
    at === undefined ? { enabled: true } : { enabled: true, unacknowledgedAutoEnableAt: at })
  const failure = { ok: false, error: new RemoteError('gateway/internal', 'offline', {}) } as never
  try {
    await b.ctx.plugin({ inject: [...inject], apply: ctx => mountReflexLocal(ctx, REMOTE) })
    const actions = b.ctx.slots.entries('plugins.bundle.config')[0]!.inject!()
    assertActions(actions)
    const toast = actions.hooks.reflexToast
    observed.onSnapshot(pending())
    expect(toast.getSnapshot()).toBeNull()
    observed.onSnapshot(pending(1000))
    expect(toast.getSnapshot()).toEqual<ReflexToast>({ seq: 1, kind: 'enabled' })
    expect(b.remote.acknowledge).not.toHaveBeenCalled()
    observed.onSnapshot(pending(1000))
    expect(toast.getSnapshot()).toEqual<ReflexToast>({ seq: 1, kind: 'enabled' })
    // A newer enablement replaces the notice without acknowledging the marker it still announces.
    observed.onSnapshot(pending(1500))
    expect(b.remote.acknowledge).not.toHaveBeenCalled()
    b.remote.acknowledge.mockResolvedValueOnce(failure)
    actions.dismissToast()
    expect(toast.getSnapshot()).toBeNull()
    expect(b.remote.acknowledge).toHaveBeenCalledOnce()
    actions.dismissToast()
    expect(b.remote.acknowledge).toHaveBeenCalledOnce()
    observed.onSnapshot(pending(2000))
    actions.reportFailure(new Error('offline'))
    expect(b.remote.acknowledge).toHaveBeenCalledTimes(2)
    observed.onSnapshot(pending(3000))
    actions.undoEnable()
    expect(toast.getSnapshot()).toBeNull()
    await vi.waitFor(() => { expect(b.remote.disable).toHaveBeenCalledOnce() })
    expect(toast.getSnapshot()).toBeNull()
    b.remote.disable.mockResolvedValueOnce(failure)
    observed.onSnapshot(pending(4000))
    actions.undoEnable()
    await vi.waitFor(() => { expect(toast.getSnapshot()).toEqual<ReflexToast>({ seq: 7, kind: 'undoFailed' }) })
    expect(b.remote.acknowledge).toHaveBeenCalledTimes(2)
  } finally { await b.ctx.fiber.dispose() }
})

it('rolls back the Remote contribution when the slot registration fails', async () => {
  const b = await fixture(true)
  try {
    await expect(mountReflexLocal(b.ctx, REMOTE)).rejects.toThrow('slot failed')
    expect(b.unmount).toHaveBeenCalledOnce()
  } finally { await b.ctx.fiber.dispose() }
})
