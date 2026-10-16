/** The `shell.overlay` entry announcing local enablement and background model switches with undo, and failed commands. */
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexLocalInjected } from './injected.ts'
import type { NS } from './locales.ts'
import { shortVariantName } from './size.ts'

/** Hold for the enablement notice, long enough to reach its undo action. */
const UNDO_HOLD_MS = 6000

/** Registration shares for the frame-wide notice. */
export type EnabledToastProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS>
  & Pick<InjectFace<ReflexLocalInjected>, 'useReflexToast' | 'dismissToast' | 'undoEnable' | 'undoSwitch'>

/**
 * Render the current notice; it outlives the plugin page because the frame-wide layer owns it.
 * @param props - notice state, its dismissal, the undo command, and the locale seat.
 * @returns the banner on display, or null.
 */
export function EnabledToast({ useReflexToast, dismissToast, undoEnable, undoSwitch, t }: EnabledToastProps) {
  const toast = useReflexToast(current => current)
  if (toast === null) return null
  if (toast.kind === 'enabled') {
    return <Toast key={`toast-${String(toast.seq)}`} text={t('toast.enabled')} tone="success" holdMs={UNDO_HOLD_MS}
      actions={[{ label: t('toast.undo'), onClick: undoEnable }]} onDone={dismissToast} />
  }
  if (toast.kind === 'switched') {
    const { change } = toast
    return <Toast key={`toast-${String(toast.seq)}`} text={t('toast.switched', { name: shortVariantName(change.to, t) })} tone="success"
      holdMs={UNDO_HOLD_MS} actions={[{ label: t('toast.undo'), onClick: () => { undoSwitch(change) } }]} onDone={dismissToast} />
  }
  const text = toast.kind === 'actionFailed' ? t('actionFailed', { message: toast.message }) : t('toast.undoFailed')
  return <Toast key={`toast-${String(toast.seq)}`} text={text} icon={<IconWarningOutlineRegular />} holdMs={UNDO_HOLD_MS} onDone={dismissToast} />
}
