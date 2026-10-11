import { buildContinuumSummaryTree, type ContinuumSummaryTreeConfig, type ContinuumSummaryTreeNode } from './summary-tree.ts'
import type { MemoryRecord, MemorySourceRef } from './records.ts'

/** A durable-source reference returned by summary navigation. */
export interface ContinuumSummarySource {
  readonly recordId: MemoryRecord['id']
  readonly sourceRefs: readonly MemorySourceRef[]
}

/** The current record projection and its deterministic navigation tree. */
export interface ContinuumSummaryView {
  readonly tree: ContinuumSummaryTreeNode
  readonly records: readonly MemoryRecord[]
}

/**
 * Build a disposable navigation view from active source-backed records.
 * Session events remain authoritative; this function performs no persistence,
 * model call, or summary assertion. Retired records are omitted.
 * @param records - current record projection folded from Session events.
 * @param config - deterministic tree and summary byte limits.
 * @returns a tree plus the records needed for source lookup.
 */
export function buildContinuumSummaryView(
  records: readonly MemoryRecord[],
  config: ContinuumSummaryTreeConfig = {},
): ContinuumSummaryView {
  const active = records.filter(record => record.status === 'active')
  const tree = buildContinuumSummaryTree(active.map(record => ({
    id: record.id,
    scope: record.scope,
    kind: record.kind,
    content: record.content,
  })), config)
  return Object.freeze({ tree, records: Object.freeze(active) })
}

/**
 * Resolve one tree path to active records and their exact Session sources.
 * @param view - view built from the current record projection.
 * @param path - tree path, including the empty root path.
 * @returns source references for records in the selected node, or an empty array.
 */
export function zoomContinuumSummaryView(view: ContinuumSummaryView, path: string): readonly ContinuumSummarySource[] {
  const node = path === '' ? view.tree : view.tree.children.find(child => child.path === path)
  if (node === undefined) return Object.freeze([])
  const byId = new Map(view.records.map(record => [String(record.id), record]))
  const result: ContinuumSummarySource[] = []
  for (const id of node.itemIds) {
    const record = byId.get(id)
    if (record === undefined) continue
    result.push(Object.freeze({ recordId: record.id, sourceRefs: record.sourceRefs }))
  }
  return Object.freeze(result)
}
