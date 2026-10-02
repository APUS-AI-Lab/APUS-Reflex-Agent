/** Provider-neutral Jev System One request and response types. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** A closed candidate set for one Choice question. */
export interface JevChoiceQuestion {
  readonly type: 'choice'
  readonly instructions?: string
  readonly criteria: Readonly<Record<string, string>>
}

/** An ordered set of semantic levels for one Score question. */
export interface JevScoreQuestion {
  readonly type: 'score'
  readonly instructions?: string
  readonly criteria: readonly string[]
}

/** A yes/no proposition for one Noul question. */
export interface JevNoulQuestion {
  readonly type: 'noul'
  readonly criteria?: Readonly<{ true: string; false: string }>
  readonly instructions?: string
}

/** One typed Jev question. */
export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion

/** A System One request. State and questions are JSON data supplied by the host. */
export interface JevRequest {
  /** Host provider selection; omitted from the System One wire body. */
  readonly providerId?: string
  readonly state: JsonValue
  readonly questions: Readonly<Record<string, JevQuestion>>
  readonly model?: string
  readonly effort?: 'low' | 'high'
}

/** Choice answer with a complete probability distribution. */
export interface JevChoiceAnswer {
  readonly type: 'choice'
  readonly choice: string
  readonly probabilities: Readonly<Record<string, number>>
  readonly confidence: number
}

/** Score answer with its ordered legend and complete probability distribution. */
export interface JevScoreAnswer {
  readonly type: 'score'
  readonly score: number
  readonly legend: Readonly<Record<string, string>>
  readonly probabilities: Readonly<Record<string, number>>
  readonly confidence: number
}

/** Noul answer containing the probability that the proposition is true. */
export interface JevNoulAnswer {
  readonly type: 'noul'
  readonly noul: number
}

/** One typed answer keyed by the request question id. */
export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer

/** Usage counters returned by a Jev provider, retained as finite numeric facts. */
export type JevUsage = Readonly<Record<string, number>>

/** A validated System One response. */
export interface JevResponse {
  readonly model: string
  readonly answers: Readonly<Record<string, JevAnswer>>
  readonly usage?: JevUsage
}

/** Provider metadata safe to expose to selectors and diagnostics. */
export interface JevProviderInfo {
  readonly id: string
  readonly model: string
  readonly endpoint: string
}

/** Implemented provider seam; providers must return a validated response or throw. */
export interface JevProvider {
  readonly info: JevProviderInfo
  /**
   * Execute the provider protocol and validate its response.
   * @param request - Typed state and questions to send.
   * @param signal - Caller cancellation.
   * @returns Validated provider response.
   */
  decide(request: JevRequest, signal?: AbortSignal): Promise<JevResponse>
  /**
   * Open or keep alive the transport to the provider without requesting a decision.
   * Providers without a reusable transport omit it.
   * @param signal - Caller cancellation.
   */
  warm?(signal?: AbortSignal): Promise<void>
}

/** A request with the provider selected and its effective model pinned. */
export interface JevSpec extends JevRequest {
  readonly providerId: string
  readonly model: string
}

/** Stable failure classes exposed by the service. */
export type JevErrorCode =
  | 'missing-credential'
  | 'timeout'
  | 'rate-limited'
  | 'http'
  | 'invalid-response'
  | 'transport'

/** A failure without request text, response text, or credentials. */
export interface JevFailure {
  readonly code: JevErrorCode
  readonly message: string
  readonly status?: number
}

/** Successful or fail-open Jev result. */
export type JevOutcome =
  | { readonly kind: 'ok'; readonly spec: JevSpec; readonly response: JevResponse }
  | { readonly kind: 'unknown'; readonly spec: JevSpec; readonly failure: JevFailure }
