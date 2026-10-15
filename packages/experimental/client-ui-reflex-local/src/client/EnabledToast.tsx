/** The `shell.overlay` entry announcing that judgments moved onto this Mac, with an undo action, and failed dock commands. */
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexLocalInjected } from './injected.ts'
import type { NS } from './locales.ts'

/** Hold for the enablement notice, long enough to reach its undo action. */
const UNDO_HOLD_MS = 6000

/** Registration shares for the frame-wide notice. */
export type EnabledToastProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS>
  & Pick<InjectFace<ReflexLocalInjected>, 'useReflexToast' | 'dismissToast' | 'undoEnable'>

/**
 * Render the current notice; it outlives the plugin page because the frame-wide layer owns it.
 * @param props - notice state, its dismissal, the undo command, and the locale seat.
 * @returns the banner on display, or null.
 */
export function EnabledToast({ useReflexToast, dismissToast, undoEnable, t }: EnabledToastProps) {
  const toast = useReflexToast(current => current)
  if (toast === null) return null
  if (toast.kind === 'enabled') {
    return <Toast key={`toast-${String(toast.seq)}`} text={t('toast.enabled')} tone="success" holdMs={UNDO_HOLD_MS}
      actions={[{ label: t('toast.undo'), onClick: undoEnable }]} onDone={dismissToast} />
  }
  const text = toast.kind === 'actionFailed' ? t('actionFailed', { message: toast.message }) : t('toast.undoFailed')
  return <Toast key={`toast-${String(toast.seq)}`} text={text} icon={<IconWarningOutlineRegular />} holdMs={UNDO_HOLD_MS} onDone={dismissToast} />
}
