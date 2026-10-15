/** The local decision engine card in the Reflex page's local mode and on its bundle page: a model dropdown with one primary action. */
import { useState } from 'react'
import {
  Button, IconEllipsisOutlineRegular, Menu, StateDot, type MenuEntry, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {
  ReflexFailure, ReflexModelOption, ReflexPreparation, ReflexPrepareOptions, ReflexRunnerStatus, ReflexSnapshot, ReflexVariant,
} from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { ReflexLocalInjected } from './injected.ts'
import type { NS, ReflexLocalKey } from './locales.ts'
import { cancelCopy, ConfirmDialog, type ConfirmCopy } from './ConfirmDialog.tsx'
import { ModelSelect } from './ModelSelect.tsx'
import { memoryText, optionOf, sameVariant, shortVariantName, sizeText } from './size.ts'
import css from './ReflexLocal.module.css'

/** Registration shares for the Reflex local-mode body and the bundle configuration entry. */
export type EngineCardProps = PropsLocale<typeof NS> & Pick<InjectFace<ReflexLocalInjected>,
  'useReflexReadiness' | 'useReflexMaster' | 'prepare' | 'pause' | 'cancel' | 'enable' | 'disable' | 'deleteModel'>

type Translate = EngineCardProps['t']
type ButtonVariant = 'primary' | 'outline'

/** The status badge of the variant the card describes. */
type CardState =
  | 'unsupported' | 'checking' | 'absent' | 'downloaded' | 'preparing' | 'verifying' | 'testing' | 'paused'
  | 'inUse' | 'off' | 'fault' | 'masterOff'

/** A preparation task that names its variant and has not failed. */
type Task = Extract<ReflexPreparation, { readonly phase: 'downloading' | 'paused' | 'verifying' | 'testing' }>

/** Commands one card state offers, already bound to the Host calls. */
interface CardCommands {
  /** Make the variant active, downloading, resuming, or re-testing it first when needed. */
  readonly choose: (variant: ReflexVariant) => void
  readonly pause: () => void
  readonly enable: () => void
  readonly disable: () => void
}

/** The single primary action; one without `onClick` states a fact and stays disabled. */
interface CardButton {
  readonly key: ReflexLocalKey
  readonly params?: Record<string, string>
  readonly variant: ButtonVariant
  readonly onClick?: () => void
}

/** Secondary actions the "⋯" menu offers for a state. */
type CardMenuAction = 'cancel' | 'delete'

/** What the described variant renders: its badge, one fact line, one primary action, and its secondary actions. */
interface CardContent {
  readonly state: CardState
  readonly percent?: string
  readonly fact?: string
  readonly primary?: CardButton
  readonly menu: readonly CardMenuAction[]
  readonly progress?: { readonly completedBytes: number; readonly totalBytes: number }
}

/** A confirmation the card is waiting on. */
type Confirmation =
  | { readonly kind: 'delete'; readonly variant: ReflexVariant }
  | { readonly kind: 'cancel'; readonly bytes: number }
  | { readonly kind: 'switch'; readonly variant: ReflexVariant }

const TONES: Readonly<Record<CardState, StateDotState>> = {
  unsupported: 'idle', checking: 'ongoing', absent: 'idle', downloaded: 'idle', preparing: 'ongoing', verifying: 'ongoing',
  testing: 'ongoing', paused: 'idle', inUse: 'done', off: 'idle', fault: 'error', masterOff: 'warning',
}
const LABELS: Readonly<Record<CardState, ReflexLocalKey>> = {
  unsupported: 'state.unsupported', checking: 'state.checking', absent: 'state.absent', downloaded: 'state.downloaded',
  preparing: 'state.downloading', verifying: 'state.verifying', testing: 'state.testing', paused: 'state.paused',
  inUse: 'state.enabled', off: 'state.disabled', fault: 'state.failed', masterOff: 'state.masterOff',
}
const SOURCE = 'source:'

function failureText(failure: ReflexFailure, t: Translate): string {
  switch (failure.kind) {
    case 'download': return t(`failure.download.${failure.download.reason}`, { status: String(failure.download.status) })
    case 'disk': return t('failure.disk', { need: sizeText(failure.requiredBytes, t), free: sizeText(failure.availableBytes, t) })
    case 'runner': return t('failure.runner')
    case 'self-test': return t('failure.self-test')
    /* v8 ignore next 2 -- closed-union backstop; only reached if a failure kind is forged */
    default: return assertNever(failure)
  }
}

function percentOf(progress: { readonly completedBytes: number; readonly totalBytes: number }): string {
  return String(Math.floor(progress.completedBytes / progress.totalBytes * 100))
}

function taskOf(preparation: ReflexPreparation): Task | undefined {
  switch (preparation.phase) {
    case 'downloading':
    case 'paused':
    case 'verifying':
    case 'testing': return preparation
    default: return undefined
  }
}

/** The variant a freshly opened card describes: the active model, else the one preparation names, else the recommendation. */
function initialDraft(snapshot: ReflexSnapshot): ReflexVariant | undefined {
  const { preparation } = snapshot
  return snapshot.active ?? ('variant' in preparation ? preparation.variant : undefined) ?? snapshot.recommended
}

function runnerFact(runner: Exclude<ReflexRunnerStatus, { readonly state: 'failed' }>, preparation: ReflexPreparation, t: Translate): string {
  switch (runner.state) {
    case 'running': {
      const size = sizeText(runner.approxResidentBytes, t)
      return preparation.phase === 'ready'
        ? t('runner.runningTimed', { size, seconds: (preparation.selfTest.decisionMs / 1000).toFixed(1) })
        : t('runner.running', { size })
    }
    case 'starting': return t('runner.starting')
    case 'stopped': return t('runner.stopped')
    /* v8 ignore next 2 -- closed-union backstop; only reached if a runner state is forged */
    default: return assertNever(runner)
  }
}

/** The active model: in use, off (kept), slow, faulted, or stopped by the master switch. */
function activeContent(snapshot: ReflexSnapshot, active: ReflexModelOption, run: CardCommands, t: Translate): CardContent {
  const { runner } = snapshot
  if (runner.state === 'failed') {
    return { state: 'fault', fact: t('runner.failed', { reason: runner.reason }), menu: ['delete'],
      primary: { key: 'enable', variant: 'primary', onClick: run.enable } }
  }
  if (!snapshot.reflexEnabled) return { state: 'masterOff', fact: t('masterOff'), menu: ['delete'] }
  if (snapshot.enabled) {
    return { state: 'inUse', fact: runnerFact(runner, snapshot.preparation, t), menu: ['delete'],
      primary: { key: 'disable', variant: 'outline', onClick: run.disable } }
  }
  const slow = active.inventory.selfTest === 'slow'
  // Turning local judgments on starts the runner first and routes only after it answers.
  return { state: 'off', fact: t(runner.state === 'starting' ? 'runner.starting' : slow ? 'slow' : 'stopped'), menu: ['delete'],
    primary: { key: slow ? 'enableAnyway' : 'enable', variant: 'primary', onClick: run.enable } }
}

function taskContent(task: Task, run: CardCommands, t: Translate): CardContent {
  switch (task.phase) {
    case 'downloading': return { state: 'preparing', progress: task, percent: percentOf(task), menu: ['cancel'],
      fact: t('progress', { completed: sizeText(task.completedBytes, t), total: sizeText(task.totalBytes, t) }),
      primary: { key: 'pause', variant: 'outline', onClick: run.pause } }
    case 'paused': return { state: 'paused', progress: task, fact: t('paused', { percent: percentOf(task) }), menu: ['cancel'],
      primary: { key: 'resume', variant: 'primary', onClick: () => { run.choose(task.variant) } } }
    case 'verifying':
    case 'testing': return { state: task.phase, fact: t(task.phase), menu: ['cancel'] }
    /* v8 ignore next 2 -- closed-union backstop; only reached if a phase is forged */
    default: return assertNever(task)
  }
}

/** Using a downloaded file that has no passing self-test first verifies and self-tests it. */
function useKey(option: ReflexModelOption, switching: boolean): ReflexLocalKey {
  switch (option.inventory.selfTest) {
    case 'passed': return 'use'
    case 'slow': return 'useAnyway'
    default: return switching ? 'verifySwitch' : 'verifyEnable'
  }
}

/** A model that is neither active nor being prepared, described by what this Host holds of it. */
function inventoryContent(snapshot: ReflexSnapshot, option: ReflexModelOption, run: CardCommands, t: Translate): CardContent {
  const size = sizeText(option.bytes, t), memory = memoryText(option.minMemoryBytes, t)
  const choose = (): void => { run.choose(option) }
  switch (option.inventory.state) {
    case 'downloaded': return { state: 'downloaded', fact: t('optionFacts', { size, memory }), menu: ['delete'],
      primary: { key: useKey(option, snapshot.active !== undefined), variant: 'primary', onClick: choose } }
    case 'partial': return { state: 'paused', menu: ['delete'], primary: { key: 'resume', variant: 'primary', onClick: choose },
      fact: t('partialFacts', { completed: sizeText(option.inventory.completedBytes ?? 0, t), size, memory }) }
    case 'absent': {
      const free = snapshot.availableDiskBytes
      return { state: 'absent', fact: t('optionFacts', { size, memory }), menu: [],
        primary: option.fits || free === undefined
          ? { key: snapshot.active === undefined ? 'download' : 'downloadSwitch', params: { size }, variant: 'primary', onClick: choose }
          : { key: 'diskShort', params: { need: size, free: sizeText(free, t) }, variant: 'primary' } }
    }
    /* v8 ignore next 2 -- closed-union backstop; only reached if an inventory state is forged */
    default: return assertNever(option.inventory.state)
  }
}

function draftContent(snapshot: ReflexSnapshot, draft: ReflexModelOption, run: CardCommands, t: Translate): CardContent {
  const { preparation, active } = snapshot
  const task = taskOf(preparation)
  if (task !== undefined && sameVariant(task.variant, draft)) return taskContent(task, run, t)
  if (preparation.phase === 'failed' && !sameVariant(draft, active)
    && (preparation.variant === undefined || sameVariant(preparation.variant, draft))) {
    return { state: 'fault', fact: failureText(preparation.failure, t), menu: draft.inventory.state === 'absent' ? [] : ['delete'],
      primary: { key: 'retry', variant: 'primary', onClick: () => { run.choose(draft) } } }
  }
  return sameVariant(draft, active) ? activeContent(snapshot, draft, run, t) : inventoryContent(snapshot, draft, run, t)
}

/** The line naming a task for a variant other than the described one, while the active model keeps answering. */
function backgroundFact(snapshot: ReflexSnapshot, draft: ReflexVariant, t: Translate): string | undefined {
  const task = taskOf(snapshot.preparation), { active } = snapshot
  if (task === undefined || sameVariant(task.variant, draft)) return undefined
  const name = shortVariantName(task.variant, t)
  if (active === undefined) return task.phase === 'paused' ? undefined : t('otherTask', { name })
  const current = shortVariantName(active, t)
  switch (task.phase) {
    case 'downloading': return t('background', { name, active: current, percent: percentOf(task) })
    case 'paused': return t('backgroundPaused', { name, active: current, percent: percentOf(task) })
    default: return t('backgroundChecking', { name, active: current })
  }
}

/** What the card shows: a state without model choice or action, or the option it describes. */
type CardView = { readonly kind: 'fixed'; readonly content: CardContent } | { readonly kind: 'draft'; readonly option: ReflexModelOption }

/** A state offers no model choice or action on an unsupported Mac, during the first disk check, or when no option fits. */
function cardView(snapshot: ReflexSnapshot, draft: ReflexModelOption | undefined, t: Translate): CardView {
  const { device, preparation } = snapshot
  const fixed = (content: CardContent): CardView => ({ kind: 'fixed', content })
  if (!device.supported) return fixed({ state: 'unsupported', fact: t(`unsupported.${device.reason}`), menu: [] })
  if (preparation.phase === 'unsupported') return fixed({ state: 'unsupported', fact: t('elsewhere'), menu: [] })
  if (preparation.phase === 'checking') return fixed({ state: 'checking', fact: t('checking'), menu: [] })
  return draft === undefined ? fixed({ state: 'absent', fact: t('noFit'), menu: [] }) : { kind: 'draft', option: draft }
}

function sourceLabel(origin: string, t: Translate): string {
  if (origin === '') return t('sourceAuto')
  if (origin === 'https://huggingface.co') return t('sourceHuggingFace')
  if (origin === 'https://hf-mirror.com') return t('sourceMirror')
  return origin
}

function confirmCopy(confirmation: Confirmation, t: Translate): ConfirmCopy {
  switch (confirmation.kind) {
    case 'switch': return { title: t('confirm.switch.title'), body: t('confirm.switch.body', { name: shortVariantName(confirmation.variant, t) }),
      action: 'confirm.switch.confirm', dismiss: 'dismiss' }
    case 'delete': return { title: t('confirm.deleteActive.title', { name: shortVariantName(confirmation.variant, t) }),
      body: t('confirm.deleteActive.body'), action: 'confirm.delete', dismiss: 'dismiss' }
    case 'cancel': return cancelCopy(confirmation.bytes, t)
    /* v8 ignore next 2 -- closed-union backstop; only reached if a confirmation is forged */
    default: return assertNever(confirmation)
  }
}

/** Whether a Remote failure is the Host refusing a selection because another model is being prepared. */
function preparingOther(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'reflexLocal/preparing-other'
}

/**
 * Render readiness as one bordered group: a model dropdown with the described model's status, its single next action, a
 * menu of secondary actions, one fact line, and inline progress. Choosing a model in the dropdown changes only the view;
 * Host state changes only through the actions. While the Reflex master switch is off, only pausing a download stays enabled.
 * @param props - shared Host readiness, Host commands, and the locale seat.
 * @returns the card, or a loading line before the first snapshot.
 */
export function EngineCard({ useReflexReadiness, useReflexMaster, t, ...actions }: EngineCardProps) {
  const readiness = useReflexReadiness(value => value), master = useReflexMaster(value => value)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirming, setConfirming] = useState<Confirmation | null>(null)
  const [source, setSource] = useState(''), [menuOpen, setMenuOpen] = useState(false), [picked, setPicked] = useState<ReflexVariant>()
  // The Jev settings form is the live master switch; the Host snapshot's copy covers clients without that form.
  const snapshot = readiness.snapshot === null || master === null ? readiness.snapshot : { ...readiness.snapshot, reflexEnabled: master }
  if (snapshot === null) {
    return <section className={css.card} data-reflex-local="engine">
      <p className={css.fact} role="status">{t('loading')}</p>
      {readiness.error !== null && <p className={css.error} role="alert">{t('actionFailed', { message: readiness.error })}</p>}
    </section>
  }
  const view = cardView(snapshot, optionOf(snapshot, picked ?? initialDraft(snapshot)), t)
  const reconnecting = !readiness.connected && <div className={css.fact} role="status">{t('reconnecting')}</div>
  if (view.kind === 'fixed') {
    return <section className={css.card} data-reflex-local="engine" data-reflex-state={view.content.state}>
      <div className={css.cardHead}>
        <div className={css.cardText}>
          <div className={css.cardTitle}><span>{t('model')}</span><StateBadge content={view.content} t={t} /></div>
          <div className={css.fact}>{view.content.fact}</div>
          {reconnecting}
        </div>
      </div>
    </section>
  }
  const draft = view.option, disabled = !readiness.connected || busy, gated = !snapshot.reflexEnabled
  const sources = snapshot.downloadSources, selectedSource = sources.includes(source) ? source : ''
  const run = async (action: () => Promise<void>, pin = true): Promise<void> => {
    // Acting on a model keeps the card on it while the Host snapshot changes, and only reopening resets it; deleting
    // a model returns the card to the model the Host names next.
    setPicked(pin ? { model: draft.model, quant: draft.quant } : undefined)
    setError(''); setBusy(true)
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const prepare = (variant: ReflexVariant): Promise<void> => actions.prepare({ variant: { model: variant.model, quant: variant.quant },
    ...selectedSource === '' ? {} : { downloadSource: selectedSource } } satisfies ReflexPrepareOptions)
  const task = taskOf(snapshot.preparation)
  const choose = (variant: ReflexVariant): void => {
    if (task !== undefined && task.phase !== 'paused' && !sameVariant(variant, task.variant)) { setConfirming({ kind: 'switch', variant }); return }
    void run(async () => {
      try { await prepare(variant) } catch (failure) {
        if (!preparingOther(failure)) throw failure
        setConfirming({ kind: 'switch', variant })
      }
    })
  }
  const content = draftContent(snapshot, draft, {
    choose,
    pause: () => { void run(actions.pause) },
    enable: () => { void run(actions.enable) },
    disable: () => { void run(actions.disable) },
  }, t)
  const { state, primary } = content
  const background = backgroundFact(snapshot, draft, t)
  const choosesSource = sources.length > 1 && (state === 'absent' || state === 'paused' || state === 'fault')
  const menu: MenuEntry[] = [
    ...content.menu.map(id => ({ id, label: t(id === 'delete' ? 'deleteThis' : 'cancel'), danger: id === 'delete' })),
    ...choosesSource ? [{ id: 'source', label: t('sourceChoice'),
      submenu: ['', ...sources].map(origin => ({ id: `${SOURCE}${origin}`, label: sourceLabel(origin, t) })) }] : [],
  ]
  const select = (id: string): void => {
    setMenuOpen(false)
    if (id === 'cancel') {
      const bytes = task !== undefined && 'completedBytes' in task ? task.completedBytes : draft.bytes
      // Nothing downloaded means nothing to lose, so only a download with bytes on disk asks first.
      if (bytes > 0) setConfirming({ kind: 'cancel', bytes })
      else void run(actions.cancel)
    }
    else if (id === 'delete') {
      const variant = { model: draft.model, quant: draft.quant }
      if (sameVariant(draft, snapshot.active) && snapshot.enabled) setConfirming({ kind: 'delete', variant })
      else void run(() => actions.deleteModel(variant), false)
    } else setSource(id.slice(SOURCE.length))
  }
  const close = (): void => { setConfirming(null) }
  const confirm = (pending: Confirmation): void => {
    switch (pending.kind) {
      case 'delete': void run(() => actions.deleteModel(pending.variant), false); break
      case 'cancel': void run(actions.cancel); break
      case 'switch': void run(async () => { await actions.pause(); await prepare(pending.variant) }); break
      /* v8 ignore next 2 -- closed-union backstop; only reached if a confirmation is forged */
      default: assertNever(pending)
    }
  }
  return <section className={css.card} data-reflex-local="engine" data-reflex-state={state}>
    <div className={css.cardHead}>
      <div className={css.cardText}>
        <div className={css.cardTitle}>
          <ModelSelect snapshot={snapshot} draft={draft} disabled={disabled || gated} choose={setPicked} t={t} />
          <StateBadge content={content} t={t} />
        </div>
        {content.fact !== undefined && <div className={css.fact} role={state === 'fault' ? 'alert' : undefined}>{content.fact}</div>}
        {background !== undefined && <div className={css.fact}>{background}</div>}
        {reconnecting}
        {error !== '' && <div className={css.error} role="alert">{t('actionFailed', { message: error })}</div>}
      </div>
      <div className={css.cardActions}>
        {primary !== undefined && <Button variant={primary.variant} size="sm" onClick={primary.onClick}
          disabled={disabled || primary.onClick === undefined || gated && primary.key !== 'pause'}>{t(primary.key, primary.params)}</Button>}
        {menu.length > 0 && <Menu open={menuOpen} onClose={() => { setMenuOpen(false) }} items={menu} onSelect={select} align="end" portal
          selectedIds={choosesSource ? [`${SOURCE}${selectedSource}`] : []}
          anchor={<Button size="sm" className={css.more} aria-label={t('more')} title={t('more')} aria-haspopup="menu"
            aria-expanded={menuOpen} disabled={disabled || gated} onClick={() => { setMenuOpen(value => !value) }}>
            <IconEllipsisOutlineRegular />
          </Button>} />}
      </div>
    </div>
    {content.progress && <progress className={css.progress} aria-label={t('progressLabel')}
      value={content.progress.completedBytes} max={content.progress.totalBytes} />}
    {confirming !== null && <ConfirmDialog copy={confirmCopy(confirming, t)} t={t} onCancel={close}
      onConfirm={() => { close(); confirm(confirming) }} />}
  </section>
}

/** The status dot and label of one card state. */
function StateBadge({ content, t }: { readonly content: CardContent; readonly t: Translate }) {
  return <span className={css.state}><StateDot state={TONES[content.state]} />{t(LABELS[content.state], { percent: content.percent ?? '' })}</span>
}
