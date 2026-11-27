/**
 * Named wire types for the APUS Reflex Harness SDK runtime protocol: the four
 * request/result pairs and the four server-to-client notification payloads
 * exchanged over the newline-delimited JSON-RPC stdio transport. The server
 * plugin (`@deepseek-ai/dsh-sdk-jsonrpc-server`) and SDK clients share these shapes;
 * `serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/types
 */

import type { ContentBlock, ReasoningEffortId, RequestMessage, ToolHistory, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { EpochHeader, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'

/**
 * Wire-stable capability token a runtime advertises when it can answer the
 * read-only request-view methods. Both SDK clients and the runtime compare this
 * exact value, so an older runtime that omits it is refused instead of being
 * asked for a view it cannot produce.
 */
export const SDK_REQUEST_VIEW_CAPABILITY = 'request-view/dispatch-v1' as const

/** Parameters for the process-wide SDK handshake. */
export interface InitializeParams {
  /** Working directory recorded on every SDK-created session's header. */
  cwd: string
  /** Provider route every SDK-created agent runs on. */
  provider: string
  /** Model name every SDK-created agent runs on (the server may mount a fallback adapter; see `HarnessSdkJsonRpcServer.initialize`). */
  model: string
  /** Optional adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Optional positive output-token cap inherited by SDK-created agents and their in-process descendants. */
  maxTokens?: number
}

/** Wire-stable server identity returned by initialization. */
export interface InitializeResult {
  /** Wire-stable server identity (`deepseek-harness-sdk-runtime`) and version. */
  serverInfo: { name: string; version: string }
  /**
   * Capability tokens this runtime serves. Present only when the runtime offers
   * optional read-only surfaces; an older runtime omits it, so clients must
   * treat absence as unsupported. See {@link SDK_REQUEST_VIEW_CAPABILITY}.
   */
  capabilities?: string[]
}

/** One recorded model dispatch of a session, as listed without reading its request. */
export interface SdkDispatchRecord {
  /** Seq of the `llm/dispatch` session event. */
  dispatchSeq: number
  /** Last committed session event seq the request was derived from. */
  prefixEnd: number
  /** Turn the dispatch belonged to. */
  turn: number
  /** Step the dispatch belonged to. */
  step: number
  /** Seq of the assistant settlement that closed the dispatch, when recorded. */
  settlementSeq?: number
}

/** Parameters for `session/dispatches`: list one session's recorded dispatches. */
export interface SessionDispatchesParams {
  /** Session whose dispatches to list. */
  sessionId: string
}

/** Result of `session/dispatches`. */
export interface SessionDispatchesResult {
  /** The queried session. */
  sessionId: string
  /** Recorded dispatches in commit order. */
  dispatches: SdkDispatchRecord[]
}

/** Parameters for `session/request-view`: rebuild one dispatch's model input. */
export interface SessionRequestViewParams {
  /** Session that dispatched the request. */
  sessionId: string
  /** Seq of the `llm/dispatch` record to rebuild. */
  dispatchSeq: number
}

/**
 * One dispatch's reconstructed model input, rebuilt through the native Session
 * primitives from its exact committed prefix. This is the loop-level request,
 * not the provider's mapped wire body.
 */
export interface SdkRequestView {
  /** Session that dispatched the request. */
  sessionId: string
  /** Seq of the `llm/dispatch` record this view rebuilt. */
  dispatchSeq: number
  /** Last committed session event seq the request was derived from. */
  prefixEnd: number
  /** Turn the dispatch belonged to. */
  turn: number
  /** Step the dispatch belonged to. */
  step: number
  /** Request header in force at dispatch: call config, adapter defaults, and tools. */
  header: EpochHeader
  /** Derived message history at dispatch. */
  messages: RequestMessage[]
  /** Assembled tool schemas at dispatch; absent for a tool-less request. */
  tools?: ToolSchema[]
  /** Session-folded tool history at dispatch. */
  toolHistory: ToolHistory
  /** Seq of the assistant settlement that closed the dispatch, when recorded. */
  settlementSeq?: number
  /** Event types of the message projections the rebuild supplied. */
  projectionTypes: string[]
}

/** Result of `session/request-view`. */
export type SessionRequestViewResult = SdkRequestView

/** A typed refusal the runtime returns for an unsupported request view. */
export interface SdkRequestViewRefusal {
  /** Stable machine classification: unknown session, unknown dispatch, missing prefix, or unsupported projection. */
  code: 'SESSION_NOT_FOUND' | 'DISPATCH_NOT_FOUND' | 'PREFIX_UNAVAILABLE' | 'UNSUPPORTED_PROJECTION'
  /** Human-readable reason, including the unavailable projection type when known. */
  message: string
}

/** One user turn on one SDK session. */
export interface SessionPromptParams {
  /** The SDK-side session id; an unknown id lazily creates the agent+session pair. */
  sessionId: string
  /** The prompt content blocks, sent verbatim as the user message. */
  contentBlocks: SdkPromptContentBlock[]
  /** Session working directory; fixed on creation and independent of the runtime cwd. */
  cwd?: string
  /** Declared Agent composition to bind before publishing the session; fixed on creation. */
  agentPreset?: string
}

/** Inline raster input admitted into the runtime's durable attachment store. */
export interface SdkEncodedImageBlock {
  type: 'image'
  /** Canonical base64-encoded raster bytes. */
  data: string
  /** Declared raster MIME type, verified during admission. */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}

/** SDK prompt input: ordinary durable blocks plus inline images awaiting admission. */
export type SdkPromptContentBlock = ContentBlock | SdkEncodedImageBlock

/** Enqueue receipt for one prompt; it does not confirm a storage flush. */
export interface SessionPromptResult {
  /** Identity of the queued user message. */
  messageId: string
}

/** One cancellation target. */
export interface SessionCancelParams {
  /** Session whose active work must stop; a session that has not started is refused for later prompts. */
  sessionId: string
}

/** Confirmation that the runtime holds no active work for the session. */
export interface SessionCancelResult {
  /** The session that reached quiescence. */
  sessionId: string
  /** Always `true`; a failure is reported as a JSON-RPC error instead. */
  cancelled: true
}

/** Deployment-mapped SDK outcome: `ok` for an accepted result, `error` otherwise. */
export type SdkRunStatus = 'ok' | 'error'

/** `session.event` payload: one session-log event, streamed as it is recorded. */
export interface SessionEventNotification {
  /** Session the event belongs to (every session in the runtime, not only SDK-created ones). */
  sessionId: string
  /** The full session-log event envelope. */
  event: SessionEvent
}

/**
 * Outcome of the runtime's evidence barrier for one `idle` transition.
 * `settled`: dispatch settlement records, queued memory admissions, and the
 * Session log flush all completed before the notification. `failed`: one of
 * them rejected or the barrier timed out, so the transition reports only that
 * the loop stopped. The dispatch and memory facts may then be incomplete.
 */
export type SdkSessionSettlement = 'settled' | 'failed'

/** Whole-agent lifecycle state for one session. */
export interface SessionStatusNotification {
  /** Session whose live agent changed status. */
  sessionId: string
  /** The whole-agent state after the transition. */
  status: 'idle' | 'running'
  /**
   * Outcome of the evidence barrier this runtime applied to an `idle`
   * transition. `settled` means the dispatch settlement records, the queued
   * memory admissions and the Session log flush all completed before this
   * notification was sent; `failed` means one of them rejected or the barrier
   * timed out, so `idle` describes the stopped loop only. Absent when the
   * runtime applies no barrier (the composition has no fact source still
   * draining), and never present on `running`.
   */
  settlement?: SdkSessionSettlement
}

/** `subagent.started` payload: an in-runtime child session was created. */
export interface SubagentStartedNotification {
  /** The delegating session. */
  parentSessionId: string
  /** The new child session. */
  childSessionId: string
}

/** `subagent.finished` payload: an in-process subagent run ended (remote runs are not reported). */
export interface SubagentFinishedNotification {
  /** Subagent provider name that ran the child. */
  provider: string
  /** The child agent's id (equals {@link childSessionId} for local runs). */
  agentId: string
  /** The delegating session. */
  parentSessionId: string
  /** The child session. */
  childSessionId: string
  /** Deployment-mapped run outcome. */
  status: SdkRunStatus
  /** The provider-reported stop reason. */
  stopReason: SubagentStopReason
  /** The child's selected assistant output; absent when the child produced none. */
  lastAssistantMessage?: ContentBlock[]
}

/** Server-to-client notifications by JSON-RPC method name. */
export interface HarnessSdkNotificationMap {
  'session.event': SessionEventNotification
  'session.status': SessionStatusNotification
  'subagent.started': SubagentStartedNotification
  'subagent.finished': SubagentFinishedNotification
}

/** Client-to-server request methods with their param and result shapes. */
export interface HarnessSdkRequestMap {
  'initialize': { params: InitializeParams; result: InitializeResult }
  'session/prompt': { params: SessionPromptParams; result: SessionPromptResult }
  'session/cancel': { params: SessionCancelParams; result: SessionCancelResult }
  /** List one session's recorded model dispatches. */
  'session/dispatches': { params: SessionDispatchesParams; result: SessionDispatchesResult }
  /** Rebuild one recorded dispatch's model input from its exact log prefix. */
  'session/request-view': { params: SessionRequestViewParams; result: SessionRequestViewResult }
  'shutdown': { params: undefined; result: Record<string, never> }
}
