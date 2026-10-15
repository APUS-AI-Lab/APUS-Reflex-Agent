/** One way to ask Jev a bounded question, apply thresholds, fall back on failure, and record the judgement. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JevConfigurationError, type JevAnswer, type JevErrorCode, type JevQuestion, type JevRequest,
  type JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { admitSystem3Routes, type System3DataClass, type System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resolveSystem3JevRoute, type System3JevOptions } from './decisions.ts'

/** `off` asks nothing; `shadow` asks and records but never changes behavior; `active` lets the judgement act. */
export type System3DecisionMode = 'off' | 'shadow' | 'active'

/** Deployment settings of one decision. */
export interface System3DecisionSettings {
  /** `off` asks nothing; `shadow` records judgements without acting on them; `active` acts on confident judgements. */
  readonly mode: System3DecisionMode
  /** Probability, from 0 to 1, at or above which a yes/no answer is yes or a choice is accepted. */
  readonly yes: number
  /** Probability, from 0 to 1, at or below which a yes/no answer is no; between the two it is unsure. */
  readonly no: number
  /** Milliseconds the judgement may take before the fallback applies. */
  readonly deadlineMs: number
}

/** Why a judgement has the outcome it has. */
export type System3JudgementReason = 'judged' | 'unsure' | 'off' | 'privacy-denied' | 'provider-unavailable' | 'deadline' | JevErrorCode

/** One judgement, recorded in the Session of the Agent it concerns. */
export interface System3Judgement {
  readonly version: 1
  /** Decision identifier, such as `constraint.check`. */
  readonly decision: string
  /** Version of the decision's questions and rules. */
  readonly decisionVersion: number
  readonly mode: System3DecisionMode
  /** Exact Jev request, or null when none was sent. */
  readonly request: JevRequest | null
  readonly response?: JevResponse
  /** The judged outcome, or the fallback when there is no judgement. */
  readonly outcome: string
  readonly reason: System3JudgementReason
  /** Whether the outcome changed behavior: only an `active` decision with a confident judgement acts. */
  readonly applied: boolean
  readonly elapsedMs: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A System3 decision asked Jev, or fell back; not model-visible by itself. */
    'system3/judgement': System3Judgement
  }
}

/** A bounded question set and the rule that turns its answers into an outcome. */
export interface System3DecisionSpec<Input, Outcome extends string> {
  readonly id: string
  readonly version: number
  /** Request state; it carries only what the questions need. */
  state(input: Input): JsonValue
  /** Questions keyed by answer id; at most the Jev question limit. */
  questions(input: Input): Readonly<Record<string, JevQuestion>>
  /** Outcome from confident answers, or `unsure` when the answers do not decide. */
  decide(response: JevResponse, settings: System3DecisionSettings, input: Input): Outcome | 'unsure'
  /** Outcome when there is no confident judgement, or the decision is not active. */
  readonly fallback: Outcome
}

/** The outcome a caller acts on, and the record that explains it. */
export interface System3DecisionResult<Outcome extends string> {
  /** The judged outcome when applied, otherwise the fallback. */
  readonly outcome: Outcome
  readonly judgement: System3Judgement
}

/** Privacy policy and Jev route shared by every decision. */
export interface System3DecisionContext {
  readonly policy: System3PrivacyPolicy
  readonly options: System3JevOptions
  readonly dataClasses: readonly System3DataClass[]
}

/**
 * Read a yes/no answer against the thresholds.
 * @param probability - Jev probability that the proposition is true.
 * @param settings - Thresholds of the decision.
 * @returns `yes`, `no`, or `unsure` between the thresholds.
 */
export function noulVerdict(probability: number, settings: Pick<System3DecisionSettings, 'yes' | 'no'>): 'yes' | 'no' | 'unsure' {
  return probability >= settings.yes ? 'yes' : probability <= settings.no ? 'no' : 'unsure'
}

/**
 * Read a choice answer against the acceptance threshold.
 * @param answer - Jev answer to a choice question, if any.
 * @param settings - Thresholds of the decision.
 * @returns The chosen key when its probability reaches `yes`, otherwise `undefined`.
 */
