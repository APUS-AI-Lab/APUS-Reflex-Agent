/** Route line in the Conversation Turn header, shown as soon as the entry decision for that Turn is recorded and kept for earlier Turns. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-experimental-system3/types'
import { routeNotice } from './System3Dock.tsx'
import { reflexJudgmentText } from './reflex-judgment.ts'

/**
 * Name who handles the Turn's input, beside the native Turn process label.
 * @param props - The Turn location, projection subscription, and translations.
 * @returns The route or fallback line for the Turn that carried an entry input, otherwise null.
 */
export function System3TurnHead(props: Pick<PropsRuntime<'conversation.chat.turnHead'>, 'turn' | 'useProjection'> & PropsLocale<'system3'>) {
  const facts = props.useProjection('system3Runtime')
  const entry = facts?.entry?.turn === props.turn.turn ? facts.entry
    : facts?.history.findLast(value => value.turn === props.turn.turn)
  const skill = facts?.skill?.turn === props.turn.turn ? facts.skill : null
  const judgment = reflexJudgmentText(skill, props.t)
  if (judgment !== undefined) return <span>{judgment}</span>
  if (entry === undefined) return null
  const notice = routeNotice(entry, null, props.t)
  return notice === null ? null : <span>{notice}</span>
}
