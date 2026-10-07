/** The fork-only gate that keeps upstream CI and automation jobs off unless the repository variable opts in. */

/** Condition this fork prefixes to every upstream job or step `if`. */
export const FORK_GATE = "vars.DSH_UPSTREAM_AUTOMATION == 'true'"

const WRAPPED = /^\$\{\{\s*vars\.DSH_UPSTREAM_AUTOMATION == 'true' && \(([\s\S]*)\)\s*\}\}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strip(node: Record<string, unknown>): void {
  if (typeof node.if !== 'string') return
  const condition = node.if.trim()
  if (condition === FORK_GATE) {
    delete node.if
    return
  }
  const inner = WRAPPED.exec(condition)?.[1]?.trim()
  if (inner === undefined) return
  // Upstream wrote these as YAML booleans, which the gate had to quote into the expression.
  node.if = inner === 'false' ? false : inner === 'true' ? true : inner
}

/**
 * Remove the fork gate from every job and step condition so workflow specs read the upstream conditions.
 * @param workflow - Parsed workflow YAML; it is changed in place.
 * @returns The same workflow object.
 */
export function stripForkGate<T>(workflow: T): T {
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) return workflow
  for (const job of Object.values(workflow.jobs)) {
    if (!isRecord(job)) continue
    strip(job)
    if (Array.isArray(job.steps)) for (const step of job.steps) if (isRecord(step)) strip(step)
  }
  return workflow
}
