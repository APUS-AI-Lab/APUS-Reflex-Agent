/** Incremental Goal evidence and intervention budgets restored by session replay. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRunId, SubagentEvidenceTurnId, SubagentEvidenceInfo } from '@deepseek-ai/dsh-subagent'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

const evidenceSchema = z.object({
  turnId: z.string().transform(value => brandString<SubagentEvidenceTurnId>(value)),
  runId: z.string().transform(value => brandString<SubagentRunId>(value)),
  provider: z.string(), id: z.string().transform(SessionId),
  kind: z.enum(['command', 'file-change']), operation: z.enum(['verification', 'diagnostic', 'command', 'file-change']),
  semantic: z.object({ version: z.literal(1),
    actions: z.array(z.object({ kind: z.enum(['read', 'list-files', 'search', 'file-add', 'file-update', 'file-delete', 'verification-target']),
      path: z.string().optional() }).transform(({ path, ...action }) => ({ ...action, ...path === undefined ? {} : { path } }))),
    truncated: z.boolean() }).optional(),
  operationDigest: z.string(), resultDigest: z.string().optional(), outcome: z.enum(['succeeded', 'failed', 'unknown']),
}).transform(({ resultDigest, semantic, ...evidence }) => ({ ...evidence, ...resultDigest === undefined ? {} : { resultDigest },
  ...semantic === undefined ? {} : { semantic } }))
const actionSchema = z.enum(['observe', 'diagnose', 'verify', 'narrow', 'realign'])
const stateSchema = z.object({
  humanRevision: z.number(), lastHumanAt: z.number(),
  recoveryBudgets: z.record(z.string(), z.object({ attempts: z.number(), lastAt: z.number() })),
  goalId: z.string().nullable(), goalRevision: z.number(), evidence: z.array(evidenceSchema),
  budgets: z.record(z.string(), z.object({ actions: z.array(actionSchema), lastDeliveryAt: z.number() })),
  requirementsGoalId: z.string().nullable(), requirements: z.array(z.string()),
})
/** Durable supervision data; live runs add only transient timing and cancellation state. */
export type ReflexSupervisionState = z.infer<typeof stateSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Goal-wide delivery reservations and bounded recent provider evidence. */
    reflexSupervision: ReflexSupervisionState
  }
}
/** Copy readonly provider evidence into mutable JSON arrays owned by a request or projection.
 * @param evidence - Validated provider observation.
 * @returns Independent action arrays suitable for JSON serialization and persisted-state validation.
 */
export function copyReflexEvidence(evidence: SubagentEvidenceInfo): ReflexSupervisionState['evidence'][number] {
  const { semantic, ...rest } = evidence
  return { ...rest, ...semantic === undefined ? {} : {
    semantic: { ...semantic, actions: semantic.actions.map(action => ({ ...action })) } } }
}

/** Create a replayable projection with deployment-bounded evidence retention.
 * @param evidenceLimit - Maximum retained evidence entries for the latest Goal revision.
 * @returns Projection definition registered before sessions are created or resumed.
 */
export function reflexSupervisionStateProjection(evidenceLimit: number): ProjectionDefinition<'reflexSupervision'> {
  return {
    key: 'reflexSupervision', stateVersion: 3, stateSchema,
    init: () => ({ humanRevision: 0, lastHumanAt: 0, recoveryBudgets: {}, goalId: null, goalRevision: 0, evidence: [],
      budgets: {}, requirementsGoalId: null, requirements: [] }),
    apply(state, event) {
      if ((event.type === 'user/message' && event.data.source.kind === 'user') || event.type === 'subagent/steer'
        || (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === 'user'))) return { ...state, humanRevision: state.humanRevision + 1, lastHumanAt: event.time }
      if (event.type === 'system3/reflex-recovery') {
        if (event.data.state !== 'intent') return { ...state, evidence: [] }
        const goalId = event.data.goalId
        return { ...state, evidence: [], recoveryBudgets: { ...state.recoveryBudgets,
          [goalId]: { attempts: (state.recoveryBudgets[goalId]?.attempts ?? 0) + 1, lastAt: event.time } } }
      }
      if (event.type === 'system3/reflex-evidence') {
        const { goalId, goalRevision, evidence } = event.data
        const previous = state.goalId === goalId && state.goalRevision === goalRevision ? state.evidence : []
        return { ...state, goalId, goalRevision, evidence: [...previous, copyReflexEvidence(evidence)].slice(-evidenceLimit) }
      }
      if (event.type === 'system3/reflex-supervision' && event.data.state === 'intent') {
        const { goalId, action } = event.data
        const previous = state.budgets[goalId]
        return { ...state, budgets: { ...state.budgets,
          [goalId]: { actions: [...previous?.actions ?? [], action], lastDeliveryAt: event.time } } }
      }
      if (event.type === 'system3/task-frame') return { ...state, requirementsGoalId: event.data.goal.goalId ?? null,
        requirements: event.data.items.map(item => item.text) }
      return state
    },
  }
}
