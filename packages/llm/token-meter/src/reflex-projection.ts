/** Signed text-price adjustments committed with a Reflex context projection. */
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction/reflex-context-projection'

/**
 * Reprice retained nodes without changing attachment prices or historical anchors.
 * @param nodes - retained nodes before this projection.
 * @param event - durable text changes and their exact heuristic price differences.
 * @returns new nodes after all affected prices have been validated.
 */
export function repriceReflexNodes<T extends { readonly seq: SessionSeq; readonly heuristicTokens: number }>(
  nodes: readonly T[],
  event: SessionEvent<'reflex/context-projection'>,
): T[] {
  const deltas = new Map<SessionSeq, number>()
  for (const target of event.data.targets) {
    if (!Number.isSafeInteger(target.tokenDelta)) throw new Error('Reflex context token delta must be a safe integer')
    deltas.set(target.seq, (deltas.get(target.seq) ?? 0) + target.tokenDelta)
  }
  const next = nodes.map((node) => {
    const delta = deltas.get(node.seq)
    if (delta === undefined) return node
    deltas.delete(node.seq)
    const heuristicTokens = node.heuristicTokens + delta
    if (!Number.isSafeInteger(heuristicTokens) || heuristicTokens < 0) {
      throw new Error('Reflex context projection produced an invalid token price')
    }
    return { ...node, heuristicTokens }
  })
  if (deltas.size > 0) throw new Error('Reflex context token target is not retained')
  return next
}
