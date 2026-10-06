/** Truthful execution feedback: advice, adoption and actual response stay separate. */
import { useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelection, ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { System3RuntimeView } from '@deepseek-ai/dsh-experimental-system3/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { System3Key } from './locales.ts'
import css from './System3Dock.module.css'

/** Mutations injected by the Conversation slot registrant. */
export interface System3Actions {
  readonly available: boolean
  /** Release the explicit human model choice through the native Session controller. */
  readonly onAutomatic: () => Promise<void>
}
/** Pure view inputs, independent of transport subscription ownership. */
export interface System3FeedbackProps extends System3Actions {
  readonly facts: System3RuntimeView | null | undefined
  readonly selection: ModelSelectionProjection | null | undefined
  readonly running: boolean
  readonly pending: boolean
  readonly opening: boolean
  readonly failed: boolean
  readonly t: TranslateNS<'system3'>
}
function labelOf(props: System3FeedbackProps): System3Key {
  if (props.opening) return 'loading'
  if (props.failed) return 'interrupted'
  if (props.pending) return props.facts?.entry?.phase === 'deciding' ? 'deciding' : 'received'
  if (props.running) return 'running'
  return props.facts?.entry?.used ? 'settled' : 'ready'
}
function model(value: ModelSelection | null | undefined, t: TranslateNS<'system3'>): string {
  return value ? `${value.provider} / ${value.model}${value.reasoningEffort ? ` · ${value.reasoningEffort}` : ''}` : t('none')
}
/** Render observed progress and allow a fixed Session to return to automatic mode.
 * @param props - Persisted facts and live Session status.
 * @returns Compact, expandable execution feedback.
 */
export function System3Feedback(props: System3FeedbackProps) {
  const { facts, selection, t } = props
  const [switching, setSwitching] = useState(false)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const change = async (): Promise<void> => {
    if (pending.current) return
    pending.current = true; setSwitching(true); setFailed(false)
    try { await props.onAutomatic() }
    catch { setFailed(true) }
    finally { pending.current = false; setSwitching(false) }
  }
  const fixed = selection?.mode === 'fixed'
  return <section className={css.dock} aria-label={t('title')}>
    <div className={css.bar}>
      <span className={css.dot} data-active={props.running || props.pending} aria-hidden="true" />
      <span role="status" aria-live="polite">{t(labelOf(props))}</span>
      <span className={css.mode}>{t(fixed ? 'fixed' : 'auto')}</span>
      {fixed && props.available && <button className={css.button} disabled={switching || props.opening} onClick={() => { void change() }}>
        {t(switching ? 'resetting' : 'reset')}
      </button>}
    </div>
    <details className={css.details}>
      <summary>{t('details')}</summary>
      <p className={css.muted}>{t('cloud')}</p>
      <p>{t('historical')}</p>
      <dl className={css.facts}>
        <dt>{t('suggestion')}</dt><dd>{model(facts?.entry?.suggested, t)}</dd>
        <dt>{t('adoption')}</dt><dd>{model(facts?.entry?.adopted, t)}</dd>
        <dt>{t('actual')}</dt><dd>{model(facts?.entry?.used, t)}</dd>
        {facts?.entry?.elapsedMs !== null && facts?.entry?.elapsedMs !== undefined && <><dt>{t('decisionTime')}</dt><dd>{facts.entry.elapsedMs} {t('milliseconds')}</dd></>}
        <dt>{t('skill')}</dt><dd>{facts?.skill?.selected
          ? `${facts.skill.selected} · ${t(facts.skill.injected ? 'injected' : 'selected')}` : t('skillSkipped')}</dd>
      </dl>
    </details>
    {failed && <p role="alert" className={css.error}>{t('failed')}</p>}
  </section>
}
/** Bind the view to native Session and projection subscriptions.
 * @param props - Standard Conversation dock capabilities and injected mutation.
 * @returns System3 feedback for this Session.
 */
export function System3Dock(props: Pick<PropsRuntime<'conversation.input.dock'>, 'useProjection' | 'useSession' | 'sessionId'> & PropsLocale<'system3'> & System3Actions) {
  const facts = props.useProjection('system3Runtime')
  const selection = props.useProjection('modelSelection')
  const running = props.useSession(s => s.running)
  const pending = props.useSession(s => s.pendingSubmissions.length > 0 || s.awaitingFirstTurn)
  const opening = props.useSession(s => s.openState !== 'open')
  const failed = props.useSession(s => s.promptError !== null || s.lastAgentError !== null)
  return <System3Feedback key={props.sessionId} facts={facts} selection={selection} running={running} pending={pending}
    opening={opening} failed={failed} available={props.available} onAutomatic={props.onAutomatic} t={props.t} />
}
