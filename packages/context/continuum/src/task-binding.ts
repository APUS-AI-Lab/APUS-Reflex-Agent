/** Durable association between a business Session and one explicitly authorized task. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { MemoryId } from './records.ts'
import { MemoryDomainId, MemoryPrincipalId, MemoryTaskId } from './task-types.ts'

/** One retired task entry as hashed into a binding's retirement digest. */
export interface TaskRetirementBasis {
  readonly id: MemoryId
  readonly status: 'superseded' | 'deactivated'
  readonly supersedes?: MemoryId
}

/** A binding captures the retirement set before any task content reaches the model. */
export interface TaskBinding {
  readonly domainId: MemoryDomainId
  readonly principalId: MemoryPrincipalId
  readonly taskId: MemoryTaskId
  readonly workspace: string
  readonly retirementDigest: string
  /**
   * Retired entries in snapshot order that produced `retirementDigest`, hashed as JSON arrays of
   * `[id, status, supersedes]`; absent on historical bindings.
   */
  readonly retirementBasis?: readonly TaskRetirementBasis[]
  /** Isolated journal revision when the binding was first written; absent on historical bindings. */
  readonly journalRevision?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Explicit host-owned cross-session task binding, required to interpret subsequent task context. It also records
     * the retired entries hashed into `retirementDigest` and the journal revision at first binding.
     */
    'continuum/task-binding': TaskBinding
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Original task binding; a changed retirement set requires a clean Session. */
    continuumTaskBinding: TaskBinding | null
  }
}

/** Incremental binding recovery; no whole-log reads occur on the request path. */
export const taskBindingProjection: ProjectionDefinition<'continuumTaskBinding'> = {
  key: 'continuumTaskBinding',
  stateVersion: 1,
  stateSchema: z.object({
    domainId: z.string().min(1).transform(MemoryDomainId),
    principalId: z.string().min(1).transform(MemoryPrincipalId),
    taskId: z.string().min(1).transform(MemoryTaskId),
    workspace: z.string().min(1),
    retirementDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).nullable(),
  init: () => null,
  apply: (state, event) => {
    if (event.type !== 'continuum/task-binding') return state
    if (state !== null) throw new Error('a Session cannot replace its Continuum task binding')
    return event.data
  },
}
