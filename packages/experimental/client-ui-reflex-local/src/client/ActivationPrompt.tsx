/** Guidance shown once when the user switches the local decision engine bundle on. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ReflexLocalInjected } from './injected.ts'
import type { NS } from './locales.ts'
import { modelBytes, sizeText } from './size.ts'
import css from './ReflexLocal.module.css'

/** Registration shares for the bundle's activation guidance. */
export type ActivationPromptProps = PropsRuntime<'plugins.bundle.activation'> & PropsLocale<typeof NS>
  & Pick<InjectFace<ReflexLocalInjected>, 'useReflexReadiness' | 'prepare'>

/**
 * Offer the one-click download while this device can run the engine and nothing is downloaded yet.
 * @param props - activation navigation, shared Host readiness, the prepare command, and the locale seat.
 * @returns the modal while a download is the next step; otherwise the prompt dismisses itself.
 */
export function ActivationPrompt({ useReflexReadiness, prepare, onDismiss, onOpenDetails, t }: ActivationPromptProps) {
  const readiness = useReflexReadiness(value => value)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const snapshot = readiness.connected ? readiness.snapshot : null
  const phase = snapshot?.preparation.phase
  const offered = snapshot?.device.supported === true && phase === 'absent'
  useEffect(() => {
    if (phase !== undefined && phase !== 'checking' && !offered) onDismiss()
  }, [phase, offered, onDismiss])
  if (snapshot === null || !snapshot.device.supported) return null
  const need = modelBytes(snapshot, snapshot.device.recommended), free = snapshot.availableDiskBytes
  const short = need !== undefined && free !== undefined && free < need
    ? t('prompt.diskShort', { need: sizeText(need, t), free: sizeText(free, t) }) : undefined
  const start = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      await prepare()
      onOpenDetails()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }
  return <Modal open={offered} title={t('prompt.title')} closeLabel={t('cancel')} onClose={onDismiss}
    footer={<>
      <Button variant="ghost" onClick={onDismiss}>{t('prompt.later')}</Button>
      {short !== undefined
        ? <Button variant="primary" data-modal-autofocus onClick={onOpenDetails}>{t('prompt.details')}</Button>
        : <Button variant="primary" data-modal-autofocus disabled={busy} onClick={() => { void start() }}>
          {need === undefined ? t('downloadPlain') : t('download', { size: sizeText(need, t) })}</Button>}
    </>}>
    <p>{short ?? (need === undefined ? t('lede') : t('prompt.body', { size: sizeText(need, t) }))}</p>
    {error !== '' && <p className={css.error} role="alert">{t('actionFailed', { message: error })}</p>}
  </Modal>
}
