/**
 * Deterministic route admission for the experimental System3 harness.
 *
 * This module is deliberately model-agnostic. Jev or another classifier may
 * suggest a route, but this policy remains the final admission boundary.
 * @module @deepseek-ai/dsh-experimental-system3-policy
 */

/** Data classes that a route may read or send. */
export type System3DataClass = 'public' | 'workspace' | 'sensitive' | 'secret'

/** User-selected privacy boundary for a routing decision. */
export type System3PrivacyMode = 'local-only' | 'controlled' | 'cloud-approved'

/** Where a route executes. */
export type System3ExecutionDomain = 'local' | 'network'

/** A route candidate supplied by a model, provider registry, or local policy. */
export interface System3RouteCandidate {
  /** Stable route identifier, such as `local-9b`, `codex`, or `claude-code`. */
  readonly id: string
  /** Whether execution can cross the local machine boundary. */
  readonly executionDomain: System3ExecutionDomain
  /** Data classes the route may receive. */
  readonly dataClasses: readonly System3DataClass[]
}

/** Explicit user controls for remote route admission. */
export interface System3PrivacyPolicy {
  /** The strongest boundary applied before any model preference. */
  readonly mode: System3PrivacyMode
  /** Remote route ids the user has approved for this decision. */
  readonly approvedRemoteIds?: readonly string[]
  /** Data classes the approved remote routes may receive. */
  readonly approvedRemoteDataClasses?: readonly System3DataClass[]
  /** Required only by the `cloud-approved` mode. */
  readonly cloudApproval?: boolean
}

/** Why a candidate was blocked by the policy. */
export type System3BlockReason =
  | 'network-disallowed'
  | 'route-not-approved'
  | 'data-class-not-approved'
  | 'cloud-approval-required'

/** A blocked candidate and the first applicable policy rule. */
export interface System3BlockedRoute {
  readonly candidate: System3RouteCandidate
  readonly reason: System3BlockReason
}

/** Result of applying the privacy policy to route candidates. */
export interface System3RouteAdmission {
  /** Candidates that may be selected, preserving caller order. */
  readonly allowed: readonly System3RouteCandidate[]
  /** Candidates rejected before model preference is considered. */
  readonly blocked: readonly System3BlockedRoute[]
  /** True when no candidate can be selected without asking or failing closed. */
  readonly requiresClarification: boolean
}

/** Result of selecting a route after policy admission. */
export interface System3RouteSelection extends System3RouteAdmission {
  /** The selected route, or undefined when the caller must clarify/fail closed. */
  readonly selected?: System3RouteCandidate
}

function includesDataClass(
  allowed: readonly System3DataClass[] | undefined,
  dataClass: System3DataClass,
): boolean {
  return allowed?.includes(dataClass) ?? false
}

function isRemoteApproved(candidate: System3RouteCandidate, policy: System3PrivacyPolicy): System3BlockReason | undefined {
  if (policy.mode === 'local-only') return 'network-disallowed'
  if (!policy.approvedRemoteIds?.includes(candidate.id)) return 'route-not-approved'
  if (candidate.dataClasses.some(dataClass => !includesDataClass(policy.approvedRemoteDataClasses, dataClass))) {
    return 'data-class-not-approved'
  }
  if (policy.mode === 'cloud-approved' && policy.cloudApproval !== true) return 'cloud-approval-required'
  return undefined
}

/**
 * Apply the user privacy policy to all route candidates.
 *
 * Local routes are always retained. Network routes are admitted only through
 * explicit route and data-class allowlists; no model score can override this.
 * Duplicate route ids are retained in their first occurrence only so a model
 * cannot change the result by emitting the same route twice.
 * @param policy - User privacy and remote-approval controls.
 * @param candidates - Ordered candidates from Jev, DSH, or a provider registry.
 * @returns The deterministic allowed/blocked partition.
 */
export function admitSystem3Routes(
  policy: System3PrivacyPolicy,
  candidates: readonly System3RouteCandidate[],
): System3RouteAdmission {
  const seen = new Set<string>()
  const allowed: System3RouteCandidate[] = []
  const blocked: System3BlockedRoute[] = []

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)

    if (candidate.executionDomain === 'local') {
      allowed.push(candidate)
      continue
    }

    const reason = isRemoteApproved(candidate, policy)
    if (reason === undefined) allowed.push(candidate)
    else blocked.push({ candidate, reason })
  }

  return { allowed, blocked, requiresClarification: allowed.length === 0 }
}

/**
 * Select the user's or Jev's preferred route after admission.
 *
 * A preferred remote id that policy rejects is ignored and the first admitted
 * route wins. When nothing is admitted, callers must ask for approval or fail
 * closed instead of silently sending data to a different provider.
 * @param policy - User privacy and remote-approval controls.
 * @param candidates - Ordered candidates from Jev, DSH, or a provider registry.
 * @param preferredId - Optional model preference evaluated only after admission.
 * @returns Admission details and the selected route when one is legal.
 */
export function selectSystem3Route(
  policy: System3PrivacyPolicy,
  candidates: readonly System3RouteCandidate[],
  preferredId?: string,
): System3RouteSelection {
  const admission = admitSystem3Routes(policy, candidates)
  const selected = preferredId === undefined
    ? admission.allowed[0]
    : admission.allowed.find(candidate => candidate.id === preferredId) ?? admission.allowed[0]
  return selected === undefined ? admission : { ...admission, selected }
}
