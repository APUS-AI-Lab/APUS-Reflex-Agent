import type Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type { JevOutcome, JevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { MemoryId, type ContinuumMemorySelection, type ContinuumMemorySelector } from '@deepseek-ai/dsh-continuum'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

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
  /** Maximum provider wait in milliseconds; omitted means no adapter timeout. */
  readonly timeoutMs?: number
  /** Maximum number of sequential candidate selections; defaults to one. */
  readonly maxSelections?: number
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

/** Profile configuration for the optional automatic Continuum selector. */
export interface ContinuumJevProfileConfig {
  readonly mode: ContinuumJevMode
  readonly minConfidence: number
  /** Maximum provider wait in milliseconds; omitted means no adapter timeout. */
  readonly timeoutMs?: number
  /** Maximum number of sequential candidate selections; defaults to one. */
  readonly maxSelections?: number
}

/** Schemastery configuration for the profile selector service. */
export const ContinuumJevProfileConfig: z<ContinuumJevProfileConfig> = z.object({
  mode: z.union([z.const('off'), z.const('shadow'), z.const('active')]).default('off'),
  minConfidence: z.number().min(0).max(1).default(0.8),
  timeoutMs: z.number().step(1).min(1).default(2_000),
  maxSelections: z.number().step(1).min(1).default(1),
})

/** Cordis service that mounts the Jev selector consumed by ContinuumMemory. */
class ContinuumJevPlugin extends Service {
  static Config = ContinuumJevProfileConfig

  constructor(ctx: Context, config: ContinuumJevProfileConfig) {
    super(ctx, 'continuumJev')
    const selector: ContinuumMemorySelector = {
      select: async (agent, input, signal): Promise<ContinuumMemorySelection> => {
        const result = await selectContinuumMemory(ctx.get('jev'), config, {
          query: input.query,
          candidates: input.candidates.map(candidate => ({
            id: MemoryId(candidate.id),
            label: candidate.label,
            excerpt: candidate.excerpt,
            score: candidate.score,
          })),
        }, signal)
        recordContinuumMemoryDecision(agent.session, result)
        return result
      },
    }
    ctx.provide('continuumMemorySelector', selector)
  }
}

export default ContinuumJevPlugin

/**
 * Select bounded memory candidates with a deterministic baseline and optional sequential Jev control.
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
  const maxSelections = config.maxSelections ?? 1
  const baseline = baselineSelection(input.candidates, maxSelections)
  if (config.mode === 'active' && jev === undefined) throw new ContinuumJevUnavailableError()
  if (config.mode === 'off' || jev === undefined) {
    return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: config.mode === 'off' ? 'off' : 'baseline' }
  }
  const available = [...input.candidates]
  const selected: MemoryId[] = []
  let lastRequest: JevRequest | undefined
  let lastConfidence: number | undefined

  for (let index = 0; index < maxSelections && available.length > 0; index += 1) {
    const criteria: Record<string, string> = { none: 'Select no memory.' }
    for (const candidate of available) criteria[String(candidate.id)] = `${candidate.label}: ${candidate.excerpt}`
    const request: JevRequest = {
      state: {
        query: input.query,
        candidates: available.map(candidate => ({ id: String(candidate.id), score: candidate.score })),
        selected: selected.map(String),
      },
      questions: { memory: { type: 'choice', instructions: 'Select one supplied memory ID or none. Never invent an ID.', criteria } },
    }
    const spec = jev.resolve(request)
    const resolvedRequest = { ...request, model: spec.model }
    lastRequest = resolvedRequest
    let outcome: JevOutcome
    try {
      outcome = await decideWithTimeout(jev, resolvedRequest, signal, config.timeoutMs)
    } catch (error) {
      if (signal?.aborted) throw error
      return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: 'unknown', failure: error instanceof ContinuumJevTimeoutError ? 'timeout' : 'provider-error', request: resolvedRequest }
    }
    if (outcome.kind !== 'ok') {
      return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: 'unknown', failure: outcome.failure.code, request: resolvedRequest }
    }
    const answer = outcome.response.answers.memory
    if (answer?.type !== 'choice' || answer.choice === 'none') break
    const candidate = available.find(item => String(item.id) === answer.choice)
    lastConfidence = answer.confidence
    if (candidate === undefined || answer.confidence < config.minConfidence) {
      return { mode: config.mode, selectedIds: baseline, baselineIds: baseline, outcome: 'unknown', confidence: answer.confidence, failure: candidate === undefined ? 'invalid-choice' : 'low-confidence', request: resolvedRequest }
    }
    selected.push(candidate.id)
    available.splice(available.indexOf(candidate), 1)
  }
  return {
    mode: config.mode,
    selectedIds: config.mode === 'active' ? selected : baseline,
    baselineIds: baseline,
    outcome: 'jev',
    ...(lastConfidence === undefined ? {} : { confidence: lastConfidence }),
    ...(lastRequest === undefined ? {} : { request: lastRequest }),
  }
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

function baselineSelection(
  candidates: readonly MemorySelectionCandidate[],
  maxSelections: number,
): readonly MemoryId[] {
  return candidates
    .filter(candidate => candidate.score > 0)
    .toSorted((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
    .slice(0, maxSelections)
    .map(candidate => candidate.id)
}

export class ContinuumJevTimeoutError extends Error {
  constructor() {
    super('Continuum memory Jev decision timed out')
    this.name = 'ContinuumJevTimeoutError'
  }
}

async function decideWithTimeout(
  jev: ContinuumJev,
  request: JevRequest,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): Promise<JevOutcome> {
  if (timeoutMs === undefined) return await jev.decide(request, signal)
  const controller = new AbortController()
  const forwardAbort = () => { controller.abort(signal?.reason) }
  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(new ContinuumJevTimeoutError())
        reject(new ContinuumJevTimeoutError())
      }, timeoutMs)
    })
    return await Promise.race([jev.decide(request, controller.signal), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

function assertConfig(config: ContinuumJevConfig): void {
  if (!Number.isFinite(config.minConfidence) || config.minConfidence < 0 || config.minConfidence > 1) throw new TypeError('minConfidence must be in [0, 1]')
  if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) throw new TypeError('timeoutMs must be a positive integer')
  if (config.timeoutMs !== undefined && !Number.isInteger(config.timeoutMs)) throw new TypeError('timeoutMs must be a positive integer')
  if (config.maxSelections !== undefined && (!Number.isSafeInteger(config.maxSelections) || config.maxSelections < 1)) throw new TypeError('maxSelections must be a positive safe integer')
}
