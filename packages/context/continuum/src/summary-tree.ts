/** Deterministic summary navigation and local stable-prefix measurements. */

/** Input used to build a local summary tree. No model call is made. */
export interface ContinuumSummaryTreeItem {
  readonly id: string
  readonly scope: string
  readonly kind: string
  readonly content: string
  readonly summary?: string
}

/** A stable tree node; paths and child ordering are reproducible for a corpus. */
export interface ContinuumSummaryTreeNode {
  readonly path: string
  readonly label: string
  readonly summary: string
  readonly itemIds: readonly string[]
  readonly children: readonly ContinuumSummaryTreeNode[]
}

/** Options for deterministic tree construction. */
export interface ContinuumSummaryTreeConfig {
  readonly maxItemsPerLeaf?: number
  /** Maximum UTF-8 bytes per node summary; omitted for unbounded local instrumentation. */
  readonly maxSummaryBytes?: number
}

/** Build a two-level scope/kind tree without silently dropping source items. */
export function buildContinuumSummaryTree(
  items: readonly ContinuumSummaryTreeItem[],
  config: ContinuumSummaryTreeConfig = {},
): ContinuumSummaryTreeNode {
  const maxItemsPerLeaf = config.maxItemsPerLeaf ?? 32
  if (!Number.isSafeInteger(maxItemsPerLeaf) || maxItemsPerLeaf < 1) throw new TypeError('maxItemsPerLeaf must be a positive safe integer')
  if (config.maxSummaryBytes !== undefined && (!Number.isSafeInteger(config.maxSummaryBytes) || config.maxSummaryBytes < 1)) {
    throw new TypeError('maxSummaryBytes must be a positive safe integer')
  }
  const ordered = [...items].sort(compareItems)
  const groups = new Map<string, ContinuumSummaryTreeItem[]>()
  for (const item of ordered) {
    const key = `${item.scope}\u0000${item.kind}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  const children: ContinuumSummaryTreeNode[] = []
  for (const [key, group] of groups) {
    const [scope, kind] = key.split('\u0000') as [string, string]
    for (let offset = 0; offset < group.length; offset += maxItemsPerLeaf) {
      const chunk = group.slice(offset, offset + maxItemsPerLeaf)
      const suffix = offset === 0 ? '' : `-${offset / maxItemsPerLeaf + 1}`
      children.push(Object.freeze({
        path: `${escapePath(scope)}/${escapePath(kind)}${suffix}`,
        label: `${scope}/${kind}${suffix}`,
        summary: summarize(chunk, config.maxSummaryBytes),
        itemIds: Object.freeze(chunk.map(item => item.id)),
        children: Object.freeze([]),
      }))
    }
  }
  return Object.freeze({ path: '', label: 'root', summary: summarize(ordered, config.maxSummaryBytes), itemIds: Object.freeze([]), children: Object.freeze(children) })
}

/** Find source item IDs whose content or deterministic summary contains every term. */
export function findContinuumSummaryTreeItems(
  tree: ContinuumSummaryTreeNode,
  items: readonly ContinuumSummaryTreeItem[],
  terms: readonly string[],
): readonly string[] {
  const wanted = terms.map(term => term.toLocaleLowerCase()).filter(term => term.length > 0)
  if (wanted.length === 0) return Object.freeze([])
  const byId = new Map(items.map(item => [item.id, item]))
  const result: string[] = []
  for (const node of tree.children) {
    for (const id of node.itemIds) {
      const item = byId.get(id)
      if (item === undefined) continue
      const text = `${item.content} ${item.summary ?? ''}`.toLocaleLowerCase()
      if (wanted.every(term => text.includes(term)) && !result.includes(id)) result.push(id)
    }
  }
  return Object.freeze(result)
}

/** One deterministic local measurement of a rendered prompt layout. */
export interface ContinuumStableCacheMeasurement {
  readonly frame: number
  readonly totalBytes: number
  readonly reusedPrefixBytes: number
  readonly cacheKey: string
}

/**
 * Measure stable-prefix reuse across rendered layouts. This is instrumentation
 * for local layout reuse only; it is never a provider cache-hit or billing claim.
 */
export function measureContinuumStableCacheLayouts(layouts: readonly string[]): readonly ContinuumStableCacheMeasurement[] {
  let previous = ''
  const measurements = layouts.map((layout, frame) => {
    const reusedPrefixBytes = utf8Bytes(commonPrefix(previous, layout))
    const measurement = Object.freeze({
      frame,
      totalBytes: utf8Bytes(layout),
      reusedPrefixBytes,
      cacheKey: stableHash(layout),
    })
    previous = layout
    return measurement
  })
  return Object.freeze(measurements)
}

function compareItems(left: ContinuumSummaryTreeItem, right: ContinuumSummaryTreeItem): number {
  return left.scope.localeCompare(right.scope) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
}

function summarize(items: readonly ContinuumSummaryTreeItem[], maxBytes?: number): string {
  let result = ''
  let bytes = 0
  for (const [index, item] of items.entries()) {
    const text = `${index === 0 ? '' : ' | '}${item.summary ?? item.content}`
    for (const character of text) {
      bytes += utf8Bytes(character)
      if (maxBytes !== undefined && bytes > maxBytes) return result
      result += character
    }
  }
  return result
}

function escapePath(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('/', '%2F').replaceAll('\u0000', '%00')
}

function commonPrefix(left: string, right: string): string {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return left.slice(0, index)
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
