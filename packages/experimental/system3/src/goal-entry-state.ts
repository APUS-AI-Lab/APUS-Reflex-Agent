/** Durable one-attempt-per-Goal-revision delegation state. */
import { z } from 'zod'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

const entrySchema = z.object({ version: z.literal(1), goalId: z.string().transform(GoalId), goalRevision: z.number(), round: z.number(),
  state: z.enum(['reserved', 'started', 'completed', 'failed', 'interrupted', 'abstained']),
  candidateId: z.string().nullable(), provider: z.string().nullable(),
  childSessionId: z.string().transform(SessionId).nullable(), reason: z.string().nullable(),
  input: z.string().nullable(), output: z.string().nullable() })
/** Lifecycle receipt identifying the authorized Goal revision and external execution. */
export type GoalEntryReceipt = z.infer<typeof entrySchema>
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Goal entry decision and its actual delegated execution lifecycle. */
    'system3/goal-entry': GoalEntryReceipt
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest Goal entry reservation retained across process restart. */
    goalEntryRouting: { entry: GoalEntryReceipt | null; delivered: boolean }
  }
}
/** Restore the latest receipt without replaying external execution. */
export const goalEntryRoutingProjection: ProjectionDefinition<'goalEntryRouting'> = {
  key: 'goalEntryRouting', stateVersion: 1, stateSchema: z.object({ entry: entrySchema.nullable(), delivered: z.boolean() }),
  init: () => ({ entry: null, delivered: false }),
  apply(state, event) {
    if (event.type === 'system3/goal-entry') return { entry: event.data, delivered: false }
    if (event.type === 'user/message' && event.data.source.kind === 'system3-goal-delegation') return { ...state, delivered: true }
    return state
  },
}
