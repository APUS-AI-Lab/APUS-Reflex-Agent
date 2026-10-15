/** The local decision engine card in the Reflex page's local mode and on its bundle page: one primary action at a time. */
import { useState } from 'react'
import { Button, Modal, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ReflexFailure, ReflexPrepareOptions, ReflexSnapshot, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { ReflexLocalInjected } from './injected.ts'
import type { NS, ReflexLocalKey } from './locales.ts'
import { ModelChooser } from './ModelChooser.tsx'
import { optionOf, sizeText, variantName } from './size.ts'
import css from './ReflexLocal.module.css'

/** Registration shares for the Reflex local-mode body and the bundle configuration entry. */
export type EngineCardProps = PropsLocale<typeof NS>
  & Pick<InjectFace<ReflexLocalInjected>, 'useReflexReadiness' | 'prepare' | 'pause' | 'cancel' | 'enable' | 'disable' | 'remove'>

type Translate = EngineCardProps['t']
type ButtonVariant = 'primary' | 'outline' | 'ghost'

/** The Host phase as the card names it; `ready` splits by the persisted enable choice. */
type CardState = Exclude<ReflexSnapshot['preparation']['phase'], 'ready'> | 'enabled' | 'disabled'

/** Commands one card state offers, already bound to the Host calls. */
interface CardCommands {
  readonly prepare: (variant?: ReflexVariant) => void
  readonly pause: () => void
  readonly cancel: () => void
  readonly enable: () => void
  readonly disable: () => void
  readonly confirmRemoval: () => void
}

/** One button of a card state; a button without `onClick` states a fact and stays disabled. */
interface CardButton {
  readonly key: ReflexLocalKey
  readonly params?: Record<string, string>
  readonly variant: ButtonVariant
  readonly onClick?: () => void
}

/** What one card state renders besides its header. */
interface CardContent {
  readonly state: CardState
  readonly lines: readonly string[]
  readonly buttons: readonly CardButton[]
  readonly progress?: { readonly completedBytes: number; readonly totalBytes: number }
}

const TONES: Readonly<Record<CardState, StateDotState>> = {
  unsupported: 'idle', checking: 'ongoing', absent: 'idle', downloading: 'ongoing', paused: 'idle',
  verifying: 'ongoing', testing: 'ongoing', enabled: 'done', disabled: 'idle', failed: 'error',
}

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

function absentContent(snapshot: ReflexSnapshot, run: CardCommands, t: Translate): CardContent {
  const option = optionOf(snapshot, snapshot.recommended)
  if (option === undefined) return { state: 'absent', lines: [t('noFit')], buttons: [] }
  const size = sizeText(option.bytes, t), free = snapshot.availableDiskBytes
  const lines = [t('cost', { size, memory: sizeText(option.minMemoryBytes, t) })]
  return { state: 'absent', lines, buttons: [option.fits || free === undefined
    ? { key: 'download', params: { size }, variant: 'primary', onClick: () => { run.prepare() } }
    : { key: 'diskShort', params: { need: size, free: sizeText(free, t) }, variant: 'primary' }] }
}

function cardContent(snapshot: ReflexSnapshot, run: CardCommands, t: Translate): CardContent {
  const elsewhere = t('elsewhere')
  const { device, preparation } = snapshot
  if (!device.supported) return { state: 'unsupported', lines: [t(`unsupported.${device.reason}`), elsewhere], buttons: [] }
  switch (preparation.phase) {
    case 'unsupported': return { state: 'unsupported', lines: [elsewhere], buttons: [] }
    case 'checking': return { state: 'checking', lines: [t('checking')], buttons: [] }
    case 'absent': return absentContent(snapshot, run, t)
    case 'downloading': {
      const { completedBytes, totalBytes } = preparation
      return { state: 'downloading', progress: preparation, buttons: [
        { key: 'pause', variant: 'primary', onClick: run.pause }, { key: 'cancel', variant: 'ghost', onClick: run.cancel }],
      lines: [t('progress', { completed: sizeText(completedBytes, t), total: sizeText(totalBytes, t),
        percent: String(Math.floor(completedBytes / totalBytes * 100)) })] }
    }
    case 'paused': return { state: 'paused', progress: preparation, buttons: [
      { key: 'resume', variant: 'primary', onClick: () => { run.prepare(preparation.variant) } }, { key: 'cancel', variant: 'ghost', onClick: run.cancel }],
    lines: [t('paused', { percent: String(Math.floor(preparation.completedBytes / preparation.totalBytes * 100)) })] }
    case 'verifying':
    case 'testing': return { state: preparation.phase, lines: [t(preparation.phase)], buttons: [] }
    case 'ready': {
      const seconds = (preparation.selfTest.decisionMs / 1000).toFixed(1)
      const remove = { key: 'remove', variant: 'ghost', onClick: run.confirmRemoval } as const
      if (snapshot.enabled) {
        return { state: 'enabled', lines: [t('enabledDetail', { seconds })], buttons: [{ key: 'disable', variant: 'outline', onClick: run.disable }, remove] }
      }
      const slow = preparation.selfTest.slow
      return { state: 'disabled', buttons: [{ key: slow ? 'enableAnyway' : 'enable', variant: 'primary', onClick: run.enable }, remove],
        lines: [slow ? t('slow', { seconds }) : t('readyDetail')] }
    }
    case 'failed': return { state: 'failed', buttons: [{ key: 'retry', variant: 'primary', onClick: () => { run.prepare(preparation.variant) } }],
      lines: preparation.failure.kind === 'download' ? [failureText(preparation.failure, t)] : [failureText(preparation.failure, t), elsewhere] }
    /* v8 ignore next 2 -- closed-union backstop; only reached if a phase is forged */
    default: return assertNever(preparation)
  }
}

function sourceLabel(origin: string, t: Translate): string {
  if (origin === 'https://huggingface.co') return t('sourceHuggingFace')
  if (origin === 'https://hf-mirror.com') return t('sourceMirror')
  return origin
}

/**
 * Render readiness and the single next action the Host state allows.
 * @param props - shared Host readiness, Host commands, and the locale seat.
 * @returns the card, or a loading line before the first snapshot.
 */
export function EngineCard({ useReflexReadiness, t, ...actions }: EngineCardProps) {
  const readiness = useReflexReadiness(value => value)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirming, setConfirming] = useState(false)
  const [source, setSource] = useState('')
  const snapshot = readiness.snapshot
  if (snapshot === null) {
    return <section className={css.card}>
      <p className={css.detail} role="status">{t('loading')}</p>
      {readiness.error !== null && <p className={css.error} role="alert">{t('actionFailed', { message: readiness.error })}</p>}
    </section>
  }
  const disabled = !readiness.connected || busy
  const sources = snapshot.downloadSources, selectedSource = sources.includes(source) ? source : ''
  const run = async (action: () => Promise<void>): Promise<void> => {
    setError(''); setBusy(true)
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const prepareWith = (variant?: ReflexVariant): void => {
    const options: ReflexPrepareOptions = { ...variant === undefined ? {} : { variant },
      ...selectedSource === '' ? {} : { downloadSource: selectedSource } }
    void run(() => actions.prepare(options))
  }
  const content = cardContent(snapshot, {
    prepare: prepareWith,
    pause: () => { void run(actions.pause) },
    cancel: () => { void run(actions.cancel) },
    enable: () => { void run(actions.enable) },
    disable: () => { void run(actions.disable) },
    confirmRemoval: () => { setConfirming(true) },
  }, t)
  const { state } = content, { preparation } = snapshot
  const current = 'variant' in preparation ? preparation.variant : undefined
  const masterOff = snapshot.device.supported && !snapshot.reflexEnabled
  const choosesModel = state === 'absent' || state === 'enabled' || state === 'disabled' || state === 'failed'
  const close = (): void => { setConfirming(false) }
  return <section className={css.card} data-reflex-local="engine">
    <header className={css.head}>
      <strong>{current === undefined ? t('model') : variantName(current, t)}</strong>
      <span className={css.state}><StateDot state={TONES[state]} />{t(state === 'enabled' && masterOff ? 'state.masterOff' : `state.${state}`)}</span>
    </header>
    <p className={css.lede}>{t('lede')}</p>
    {content.progress && <progress className={css.progress} aria-label={t('progressLabel')}
      value={content.progress.completedBytes} max={content.progress.totalBytes} />}
    {content.lines.map(line => <p key={line} className={css.detail} role={state === 'failed' ? 'alert' : undefined}>{line}</p>)}
    {masterOff && <p className={css.detail}>{t('masterOff')}</p>}
    {!readiness.connected && <p className={css.detail} role="status">{t('reconnecting')}</p>}
    {sources.length > 1 && (state === 'absent' || state === 'failed') && <details className={css.source}>
      <summary>{t('sourceChoice')}</summary>
      <select aria-label={t('sourceChoice')} value={selectedSource} disabled={disabled} onChange={(event) => { setSource(event.target.value) }}>
        <option value="">{t('sourceAuto')}</option>
        {sources.map(origin => <option key={origin} value={origin}>{sourceLabel(origin, t)}</option>)}
      </select>
    </details>}
    {content.buttons.length > 0 && <div className={css.actions}>
      {content.buttons.map(button => <Button key={button.key} variant={button.variant} size="sm"
        disabled={disabled || button.onClick === undefined} onClick={button.onClick}>{t(button.key, button.params)}</Button>)}
    </div>}
    {choosesModel && <ModelChooser snapshot={snapshot} current={current} disabled={disabled} t={t}
      choose={(variant) => { prepareWith(variant) }} />}
    {error !== '' && <p className={css.error} role="alert">{t('actionFailed', { message: error })}</p>}
    {(state === 'enabled' || state === 'disabled') && <Modal open={confirming} title={t('removeConfirm.title')}
      closeLabel={t('cancel')} onClose={close} footer={<>
        <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button variant="primary" data-modal-autofocus onClick={() => { close(); void run(actions.remove) }}>{t('removeConfirm.confirm')}</Button>
      </>}>
      <p>{t('removeConfirm.body')}</p>
    </Modal>}
  </section>
}
