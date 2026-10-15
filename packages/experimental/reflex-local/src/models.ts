/** Pinned model catalog, per-Host option fitness, and the automatic recommendation. */
import { readFileSync } from 'node:fs'
import type { ModelAsset } from './download.ts'
import type { ReflexModelId, ReflexModelOption, ReflexQuant, ReflexVariant } from './types.ts'

/** Stable string identity of a variant, used for configuration keys, catalog keys, and `state.json`. */
export type VariantKey = `${ReflexModelId}-${ReflexQuant}`

/** Every published variant, smallest file first. */
export const VARIANT_KEYS: readonly VariantKey[] = ['4b-q4_k_m', '4b-q8_0', '9b-q4_k_m', '9b-q8_0', '35b-a3b-q4_k_m', '35b-a3b-q8_0']

/** A pinned weights file and whether it is still unmeasured on Mac. */
export interface CatalogAsset extends ModelAsset {
  readonly experimental: boolean
}

/**
 * Spell a variant as its catalog key.
 * @param variant - model and quantization.
 * @returns the variant's catalog key.
 */
export function variantKey(variant: ReflexVariant): VariantKey {
  return `${variant.model}-${variant.quant}`
}

/**
 * Parse a catalog key back into its variant.
 * @param key - catalog key; the quantization never contains `-`.
 * @returns the variant the key names.
 */
export function variantOf(key: VariantKey): ReflexVariant {
  const split = key.lastIndexOf('-')
  return { model: key.slice(0, split) as ReflexModelId, quant: key.slice(split + 1) as ReflexQuant }
}

/**
 * Read the pinned catalog shipped with the package.
 * @returns every variant's asset from `runtime/assets.json`.
 */
export function readCatalog(): Record<VariantKey, CatalogAsset> {
  return (JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as { models: Record<VariantKey, CatalogAsset> }).models
}

/** Host facts that decide which options fit. */
export interface FitFacts {
  readonly memoryBytes: number
  /** Free bytes on the data volume; undefined before the first disk check judges only memory. */
  readonly availableBytes: number | undefined
  /** Bytes of each variant already on disk, complete or partial. */
  readonly presentBytes: (key: VariantKey) => number
  readonly diskMarginBytes: number
}

/**
 * Judge every catalog option against this Host.
 * @param catalog - pinned assets.
 * @param minMemoryBytes - configured memory tier per variant.
 * @param facts - memory, free space, and bytes already present.
 * @returns all options, smallest first; memory is checked before disk.
 */
export function modelOptions(
  catalog: Record<VariantKey, CatalogAsset>, minMemoryBytes: Record<VariantKey, number>, facts: FitFacts,
): ReflexModelOption[] {
  return VARIANT_KEYS.map((key) => {
    const asset = catalog[key], needMemory = minMemoryBytes[key]
    const missing = asset.bytes - facts.presentBytes(key) + facts.diskMarginBytes
    const reason = facts.memoryBytes < needMemory ? 'memory' as const
      : facts.availableBytes !== undefined && facts.availableBytes < missing ? 'disk' as const : undefined
    return { ...variantOf(key), bytes: asset.bytes, minMemoryBytes: needMemory, experimental: asset.experimental,
      fits: reason === undefined, ...reason === undefined ? {} : { reason } }
  })
}

/**
 * Pick the automatic recommendation; experimental options are never recommended.
 * @param options - judged options, smallest first.
 * @returns the largest stable fitting option, else the smallest stable option that fits memory, else undefined.
 */
export function recommend(options: readonly ReflexModelOption[]): ReflexVariant | undefined {
  const stable = options.filter(option => !option.experimental && option.reason !== 'memory')
  const chosen = stable.filter(option => option.fits).at(-1) ?? stable[0]
  return chosen === undefined ? undefined : { model: chosen.model, quant: chosen.quant }
}
