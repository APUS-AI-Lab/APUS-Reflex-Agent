/** Source-safe lifecycle for the local decision engine Remote and its browser surfaces. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-api-reflex-local/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { ActivationPrompt } from './ActivationPrompt.tsx'
import { EnabledToast } from './EnabledToast.tsx'
import { EngineCard } from './EngineCard.tsx'
import type { ReflexLocalInjected, ReflexToast } from './injected.ts'
import { en, NS, zh } from './locales.ts'
import { observeReadiness } from './readiness.ts'
import { PreparationChip } from './PreparationChip.tsx'

export const inject = ['remote', 'slots', 'locale', 'pluginNavigation', 'configForms']

/** Settings namespace of the Jev entry, whose `enabled` field is the Reflex master switch. */
const JEV_NS = 'jev'

/** Package name keying the bundle page entries. */
const BUNDLE = '@deepseek-ai/dsh-experimental-reflex-local-bundle'

async function settled(call: Promise<RemoteResult<unknown>>): Promise<void> {
  const result = await call
  if (!result.ok) throw result.error
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const toast = createSnapshotStore<ReflexToast | null>(null)
  const remote = ctx.remote.reflexLocal
  let seq = 0, announcedEnable: number | undefined, announcedSwitch: number | undefined
  const localChosen = createSnapshotStore<boolean | null>(null)
  // The Host keeps an automatic enablement and a background model switch unacknowledged across restarts. Closing a notice
  // acknowledges it, so a page closed while it is visible announces it again on the next load; a newer notice of the same
  // kind replaces it without acknowledging the marker it still announces.
  const replace = (next: ReflexToast | null): void => {
    const closing = toast.getSnapshot()
    toast.set(next)
    if (closing === null || closing.kind === next?.kind) return
    const acknowledged = closing.kind === 'enabled' ? remote.acknowledge() : closing.kind === 'switched' ? remote.acknowledgeSwitch() : undefined
    if (acknowledged === undefined) return
    settled(acknowledged).catch(() => {
      // A failed acknowledgement leaves the marker set; another client or a later load announces it again.
    })
  }
  const show = (kind: 'enabled' | 'undoFailed'): void => { seq += 1; replace({ seq, kind }) }
  const readiness = observeReadiness(ctx, (snapshot) => {
    const { unacknowledgedAutoEnableAt: enabledAt, unacknowledgedSwitch: change, localChosen: chosen } = snapshot
    if (chosen !== localChosen.getSnapshot()) localChosen.set(chosen)
    if (enabledAt !== undefined && enabledAt !== announcedEnable) {
      announcedEnable = enabledAt
      show('enabled')
    }
    if (change !== undefined && change.at !== announcedSwitch) {
      announcedSwitch = change.at
      seq += 1
      replace({ seq, kind: 'switched', change })
    }
  })
  ctx.effect(() => readiness.dispose)
  ctx.provide('reflexLocalMode', { chosen: localChosen, choose: () => settled(remote.chooseLocal()) })
  const jev = ctx.configForms.get<{ enabled?: boolean }>(JEV_NS)
  const masterOf = (): boolean | null => { const { status, value } = jev.getSnapshot(); return status === 'ready' ? value?.enabled !== false : null }
  const master = createSnapshotStore(masterOf())
  ctx.effect(() => jev.subscribe(() => { master.set(masterOf()) }))
  const slowChipDismissed = createSnapshotStore(false)
  const disable = (): Promise<void> => settled(remote.disable())
  const actions: ReflexLocalInjected = {
    hooks: { reflexReadiness: readiness.state, reflexToast: toast, reflexMaster: master, reflexSlowChipDismissed: slowChipDismissed },
    prepare: options => settled(remote.prepare(options)),
    pause: () => settled(remote.pause()),
    cancel: () => settled(remote.cancel()),
    enable: () => settled(remote.enable()),
    disable,
    deleteModel: variant => settled(remote.deleteModel(variant)),
    openDetails: () => { ctx.pluginNavigation.openBundle(BUNDLE) },
    dismissSlowChip: () => { slowChipDismissed.set(true) },
    reportFailure: (error) => {
      seq += 1
      replace({ seq, kind: 'actionFailed', message: error instanceof Error ? error.message : String(error) })
    },
    dismissToast: () => { replace(null) },
    undoEnable: () => {
      toast.set(null)
      disable().catch(() => { show('undoFailed') })
    },
    undoSwitch: (change) => {
      replace(null)
      settled(remote.select(change.from, undefined)).catch(() => { show('undoFailed') })
    },
  }
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config',
    key: BUNDLE, locale: NS, inject: () => actions,
  }, EngineCard))
  // The Reflex settings page's local connection mode; the bundle page keeps the same card for plugin-page navigation.
  ctx.slots.inject('settings.reflex.local', () => ctx.slots.register({ name: 'settings.reflex.local',
    locale: NS, inject: () => actions,
  }, EngineCard))
  ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation',
    key: BUNDLE, locale: NS, inject: () => actions,
  }, ActivationPrompt))
  // Beside the System3 decision row (order 5), above the Goal bar (order 10).
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock',
    id: 'reflex-local.preparation', order: 6, locale: NS, inject: () => actions,
  }, PreparationChip))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay',
    id: 'reflex-local.enabled-toast', locale: NS, inject: () => actions,
  }, EnabledToast))
}

/**
 * Mount the experimental namespace without adding it to stable API Remotes.
 * @param ctx - Client runtime owning the Remote, dictionaries and slots.
 * @param contribution - generated local decision engine Remote definitions.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function mountReflexLocal(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.reflexLocal', 'slots', 'locale', 'pluginNavigation', 'configForms'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
