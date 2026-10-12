/** Opt-in System3 feedback in the native Conversation input dock. */
import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-experimental-system3/types'
import type { SubagentLiveRunId } from '@deepseek-ai/dsh-subagent/client'
import { System3Dock, type System3Actions } from './System3Dock.tsx'
import { System3TurnHead } from './TurnHead.tsx'
import { System3ComposerDelegation } from './ComposerDelegation.tsx'
import { installReflexSettings } from './reflex-settings.ts'
import { en, zh } from './locales.ts'

/** Native services required by this optional Client plugin. */
export const inject = ['remote']
/** Register localized feedback and the native automatic-mode mutation.
 * @param ctx - Client plugin context.
 */
function registerUi(ctx: Context): void {
  installReflexSettings(ctx)
  ctx.effect(() => ctx.locale.register('system3', { zh, en }), 'system3: dictionaries')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'system3', order: 5, locale: 'system3',
    inject: (sessionId): System3Actions => ({
      available: ctx.sessions.subagentAddress(sessionId) === undefined,
      onAutomatic: async () => {
        const result = await ctx.remote.session.resetModelSelection({ sessionId })
        if (!result.ok) throw result.error
      },
      onStop: async () => {
        const result = await ctx.remote.session.cancel({ sessionId })
        if (!result.ok) throw result.error
      },
      onSteer: async (runId, text) => {
        const result = await ctx.remote.subagents.steerByParent({ runId: runId as SubagentLiveRunId, parentSessionId: sessionId, text })
        if (!result.ok) throw result.error
      },
    }),
  }, System3Dock))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'system3-delegation', order: 5, locale: 'system3',
  }, System3ComposerDelegation))
  ctx.slots.inject('conversation.chat.turnHead', () => ctx.slots.register({
    name: 'conversation.chat.turnHead', id: 'system3-route', order: 5, locale: 'system3',
  }, System3TurnHead))
}

/** Mount this experimental namespace and withdraw its UI before its Remote.
 * @param ctx - Client runtime owning the experimental UI.
 * @param contribution - Generated Reflex Remote definitions.
 * @returns Disposer joining UI and Remote withdrawal.
 */
export async function mountSystem3(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['slots', 'sessions', 'remote.session', 'remote.subagents', 'locale', 'configForms',
    'remote.reflex', 'remote.credentials'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
