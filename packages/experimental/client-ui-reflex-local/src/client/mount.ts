/** Source-safe lifecycle for the local decision engine Remote and its browser surfaces. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-api-reflex-local/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
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

export const inject = ['remote', 'slots', 'locale', 'pluginNavigation']

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
  let seq = 0, announced: number | undefined
  // The Host keeps an automatic enablement unacknowledged across restarts. Closing its notice acknowledges it, so a page
  // closed while the notice is visible announces it again on the next load; a successful undo clears it through `disable()`.
  const replace = (next: ReflexToast | null): void => {
    const closing = toast.getSnapshot()
    toast.set(next)
    if (closing?.kind !== 'enabled' || next?.kind === 'enabled') return
    settled(remote.acknowledge()).catch(() => {
      // A failed acknowledgement leaves the marker set; another client or a later load announces it again.
    })
  }
  const show = (kind: 'enabled' | 'undoFailed'): void => { seq += 1; replace({ seq, kind }) }
  const readiness = observeReadiness(ctx, ({ unacknowledgedAutoEnableAt: at }) => {
    if (at === undefined || at === announced) return
    announced = at
    show('enabled')
  })
  ctx.effect(() => readiness.dispose)
  const slowChipDismissed = createSnapshotStore(false)
  const disable = (): Promise<void> => settled(remote.disable())
  const actions: ReflexLocalInjected = {
    hooks: { reflexReadiness: readiness.state, reflexToast: toast, reflexSlowChipDismissed: slowChipDismissed },
    prepare: options => settled(remote.prepare(options)),
    pause: () => settled(remote.pause()),
    cancel: () => settled(remote.cancel()),
    enable: () => settled(remote.enable()),
    disable,
    remove: () => settled(remote.remove()),
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
  }
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config',
    key: BUNDLE, locale: NS, inject: () => actions,
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
  const ui = ctx.inject(['remote.reflexLocal', 'slots', 'locale', 'pluginNavigation'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
