/** Dialogs the local engine surfaces raise: a confirmation before discarding a download or a model in use, and a notice. */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS, ReflexLocalKey } from './locales.ts'
import { sizeText } from './size.ts'

type Translate = PropsLocale<typeof NS>['t']

/** Copy of one confirmation dialog. */
export interface ConfirmCopy {
  readonly title: string
  readonly body: string
  readonly action: ReflexLocalKey
  readonly dismiss: ReflexLocalKey
}

/**
 * Describe cancelling a download, which deletes the bytes already on disk.
 * @param bytes - bytes the cancellation deletes.
 * @param t - locale seat owning the copy.
 * @returns the dialog copy.
 */
export function cancelCopy(bytes: number, t: Translate): ConfirmCopy {
  return { title: t('confirm.cancel.title', { size: sizeText(bytes, t) }), body: t('confirm.cancel.body'),
    action: 'confirm.cancel.confirm', dismiss: 'confirm.cancel.keep' }
}

/**
 * Render one open notice whose only answer, like closing it, proceeds; the owner unmounts it once answered.
 * @param props - the copy, the proceed callback, and the locale seat.
 * @returns the modal dialog.
 */
export function NoticeDialog({ title, body, action, onClose, t }: {
  readonly title: string
  readonly body: string
  readonly action: ReflexLocalKey
  readonly onClose: () => void
  readonly t: Translate
}) {
  return <Modal open title={title} closeLabel={t('close')} onClose={onClose}
    footer={<Button variant="primary" data-modal-autofocus onClick={onClose}>{t(action)}</Button>}>
    <p>{body}</p>
  </Modal>
}

/**
 * Render one open confirmation; the owner unmounts it once answered.
 * @param props - the copy, both answers, and the locale seat.
 * @returns the modal dialog.
 */
export function ConfirmDialog({ copy, onCancel, onConfirm, t }: {
  readonly copy: ConfirmCopy
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly t: Translate
}) {
  return <Modal open title={copy.title} closeLabel={t('close')} onClose={onCancel} footer={<>
    <Button variant="ghost" onClick={onCancel}>{t(copy.dismiss)}</Button>
    <Button variant="primary" data-modal-autofocus onClick={onConfirm}>{t(copy.action)}</Button>
  </>}>
    <p>{copy.body}</p>
  </Modal>
}
