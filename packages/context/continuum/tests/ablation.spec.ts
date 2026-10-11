import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTINUUM_ABLATION_CASES, runContinuumAblation } from '../src/index.ts'

describe('Continuum tree/cache ablation', () => {
  it('runs all four frozen variants and keeps retrieval separate from cache', () => {
    const results = runContinuumAblation(DEFAULT_CONTINUUM_ABLATION_CASES)
    expect(results).toHaveLength(4)
    expect(results.find(result => !result.summaryTree && !result.stableCache)?.retrievalHitRate).toBe(2 / 3)
    expect(results.find(result => result.summaryTree && !result.stableCache)?.retrievalHitRate).toBe(1)
    expect(results.find(result => !result.summaryTree && result.stableCache)?.estimatedCacheReadBytes).toBeGreaterThan(0)
    expect(results.find(result => result.summaryTree && result.stableCache)?.retrievalHitRate).toBe(1)
  })
})
