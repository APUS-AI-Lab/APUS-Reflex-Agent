/** The collapsed 「更换模型」 list: every offered option with its size, memory need, and whether it fits. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexSnapshot, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { NS } from './locales.ts'
import { sameVariant, sizeText, variantName } from './size.ts'
import css from './ReflexLocal.module.css'

/** Options, the variant on disk, and the command that downloads another one. */
export type ModelChooserProps = PropsLocale<typeof NS> & {
  readonly snapshot: ReflexSnapshot
  /** Variant downloaded or last attempted; it offers no download of itself. */
  readonly current: ReflexVariant | undefined
  readonly disabled: boolean
  readonly choose: (variant: ReflexVariant) => void
}

/**
 * List every option; unfit ones stay visible, disabled, with their first unmet requirement.
 * @param props - Host options, current variant, availability, and the choose command.
 * @returns the disclosure, or null when the Host offers a single option.
 */
export function ModelChooser({ snapshot, current, disabled, choose, t }: ModelChooserProps) {
  if (snapshot.options.length < 2) return null
  return <details className={css.models}>
    <summary>{t('chooseModel')}</summary>
    <ul>
      {snapshot.options.map((option) => {
        const name = variantName(option, t), isCurrent = sameVariant(option, current)
        const tags = [
          ...sameVariant(option, snapshot.recommended) ? [t('tag.recommended')] : [],
          ...option.experimental ? [t('tag.experimental')] : [],
          ...isCurrent ? [t('tag.current')] : [],
        ]
        return <li key={name} data-fits={option.fits}>
          <div>
            <strong>{name}</strong>{tags.length > 0 && <span className={css.tags}>{tags.join(' · ')}</span>}
            <p>{t('optionFacts', { size: sizeText(option.bytes, t), memory: sizeText(option.minMemoryBytes, t) })}</p>
            {option.reason !== undefined && <p className={css.unfit}>{t(`unfit.${option.reason}`)}</p>}
          </div>
          {!isCurrent && <Button variant="outline" size="sm" disabled={disabled || !option.fits}
            aria-label={t('useModelNamed', { name })} onClick={() => { choose({ model: option.model, quant: option.quant }) }}>{t('useModel')}</Button>}
        </li>
      })}
    </ul>
  </details>
}
