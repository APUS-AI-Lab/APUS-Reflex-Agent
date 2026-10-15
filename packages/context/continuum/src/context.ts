import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryId, MemoryRecordStore } from './records.ts'
import { budgetMemoryWorkingSet, renderMemoryWorkingSet, retrieveMemoryWorkingSet, type MemoryRetrievalConfig } from './retrieval.ts'
import type { ContinuumMemoryController, ContinuumMemoryPrincipal } from './policy.ts'

/** Model-visible source for one bounded Continuum memory snapshot. */
export interface ContinuumMemorySource {
  readonly kind: 'continuum-memory'
  readonly form: 'recall'
  readonly version: 1
  readonly recordIds: readonly string[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Source-backed, bounded Continuum memory context.
     * @persistenceAttribution
     */
    'continuum-memory': ContinuumMemorySource
  }
}

/** Configuration for the deterministic memory context consumer. */
export interface ContinuumMemoryContextConfig extends MemoryRetrievalConfig {
  /**
   * Candidates offered to a mounted selector, which may route by tag before judging; the final recall still keeps
   * `maxTotalBytes`. Omitted means `maxCandidates`.
   */
  readonly maxPool?: number | undefined
}

/** Candidate passed to the optional mounted Reflex selector. */
export interface ContinuumMemorySelectionCandidate {
  readonly id: string
  readonly label: string
  readonly excerpt: string
  readonly score: number
  /** L1 index tags of the record; empty for untagged records. */
  readonly tags: readonly string[]
}

/** Minimal replayable outcome returned by a mounted Reflex selector. */
export interface ContinuumMemorySelection {
  readonly mode: 'off' | 'shadow' | 'active'
  readonly selectedIds: readonly string[]
  readonly baselineIds: readonly string[]
  readonly outcome: 'off' | 'baseline' | 'jev' | 'unknown'
  readonly confidence?: number
  readonly failure?: string
}

/** Optional Jev-backed selector installed by the profile's Reflex plugin. */
export interface ContinuumMemorySelector {
  select(
    agent: Agent,
    input: { readonly query: string; readonly candidates: readonly ContinuumMemorySelectionCandidate[]; readonly isCurrent: () => boolean },
    signal: AbortSignal,
  ): Promise<ContinuumMemorySelection>
}

/** One compacted human message offered for admission as a memory record. */
export interface ContinuumAdmissionCandidate {
  readonly id: string
  /** Complete original text of the message. */
  readonly content: string
}

/** One kept candidate and the tags Reflex assigned it. */
export interface ContinuumAdmittedMemory {
  readonly id: string
  /** Index tags; empty when the candidate was kept without a Reflex judgement. */
  readonly tags: readonly string[]
}

/** Replayable outcome returned by a mounted Reflex admitter. */
export interface ContinuumMemoryAdmission {
  /** Candidates to index; IDs absent from the request are ignored. */
  readonly admitted: readonly ContinuumAdmittedMemory[]
}

/** Optional Jev-backed admitter that selects and tags the compacted messages worth indexing. */
export interface ContinuumMemoryAdmitter {
  admit(
    agent: Agent,
    input: { readonly candidates: readonly ContinuumAdmissionCandidate[]; readonly isCurrent: () => boolean },
    signal: AbortSignal,
  ): Promise<ContinuumMemoryAdmission>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional Reflex selector; absent keeps deterministic original behavior. */
    continuumMemorySelector?: ContinuumMemorySelector
    /** Optional Reflex admitter for compaction admission; absent admits every compacted human message. */
    continuumMemoryAdmitter?: ContinuumMemoryAdmitter
  }
}

/** Store lookup owned by the product profile; no global memory store is implied. */
export type ContinuumMemoryStoreOf = (agent: Agent) => MemoryRecordStore | undefined

/** Resolves the exact scopes visible to one agent request. */
export type ContinuumMemoryPrincipalOf = (agent: Agent) => ContinuumMemoryPrincipal

/**
 * Install same-step bounded memory context on the existing pre-step waterfall.
 * Disposing the listener or its context prevents pending reads from injecting recall.
 * @param ctx - Cordis context that owns AgentLoop events.
 * @param storeOf - per-agent store resolver; returning undefined disables this agent.
 * @param config - retrieval and byte limits.
 * @returns idempotent synchronous disposer for the listener.
 */
export function installContinuumMemoryContext(
  ctx: Context,
  storeOf: ContinuumMemoryStoreOf,
  config: ContinuumMemoryContextConfig,
): () => void {
  let active = true
  const isActive = (): boolean => active
  const stop = ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (!isActive() || decision.kind === 'reject') return decision
    const store = storeOf(agent)
    const query = latestUserText(messages)
    if (store === undefined || query === undefined) return decision
    signal.throwIfAborted()
    const workingSet = retrieveMemoryWorkingSet(store, config, query)
    if (workingSet.candidates.length === 0) return decision
    return { ...decision, messages: [...decision.messages, recallMessage(workingSet)] }
  })
  const dispose = ctx.effect(() => () => {
    active = false
    stop()
  })
  return () => { void dispose() }
}

