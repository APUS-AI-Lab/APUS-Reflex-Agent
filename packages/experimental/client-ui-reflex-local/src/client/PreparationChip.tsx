/** Compact composer-dock status of background preparation, with the next actions in a menu. */
import { useState } from 'react'
import { Menu, MenuItemButton, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { ReflexLocalInjected } from './injected.ts'
import type { NS, ReflexLocalKey } from './locales.ts'
import css from './ReflexLocal.module.css'

/** Registration shares for the composer dock entry. */
export type PreparationChipProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS>
  & Pick<InjectFace<ReflexLocalInjected>, 'useReflexReadiness' | 'useReflexSlowChipDismissed'
    | 'prepare' | 'pause' | 'cancel' | 'enable' | 'openDetails' | 'reportFailure' | 'dismissSlowChip'>

type Actions = Omit<PreparationChipProps, 'useReflexReadiness' | 'useReflexSlowChipDismissed' | 't' | 'sessionId'>

/** What the chip shows and offers; `null` leaves the dock untouched. */
interface Chip {
  readonly tone: StateDotState
  readonly label: string
  readonly commands: readonly { readonly key: ReflexLocalKey; readonly run: () => Promise<void> }[]
  /** A page-local choice that needs no Host connection. */
  readonly dismiss?: () => void
}

function chipOf(snapshot: ReflexSnapshot | null, slowDismissed: boolean, actions: Actions, t: PreparationChipProps['t']): Chip | null {
  if (snapshot === null) return null
  const { preparation } = snapshot
  const cancel = { key: 'cancel', run: actions.cancel } as const
  switch (preparation.phase) {
    case 'downloading': return { tone: 'ongoing', commands: [{ key: 'pause', run: actions.pause }, cancel],
      label: t('chip.downloading', { percent: String(Math.floor(preparation.completedBytes / preparation.totalBytes * 100)) }) }
    case 'paused': return { tone: 'idle', label: t('chip.paused'),
      commands: [{ key: 'resume', run: () => actions.prepare({ variant: preparation.variant }) }, cancel] }
    case 'verifying':
    case 'testing': return { tone: 'ongoing', label: t('chip.checking'), commands: [] }
    case 'ready': return preparation.selfTest.slow && !snapshot.enabled && !slowDismissed
      ? { tone: 'warning', label: t('chip.slow'), commands: [{ key: 'enableAnyway', run: actions.enable }], dismiss: actions.dismissSlowChip } : null
    case 'unsupported':
    case 'checking':
    case 'absent':
    case 'failed': return null
    /* v8 ignore next 2 -- closed-union backstop; only reached if a phase is forged */
    default: return assertNever(preparation)
  }
}

/**
 * Show background preparation above the composer only while it needs the user's attention.
 * @param props - shared Host readiness, Host commands, details navigation, and the locale seat.
 * @returns the chip and its menu, or null when preparation is idle, finished, or unsupported.
 */
export function PreparationChip({ useReflexReadiness, useReflexSlowChipDismissed, t, ...actions }: PreparationChipProps) {
  const readiness = useReflexReadiness(value => value)
  const slowDismissed = useReflexSlowChipDismissed(value => value)
  const [open, setOpen] = useState(false)
  const chip = chipOf(readiness.snapshot, slowDismissed, actions, t)
  if (chip === null) return null
  const close = (): void => { setOpen(false) }
  const { dismiss } = chip
  return <div className={css.dockRow}>
    <Menu open={open} onClose={close} align="end" side="top" portal compact
      anchor={<button type="button" className={css.chip} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}>
        <StateDot state={chip.tone} />
        <span>{chip.label}</span>
      </button>}>
      {chip.commands.map(command => <MenuItemButton key={command.key} disabled={!readiness.connected}
        onSelect={() => { close(); command.run().catch(actions.reportFailure) }}>{t(command.key)}</MenuItemButton>)}
      {dismiss !== undefined && <MenuItemButton onSelect={() => { close(); dismiss() }}>{t('chip.notNow')}</MenuItemButton>}
      <MenuItemButton onSelect={() => { close(); actions.openDetails() }}>{t('chip.details')}</MenuItemButton>
    </Menu>
  </div>
}
