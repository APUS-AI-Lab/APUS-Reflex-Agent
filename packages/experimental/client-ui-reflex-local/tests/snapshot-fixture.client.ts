/** Host snapshots shared by the local decision engine Client specs. */
import type { ReflexInventory, ReflexModelOption, ReflexPreparation, ReflexSnapshot, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'

/** Pinned sizes as the Host publishes them for the options the specs use. */
export const SIZES = { q8_0: 4_480_000_000, q4_k_m: 2_710_000_000, nineQ8: 9_530_000_000, big: 21_170_000_000 } as const

/** Memory tiers are binary gigabytes. */
export const GIB = 1024 ** 3

/** Variants the specs name. */
export const Q8: ReflexVariant = { model: '4b', quant: 'q8_0' }
export const Q4: ReflexVariant = { model: '4b', quant: 'q4_k_m' }
export const NINE: ReflexVariant = { model: '9b', quant: 'q8_0' }

const ABSENT = { state: 'absent' } as const

/** Every option a 24 GB Mac with ample disk sees: three fit, the experimental 35B does not. */
export const OPTIONS: readonly ReflexModelOption[] = [
  { ...Q4, bytes: SIZES.q4_k_m, minMemoryBytes: 8 * GIB, experimental: false, fits: true, inventory: ABSENT },
  { ...Q8, bytes: SIZES.q8_0, minMemoryBytes: 16 * GIB, experimental: false, fits: true, inventory: ABSENT },
  { model: '9b', quant: 'q8_0', bytes: SIZES.nineQ8, minMemoryBytes: 24 * GIB, experimental: false, fits: true, inventory: ABSENT },
  { model: '35b-a3b', quant: 'q4_k_m', bytes: SIZES.big, minMemoryBytes: 32 * GIB, experimental: true, fits: false, reason: 'memory', inventory: ABSENT },
]

/**
 * Build one supported-device snapshot recommending the 4B Q8_0 option.
 * @param preparation - phase under test.
 * @param overrides - snapshot fields under test; `availableDiskBytes: undefined` models a Host before its first disk check,
 * `recommended: undefined` a Host where no option fits.
 * @returns a complete Host observation.
 */
export function snapshotOf(preparation: ReflexPreparation, overrides: Omit<Partial<ReflexSnapshot>, 'availableDiskBytes' | 'recommended'>
  & { availableDiskBytes?: number | undefined; recommended?: ReflexVariant | undefined } = {}): ReflexSnapshot {
  const { availableDiskBytes, recommended, ...rest } = { availableDiskBytes: 180e9, recommended: Q8, ...overrides }
  const snapshot: ReflexSnapshot = {
    device: { supported: true, memoryBytes: 24e9 }, options: OPTIONS,
    preparation, runner: { state: 'stopped' }, enabled: false, localChosen: false, reflexEnabled: true, providerId: 'reflex-local', downloadSources: [],
    ...rest,
  }
  return { ...snapshot, ...availableDiskBytes === undefined ? {} : { availableDiskBytes },
    ...recommended === undefined ? {} : { recommended } }
}

/** A passing, fast self-test. */
export const FAST = { prefillTokensPerSecond: 900, decisionMs: 430, slow: false } as const

/**
 * Record what this Host holds for some options.
 * @param held - variant and inventory pairs.
 * @returns the default options with those inventories.
 */
export function holding(...held: readonly (readonly [ReflexVariant, ReflexInventory])[]): readonly ReflexModelOption[] {
  return OPTIONS.map((option) => {
    const match = held.find(([variant]) => variant.model === option.model && variant.quant === option.quant)
    return match === undefined ? option : { ...option, inventory: match[1] }
  })
}
