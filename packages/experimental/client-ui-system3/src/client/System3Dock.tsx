/** Truthful execution feedback: advice, adoption and actual response stay separate. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelection, ModelSelectionProjection, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { System3ProcessNoticeView, System3RuntimeView, System3SubagentRunView, System3TaskFrameView } from '@deepseek-ai/dsh-experimental-system3/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { System3Key } from './locales.ts'
import css from './System3Dock.module.css'
import { reflexJudgmentText } from './reflex-judgment.ts'

/** Mutations injected by the Conversation slot registrant. */
export interface System3Actions {
  readonly available: boolean
  /** Release the explicit human model choice through the native Session controller. */
  readonly onAutomatic: () => Promise<void>
  /** Cancel the Session's in-flight Turn, which also cancels its delegated run, through the native Session controller. */
  readonly onStop: () => Promise<void>
  /** Deliver the person's text to the running delegated run; rejects when the run refused it. */
  readonly onSteer: (runId: string, text: string) => Promise<void>
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
/** Entry outcomes after which the baseline answers because no route decision was available. */
const FALLBACK_TIMEOUT = new Set(['timeout'])
const FALLBACK_UNAVAILABLE = new Set(['provider-unavailable', 'transport', 'http', 'rate-limited', 'invalid-response'])
/**
 * One line naming who handles an input, available as soon as its entry decision is recorded.
 * @param entry - Latest projected entry facts.
 * @param pendingRequestId - Latest local submission not yet admitted; an earlier input's route is not shown for it.
 * @param t - System3 translations.
 * @returns The route or fallback line, or null while deciding, after an unrouted abstention, or for an earlier input.
 */
export function routeNotice(entry: System3RuntimeView['entry'] | undefined, pendingRequestId: SessionRequestId | null,
  t: TranslateNS<'system3'>): string | null {
  if (entry?.phase !== 'decided') return null
  if (pendingRequestId !== null && entry.requestId !== pendingRequestId) return null
  if (entry.route !== null) {
    const route = entry.route.label ?? model(entry.suggested ?? entry.adopted, t)
    const chosen = t(entry.route.retained ? 'routeRetained' : 'routeChosen', { route })
    return entry.avoided.length === 0 ? chosen
      : `${chosen} · ${t('routeAvoided', { routes: entry.avoided.map(value => value.label).join('、') })}`
  }
  if (entry.adopted === null || entry.outcome === null) return null
  if (FALLBACK_TIMEOUT.has(entry.outcome)) return t('fallbackTimeout', { model: model(entry.adopted, t) })
  if (FALLBACK_UNAVAILABLE.has(entry.outcome)) return t('fallbackUnavailable', { model: model(entry.adopted, t) })
  return null
}
/**
 * Format a duration for progress lines: seconds below one minute, then minutes and seconds.
 * @param ms - Duration in milliseconds.
 * @param t - System3 translations.
 * @returns Localized duration text.
 */
export function formatDuration(ms: number, t: TranslateNS<'system3'>): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return total < 60 ? t('runSeconds', { seconds: String(total) })
    : t('runMinutes', { minutes: String(Math.floor(total / 60)), seconds: String(total % 60) })
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
function runStateKey(run: System3SubagentRunView, turnRunning: boolean): System3Key {
  if (run.state === 'running') return Object.keys(run.completed).length === 0 && run.current === null ? 'runStarting' : 'runRunning'
  if (run.state === 'completed') return turnRunning ? 'runReviewing' : 'runCompleted'
  return run.state === 'aborted' ? 'runAborted' : 'runIncomplete'
}
function alertText(run: System3SubagentRunView, alert: NonNullable<System3SubagentRunView['alert']>, now: number,
  t: TranslateNS<'system3'>): string {
  if (alert.kind === 'overtime') return t('alertOvertime', { provider: run.provider, duration: formatDuration(alert.elapsedMs, t) })
  const since = now - run.startedAt - (run.lastStepAt ?? 0)
  return t(alert.kind === 'starting' ? 'alertStarting' : 'alertStalled', { provider: run.provider, duration: formatDuration(since, t) })
}
/** Upper bound of one mid-run input, matching the Host's `SUBAGENT_STEER_MAX_CHARS`. */
const STEER_MAX_CHARS = 2000
/** Inline form that sends one correction to the running delegated run; the text stays when sending fails.
 * @param props - The run id, the steer action, and translations.
 * @returns The input with its send button and failure notice.
 */
function SteerForm({ runId, onSteer, t }: {
  readonly runId: string
  readonly onSteer: (runId: string, text: string) => Promise<void>
  readonly t: TranslateNS<'system3'>
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const send = async (): Promise<void> => {
    const value = text.trim()
    if (value === '' || sending) return
    setSending(true); setFailed(false)
    try { await onSteer(runId, value); setText('') } catch { setFailed(true) } finally { setSending(false) }
  }
  return <form className={css.steer} onSubmit={(event) => { event.preventDefault(); void send() }}>
    <div className={css.steerInput}>
      <Input value={text} maxLength={STEER_MAX_CHARS} disabled={sending} aria-label={t('steerLabel')}
        placeholder={t('steerPlaceholder')} onChange={(event) => { setText(event.target.value) }} />
    </div>
    <button type="submit" className={css.button} disabled={sending || text.trim() === ''}>{t(sending ? 'steerSending' : 'steerSend')}</button>
    {failed && <span role="alert" className={css.error}>{t('steerFailed')}</span>}
  </form>
}
/** Progress of the latest delegated run; elapsed time advances locally while the run is running.
 * @param props - The projected run snapshot, the delegating Turn's state, the stop and steer actions, and translations.
 * @returns The status line, the child's latest note, accepted inputs, any undismissed attention alert with keep-waiting,
 *   steer, and stop actions, and the steer form while it is open.
 */
export function DelegationRun({ run, turnRunning, onStop, onSteer, t }: {
  readonly run: System3SubagentRunView
  /** Whether the delegating Turn is still running, so a finished run is still being checked. */
  readonly turnRunning: boolean
  /** Cancel the delegating Turn. */
  readonly onStop: () => Promise<void>
  /** Deliver one correction to the run. */
  readonly onSteer: (runId: string, text: string) => Promise<void>
  readonly t: TranslateNS<'system3'>
}) {
  const [steering, setSteering] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [stopFailed, setStopFailed] = useState(false)
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
  const alertKey = run.alert === null ? null : `${run.runId}:${run.alert.kind}:${String(run.alert.elapsedMs)}`
  const stop = async (): Promise<void> => {
    setStopping(true); setStopFailed(false)
    try { await onStop() } catch { setStopFailed(true) } finally { setStopping(false) }
  }
  return <div>
    <p className={css.run} role="status" aria-live="polite">
      <span>{t(runStateKey(run, turnRunning), { provider: run.provider })}</span>
      <span>{formatDuration(elapsedMs, t)}</span>
      {counts.length > 0 && <span>{counts.join(' · ')}</span>}
      {running && run.current !== null && <span>{t('runCurrent', { kind: kindLabel(run.current, t) })}</span>}
    </p>
    {running && run.note !== null && <p className={css.note}>{t('runNote', { note: run.note })}</p>}
    {run.steers.map(steer => <p key={`${String(steer.atMs)}:${steer.text}`} className={css.note}>
      {t('steerSent', { duration: formatDuration(steer.atMs, t), text: steer.text })}</p>)}
    {running && run.alert !== null && alertKey !== dismissed && <div className={css.alert} role="alert">
      <span>{alertText(run, run.alert, now, t)}</span>
      <span className={css.alertActions}>
        <button type="button" className={css.button} onClick={() => { setDismissed(alertKey) }}>{t('keepWaiting')}</button>
        {run.steerable && !steering && <button type="button" className={css.button} onClick={() => { setSteering(true) }}>{t('steerOpen')}</button>}
        <button type="button" className={css.button} disabled={stopping} onClick={() => { void stop() }}>{t('stopRun')}</button>
      </span>
      {stopFailed && <span className={css.error}>{t('stopFailed')}</span>}
    </div>}
    {run.steerable && (steering
      ? <SteerForm runId={run.runId} onSteer={onSteer} t={t} />
      : <button type="button" className={css.link} onClick={() => { setSteering(true) }}>{t('steerOpen')}</button>)}
  </div>
}
const NOTICE_KEYS: Readonly<Record<string, System3Key>> = { 'repeated-error': 'noticeRepeatedError',
  'failed-attempts': 'noticeFailedAttempts', 'no-progress': 'noticeNoProgress', 'missing-evidence': 'noticeMissingEvidence',
  'delegate-failures': 'noticeDelegateFailures' }
/** Render one process supervision finding; rules unknown to this Client show a generic label.
 * @param props - The finding and the translator.
 * @returns One notice line.
 */
export function ProcessNotice({ notice, t }: { readonly notice: System3ProcessNoticeView; readonly t: TranslateNS<'system3'> }) {
  const text = t(NOTICE_KEYS[notice.rule] ?? 'noticeOther', { subject: notice.subject ?? '', count: String(notice.count) })
  return <p className={css.note}>{notice.advised ? `${text} · ${t('noticeAdvised')}` : text}</p>
}
/** The person's requirements System3 keeps for the current task, collapsed to one line until opened.
 * @param props - The projected task frame and the translator.
 * @returns The count line and, when opened, the task and each requirement verbatim.
 */
export function TaskFrame({ frame, t }: { readonly frame: System3TaskFrameView; readonly t: TranslateNS<'system3'> }) {
  return <details className={css.details}>
    <summary>{t('taskFrame', { count: String(frame.items.length) })}</summary>
    <p className={css.muted}>{t('taskGoal', { text: frame.goal.text })}</p>
    {frame.items.map(item => <p key={item.messageId} className={css.note}>{t('taskItem', { text: item.text })}</p>)}
  </details>
}
const REFLEX_STATES: Readonly<Record<string, System3Key>> = {
  intent: 'reflexIntent', accepted: 'reflexAccepted', unknown: 'reflexUnknown', improved: 'reflexImproved',
  unchanged: 'reflexUnchanged', inconclusive: 'reflexInconclusive', limit: 'reflexLimit', stale: 'reflexStale',
}
const REFLEX_ACTIONS: Readonly<Record<string, System3Key>> = {
  observe: 'reflexObserve', diagnose: 'reflexDiagnose', verify: 'reflexVerify', narrow: 'reflexNarrow', realign: 'reflexRealign',
}
const RECOVERY_STATES: Readonly<Record<string, System3Key>> = {
  intent: 'recoveryIntent', continued: 'recoveryContinued', completed: 'recoveryCompleted',
  stale: 'recoveryStale', unknown: 'recoveryUnknown',
}

function reflexTimelineText(item: NonNullable<NonNullable<System3RuntimeView['reflex']>['timeline']>[number], t: TranslateNS<'system3'>): string {
  if (item.kind === 'supervision') return t('reflexTimelineSupervision', {
    state: t(REFLEX_STATES[item.state ?? ''] ?? 'reflexOther'), action: t(REFLEX_ACTIONS[item.action ?? ''] ?? 'reflexOther'),
  })
  if (item.kind === 'recovery') return t('reflexTimelineRecovery', { state: t(RECOVERY_STATES[item.state ?? ''] ?? 'recoveryUnknown') })
  if (item.kind === 'context') return t('reflexTimelineContext', {
    action: t(item.action === 'remove' ? 'reflexRemoveAction' : 'reflexRestoreAction'),
    count: String(item.count ?? 0),
  })
  return t('reflexTimelineEvidence')
}

/** Render durable Reflex actions without conflating delivery with effectiveness.
 * @param props - Runtime projection and localized labels.
 * @returns Supervision evidence and recoverable-context operation status.
 */
export function ReflexRuntimeFeedback({ reflex, t }: { readonly reflex: NonNullable<System3RuntimeView['reflex']>; readonly t: TranslateNS<'system3'> }) {
  return <div>
    {reflex.observing && <p className={css.run} role="status" aria-live="polite">{t('reflexObserving')}</p>}
    {reflex.recovery && <details className={css.details}>
      <summary>{t('reflexRecovery', { state: t(RECOVERY_STATES[reflex.recovery.state] ?? 'reflexOther') })}</summary>
      <p className={css.muted}>{t(reflex.recovery.reason === 'retry-budget' ? 'recoveryRetryBudget' : 'recoveryInactivityBudget')}</p>
    </details>}
    {reflex.supervision && <details className={css.details}>
      <summary>{t('reflexSupervision', { state: t(REFLEX_STATES[reflex.supervision.state] ?? 'reflexOther') })}</summary>
      <p className={css.muted}>{t(REFLEX_ACTIONS[reflex.supervision.action] ?? 'reflexOther')}</p>
      <p className={css.muted}>{t('reflexEvidence', { count: String(reflex.supervision.evidenceCount) })}</p>
    </details>}
    {reflex.context && <p className={css.note} role="status">{t(reflex.context.action === 'remove' ? 'reflexContextRemoved' : 'reflexContextRestored', { count: String(reflex.context.targetsCount) })}</p>}
    {reflex.timeline.length > 0 && <details className={css.details}>
      <summary>{t('reflexTimeline', { count: String(reflex.timeline.length) })}</summary>
      {reflex.timeline.map((item, index) => <p className={css.note} key={`${item.at}:${item.kind}:${String(index)}`}>{reflexTimelineText(item, t)}</p>)}
    </details>}
  </div>
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
  const currentSkill = props.pending && (props.pendingRequestId === null || facts?.skill?.requestId !== props.pendingRequestId)
    ? null : facts?.skill
  const judgment = props.opening ? undefined : reflexJudgmentText(currentSkill, t)
  const fixed = selection?.mode === 'fixed'
  const route = facts?.entry?.route
  const suggestion = route?.retained === true ? t('continued')
    : route?.delegation ? route.label ?? route.delegation.tool : model(facts?.entry?.suggested, t)
  return <section className={css.dock} aria-label={t('title')}>
    <div className={css.bar}>
      <span className={css.dot} data-active={props.running || props.pending} aria-hidden="true" />
      <span role="status" aria-live="polite">{judgment ?? t(labelOf(props))}</span>
      <span className={css.mode}>{t(fixed ? 'fixed' : 'auto')}</span>
      {fixed && props.available && <button className={css.button} disabled={switching || props.opening} onClick={() => { void change() }}>
        {t(switching ? 'resetting' : 'reset')}
      </button>}
    </div>
    {facts?.subagentRun && <DelegationRun run={facts.subagentRun} turnRunning={props.running} onStop={props.onStop}
      onSteer={props.onSteer} t={t} />}
    {facts?.notices.map((notice, index) => <ProcessNotice key={`${String(index)}:${notice.rule}`} notice={notice} t={t} />)}
    {facts?.reflex && <ReflexRuntimeFeedback reflex={facts.reflex} t={t} />}
    {facts?.interjection && <p className={css.note} role="status">{t('interjectionSteered')}</p>}
    {facts?.taskFrame && facts.taskFrame.items.length > 0 && <TaskFrame frame={facts.taskFrame} t={t} />}
    {/* From the injected instruction until the delegated run's first snapshot, including the tool call's startup. */}
    {!facts?.subagentRun && facts?.entry?.route?.delegation?.injected === true
      && props.running && <p className={css.run} role="status" aria-live="polite">{t('delegationPreparing')}</p>}
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
    opening={opening} failed={failed} available={props.available} onAutomatic={props.onAutomatic} onStop={props.onStop}
    onSteer={props.onSteer} t={props.t} />
}
