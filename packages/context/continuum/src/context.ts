import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryRecordStore } from './records.ts'
import { retrieveMemoryWorkingSet, type MemoryRetrievalConfig } from './retrieval.ts'

/** Model-visible source for one bounded Continuum memory snapshot. */
export interface ContinuumMemorySource {
  readonly kind: 'continuum-memory'
  readonly form: 'recall'
  readonly version: 1
  readonly recordIds: readonly string[]
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    /** Source-backed, bounded Continuum memory context. */
    'continuum-memory': ContinuumMemorySource
  }
}

/** Configuration for the deterministic memory context consumer. */
export interface ContinuumMemoryContextConfig extends MemoryRetrievalConfig {}

/** Store lookup owned by the product profile; no global memory store is implied. */
export type ContinuumMemoryStoreOf = (agent: Agent) => MemoryRecordStore | undefined

/**
 * Install same-step bounded memory context on the existing pre-step waterfall.
 * @param ctx - Cordis context that owns AgentLoop events.
 * @param storeOf - per-agent store resolver; returning undefined disables this agent.
 * @param config - retrieval and byte limits.
 * @returns disposer for the listener.
 */
export function installContinuumMemoryContext(
  ctx: Context,
  storeOf: ContinuumMemoryStoreOf,
  config: ContinuumMemoryContextConfig,
): () => void {
  return ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
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
