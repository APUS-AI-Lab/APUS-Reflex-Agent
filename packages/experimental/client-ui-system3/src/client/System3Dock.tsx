/** Truthful execution feedback: advice, adoption and actual response stay separate. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelection, ModelSelectionProjection, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { System3RuntimeView, System3SubagentRunView } from '@deepseek-ai/dsh-experimental-system3/types'
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
  /** Latest local submission not yet admitted; an entry decision for an earlier input is not shown as its route. */
  readonly pendingRequestId: SessionRequestId | null
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
/** The configured route shown as soon as the entry decision is recorded, before the model answers. */
function routeNotice(entry: System3RuntimeView['entry'] | undefined, pendingRequestId: SessionRequestId | null,
  t: TranslateNS<'system3'>): string | null {
  if (entry?.phase !== 'decided' || entry.route === null) return null
  if (pendingRequestId !== null && entry.requestId !== pendingRequestId) return null
  const route = entry.route.label ?? model(entry.suggested ?? entry.adopted, t)
  return t(entry.route.retained ? 'routeRetained' : 'routeChosen', { route })
}
/** Step categories come from providers; unknown categories read as other. */
function kindKey(kind: string): System3Key {
  switch (kind) {
    case 'message': return 'kindMessage'
    case 'reasoning': return 'kindReasoning'
    case 'command': return 'kindCommand'
    case 'file-change': return 'kindFileChange'
    case 'tool': return 'kindTool'
    case 'web-search': return 'kindWebSearch'
    default: return 'kindOther'
  }
}
function kindLabel(kind: string, t: TranslateNS<'system3'>): string {
  return t(kindKey(kind))
}
function runStateKey(state: string): System3Key {
  if (state === 'running') return 'runRunning'
  if (state === 'completed') return 'runCompleted'
  return state === 'aborted' ? 'runAborted' : 'runIncomplete'
}
/** Progress of the latest delegated run; elapsed time advances locally while the run is running.
 * @param props - The projected run snapshot and translations.
 * @returns One status line with elapsed time, completed step counts, and the step in progress.
 */
export function DelegationRun({ run, t }: { readonly run: System3SubagentRunView; readonly t: TranslateNS<'system3'> }) {
  const [now, setNow] = useState(() => Date.now())
  const running = run.state === 'running'
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [running])
  const elapsedMs = running ? Math.max(run.elapsedMs, now - run.startedAt) : run.elapsedMs
  const counts = Object.entries(run.completed).filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kindLabel(kind, t)} ${String(count)}`)
  return <p className={css.run} role="status" aria-live="polite">
    <span>{t(runStateKey(run.state), { provider: run.provider })}</span>
    <span>{t('runSeconds', { seconds: String(Math.round(elapsedMs / 1000)) })}</span>
    {counts.length > 0 && <span>{counts.join(' · ')}</span>}
    {running && run.current !== null && <span>{t('runCurrent', { kind: kindLabel(run.current, t) })}</span>}
  </p>
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
  const notice = routeNotice(facts?.entry, props.pendingRequestId, t)
  const route = facts?.entry?.route
  const suggestion = route?.retained === true ? t('continued')
    : route?.delegation ? route.label ?? route.delegation.tool : model(facts?.entry?.suggested, t)
  return <section className={css.dock} aria-label={t('title')}>
    <div className={css.bar}>
      <span className={css.dot} data-active={props.running || props.pending} aria-hidden="true" />
      <span role="status" aria-live="polite">{t(labelOf(props))}</span>
      {notice !== null && <span className={css.route} aria-live="polite">{notice}</span>}
      <span className={css.mode}>{t(fixed ? 'fixed' : 'auto')}</span>
      {fixed && props.available && <button className={css.button} disabled={switching || props.opening} onClick={() => { void change() }}>
        {t(switching ? 'resetting' : 'reset')}
      </button>}
    </div>
    {facts?.subagentRun && <DelegationRun run={facts.subagentRun} t={t} />}
    <details className={css.details}>
      <summary>{t('details')}</summary>
      <p className={css.muted}>{t('cloud')}</p>
      <p>{t('historical')}</p>
      <dl className={css.facts}>
        <dt>{t('suggestion')}</dt><dd>{suggestion}</dd>
        <dt>{t('adoption')}</dt><dd>{model(facts?.entry?.adopted, t)}</dd>
        <dt>{t('actual')}</dt><dd>{model(facts?.entry?.used, t)}</dd>
        {facts?.entry?.elapsedMs !== null && facts?.entry?.elapsedMs !== undefined && <><dt>{t('decisionTime')}</dt><dd>{facts.entry.elapsedMs} {t('milliseconds')}</dd></>}
        {facts?.entry?.route?.delegation && <><dt>{t('delegation')}</dt><dd>{t(facts.entry.route.delegation.called ? 'delegationCalled'
          : facts.entry.route.delegation.injected ? 'delegationInjected' : 'delegationSuggested', { tool: facts.entry.route.delegation.tool })}</dd></>}
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
  const pendingRequestId = props.useSession(s => s.pendingSubmissions.at(-1)?.requestId ?? null)
  const opening = props.useSession(s => s.openState !== 'open')
  const failed = props.useSession(s => s.promptError !== null || s.lastAgentError !== null)
  return <System3Feedback key={props.sessionId} facts={facts} selection={selection} running={running} pending={pending}
    pendingRequestId={pendingRequestId}
    opening={opening} failed={failed} available={props.available} onAutomatic={props.onAutomatic} t={props.t} />
}
