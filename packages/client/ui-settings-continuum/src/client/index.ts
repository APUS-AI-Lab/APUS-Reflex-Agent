/** Browser settings adapter for the Reflex-only Continuum memory switch. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ContinuumRow } from './ContinuumRow.tsx'
import { CONTINUUM_NS, ContinuumSettingsController } from './continuum-settings-controller.ts'
import { en, zh, type ContinuumSettingsLocaleKey } from './locales.ts'
export { CONTINUUM_NS, ContinuumSettingsController } from './continuum-settings-controller.ts'
export { ContinuumRow } from './ContinuumRow.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'settings.continuum': ContinuumSettingsLocaleKey } }
export const inject = ['slots', 'locale', 'configForms']
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.continuum', { zh, en }), 'ui-settings-continuum: dictionaries')
  ctx.effect(() => ctx.configForms.whileServed([CONTINUUM_NS], () => {
    const controller = new ContinuumSettingsController(ctx.configForms.get(CONTINUUM_NS))
    const dispose = ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item', id: 'continuum-memory', order: 30, locale: 'settings.continuum', inject: () => controller.inject(),
    }, ContinuumRow))
    return () => { dispose(); controller.dispose() }
  }), 'ui-settings-continuum: settings row')
}
