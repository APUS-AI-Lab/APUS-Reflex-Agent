import type Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type { JevOutcome, JevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type { MemoryId } from '@deepseek-ai/dsh-continuum'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Controller mode; only active mode lets Jev replace the deterministic choice. */
export type ContinuumJevMode = 'off' | 'shadow' | 'active'

/** Candidate supplied by a bounded local retrieval step. */
export interface MemorySelectionCandidate {
  readonly id: MemoryId
  readonly label: string
  readonly excerpt: string
  readonly score: number
}

/** Input to one Reflex memory-selection decision. */
export interface MemorySelectionRequest {
  readonly query: string
  readonly candidates: readonly MemorySelectionCandidate[]
}

/** Configuration that makes the Reflex-only switch explicit. */
export interface ContinuumJevConfig {
  readonly mode: ContinuumJevMode
  readonly minConfidence: number
}

/** Configuration error when the Reflex-only active switch has no Jev provider. */
export class ContinuumJevUnavailableError extends Error {
  constructor() {
    super('active Continuum memory requires a mounted Reflex/Jev provider')
    this.name = 'ContinuumJevUnavailableError'
  }
}

/** Result of one deterministic or Jev-assisted selection. */
export interface MemorySelectionResult {
  readonly mode: ContinuumJevMode
  readonly selectedIds: readonly MemoryId[]
  readonly baselineIds: readonly MemoryId[]
  readonly outcome: 'off' | 'baseline' | 'jev' | 'unknown'
  readonly confidence?: number
  readonly failure?: string
  readonly request?: JevRequest
}

/** Model-free, replayable record of one Continuum Jev selection. */
export interface ContinuumMemoryDecisionReceipt {
  readonly version: 1
  readonly mode: ContinuumJevMode
  readonly selectedIds: readonly MemoryId[]
  readonly baselineIds: readonly MemoryId[]
  readonly outcome: MemorySelectionResult['outcome']
  readonly confidence?: number
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Replayable Continuum selection receipt; never re-calls Jev during replay. */
    'continuum/memory-decision': ContinuumMemoryDecisionReceipt
  }
}

/** Narrow Jev capability consumed by the adapter, usable with `ctx.jev`. */
export type ContinuumJev = Pick<Jev, 'resolve' | 'decide'>

/**
 * Select one bounded memory candidate with a deterministic baseline and optional Jev control.
 * Jev receives candidate labels and excerpts only; it cannot invent an ID outside the supplied set.
 * @param jev - provider-neutral Jev service, or undefined when Reflex is not mounted.
 * @param config - explicit Reflex mode and confidence threshold.
 * @param input - query and already retrieved bounded candidates.
 * @param signal - cancellation propagated to Jev.
 * @returns selected IDs plus baseline and provider outcome for audit.
 */
export async function selectContinuumMemory(
  jev: ContinuumJev | undefined,
  config: ContinuumJevConfig,
  input: MemorySelectionRequest,
  signal?: AbortSignal,
): Promise<MemorySelectionResult> {
  assertConfig(config)
  signal?.throwIfAborted()
  const baseline = baselineSelection(input.candidates)
  if (config.mode === 'active' && jev === undefined) throw new ContinuumJevUnavailableError()
  if (config.mode === 'off' || jev === undefined) {
    return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: config.mode === 'off' ? 'off' : 'baseline' }
  }
  const criteria: Record<string, string> = { none: 'Select no memory.' }
  for (const candidate of input.candidates) criteria[String(candidate.id)] = `${candidate.label}: ${candidate.excerpt}`
  const request: JevRequest = {
    state: { query: input.query, candidates: input.candidates.map(candidate => ({ id: String(candidate.id), score: candidate.score })) },
    questions: { memory: { type: 'choice', instructions: 'Select one supplied memory ID or none. Never invent an ID.', criteria } },
  }
  const spec = jev.resolve(request)
  const resolvedRequest = { ...request, model: spec.model }
  let outcome: JevOutcome
  try {
    outcome = await jev.decide(resolvedRequest, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: 'unknown', failure: 'provider-error', request: resolvedRequest }
  }
  if (outcome.kind !== 'ok') {
    return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: 'unknown', failure: outcome.failure.code, request: resolvedRequest }
  }
  const answer = outcome.response.answers.memory
  if (answer?.type !== 'choice' || answer.choice === 'none') {
    return {
      mode: config.mode, selectedIds: [], baselineIds: baseline, outcome: 'jev', request: resolvedRequest,
      ...(answer?.type === 'choice' ? { confidence: answer.confidence } : {}),
    }
  }
  const candidate = input.candidates.find(item => String(item.id) === answer.choice)
  if (candidate === undefined || answer.confidence < config.minConfidence) {
    return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: 'unknown', confidence: answer.confidence, failure: candidate === undefined ? 'invalid-choice' : 'low-confidence', request: resolvedRequest }
  }
  return { mode: config.mode, selectedIds: config.mode === 'active' ? [candidate.id] : baseline, baselineIds: baseline, outcome: 'jev', confidence: answer.confidence, request: resolvedRequest }
}

/**
 * Persist one selection receipt in the owning Session log.
 * @param session - Session that owns the decision history.
 * @param result - selection result returned by the controller.
 * @returns appended receipt event.
 */
export function recordContinuumMemoryDecision(
  session: Session,
  result: MemorySelectionResult,
): SessionEvent<'continuum/memory-decision'> {
  const receipt: ContinuumMemoryDecisionReceipt = {
    version: 1, mode: result.mode, selectedIds: [...result.selectedIds], baselineIds: [...result.baselineIds], outcome: result.outcome,
    ...(result.confidence === undefined ? {} : { confidence: result.confidence }),
    ...(result.failure === undefined ? {} : { failure: result.failure }),
  }
  return session.append('continuum/memory-decision', receipt)
}

/**
 * Find the latest decision receipt without invoking Jev.
 * @param events - Session log events in sequence order.
 * @returns latest receipt, or undefined before the first decision.
 */
export function latestContinuumMemoryDecision(
  events: readonly SessionEvent[],
): ContinuumMemoryDecisionReceipt | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'continuum/memory-decision') return event.data
  }
  return undefined
}

function baselineSelection(candidates: readonly MemorySelectionCandidate[]): readonly MemoryId[] {
  const best = candidates.filter(candidate => candidate.score > 0).toSorted((a, b) => b.score - a.score)[0]
  return best === undefined ? [] : [best.id]
}

function assertConfig(config: ContinuumJevConfig): void {
  if (!Number.isFinite(config.minConfidence) || config.minConfidence < 0 || config.minConfidence > 1) throw new TypeError('minConfidence must be in [0, 1]')
}
