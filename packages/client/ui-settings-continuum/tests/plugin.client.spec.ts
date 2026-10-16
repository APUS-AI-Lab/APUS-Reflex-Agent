/** The Continuum row registers into the Reflex section while its Host namespace is served and withdraws on disposal. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { expect, it, vi } from 'vitest'
import { apply as hostApply } from '../src/index.ts'
import { apply, CONTINUUM_NS, ContinuumRow } from '../src/client/index.ts'
import type { ContinuumSettingsFace } from '../src/client/continuum-settings-controller.ts'

it('registers the row while the namespace is served and withdraws it with the plugin', async () => {
  expect(() => { hostApply() }).not.toThrow()
  const ctx = new Context(), form = stubConfigForm<{ enabled?: boolean }>()
  form.publish({ status: 'ready', writable: true, value: {} })
  const whileServed = vi.fn((namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) =>
    register(new Set(namespaces)))
  ctx.provide('configForms', { get: vi.fn(() => form.scope), whileServed } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'settings.reflex.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  const fiber = ctx.plugin({ inject: ['slots', 'locale', 'configForms'], apply })
  await fiber
  expect(whileServed).toHaveBeenCalledWith([CONTINUUM_NS], expect.any(Function))
  const entry = ctx.slots.entries('settings.reflex.item')[0]!
  expect(entry).toMatchObject({ component: ContinuumRow, locale: 'settings.continuum', options: { id: 'continuum-memory', order: 30 } })
  const { setEnabled } = entry.inject!()
  await (setEnabled as ContinuumSettingsFace['setEnabled'])(true)
  expect(form.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enabled'], value: true }], undefined)
  await fiber.dispose()
  expect(ctx.slots.entries('settings.reflex.item')).toHaveLength(0)
  expect(form.listenerCount()).toBe(0)
})
