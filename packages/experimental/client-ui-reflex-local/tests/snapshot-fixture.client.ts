/** Host snapshots shared by the local decision engine Client specs. */
import type { ReflexPreparation, ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'

/** Pinned sizes as the Host publishes them for the two variants. */
export const SIZES = { q8_0: 4_480_000_000, q4_k_m: 2_710_000_000 } as const

/**
 * Build one supported-device snapshot.
 * @param preparation - phase under test.
 * @param overrides - snapshot fields under test; `availableDiskBytes: undefined` models a Host before its first disk check.
 * @returns a complete Host observation.
 */
export function snapshotOf(preparation: ReflexPreparation,
  overrides: Omit<Partial<ReflexSnapshot>, 'availableDiskBytes'> & { availableDiskBytes?: number | undefined } = {}): ReflexSnapshot {
  const { availableDiskBytes, ...rest } = { availableDiskBytes: 180e9, ...overrides }
  const snapshot: ReflexSnapshot = {
    device: { supported: true, memoryBytes: 24e9, recommended: 'q8_0' },
    models: [{ variant: 'q8_0', bytes: SIZES.q8_0 }, { variant: 'q4_k_m', bytes: SIZES.q4_k_m }],
    preparation, enabled: false, providerId: 'reflex-local', downloadSources: [],
    ...rest,
  }
  return availableDiskBytes === undefined ? snapshot : { ...snapshot, availableDiskBytes }
}

/** A passing, fast self-test. */
export const FAST = { prefillTokensPerSecond: 900, decisionMs: 430, slow: false } as const
