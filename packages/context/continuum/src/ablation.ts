/** Deterministic 2x2 experiment for deciding whether tree navigation and stable cache layout help. */

import { buildContinuumSummaryTree, findContinuumSummaryTreeItems, measureContinuumStableCacheLayouts } from './summary-tree.ts'

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

/** Run the same frozen corpus through all four strategies.
 * @param cases - Frozen corpus to evaluate.
 * @returns Local measurements for each tree/cache combination.
 */
export function runContinuumAblation(cases: readonly ContinuumAblationCase[]): readonly ContinuumAblationResult[] {
  if (cases.length === 0) throw new TypeError('ablation corpus must not be empty')
  const tree = buildContinuumSummaryTree(cases.map(item => ({ ...item, scope: 'ablation', kind: 'case' })))
  return [false, true].flatMap(summaryTree => [false, true].map((stableCache) => {
    const layouts = cases.map((_, index) => cases.slice(0, index + 1).map(entry => `${entry.content}\n${summaryTree ? entry.summary : ''}`).join('\n'))
    const promptBytes = utf8(layouts.at(-1) ?? '')
    const retrievalHits = cases.filter((item) => {
      if (!summaryTree) {
        const searchable = item.content.toLocaleLowerCase()
        return item.expectedTerms.every(term => searchable.includes(term.toLocaleLowerCase()))
      }
      return findContinuumSummaryTreeItems(tree, cases.map(entry => ({ ...entry, scope: 'ablation', kind: 'case' })), item.expectedTerms).includes(item.id)
    }).length
    const measurements = measureContinuumStableCacheLayouts(layouts)
    const estimatedCacheReadBytes = stableCache ? measurements.at(-1)?.reusedPrefixBytes ?? 0 : 0
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
