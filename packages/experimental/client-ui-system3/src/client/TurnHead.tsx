/** Route line in the Conversation Turn header, shown as soon as the entry decision for that Turn is recorded and kept for earlier Turns. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-experimental-system3/types'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { routeNotice, sourceKey } from './System3Dock.tsx'
import { reflexJudgmentText } from './reflex-judgment.ts'

/**
 * Name who handles the Turn's input and where that decision ran, beside the native Turn process label.
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
  if (notice === null) return null
  const source = sourceKey(entry)
  if (source === null) return <span>{notice}</span>
  return <span>{notice} · {source === 'sourceLocal'
    ? <Tooltip label={props.t('sourceLocalDetail')} side="bottom" delayMs={300}><span tabIndex={0}>{props.t(source)}</span></Tooltip>
    : props.t(source)}</span>
}
