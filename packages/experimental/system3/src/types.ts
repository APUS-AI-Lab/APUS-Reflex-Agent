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

/** Latest entry and Skill facts; no prompt bodies or provider probabilities leave the Host. */
export interface System3RuntimeView {
  readonly entry: System3EntryView | null
  readonly skill: System3SkillView | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest real entry, adoption, request-use, and Skill injection facts. */
    system3Runtime: System3RuntimeView
  }
}
