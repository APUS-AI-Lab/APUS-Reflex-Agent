/** Deterministic 2x2 experiment for deciding whether tree navigation and stable cache layout help. */

/** One frozen long-history query used by the local ablation. */
export interface ContinuumAblationCase {
  readonly id: string
  readonly query: string
  readonly content: string
  readonly summary: string
  readonly expectedTerms: readonly string[]
}

/** One 2x2 tree/cache result. Values are local estimates, not provider billing. */
export interface ContinuumAblationResult {
  readonly summaryTree: boolean
  readonly stableCache: boolean
  readonly cases: number
  readonly retrievalHits: number
  readonly retrievalHitRate: number
  readonly promptBytes: number
  readonly estimatedCacheReadBytes: number
  readonly cacheReadRatio: number
}

/** Run the same frozen corpus through all four strategies. */
export function runContinuumAblation(cases: readonly ContinuumAblationCase[]): readonly ContinuumAblationResult[] {
  if (cases.length === 0) throw new TypeError('ablation corpus must not be empty')
  return [false, true].flatMap(summaryTree => [false, true].map((stableCache) => {
    const promptBytes = cases.reduce((total, item) => total + utf8(`${item.content}\n${summaryTree ? item.summary : ''}`), 0)
    const retrievalHits = cases.filter((item) => {
      const searchable = `${item.content} ${summaryTree ? item.summary : ''}`.toLocaleLowerCase()
      return item.expectedTerms.every(term => searchable.includes(term.toLocaleLowerCase()))
    }).length
    const estimatedCacheReadBytes = stableCache ? Math.max(0, promptBytes - utf8(cases.at(-1)?.content ?? '')) : 0
    return Object.freeze({
      summaryTree, stableCache, cases: cases.length, retrievalHits,
      retrievalHitRate: retrievalHits / cases.length, promptBytes,
      estimatedCacheReadBytes, cacheReadRatio: promptBytes === 0 ? 0 : estimatedCacheReadBytes / promptBytes,
    })
  }))
}

/** Small frozen corpus for CI and design review; it deliberately includes an alias only in the summary. */
export const DEFAULT_CONTINUUM_ABLATION_CASES: readonly ContinuumAblationCase[] = Object.freeze([
  Object.freeze({ id: 'migration', query: 'when is the cutover', content: 'The migration is scheduled Friday.', summary: 'The cutover is Friday.', expectedTerms: ['cutover'] }),
  Object.freeze({ id: 'owner', query: 'who owns the rollback', content: 'Rollback is assigned to the platform team.', summary: 'The platform team owns rollback.', expectedTerms: ['platform'] }),
  Object.freeze({ id: 'invoice', query: 'which invoice was disputed', content: 'Invoice INV-42 was disputed by finance.', summary: 'Finance disputed invoice INV-42.', expectedTerms: ['inv-42'] }),
])

function utf8(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
