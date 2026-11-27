/**
 * Durable loop-owned observations declared beside the core turn events.
 *
 * @module @deepseek-ai/dsh-agent-loop/types
 */

import type { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'

/** One admitted tool and the digest of the parameter schema the model saw. */
export interface ToolCatalogEntry {
  name: string
  /** SHA-256 of the exact parameters JSON schema sent to the model. */
  schemaDigest: string
}

/** One known tool name the assembly withheld, and the stage that withheld it. */
export interface ToolCatalogSkip {
  name: string
  reason: 'restricted' | 'ptc-collapse' | unknown
}

/** Payload of one `tool/catalog-resolved` event. */
export interface ToolCatalogResolvedEventData {
  turn: number
  step: number
  /** Admitted tools in the order their schemas were sent. */
  admitted: ToolCatalogEntry[]
  /** Known tools this assembly withheld, with the excluding stage. */
  skipped: ToolCatalogSkip[]
}

/** One call's scheduling classification recorded by a `tool/execution-plan` event. */
export interface ToolExecutionPlanCall {
  callId: ToolCallId
  name: string
  /** The live classifier result: only an exact `true` is parallel. */
  exactParallel: boolean
  /** The mode this call was actually scheduled under. */
  reclassifiedTo: 'parallel' | 'exclusive'
}

/** Payload of one `tool/execution-plan` event. */
export interface ToolExecutionPlanEventData {
  turn: number
  step: number
  scheduleMode: 'parallel' | 'exclusive'
  /** 1-based ordinal of this parallel group within the step; absent for exclusive barriers. */
  parallelGroup?: number
  /** True when the group is one exclusive call holding the ordering barrier. */
  exclusiveBarrier?: boolean
  /**
   * Calls the group scheduled, in model order. A parallel group also lists the
   * first call whose live re-check classified it exclusive before start; that
   * call was deferred to its own barrier group and is logged again there.
   */
  calls: ToolExecutionPlanCall[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The model-facing tool catalog one step actually assembled: the admitted
     * tool names in schema order, each tool's parameter-schema digest, and the
     * names this assembly omitted with their excluding stage. Appended after
     * `systemPrompt.assemble` and before the step's model request, so it is the
     * only record of what the model could call on that rotation. Schemas are
     * recorded as digests, not definitions: the definitions are large and
     * re-fetchable from the registry, while a reader only needs to prove which
     * version the model saw. Log-only: `deriveMessages()` ignores it.
     */
    'tool/catalog-resolved': ToolCatalogResolvedEventData
    /**
     * The scheduling decision for one tool-call group of a step: the mode the
     * group ran under, whether it held the exclusive barrier, and the live
     * classification each call was scheduled with. Concurrency classification
     * is a runtime decision (only an exact `true` from the tool's classifier
     * is parallel; unknown, hidden, undeclared, invalid, or throwing
     * classifiers are exclusive), so it cannot be reconstructed from static
     * tool definitions. Appended when the group quiesces, before the scheduler
     * returns to the next group. A parallel group that stopped before an
     * exclusive call also lists that deferred call, which was re-read after
     * the group's ordered commits. Calls skipped by an abort never started and
     * are absent. Log-only: `deriveMessages()` ignores it.
     */
    'tool/execution-plan': ToolExecutionPlanEventData
    /**
     * The aggregate result of one `agent/turn-stopping` serial dispatch. Serial
     * listeners expose no identity or per-listener vote, so this records only
     * the turn's stopping outcome and the pending next-step snapshot before and
     * after the dispatch. `continue` means a listener supplied work that keeps
     * the turn open; `stop` means the turn closes at this boundary. Only the
     * loop can state the outcome: a listener sees the inbox before later
     * listeners have had their say. Log-only: `deriveMessages()` ignores it.
     */
    'turn/stopping': {
      turn: number
      outcome: 'stop' | 'continue'
      nextStepBefore: MessageId[]
      nextStepAfter: MessageId[]
    }
  }
}
