/** Installed release version in General Settings for Web and Desktop. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

/**
 * Render the Desktop carrier’s product version or the Web build version; omit the row when neither is available.
 * @param props - runtime share and localized copy.
 * @returns the current release label, or nothing when build metadata is absent.
 */
export function CurrentVersionRow({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const carrier = (globalThis as typeof globalThis & { dshDesktop?: { readonly productVersion?: string } }).dshDesktop
  const version = carrier?.productVersion ?? process.env.DSH_CLIENT_VERSION
  if (version === undefined) return null
  return <div className={css.row}>{t('general.currentVersion', { version })}</div>
}