export function choiceVerdict(answer: JevAnswer | undefined, settings: Pick<System3DecisionSettings, 'yes'>): string | undefined {
  return answer?.type === 'choice' && (answer.probabilities[answer.choice] ?? 0) >= settings.yes ? answer.choice : undefined
}

/**
 * Reject settings that cannot produce a meaningful judgement.
 * @param id - Decision identifier, used in the error.
 * @param settings - Deployment settings of the decision.
 */
export function validateSystem3DecisionSettings(id: string, settings: System3DecisionSettings): void {
  if (!(settings.no >= 0 && settings.no < settings.yes && settings.yes <= 1)) {
    throw new Error(`decisions.${id} thresholds must satisfy 0 <= no < yes <= 1`)
  }
  if (!Number.isSafeInteger(settings.deadlineMs) || settings.deadlineMs < 1 || settings.deadlineMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`decisions.${id} deadlineMs must be a positive integer within the timer limit`)
  }
}

/**
 * Ask Jev one decision for an Agent, apply the thresholds, and record the judgement in its Session.
 * Jev failures, the deadline, and privacy denial yield the fallback and are recorded; caller cancellation rejects without a record.
 * An already-cancelled caller dispatches nothing; a provider response received after cancellation is discarded.
 * @param ctx - Context providing the optional Jev service.
 * @param shared - Privacy policy, Jev route, and data classes.
 * @param spec - The decision.
 * @param settings - Mode, thresholds, and deadline.
 * @param agent - Agent whose Session receives the record.
 * @param input - What the decision judges.
 * @param signal - Caller cancellation.
 * @returns The outcome to act on and its record.
 */
export async function runSystem3Decision<Input, Outcome extends string>(ctx: Context, shared: System3DecisionContext,
  spec: System3DecisionSpec<Input, Outcome>, settings: System3DecisionSettings, agent: Agent, input: Input,
  signal: AbortSignal): Promise<System3DecisionResult<Outcome>> {
  signal.throwIfAborted()
  const started = Date.now()
  let request: JevRequest | null = null
  let response: JevResponse | undefined
  let judged: Outcome | 'unsure' = 'unsure'
  let reason: System3JudgementReason = 'provider-unavailable'
  if (settings.mode === 'off') { reason = 'off'; return finish() }
  const jev = ctx.get('jev')
  const admission = admitSystem3Routes(shared.policy, [{ id: shared.options.routeId,
    executionDomain: resolveSystem3JevRoute(jev, shared.options).executionDomain, dataClasses: shared.dataClasses }])
  if (admission.allowed.length === 0) { reason = 'privacy-denied'; return finish() }
  if (jev === undefined) return finish()
  try {
    request = jev.resolve({ state: spec.state(input),
      ...shared.options.effort === undefined ? {} : { effort: shared.options.effort }, questions: spec.questions(input) })
  } catch (error) {
    // An unconfigured or switched-off provider answers like a missing one.
    if (error instanceof JevConfigurationError) return finish()
    throw error
  }
  const deadline = AbortSignal.timeout(settings.deadlineMs)
  try {
    const result = await jev.decide(request, AbortSignal.any([signal, deadline]))
    if (result.kind === 'unknown') { reason = result.failure.code; return finish() }
    response = result.response
  } catch (error) {
    if (!signal.aborted && error instanceof JevConfigurationError) return finish()
    // Caller cancellation and unexpected failures propagate without a record; only the deadline falls back.
    if (signal.aborted || !deadline.aborted) throw error
    reason = 'deadline'
    return finish()
  }
  judged = spec.decide(response, settings, input)
  reason = judged === 'unsure' ? 'unsure' : 'judged'
  return finish()

  function finish(): System3DecisionResult<Outcome> {
    signal.throwIfAborted()
    const applied = settings.mode === 'active' && judged !== 'unsure'
    const outcome = judged === 'unsure' ? spec.fallback : judged
    const judgement: System3Judgement = {
      version: 1, decision: spec.id, decisionVersion: spec.version, mode: settings.mode, request,
      ...response === undefined ? {} : { response }, outcome, reason, applied, elapsedMs: Date.now() - started,
    }
    agent.session.append('system3/judgement', judgement)
    return { outcome: applied ? outcome : spec.fallback, judgement }
  }
}
