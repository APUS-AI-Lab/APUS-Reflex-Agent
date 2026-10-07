/** Route line in the Conversation Turn header, shown as soon as the entry decision for that Turn is recorded. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-experimental-system3/types'
import { routeNotice } from './System3Dock.tsx'

/**
 * Name who handles the Turn's input, beside the native Turn process label.
 * @param props - The Turn location, projection subscription, and translations.
 * @returns The route or fallback line for the Turn that carried the latest entry input, otherwise null.
 */
export function System3TurnHead(props: Pick<PropsRuntime<'conversation.chat.turnHead'>, 'turn' | 'useProjection'> & PropsLocale<'system3'>) {
  const entry = props.useProjection('system3Runtime')?.entry
  if (entry?.turn !== props.turn.turn) return null
  const notice = routeNotice(entry, null, props.t)
  return notice === null ? null : <span>{notice}</span>
}
