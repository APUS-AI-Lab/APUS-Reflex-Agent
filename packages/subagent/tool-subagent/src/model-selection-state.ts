/** Durable per-session state for the user-controlled model-selection opt-in. */

import { z as zod } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { assertAllowedModelRoutes, type AllowedModelRoute, type DelegationModelRequest } from './model-selection.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that this session's delegation tool exposes child provider,
     * model, and reasoning-effort selection. Appended before the first model
     * request; absence means the fixed-route definition. Log-only: it carries
     * no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }
    /**
     * The route one accepted delegation resolved to, recorded in the delegating
     * parent's session after the child was published. The policy states what a
     * child *may* select; this states what one delegation actually got, which
     * neither the tool call nor the child's own log carries. Log-only.
     */
    'subagent/model-selection-observation': SubagentModelSelectionObservation
  }
}

/** One accepted delegation's resolved child route, as the parent recorded it. */
export interface SubagentModelSelectionObservation {
  /** The published child this observation belongs to. */
  subagentId: string
  /** Route fields the call supplied; absent when it selected nothing. */
  requested?: DelegationModelRequest
  /** Child agent options this tool forwarded; absent when it forwarded none. */
  forwarded?: AgentOptions
  /** Whether the session policy constrained this selection. */
  policyConstrained: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Exact routes authorized for child LLM selection, or null when disabled. */
    subagentModelSelectionPolicy: AllowedModelRoute[] | null
  }
}

const modelSelectionPolicySchema: zod.ZodType<AllowedModelRoute[] | null> = zod.array(zod.object({
  provider: zod.string().min(1),
  model: zod.string().min(1),
}).strict()).min(1).nullable()

/** Host-only projection of the durable model-selection policy. */
export const subagentModelSelectionProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: modelSelectionPolicySchema,
  init: () => null,
  apply: (policy, event) => {
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    assertAllowedModelRoutes(allowedModels)
    if (allowedModels.length === 0) {
      throw new Error('subagent/model-selection-policy requires at least one route')
    }
    return allowedModels
  },
} satisfies ProjectionDefinition<'subagentModelSelectionPolicy', AllowedModelRoute[] | null>

/**
 * Read the exact route list captured for a model-selectable definition.
 * @param projections - registry that owns the policy projection.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined for the fixed-route definition.
 */
export function subagentModelSelectionPolicy(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
): AllowedModelRoute[] | undefined {
  return projections.stateOf(session, 'subagentModelSelectionPolicy')?.map(route => ({ ...route }))
}

/**
 * Append the route policy once, before its definition can reach a model request.
 * @param projections - registry that owns the policy projection.
 * @param session - session receiving the model-selectable definition.
 * @param allowedModels - exact routes the definition may select explicitly.
 */
export function recordSubagentModelSelection(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
  allowedModels: readonly AllowedModelRoute[],
): void {
  if (subagentModelSelectionPolicy(projections, session) !== undefined) return
  session.append('subagent/model-selection-policy', {
    allowedModels: allowedModels.map(route => ({ ...route })),
  })
}

/**
 * Record one accepted delegation's resolved route in the delegating session.
 * Append failure is contained: the warning names the child, and the delegation
 * keeps its accepted result unchanged.
 * @param logger - plugin logger that contains append failures.
 * @param session - the delegating parent's durable session.
 * @param observation - selection facts taken after the child was published.
 */
export function recordModelSelectionObservation(
  logger: Context['logger'],
  session: Session,
  observation: SubagentModelSelectionObservation,
): void {
  try {
    session.append('subagent/model-selection-observation', observation)
  } catch (error: unknown) {
    logger.warn(
      `subagent "${observation.subagentId}": the route selection was not recorded as subagent/model-selection-observation: ${String(error)}`,
    )
  }
}
