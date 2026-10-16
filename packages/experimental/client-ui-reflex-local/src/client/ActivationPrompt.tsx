/** Guidance shown once when the user switches the local decision engine bundle on. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ReflexLocalInjected } from './injected.ts'
import type { NS } from './locales.ts'
import { optionOf, sizeText } from './size.ts'
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
  const option = optionOf(snapshot, snapshot.recommended), free = snapshot.availableDiskBytes
  // Without a fitting recommendation the details page explains why; the prompt then only points there.
  const offer: { readonly blocked: string } | { readonly size: string } = option === undefined ? { blocked: t('noFit') }
    : !option.fits && free !== undefined ? { blocked: t('prompt.diskShort', { need: sizeText(option.bytes, t), free: sizeText(free, t) }) }
      : { size: sizeText(option.bytes, t) }
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
  return <Modal open={offered} title={t('prompt.title')} closeLabel={t('close')} onClose={onDismiss}
    footer={<>
      <Button variant="ghost" onClick={onDismiss}>{t('prompt.later')}</Button>
      {'blocked' in offer
        ? <Button variant="primary" data-modal-autofocus onClick={onOpenDetails}>{t('prompt.details')}</Button>
        : <Button variant="primary" data-modal-autofocus disabled={busy} onClick={() => { void start() }}>
          {t('download', { size: offer.size })}</Button>}
    </>}>
    <p>{'blocked' in offer ? offer.blocked : t('prompt.body', { size: offer.size })}</p>
    {error !== '' && <p className={css.error} role="alert">{t('actionFailed', { message: error })}</p>}
  </Modal>
}
