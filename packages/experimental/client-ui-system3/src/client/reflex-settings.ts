/** Dedicated top-level Reflex settings registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ReflexSettings } from './ReflexSettings.tsx'
import { PRESTEP_NS, ReflexCardController, REFLEX_NS } from './reflex-settings-controller.ts'
import { en, zh, type ReflexSettingsKey } from './reflex-settings-locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Reflex connection and capability status copy. */
    'settings.reflex': ReflexSettingsKey
  }
}

/** Register the dedicated section independently from ordinary chat-model settings.
 * @param ctx - Client context with settings and authenticated remote services.
 */
export function installReflexSettings(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.reflex', { zh, en }), 'reflex: settings dictionaries')
  const controller = new ReflexCardController(ctx.configForms.get(REFLEX_NS), ctx, ctx.configForms.get(PRESTEP_NS))
  ctx.effect(() => () =>{  controller.dispose() }, 'reflex: settings form')
  ctx.inject(['reflexLocalMode'], (inner) => { inner.effect(() => controller.attachLocalMode(inner.reflexLocalMode), 'reflex: local mode') })
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) =>{  controller.refreshCredential(ref) }), 'reflex: credentials invalidation')
  const t = ctx.locale.bind('settings.reflex')
  const face = controller.inject()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'reflex-model', order: 12, label: () => t('title'), locale: 'settings.reflex', inject: () => face,
    children: { 'settings.reflex.item': { kind: 'list', scope: 'root' }, 'settings.reflex.local': { kind: 'single', scope: 'root' } },
  }, ReflexSettings))
}
