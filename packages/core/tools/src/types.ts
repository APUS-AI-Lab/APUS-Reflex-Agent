/**
 * Durable Tool event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-tools/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

/** Payload recorded when one nested PTC mode Tool dispatch starts. */
export interface PtcDispatchStartEventData {
  rootCallId: ToolCallId
  parentCallId: ToolCallId
  subCallId: ToolCallId
  name: string
  arguments: unknown
  /** The run's configured overlap cap for parallel-classified sub-calls. */
  maxParallelSubCalls?: number
  /** 1-based submission order within the parent program, assigned before scheduling. */
  submissionIndex?: number
  /** Sibling sub-dispatch bodies already in flight when this start was appended (this call excluded). */
  concurrentSubCallsAtStart?: number
}

/** Payload recorded when one nested PTC mode Tool dispatch settles. */
export interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean
  content: ContentBlock[]
  /** Optional failure identity and raw user-facing detail, outside model-facing content. */
  error?: { name: string; code: string; reason?: string }
  // No `durationMs`: the span is wall-clock and differs on every run, so a
  // recorded session could never replay it. The two events' `time` fields give
  // the span for a live reader.
  /** Sibling sub-dispatch bodies still in flight when this settle was appended (this call excluded). */
  concurrentSubCallsAtSettle?: number
}

/** One tool schema the request made visible for a step, reduced to an identity and digest. */
/** One known tool name that this step's model-facing catalog omitted, with the omitting stage's reason. */
export interface ToolCatalogOmittedTool {
  name: string
  /**
   * The owning stage that omitted the name: `restricted` — a scoped registry
   * restriction removed it before projection; `ptc-collapse` — the executor
   * collapse replaced native schemas with the program-only SDK.
   */
  reason: 'restricted' | 'ptc-collapse'
}

/** Payload recorded after prompt assembly resolved one step's model-visible tool catalog. */
/**
 * Payload recorded for one aggregate pre-execute decision. The Cordis
 * waterfall does not expose listener identities, order, or per-listener votes,
 * so `attributed` is always false and the record never guesses them.
 */
/** One pipeline stage that converted a thrown value into an `isError` tool result. */
export interface ToolPipelineErrorEventData {
  callId: ToolCallId
  rootCallId: ToolCallId
  name: string
  /** The registry stage whose `try` block caught the value. */
  stage: 'pre-execute' | 'approval' | 'guard' | 'execute-wrapper' | 'projectContent' | 'post-execute' | 'materialize' | 'finalizeContent'
  /** The kind of code that threw, never an instance or listener identity. */
  thrower: 'listener' | 'approval-service' | 'guard' | 'definition' | 'registry'
  error: { name: string; code?: string; message: string }
  /** Pipeline catches always materialize the thrown value as an error result. */
  normalizedToIsError: true
}

/** The aggregate pre-execute gate decision for one call, as the registry applied it. */
export interface ToolPreExecuteDecisionEventData {
  callId: ToolCallId
  name: string
  /** The gate outcome the registry acted on. */
  decision: 'allow' | 'deny' | 'cancel' | 'ask'
  /**
   * Which owner produced the final decision. `pre-execute` is the waterfall's
   * own aggregate; `guard` is a registered guard that denied after the
   * waterfall allowed. Only the registry can tell these apart — a listener on
   * the waterfall sees just the resulting decision.
   */
  decidedBy: 'pre-execute' | 'guard'
  /** The denial or ask reason, when the deciding owner supplied one. */
  reason?: string
  /** How an `ask` resolved, when an approval service answered it. */
  askResolution?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' | 'no-service'
  /** Listener identity is unavailable on the waterfall. */
  attributed: false
}

/** One model-visible result field replaced after dispatch. */
export interface ToolResultRewriteEventData {
  callId: ToolCallId
  rootCallId: ToolCallId
  name: string
  /**
   * The stage that produced the replacement. `projectContent` and
   * `finalizeContent` are definition callbacks the tool registry invokes with
   * no public emit, so only the owning registry can record them; `post-execute`
   * is the waterfall's own decision. No digests: replaced fields embed
   * wall-clock times and per-run locator names, so a hash could never replay.
   */
  stage: 'projectContent' | 'post-execute' | 'finalizeContent'
  /** Which model-visible field changed; a value replacement re-renders content alongside it. */
  replacedField: 'content' | 'value'
  /** Listener identity is unavailable on the waterfall; definition stages are identified by `name` and `stage`. */
  attributed: false
}

/** Payload recorded when an `ask` decision degraded without an approval service or agent. */
export interface ApprovalUnavailableEventData {
  callId: ToolCallId
  toolName: string
  /** The tool's requested approval reason, when the decision supplied one. */
  askReason?: string
  /**
   * Why no approval request reached the seam. Only `no-service` is recordable:
   * an agent-less call has no session to append to.
   */
  degradeCause: 'no-service'
  /** The fail-closed outcome the pipeline used. */
  finalDecision: 'deny'
  denyReason: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the opaque sub-call id (new calls use
     * `<parent>:ptc:<n>`, numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/ptc-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     */
    'tool/ptc-dispatch-start': PtcDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/ptc-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * durable outcome in `tool/result`'s own vocabulary (`content` + `isError`
     * + optional structured `error`), so UIs and SDKs render a sub-call through
     * the exact path used for a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     */
    'tool/ptc-dispatch': PtcDispatchEventData
    /**
     * One thrown pipeline value after the registry converted it into a tool
     * `isError` result. Records the exact stage and the kind of owner that
     * threw; listener and definition instance identities are not exposed on
     * these seams. Log-only: `deriveMessages()` ignores it.
     */
    'tool/pipeline-error': ToolPipelineErrorEventData
    /**
     * One replacement of a model-visible result field after dispatch. Records
     * which stage replaced it and which field changed. The `projectContent` and
     * `finalizeContent` stages are definition callbacks invoked directly by the
     * registry with no emit, so the registry is the only writer that can state
     * them; `post-execute` is the waterfall decision. Log-only:
     * `deriveMessages()` ignores it; the durable `tool/result` carries the
     * replaced value itself.
     */
    'tool/result-rewrite': ToolResultRewriteEventData
    /**
     * The aggregate pre-execute gate decision for one call, plus which owner
     * produced it. `decidedBy: 'guard'` is state only the registry holds: the
     * waterfall returns the decision, but a guard denying after an allow is
     * invisible to any listener. Log-only: `deriveMessages()` ignores it.
     */
    'tool/pre-execute-decision': ToolPreExecuteDecisionEventData
    /**
     * An `ask` decision that degraded without reaching the approval seam
     * because no ApprovalService is composed. When the service exists, its own
     * `approval/decided` records every outcome, including `unavailable`; an
     * agent-less call has no session and therefore no durable record at all.
     * Log-only: `deriveMessages()` ignores it.
     */
    'approval/unavailable': ApprovalUnavailableEventData
  }
}