/**
 * Install the lifecycle-aware consumer. The controller owns switch state,
 * authorization, and invalidation; an absent controller leaves messages intact.
 * Disposing the listener or its context prevents pending reads from injecting recall.
 * @param ctx - Cordis context that owns AgentLoop events.
 * @param controllerOf - per-agent Continuum controller resolver.
 * @param principalOf - exact scope resolver for the current agent.
 * @param config - retrieval and byte limits.
 * @param selectorOf - Reads the optional Jev selector at request time. Without one, only candidates that share a
 * query term are injected.
 * @param pendingOf - Admissions the read waits for, so records from a just-completed compaction are visible.
 * @param tagsOf - L1 index tags of one record, passed to the selector.
 * @returns idempotent synchronous disposer for the listener.
 */
export function installContinuumMemoryControllerContext(
  ctx: Context,
  controllerOf: (agent: Agent) => ContinuumMemoryController | undefined,
  principalOf: ContinuumMemoryPrincipalOf,
  config: ContinuumMemoryContextConfig,
  selectorOf: () => ContinuumMemorySelector | undefined = () => undefined,
  pendingOf: (agent: Agent) => Promise<void> | undefined = () => undefined,
  tagsOf: (agent: Agent, id: MemoryId) => readonly string[] = () => [],
): () => void {
  let active = true
  const isActive = (): boolean => active
  const stop = ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (!isActive() || decision.kind === 'reject') return decision
    const controller = controllerOf(agent)
    if (controller === undefined) return decision
    const query = latestUserText(messages)
    if (query === undefined) return decision
    signal.throwIfAborted()
    const pending = pendingOf(agent)
    if (pending !== undefined) await abortable(pending, signal)
    if (!isActive()) return decision
    const ticket = controller.beginRead(principalOf(agent))
    if (ticket === undefined) return decision
    const selector = selectorOf()
    // A selector sees the larger pool and may route by tag; the byte budget applies to the recall it selects.
    const workingSet = controller.read(ticket, selector === undefined ? config : {
      ...config, maxCandidates: config.maxPool ?? config.maxCandidates, maxTotalBytes: Number.MAX_SAFE_INTEGER,
    }, query)
    if (workingSet === undefined || !controller.isCurrent(ticket) || workingSet.candidates.length === 0) return decision
    if (selector === undefined) {
      const matched = renderMemoryWorkingSet(workingSet.query, workingSet.candidates.filter(candidate => candidate.score > 0))
      return matched.candidates.length === 0 ? decision : { ...decision, messages: [...decision.messages, recallMessage(matched)] }
    }
    const selection = await selector.select(agent, {
      query,
      isCurrent: () => isActive() && controller.isCurrent(ticket),
      candidates: workingSet.candidates.map(candidate => ({
        id: String(candidate.id),
        label: candidate.record.kind,
        excerpt: candidate.excerpt,
        score: candidate.score,
        tags: tagsOf(agent, candidate.id),
      })),
    }, signal)
    signal.throwIfAborted()
    if (!isActive() || !controller.isCurrent(ticket)) return decision
    const byId = new Map(workingSet.candidates.map(candidate => [String(candidate.id), candidate]))
    const candidates = [...new Set(selection.selectedIds)].flatMap((id) => {
      const candidate = byId.get(id)
      return candidate === undefined ? [] : [candidate]
    })
    const filtered = budgetMemoryWorkingSet(workingSet.query, candidates, config.maxTotalBytes)
    if (filtered.candidates.length === 0) return decision
    return { ...decision, messages: [...decision.messages, recallMessage(filtered)] }
  })
  const dispose = ctx.effect(() => () => {
    active = false
    stop()
  })
  return () => { void dispose() }
}

/** Wait for a promise that never rejects, or reject with the turn's cancellation. */
async function abortable(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  const aborted = Promise.withResolvers<never>()
  const reject = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', reject, { once: true })
  try {
    await Promise.race([promise, aborted.promise])
  } finally {
    signal.removeEventListener('abort', reject)
  }
}

function recallMessage(workingSet: ReturnType<typeof retrieveMemoryWorkingSet>): UserMessage {
  return createUserMessage({
    source: { kind: 'continuum-memory', form: 'recall', version: 1, recordIds: workingSet.candidates.map(candidate => String(candidate.id)) },
    content: [{ type: 'text', text: workingSet.text }],
  })
}

function latestUserText(messages: readonly UserMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.source.kind !== 'user') continue
    const text = message.content.filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text').map(block => block.text).join('\n').trim()
    if (text.length > 0) return text
  }
  return undefined
}
