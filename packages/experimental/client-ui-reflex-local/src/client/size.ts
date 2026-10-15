/** Byte facts of the Host snapshot rendered as user-facing sizes. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReflexSnapshot, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import type { NS } from './locales.ts'

/**
 * Look up the pinned download size of one variant.
 * @param snapshot - Host observation listing the published variants.
 * @param variant - quantization to look up.
 * @returns exact byte count, or undefined when the Host does not publish the variant.
 */
export function modelBytes(snapshot: ReflexSnapshot, variant: ReflexVariant): number | undefined {
  return snapshot.models.find(model => model.variant === variant)?.bytes
}

/**
 * Format decimal gigabytes with one fractional digit, matching download sizes as storage vendors state them.
 * @param bytes - exact byte count.
 * @param t - locale seat owning the unit.
 * @returns localized size text.
 */
export function sizeText(bytes: number, t: PropsLocale<typeof NS>['t']): string {
  return t('size', { value: (bytes / 1e9).toFixed(1) })
}
