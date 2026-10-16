/** The engine card's model dropdown: every offered option, grouped by model size, with its download facts and tags. */
import { useState } from 'react'
import { IconChevronDownOutlineRegular, Menu, MenuItemButton, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexModelOption, ReflexSnapshot, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { NS } from './locales.ts'
import { memoryText, sameVariant, shortfallText, shortVariantName, sizeText, variantName } from './size.ts'
import css from './ReflexLocal.module.css'

/** Offered options, the variant the card describes, and the command that changes it. */
export type ModelSelectProps = PropsLocale<typeof NS> & {
  readonly snapshot: ReflexSnapshot
  /** Variant the card currently describes; choosing another changes only this view, never Host state. */
  readonly draft: ReflexVariant
  readonly disabled: boolean
  readonly choose: (variant: ReflexVariant) => void
}

function facts(option: ReflexModelOption, t: ModelSelectProps['t']): string {
  const size = sizeText(option.bytes, t), memory = memoryText(option.minMemoryBytes, t)
  return option.inventory.state === 'partial'
    ? t('partialFacts', { completed: sizeText(option.inventory.completedBytes ?? 0, t), size, memory })
    : t('optionFacts', { size, memory })
}

/** Two-line menu row: name, any shortfall, and tags, then size and memory facts. */
function OptionLabel({ option, snapshot, t }: Pick<ModelSelectProps, 'snapshot' | 't'> & { readonly option: ReflexModelOption }) {
  const active = sameVariant(option, snapshot.active)
  return <span className={css.option}>
    <span className={css.optionName}>
      <span>{shortVariantName(option, t)}{shortfallText(snapshot, option, t)}</span>
      {sameVariant(option, snapshot.recommended) && <Tag tone="info">{t('tag.recommended')}</Tag>}
      {option.experimental && <Tag tone="warning">{t('tag.experimental')}</Tag>}
      {active && <Tag tone="success">{t('tag.inUse')}</Tag>}
      {!active && option.inventory.state === 'downloaded' && <Tag tone="outline">{t('tag.downloaded')}</Tag>}
    </span>
    <span className={css.optionFacts}>{facts(option, t)}</span>
  </span>
}

/**
 * Render the selected model as a pill that opens every option; options this Mac may not run stay selectable with a warning.
 * @param props - Host options, the described variant, availability, and the view change.
 * @returns the dropdown trigger with its menu.
 */
export function ModelSelect({ snapshot, draft, disabled, choose, t }: ModelSelectProps) {
  const [open, setOpen] = useState(false)
  const pick = (option: ReflexModelOption): void => { setOpen(false); choose({ model: option.model, quant: option.quant }) }
  return <Menu open={open} onClose={() => { setOpen(false) }} portal listClassName={css.optionList}
    anchor={<button type="button" className={css.selector} data-reflex-model-select={`${draft.model}:${draft.quant}`}
      aria-label={t('modelSelect')} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      onClick={() => { setOpen(value => !value) }}>
      <span>{variantName(draft, t)}</span>
      <IconChevronDownOutlineRegular className={css.chevron} size={12} aria-hidden="true" />
    </button>}>
    {snapshot.options.map((option, index) => <MenuItemButton key={`${option.model}:${option.quant}`}
      separatorBefore={index > 0 && snapshot.options[index - 1]?.model !== option.model} onSelect={() => { pick(option) }}>
      <OptionLabel option={option} snapshot={snapshot} t={t} />
    </MenuItemButton>)}
  </Menu>
}
