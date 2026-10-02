/** Opt-in System3 feedback in the native Conversation input dock. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-experimental-system3/types'
import { System3Dock, type System3Actions } from './System3Dock.tsx'
import { System3TurnHead } from './TurnHead.tsx'
import { en, zh } from './locales.ts'

/** Native services required by this optional Client plugin. */
export const inject = ['slots', 'sessions', 'remote', 'remote.session', 'locale']
/** Register localized feedback and the native automatic-mode mutation.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
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
    }),
  }, System3Dock))
  ctx.slots.inject('conversation.chat.turnHead', () => ctx.slots.register({
    name: 'conversation.chat.turnHead', id: 'system3-route', order: 5, locale: 'system3',
  }, System3TurnHead))
}
