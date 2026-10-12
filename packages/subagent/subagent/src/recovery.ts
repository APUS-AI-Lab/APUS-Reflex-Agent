/** Host-only, attributed recovery control and durable native receipts. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SubagentRecoveryState, SubagentRecoveryReceipt, SubagentRunId } from './types.ts'

/** Identifies one reserved autonomous recovery attempt. */
export type SubagentRecoveryId = Branded<'SubagentRecoveryId'>
/** Authority is checked before both native interruption and continuation. */
export interface SubagentSupervisorRecovery {
  readonly id: SubagentRecoveryId
  readonly observation: SubagentRecoveryState
  readonly interruptGraceMs: number
  readonly text: string
  readonly isCurrent: () => boolean
}
/** Content delivered to the native model is retained with autonomous attribution. */
export interface SubagentSupervisionRecoveryEvent {
  readonly version: 1
  readonly id: SubagentRecoveryId
  readonly runId: SubagentRunId
  readonly provider: string
  readonly source: 'reflex-supervision'
  readonly text: string
  readonly observation: SubagentRecoveryState
  readonly state: 'intent' | 'unknown' | SubagentRecoveryReceipt['state']
  readonly turnId?: SubagentRecoveryReceipt['turnId']
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Attributed native recovery intent or receipt; never a human message. */
    'subagent/supervision-recovery': SubagentSupervisionRecoveryEvent
  }
}

/** Supervisor advice was rejected before native dispatch because its authority changed. */
export class SubagentSupervisorStaleError extends Error {}
