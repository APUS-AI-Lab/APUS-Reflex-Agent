/** Model options and byte facts of the Host snapshot rendered as user-facing text. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexModelOption, ReflexSnapshot, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { NS } from './locales.ts'

type Translate = PropsLocale<typeof NS>['t']

/**
 * Compare two weights identities.
 * @param a - one variant.
 * @param b - another variant, or none.
 * @returns whether both name the same model and quantization.
 */
export function sameVariant(a: ReflexVariant, b: ReflexVariant | undefined): boolean {
  return a.model === b?.model && a.quant === b.quant
}

/**
 * Look up the offered option of one variant.
 * @param snapshot - Host observation listing the offered options.
 * @param variant - weights identity to look up.
 * @returns the option, or undefined when the Host does not offer it.
 */
export function optionOf(snapshot: ReflexSnapshot, variant: ReflexVariant | undefined): ReflexModelOption | undefined {
  return snapshot.options.find(option => sameVariant(option, variant))
}

/**
 * Format decimal gigabytes with one fractional digit, matching download sizes as storage vendors state them.
 * @param bytes - exact byte count.
 * @param t - locale seat owning the unit.
 * @returns localized size text.
 */
export function sizeText(bytes: number, t: Translate): string {
  return t('size', { value: (bytes / 1e9).toFixed(1) })
}

/**
 * Format a memory tier the way Macs are sold: binary gigabytes, whole when exact, labeled GB.
 * @param bytes - byte count of a GiB-based tier.
 * @param t - locale seat owning the unit.
 * @returns localized memory text, for example 16 GB for 16 GiB.
 */
export function memoryText(bytes: number, t: Translate): string {
  const gib = bytes / 1024 ** 3
  return t('size', { value: Number.isInteger(gib) ? String(gib) : gib.toFixed(1) })
}

/**
 * Name one weights file without the product prefix, as the model list and its summary show it.
 * @param variant - model and quantization.
 * @param t - locale seat owning the names.
 * @returns localized short name, for example 9B · Q8_0.
 */
export function shortVariantName(variant: ReflexVariant, t: Translate): string {
  return t('variantShort', { model: t(`model.${variant.model}`), quant: t(`quant.${variant.quant}`) })
}

/**
 * Name one weights file the way the card lists it.
 * @param variant - model and quantization.
 * @param t - locale seat owning the names.
 * @returns localized model name with its quantization.
 */
export function variantName(variant: ReflexVariant, t: Translate): string {
  return t('variant', { model: t(`model.${variant.model}`), quant: t(`quant.${variant.quant}`) })
}
