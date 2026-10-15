/** Host snapshots shared by the local decision engine Client specs. */
import type { ReflexModelOption, ReflexPreparation, ReflexSnapshot, ReflexVariant } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'

/** Pinned sizes as the Host publishes them for the options the specs use. */
export const SIZES = { q8_0: 4_480_000_000, q4_k_m: 2_710_000_000, nineQ8: 9_530_000_000, big: 21_170_000_000 } as const

/** Variants the specs name. */
export const Q8: ReflexVariant = { model: '4b', quant: 'q8_0' }
export const Q4: ReflexVariant = { model: '4b', quant: 'q4_k_m' }

/** Every option a 24 GB Mac with ample disk sees: three fit, the experimental 35B does not. */
export const OPTIONS: readonly ReflexModelOption[] = [
  { ...Q4, bytes: SIZES.q4_k_m, minMemoryBytes: 8e9, experimental: false, fits: true },
  { ...Q8, bytes: SIZES.q8_0, minMemoryBytes: 16e9, experimental: false, fits: true },
  { model: '9b', quant: 'q8_0', bytes: SIZES.nineQ8, minMemoryBytes: 24e9, experimental: false, fits: true },
  { model: '35b-a3b', quant: 'q4_k_m', bytes: SIZES.big, minMemoryBytes: 32e9, experimental: true, fits: false, reason: 'memory' },
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
    preparation, enabled: false, reflexEnabled: true, providerId: 'reflex-local', downloadSources: [],
    ...rest,
  }
  return { ...snapshot, ...availableDiskBytes === undefined ? {} : { availableDiskBytes },
    ...recommended === undefined ? {} : { recommended } }
}

/** A passing, fast self-test. */
export const FAST = { prefillTokensPerSecond: 900, decisionMs: 430, slow: false } as const
