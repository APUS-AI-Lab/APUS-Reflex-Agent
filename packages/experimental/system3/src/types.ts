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
  /** Where the recorded entry decision ran: on this device (`local`) or through a decision service (`network`); null while deciding. */
  readonly executionDomain: 'local' | 'network' | null
  /** Turn that carried this input, once its user message is committed; null before admission. */
  readonly turn: number | null
  /** Model candidates left out of this decision because their route was degraded, by display label. */
  readonly avoided: readonly { readonly label: string; readonly reason: string }[]
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

/** Bounded input classification; it never asserts that an action has executed. */
export type System3InputIntent = 'conversation' | 'retrieval' | 'research' | 'creation' | 'action' | 'uncertain'

/** One automatic Skill recommendation; injection is confirmed by its durable user message. */
export interface System3SkillView {
  /** Model-selected input category, absent on legacy receipts or failed classification. */
  readonly intent?: System3InputIntent
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
  /** Milliseconds from start to the latest step, or null before the first step. */
  readonly lastStepAt: number | null
  /** Latest short progress text the child wrote for a person, or null. */
  readonly note: string | null
  /** Latest unresolved attention alert: overtime lasts while running; stalled and starting clear on the next step. */
  readonly alert: { readonly kind: string; readonly elapsedMs: number } | null
  /** Whether the run accepts a person's mid-run input now; false once it settles. */
  readonly steerable: boolean
  /** The latest three inputs the run accepted, oldest first, with milliseconds from start. */
  readonly steers: readonly { readonly text: string; readonly atMs: number }[]
}

/**
 * Latest entry, Skill, and delegated-run facts; no prompt bodies, child content, or provider probabilities leave the Host.
 * Steer texts are the person's own input.
 */
export interface System3RuntimeView {
  /** Latest durable Reflex actions; absent until this session records one. */
  readonly reflex?: {
    /** Whether a delegated Codex run is currently being observed by Reflex. */
    readonly observing: boolean
    readonly recovery?: { readonly state: string; readonly reason: string; readonly runId: string } | undefined
    readonly supervision: { readonly state: string; readonly action: string; readonly evidenceCount: number; readonly runId: string } | null
    readonly context: { readonly revision: number; readonly action: 'remove' | 'restore'; readonly targetsCount: number } | null
    /** Recent content-free Reflex milestones, newest last. */
    readonly timeline: readonly {
      readonly kind: 'supervision' | 'recovery' | 'context' | 'evidence'
      readonly at: number
      readonly state: string | null
      readonly action: string | null
      readonly count: number | null
    }[]
  } | undefined
  readonly entry: System3EntryView | null
  /** Earlier entry decisions whose input reached a turn, oldest first, so earlier turns keep their route line. */
  readonly history: readonly System3EntryView[]
  readonly skill: System3SkillView | null
  readonly subagentRun: System3SubagentRunView | null
  /** Process supervision findings of the latest turn, oldest first; cleared when a turn starts. */
  readonly notices: readonly System3ProcessNoticeView[]
  /** The person's current goal and later requirements, verbatim; null before the first frame. */
  readonly taskFrame: System3TaskFrameView | null
  /** The latest queued message System3 moved into the running turn; cleared when that turn ends. */
  readonly interjection: { readonly messageId: string } | null
}

/** The task frame as the Client shows it; texts are the person's own messages. */
export interface System3TaskFrameView {
  /** The DSH goal's objective (`goalId`) or the message that started the task (`messageId`). */
  readonly goal: { readonly text: string; readonly messageId?: string; readonly goalId?: string }
  readonly items: readonly { readonly messageId: string; readonly text: string }[]
}

/** One process supervision finding as the Client shows it. */
export interface System3ProcessNoticeView {
  /** Rule identifier, such as `repeated-error` or `missing-evidence`. */
  readonly rule: string
  /** Tool or delegate provider the finding concerns, or null. */
  readonly subject: string | null
  readonly count: number
  /** Whether the main model was told what to do next. */
  readonly advised: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest real entry, adoption, request-use, and Skill injection facts. */
    system3Runtime: System3RuntimeView
  }
}
