import { describe, expect, it } from 'vitest'
import { buildContinuumSummaryTree, findContinuumSummaryTreeItems, measureContinuumStableCacheLayouts } from '../src/index.ts'

const items = [
  { id: 'b', scope: 'workspace', kind: 'fact', content: 'Migration is scheduled Friday.', summary: 'Cutover is Friday.' },
  { id: 'a', scope: 'workspace', kind: 'fact', content: 'Rollback belongs to platform.', summary: 'Platform owns rollback.' },
  { id: 'c', scope: 'task', kind: 'decision', content: 'Invoice INV-42 disputed.', summary: 'Finance disputed INV-42.' },
] as const

describe('Continuum deterministic summary tree', () => {
  it('sorts input-independent paths and keeps every source item', () => {
    const first = buildContinuumSummaryTree(items, { maxItemsPerLeaf: 1 })
    const second = buildContinuumSummaryTree([...items].reverse(), { maxItemsPerLeaf: 1 })
    expect(first).toEqual(second)
    expect(first.children.flatMap(node => node.itemIds).sort()).toEqual(['a', 'b', 'c'])
    expect(first.children.map(node => node.path)).toEqual(['task/decision', 'workspace/fact', 'workspace/fact-2'])
  })

  it('uses summaries for alias navigation while returning source IDs', () => {
    const tree = buildContinuumSummaryTree(items)
    expect(findContinuumSummaryTreeItems(tree, items, ['cutover'])).toEqual(['b'])
    expect(findContinuumSummaryTreeItems(tree, items, ['inv-42'])).toEqual(['c'])
  })

  it('reports stable prefix reuse and deterministic layout hashes', () => {
    const first = measureContinuumStableCacheLayouts(['header\nA', 'header\nA\nB', 'header\nA\nC'])
    const second = measureContinuumStableCacheLayouts(['header\nA', 'header\nA\nB', 'header\nA\nC'])
    expect(first).toEqual(second)
    expect(first[0]?.reusedPrefixBytes).toBe(0)
    expect(first[1]?.reusedPrefixBytes).toBeGreaterThan(0)
    expect(first[2]?.reusedPrefixBytes).toBeGreaterThan(0)
    expect(first[1]?.totalBytes).toBeGreaterThan(first[0]?.totalBytes ?? 0)
  })
})
