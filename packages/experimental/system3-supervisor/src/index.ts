/**
 * Deterministic completion supervision and usage accounting primitives.
 * @module @deepseek-ai/dsh-experimental-system3-supervisor
 */

/** Actions a model or Jev may suggest after a step. */
export type System3AdviceAction = 'continue' | 'retry' | 'escalate' | 'candidate_done' | 'unknown'

/** Independent status for one user-visible goal check. */
export type System3CheckStatus = 'pass' | 'fail' | 'unknown'

/** A durable, independently computed goal check. */
export interface System3GoalCheck {
  readonly id: string
  readonly status: System3CheckStatus
  readonly evidenceRefs: readonly string[]
}

/** A model's non-authoritative advice. */
export interface System3SupervisorAdvice {
  readonly action: System3AdviceAction
  readonly goalRevision: string
  readonly evidenceRefs: readonly string[]
}

/** Inputs to the completion supervisor. */
export interface System3SupervisorRequest {
  readonly currentGoalRevision: string
  readonly advice: System3SupervisorAdvice
  readonly requiredChecks: readonly System3GoalCheck[]
  readonly availableEvidenceRefs: readonly string[]
  readonly budgetRemaining: number
}

/** The action the deterministic supervisor allows the loop to take. */
export type System3SupervisedAction = 'continue' | 'retry' | 'escalate' | 'done'

/** Auditable supervision result. */
export interface System3SupervisorResult {
  readonly action: System3SupervisedAction
  readonly accepted: boolean
  readonly reason: 'accepted' | 'stale-goal' | 'missing-evidence' | 'failed-checks' | 'unknown-checks' | 'budget-exhausted' | 'invalid-advice'
  readonly missingChecks: readonly string[]
  readonly missingEvidenceRefs: readonly string[]
}

/** Comparison between a model suggestion and an independent baseline. */
export interface System3ShadowComparison {
  readonly modelAction: System3AdviceAction
  readonly baselineAction: System3SupervisedAction
  readonly agrees: boolean
  readonly divergence: 'none' | 'model-premature-done' | 'model-understops' | 'model-unsafe'
}

/** Token accounting source. Estimated values must never be presented as provider usage. */
export type System3UsageSource = 'provider' | 'estimated'

/** One request's auditable usage record. */
export interface System3CostRecord {
  readonly requestId: string
  readonly episodeId: string
  readonly modelRevision: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly source: System3UsageSource
  readonly elapsedMs: number
}

function missingValues(values: readonly string[], available: readonly string[]): string[] {
  const allowed = new Set(available)
  return [...new Set(values)].filter(value => !allowed.has(value))
}

/**
 * Apply independent goal checks to non-authoritative model advice.
 *
 * `candidate_done` becomes `done` only when the goal revision is current, all
 * checks pass, all referenced evidence exists, and budget remains. This is a
 * pure gate so a Jev confidence score cannot authorize completion.
 * @param request - Advice, goal checks, evidence inventory, and budget.
 * @returns A deterministic action and the reason for any refusal.
 */
export function superviseSystem3Advice(request: System3SupervisorRequest): System3SupervisorResult {
  const missingEvidenceRefs = missingValues(request.advice.evidenceRefs, request.availableEvidenceRefs)
  const missingChecks = request.requiredChecks.filter(check => check.status !== 'pass').map(check => check.id)
  const unknownChecks = request.requiredChecks.filter(check => check.status === 'unknown').map(check => check.id)

  if (request.advice.goalRevision !== request.currentGoalRevision) {
    return { action: 'escalate', accepted: false, reason: 'stale-goal', missingChecks, missingEvidenceRefs }
  }
  if (request.budgetRemaining <= 0) {
    return { action: 'escalate', accepted: false, reason: 'budget-exhausted', missingChecks, missingEvidenceRefs }
  }
  if (missingEvidenceRefs.length > 0) {
    return { action: 'escalate', accepted: false, reason: 'missing-evidence', missingChecks, missingEvidenceRefs }
  }
  if (request.advice.action === 'candidate_done') {
    if (unknownChecks.length > 0) return { action: 'escalate', accepted: false, reason: 'unknown-checks', missingChecks, missingEvidenceRefs }
    if (missingChecks.length > 0) return { action: 'retry', accepted: false, reason: 'failed-checks', missingChecks, missingEvidenceRefs }
    return { action: 'done', accepted: true, reason: 'accepted', missingChecks: [], missingEvidenceRefs: [] }
  }
  if (request.advice.action === 'continue') return { action: 'continue', accepted: true, reason: 'accepted', missingChecks, missingEvidenceRefs }
  if (request.advice.action === 'retry') return { action: 'retry', accepted: true, reason: 'accepted', missingChecks, missingEvidenceRefs }
  if (request.advice.action === 'escalate') return { action: 'escalate', accepted: true, reason: 'accepted', missingChecks, missingEvidenceRefs }
  return { action: 'escalate', accepted: false, reason: 'invalid-advice', missingChecks, missingEvidenceRefs }
}

/** Compare Jev/model advice with a deterministic supervised baseline. */
export function compareSystem3Advice(
  modelAction: System3AdviceAction,
  baseline: System3SupervisorResult,
): System3ShadowComparison {
  const agrees = modelAction === baseline.action || (modelAction === 'candidate_done' && baseline.action === 'done')
  let divergence: System3ShadowComparison['divergence'] = 'none'
  if (!agrees) {
    divergence = modelAction === 'candidate_done' ? 'model-premature-done' : baseline.action === 'done' ? 'model-understops' : 'model-unsafe'
  }
  return { modelAction, baselineAction: baseline.action, agrees, divergence }
}

function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`)
}

/** Validate usage without fabricating provider-reported zeros. */
export function validateSystem3CostRecord(record: System3CostRecord): System3CostRecord {
  if (record.requestId.trim().length === 0 || record.episodeId.trim().length === 0 || record.modelRevision.trim().length === 0) {
    throw new TypeError('requestId, episodeId, and modelRevision must not be empty')
  }
  for (const [name, value] of Object.entries({
    inputTokens: record.inputTokens, outputTokens: record.outputTokens, cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens, reasoningTokens: record.reasoningTokens, elapsedMs: record.elapsedMs,
  })) assertCount(value, name)
  return { ...record }
}

/** Add two validated records from the same episode and model revision. */
export function sumSystem3CostRecords(records: readonly System3CostRecord[]): System3CostRecord {
  if (records.length === 0) throw new RangeError('records must not be empty')
  const firstRecord = records[0]
  if (firstRecord === undefined) throw new RangeError('records must not be empty')
  const first = validateSystem3CostRecord(firstRecord)
  return validateSystem3CostRecord({
    ...first,
    requestId: `sum:${first.requestId}`,
    inputTokens: records.reduce((total, record) => total + validateSystem3CostRecord(record).inputTokens, 0),
    outputTokens: records.reduce((total, record) => total + validateSystem3CostRecord(record).outputTokens, 0),
    cacheReadTokens: records.reduce((total, record) => total + validateSystem3CostRecord(record).cacheReadTokens, 0),
    cacheWriteTokens: records.reduce((total, record) => total + validateSystem3CostRecord(record).cacheWriteTokens, 0),
    reasoningTokens: records.reduce((total, record) => total + validateSystem3CostRecord(record).reasoningTokens, 0),
    elapsedMs: records.reduce((total, record) => total + validateSystem3CostRecord(record).elapsedMs, 0),
  })
}
