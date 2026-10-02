/** Client-safe System3 facts derived only from committed Session events. */
import type { SessionRequestId, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

/** Entry recommendation, Host adoption, and actual request use are separate facts. */
export interface System3EntryView {
  readonly requestId: SessionRequestId
  readonly phase: 'deciding' | 'decided'
  readonly outcome: string | null
  readonly suggested: ModelSelection | null
  readonly adopted: ModelSelection | null
  readonly used: ModelSelection | null
  readonly elapsedMs: number | null
  /** Turn that carried this input, once its user message is committed; null before admission. */
  readonly turn: number | null
  /** Configured route chosen for this input, by Jev or by continuing the previous route; null when the baseline was kept. */
  readonly route: {
    readonly id: string
    readonly label: string | null
    readonly retained: boolean
    /** Delegation chosen for this input: instruction injected, then the named tool actually called. */
    readonly delegation: {
      readonly candidateId: string
      readonly tool: string
      readonly injected: boolean
      readonly called: boolean
    } | null
  } | null
}

/** One automatic Skill recommendation; injection is confirmed by its durable user message. */
export interface System3SkillView {
  readonly requestId: SessionRequestId | null
  readonly turn: number
  readonly step: number
  readonly outcome: string
  readonly selected: string | null
  readonly injected: boolean
  readonly elapsedMs: number
}

/** Latest progress snapshot of a subagent run delegated by this Session's Agent. */
export interface System3SubagentRunView {
  readonly runId: string
  readonly provider: string
  /** `running` until the run settles, then its stop reason. */
  readonly state: string
  /** Host wall-clock milliseconds when the run started; the Client derives live elapsed time from it. */
  readonly startedAt: number
  readonly elapsedMs: number
  /** Completed steps per category. */
  readonly completed: Readonly<Record<string, number>>
  /** Category of the step in progress, or null. */
  readonly current: string | null
}

/** Latest entry, Skill, and delegated-run facts; no prompt bodies, child content, or provider probabilities leave the Host. */
export interface System3RuntimeView {
  readonly entry: System3EntryView | null
  readonly skill: System3SkillView | null
  readonly subagentRun: System3SubagentRunView | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest real entry, adoption, request-use, and Skill injection facts. */
    system3Runtime: System3RuntimeView
  }
}
