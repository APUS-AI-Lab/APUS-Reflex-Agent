/** Explicit Jev shadow consumer and durable, text-free decision receipts. */
import { createHash, randomUUID } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { JevFailure, JevRequest, JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { selectSystem3Route, type System3DataClass, type System3ExecutionDomain, type System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import { compareSystem3Advice, superviseSystem3Advice, type System3AdviceAction, type System3ShadowComparison, type System3SupervisorRequest, type System3SupervisorResult } from '@deepseek-ai/dsh-experimental-system3-supervisor'

/** Opaque identity of one persisted Jev shadow operation. */
export type System3DecisionId = Branded<'System3DecisionId'>

/** Independent checks and classified decision facts for one explicit shadow request. */
export interface System3DecisionRequest {
  readonly dataClasses: readonly System3DataClass[]
  readonly supervisor: System3SupervisorRequest
  readonly turn?: number
  readonly step?: number
}

/** Recorded success or safe failure; raw business text and provider error text are omitted. */
export type System3DecisionOutcome =
  | { readonly kind: 'ok'; readonly response: JevResponse }
  | { readonly kind: 'unknown'; readonly code: JevFailure['code'] | 'privacy-denied' | 'provider-unavailable' | 'cancelled'; readonly status?: number }

/** A shadow receipt that cannot change the deterministic supervisor result. */
export interface System3DecisionReceipt {
  readonly version: 1
  readonly id: System3DecisionId
  readonly mode: 'shadow'
  /** Complete structured payload sent to Jev, without raw business text or credentials. */
  readonly request: JevRequest
  readonly stateDigest: string
  readonly evidenceRefs: readonly string[]
  readonly goalRevision: string
  readonly dataClasses: readonly System3DataClass[]
  readonly routeId: string
  readonly executionDomain: System3ExecutionDomain
  readonly providerId?: string
  readonly requestedModel?: string
  readonly effort: 'low' | 'high'
  readonly turn?: number
  readonly step?: number
  readonly elapsedMs: number
  readonly baseline: System3SupervisorResult
  readonly advice: System3AdviceAction
  readonly comparison: System3ShadowComparison
  readonly outcome: System3DecisionOutcome
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Non-model-visible Jev shadow receipt, retaining deterministic authority. */
    'system3/decision': System3DecisionReceipt
  }
}

/** Deployment facts used by the System3 consumer before sending any state. */
export interface System3JevOptions {
  readonly routeId: string
  readonly executionDomain: System3ExecutionDomain
  readonly effort: 'low' | 'high'
}

const CRITERIA: Readonly<Record<System3AdviceAction, string>> = {
  continue: 'Continue working on the current goal.',
  retry: 'Retry after resolving a failed check.',
  escalate: 'Request additional capability or human input.',
  candidate_done: 'Suggest completion for independent verification.',
  unknown: 'Insufficient evidence to choose an action.',
}

function adviceOf(response: JevResponse): System3AdviceAction {
  const answer = response.answers.action
  if (answer?.type !== 'choice') return 'unknown'
  switch (answer.choice) {
    case 'continue': case 'retry': case 'escalate': case 'candidate_done': case 'unknown': return answer.choice
    default: return 'unknown'
  }
}

/**
 * Record one non-authoritative Jev decision after privacy admission.
 * @param ctx - Context providing the optional Jev capability.
 * @param session - Session that owns the durable receipt.
 * @param policy - Captured System3 privacy policy.
 * @param options - Declared Jev execution location and effort.
 * @param input - Classified decision facts and independent supervisor checks.
 * @param signal - Caller cancellation; a cancelled receipt is committed before rejection.
 * @returns The appended receipt with the unchanged deterministic baseline.
 */
export async function recordSystem3Decision(
  ctx: Context, session: Session, policy: System3PrivacyPolicy, options: System3JevOptions,
  input: System3DecisionRequest, signal?: AbortSignal,
): Promise<System3DecisionReceipt> {
  const started = Date.now()
  const request = structuredClone(input)
  const baseline = superviseSystem3Advice(request.supervisor)
  const admission = selectSystem3Route(policy, [
    { id: options.routeId, executionDomain: options.executionDomain, dataClasses: request.dataClasses },
  ])
  const jev = ctx.get('jev')
  let outcome: System3DecisionOutcome = { kind: 'unknown', code: 'provider-unavailable' }
  let advice: System3AdviceAction = 'unknown'
  let providerId: string | undefined
  let requestedModel: string | undefined
  let query: JevRequest = {
    state: {
      currentGoalRevision: request.supervisor.currentGoalRevision,
      advice: { ...request.supervisor.advice, evidenceRefs: [...request.supervisor.advice.evidenceRefs] },
      requiredChecks: request.supervisor.requiredChecks.map(check => ({ ...check, evidenceRefs: [...check.evidenceRefs] })),
      availableEvidenceRefs: [...request.supervisor.availableEvidenceRefs], budgetRemaining: request.supervisor.budgetRemaining,
    },
    effort: options.effort, questions: { action: { type: 'choice', criteria: CRITERIA } },
  }
  let cancellation: Error | undefined
  if (signal?.aborted) {
    outcome = { kind: 'unknown', code: 'cancelled' }
    cancellation = signal.reason instanceof Error ? signal.reason : new DOMException('Jev shadow request cancelled', 'AbortError')
  } else if (admission.selected === undefined) {
    outcome = { kind: 'unknown', code: 'privacy-denied' }
  } else if (jev !== undefined) {
    const spec = jev.resolve(query)
    providerId = spec.providerId
    requestedModel = spec.model
    query = { ...query, model: spec.model }
    try {
      const result = await jev.decide(query, signal)
      if (result.kind === 'ok') {
        outcome = { kind: 'ok', response: result.response }
        advice = adviceOf(result.response)
      } else {
        outcome = { kind: 'unknown', code: result.failure.code, ...result.failure.status === undefined ? {} : { status: result.failure.status } }
      }
    } catch (error) {
      if (!signal?.aborted) throw error
      outcome = { kind: 'unknown', code: 'cancelled' }
      cancellation = error instanceof Error ? error : new DOMException('Jev shadow request cancelled', 'AbortError')
    }
  }
  const receipt: System3DecisionReceipt = {
    version: 1, id: brandString<System3DecisionId>(randomUUID()), mode: 'shadow',
    request: query, stateDigest: createHash('sha256').update(JSON.stringify(query)).digest('hex'),
    evidenceRefs: [...request.supervisor.advice.evidenceRefs], goalRevision: request.supervisor.currentGoalRevision,
    dataClasses: [...request.dataClasses], routeId: options.routeId, executionDomain: options.executionDomain,
    ...providerId === undefined ? {} : { providerId }, ...requestedModel === undefined ? {} : { requestedModel },
    effort: options.effort,
    ...request.turn === undefined ? {} : { turn: request.turn },
    ...request.step === undefined ? {} : { step: request.step },
    elapsedMs: Date.now() - started, baseline, advice, comparison: compareSystem3Advice(advice, baseline), outcome,
  }
  const event = session.append('system3/decision', receipt)
  if (signal?.aborted) throw cancellation ?? new DOMException('Jev shadow request cancelled', 'AbortError')
  return event.data
}
