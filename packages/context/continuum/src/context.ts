import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryRecordStore } from './records.ts'
import { retrieveMemoryWorkingSet, type MemoryRetrievalConfig } from './retrieval.ts'
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
export interface ContinuumMemoryContextConfig extends MemoryRetrievalConfig {}

/** Candidate passed to the optional mounted Reflex selector. */
export interface ContinuumMemorySelectionCandidate {
  readonly id: string
  readonly label: string
  readonly excerpt: string
  readonly score: number
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
    input: { readonly query: string; readonly candidates: readonly ContinuumMemorySelectionCandidate[] },
    signal: AbortSignal,
  ): Promise<ContinuumMemorySelection>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional Reflex selector; absent keeps deterministic original behavior. */
    continuumMemorySelector?: ContinuumMemorySelector
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
    const message = createUserMessage({
      source: { kind: 'continuum-memory', form: 'recall', version: 1, recordIds: workingSet.candidates.map(candidate => String(candidate.id)) },
      content: [{ type: 'text', text: `## Continuum memory\n${workingSet.text}` }],
    })
    return { ...decision, messages: [...decision.messages, message] }
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
 * @param selectorOf - Reads the optional Jev selector at request time.
 * @returns idempotent synchronous disposer for the listener.
 */
export function installContinuumMemoryControllerContext(
  ctx: Context,
  controllerOf: (agent: Agent) => ContinuumMemoryController | undefined,
  principalOf: ContinuumMemoryPrincipalOf,
  config: ContinuumMemoryContextConfig,
  selectorOf: () => ContinuumMemorySelector | undefined = () => undefined,
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
    const ticket = controller.beginRead(principalOf(agent))
    if (ticket === undefined) return decision
    const workingSet = controller.read(ticket, config, query)
    if (workingSet === undefined || !controller.isCurrent(ticket) || workingSet.candidates.length === 0) return decision
    const selector = selectorOf()
    if (selector === undefined) return { ...decision, messages: [...decision.messages, recallMessage(workingSet)] }
    const selection = await selector.select(agent, {
      query,
      candidates: workingSet.candidates.map(candidate => ({
        id: String(candidate.id),
        label: candidate.record.kind,
        excerpt: candidate.excerpt,
        score: candidate.score,
      })),
    }, signal)
    if (!isActive() || !controller.isCurrent(ticket)) return decision
    const selected = new Set(selection.selectedIds)
    const candidates = workingSet.candidates.filter(candidate => selected.has(String(candidate.id)))
    const text = candidates.map(candidate => `[memory:${candidate.id}] ${candidate.excerpt}`).join('\n')
    const filtered = {
      ...workingSet,
      candidates,
      text,
      bytes: new TextEncoder().encode(text).byteLength,
    }
    if (filtered.candidates.length === 0) return decision
    return { ...decision, messages: [...decision.messages, recallMessage(filtered)] }
  })
  const dispose = ctx.effect(() => () => {
    active = false
    stop()
  })
  return () => { void dispose() }
}

function recallMessage(workingSet: ReturnType<typeof retrieveMemoryWorkingSet>): UserMessage {
  return createUserMessage({
    source: { kind: 'continuum-memory', form: 'recall', version: 1, recordIds: workingSet.candidates.map(candidate => String(candidate.id)) },
    content: [{ type: 'text', text: `## Continuum memory\n${workingSet.text}` }],
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
