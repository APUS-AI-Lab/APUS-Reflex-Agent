/**
 * JSON-RPC methods and notifications for out-of-process harness SDKs.
 * The surrounding context owns plugins, persistence, and configured adapters.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/server
 */

import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute, resolve } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentHandle, AgentSetup } from '@deepseek-ai/dsh-agent'
import { admitEncodedImages, type EncodedImageAttachment, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, ReasoningEffortId, type ContentBlock, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf, type Scoped } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import type {
  InitializeParams,
  InitializeResult,
  JsonRpcTransportPeer,
  SessionCancelParams,
  SessionCancelResult,
  SessionDispatchesParams,
  SessionDispatchesResult,
  SessionEventNotification,
  SessionPromptParams,
  SessionPromptResult,
  SessionRequestViewParams,
  SessionRequestViewResult,
  SdkEncodedImageBlock,
  SdkRequestViewRefusal,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from '@deepseek-ai/dsh-sdk-protocol'
import { SDK_REQUEST_VIEW_CAPABILITY } from '@deepseek-ai/dsh-sdk-protocol'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionMessageProjection } from '@deepseek-ai/dsh-session'
import { buildRequestView, installRequestDispatchRecorder, RequestViewError, RequestViewUnsupportedError } from './request-view.ts'

interface SessionRecord {
  handle: AgentHandle
  cwd: string
  agentPreset: string | undefined
}

/** Validate the wire params of one `session/cancel` request. */
function cancelParams(params: Record<string, unknown> | undefined): SessionCancelParams {
  const sessionId = params?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new TypeError('session/cancel requires a non-empty sessionId')
  }
  return { sessionId }
}

function encodedImage(block: SessionPromptParams['contentBlocks'][number]): block is SdkEncodedImageBlock {
  return block.type === 'image' && 'data' in block
}

async function durablePromptContent(ctx: Context, blocks: SessionPromptParams['contentBlocks']): Promise<ContentBlock[]> {
  const images = blocks.filter(encodedImage)
  if (images.length === 0) return blocks as ContentBlock[]
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('SDK image prompt requires an attachment store')
  const refs = await admitEncodedImages(attachments, images.map((image): EncodedImageAttachment => ({
    data: image.data,
    mediaType: image.mimeType,
  })))
  let next = 0
  return blocks.map(block => encodedImage(block)
    ? { type: 'image', attachment: refs[next++] as ImageAttachmentRef }
    : block)
}

/** Recover the delegating parent from the service-owned scoped carrier. */
function subagentParentOf(carrier: Scoped<SubagentRuntime>): Agent {
  return carrierKeyOf(carrier) as Agent
}

/** Deployment-specific status mapping for SDK turn and subagent outcomes. */
export interface HarnessSdkJsonRpcServerOptions {
  /** Report max-token termination as an accepted result instead of an infrastructure error. */
  maxTokensAsSuccess?: boolean
  /**
   * Record one minimal `llm/dispatch` fact per loop-built model call and expose
   * the read-only request-view methods. Default `false`: the recorder is off,
   * so dispatch records are not written and the capability is not advertised.
   */
  recordLlmDispatch?: boolean
  /**
   * Message projections used when rebuilding request views. Defaults to the
   * store's registered projections; a log needing a projection outside this set
   * is refused instead of flattened.
   */
  requestViewProjections?: readonly SessionMessageProjection[]
}

/** Validate the wire params of one `session/dispatches` request. */
function dispatchesParams(params: Record<string, unknown> | undefined): SessionDispatchesParams {
  const sessionId = params?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new TypeError('session/dispatches requires a non-empty sessionId')
  }
  return { sessionId }
}

/** Validate the wire params of one `session/request-view` request. */
function requestViewParams(params: Record<string, unknown> | undefined): SessionRequestViewParams {
  const { sessionId, dispatchSeq } = params ?? {}
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new TypeError('session/request-view requires a non-empty sessionId')
  }
  if (typeof dispatchSeq !== 'number' || !Number.isSafeInteger(dispatchSeq) || dispatchSeq < 0) {
    throw new TypeError('session/request-view requires a non-negative safe-integer dispatchSeq')
  }
  return { sessionId, dispatchSeq }
}

function successStatus(reason: string, options: HarnessSdkJsonRpcServerOptions): 'ok' | 'error' {
  if (reason === 'completed') return 'ok'
  return reason === 'max-tokens' && options.maxTokensAsSuccess === true ? 'ok' : 'error'
}

/**
 * SDK server over one booted harness context and transport peer. Construction
 * subscribes to session, agent, and subagent lifecycle events until shutdown;
 * reinitialization is unsupported.
 */
export class HarnessSdkJsonRpcServer {
  private cwd = process.cwd()
  private provider = 'deepseek-official'
  private model = 'deepseek-official'
  private reasoningEffort: ReturnType<typeof ReasoningEffortId> | undefined
  private maxTokens: number | undefined
  private llmFiber: { dispose(): Promise<void> } | undefined
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly sessionCreations = new Map<string, Promise<SessionRecord>>()
  /**
   * Cancellation generation per session. A prompt snapshots it on arrival and
   * re-reads it before delivery, so only work that was already in flight when
   * the cancel landed is refused; a prompt sent afterwards still runs.
   */
  private readonly cancelGenerations = new Map<string, number>()
  private readonly disposers: (() => void)[] = []
  private dispatchRecorderDispose: (() => void) | undefined
  private shutdownTask: Promise<Record<string, never>> | undefined
  private shuttingDown = false
  private initialized = false

  constructor(
    private readonly ctx: Context,
    private readonly transport: JsonRpcTransportPeer,
    private readonly options: HarnessSdkJsonRpcServerOptions = {},
  ) {
    const serverOptions = this.options
    if (serverOptions.recordLlmDispatch === true) {
      this.dispatchRecorderDispose = installRequestDispatchRecorder(ctx)
    }
    this.disposers.push(ctx.on('session/event', (session, event) => {
      const payload: SessionEventNotification = { sessionId: String(session.id), event }
      this.transport.notify('session.event', payload)
    }))
    this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      this.transport.notify('session.status', { sessionId: String(agent.session.id), status })
    }))
    this.disposers.push(ctx.on('session/created', (session) => {
      const parentSession = session.header.parentSession
      if (parentSession === undefined) return
      const payload: SubagentStartedNotification = {
        parentSessionId: String(parentSession),
        childSessionId: String(session.id),
      }
      this.transport.notify('subagent.started', payload)
    }))
    this.disposers.push(ctx.on('subagent/end', function (this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo) {
      const parent = subagentParentOf(this)
      // This protocol reports only in-process child sessions. The service
      // snapshots the provider name and local flag through child disposal;
      // matching ids or parent lineage alone never establishes locality.
      if (!info.local) return
      const payload: SubagentFinishedNotification = {
        provider: info.provider,
        agentId: String(info.id),
        parentSessionId: String(parent.session.id),
        childSessionId: String(info.id),
        status: successStatus(info.stopReason, serverOptions),
        stopReason: info.stopReason,
        ...(info.lastAssistantMessage === undefined
          ? {}
          : { lastAssistantMessage: [...info.lastAssistantMessage] }),
      }
      transport.notify('subagent.finished', payload)
    }))
  }

  /**
   * Validate and configure the SDK route, mounting the DeepSeek fallback only when unowned.
   * @param params - SDK handshake parameters.
   * @returns server identity for the handshake.
   */
  async initialize(params: InitializeParams): Promise<InitializeResult> {
    if (params.reasoningEffort !== undefined
      && (typeof params.reasoningEffort !== 'string' || params.reasoningEffort.length === 0)) {
      throw new TypeError('initialize reasoningEffort must be a non-empty string')
    }
    if (params.maxTokens !== undefined
      && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    const cwd = resolve(params.cwd)
    const provider = params.provider
    const model = params.model
    const reasoningEffort = params.reasoningEffort === undefined
      ? undefined
      : ReasoningEffortId(params.reasoningEffort)
    if (!this.hasAdapterFor(provider)) {
      if (provider !== 'deepseek-official') throw new Error(`no adapter registered for provider "${provider}"`)
      this.llmFiber = await this.ctx.plugin(LlmDeepSeek)
    }
    // Adapter presence was read from this service above; a successful fallback mount also requires it.
    const llm = this.ctx.get('llm') as LlmRuntime
    await llm.resolveCallConfig({
      provider,
      model,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      ...params.maxTokens === undefined ? {} : { maxTokens: params.maxTokens },
    })
    this.cwd = cwd
    this.provider = provider
    this.model = model
    this.reasoningEffort = reasoningEffort
    this.maxTokens = params.maxTokens
    this.initialized = true
    return {
      serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
      ...this.dispatchRecorderDispose === undefined ? {} : { capabilities: [SDK_REQUEST_VIEW_CAPABILITY] },
    }
  }

  /**
   * List one session's recorded model dispatches. The session may be live or
   * only durable; each record names the exact prefix its request came from.
   * @param params - target session.
   * @returns the session id and its dispatch records in commit order.
   * @throws when the recorder is off for this runtime.
   */
  async dispatches(params: SessionDispatchesParams): Promise<SessionDispatchesResult> {
    if (!this.initialized) throw new Error('SDK server is not initialized')
    this.assertRequestViews()
    const sessionId = SessionId(params.sessionId)
    let events: readonly SessionEvent[]
    try {
      events = await this.sessionEvents(sessionId)
    } catch (error: unknown) {
      // An unknown session is classified like the request-view path: the client
      // reads the same `data.code` instead of parsing message text.
      throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { data: refusalOf(error) })
    }
    const dispatches = events
      .flatMap(event => event.type === 'llm/dispatch' ? [event] : [])
      .map((event) => {
        const settlement = events.find((candidate): candidate is Extract<SessionEvent, { type: 'llm/dispatch-settled' }> =>
          candidate.type === 'llm/dispatch-settled'
          && candidate.data.dispatchSeq === event.seq)
        return {
          dispatchSeq: Number(event.seq),
          prefixEnd: Number(event.data.prefixEnd),
          turn: event.data.turn,
          step: event.data.step,
          ...settlement === undefined ? {} : { settlementSeq: Number(settlement.data.settlementSeq) },
        }
      })
    return { sessionId: params.sessionId, dispatches }
  }

  /**
   * Rebuild one recorded dispatch's model input from its exact committed log
   * prefix through the native Session primitives.
   * @param params - target session and dispatch record.
   * @returns the reconstructed header, messages, tools, and tool history.
   * @throws when the recorder is off, the params are invalid, the session or
   *   dispatch is unknown, or the prefix needs an unavailable projection.
   */
  async requestView(params: SessionRequestViewParams): Promise<SessionRequestViewResult> {
    if (!this.initialized) throw new Error('SDK server is not initialized')
    this.assertRequestViews()
    const projections = this.options.requestViewProjections
    try {
      const view = await buildRequestView(this.ctx, {
        sessionId: SessionId(params.sessionId),
        dispatchSeq: SessionSeq(params.dispatchSeq),
        ...projections === undefined ? {} : { projections },
      })
      return {
        sessionId: String(view.sessionId),
        dispatchSeq: Number(view.dispatchSeq),
        prefixEnd: Number(view.prefixEnd),
        turn: view.turn,
        step: view.step,
        header: view.header,
        messages: view.messages,
        ...view.tools === undefined ? {} : { tools: view.tools },
        toolHistory: view.toolHistory,
        ...view.settlementSeq === undefined ? {} : { settlementSeq: Number(view.settlementSeq) },
        projectionTypes: view.projectionTypes,
      }
    } catch (error: unknown) {
      throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { data: refusalOf(error) })
    }
  }

  /** Refuse read-only request views when this runtime recorded no dispatches. */
  private assertRequestViews(): void {
    if (this.dispatchRecorderDispose === undefined) {
      throw new Error('this SDK runtime does not support read-only request views; start it with recordLlmDispatch enabled')
    }
  }

  /**
   * Read one session's complete event log for request facts. A live session is
   * flushed to its durability barrier first; a disposed one is read from
   * storage. Neither path mutates the session.
   * @param sessionId - the session to read.
   * @returns contiguous events from seq 0.
   */
  private async sessionEvents(sessionId: SessionId): Promise<readonly SessionEvent[]> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('request views require the session store')
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) throw new Error('request views require session persistence')
    const live = sessions.get(sessionId)
    if (live !== undefined) await sessions.flush(live)
    let handle
    try {
      handle = await persistence.open(sessionId, 'read')
    } catch (_error: unknown) {
      // Every open failure on this path means the recorded session cannot be
      // read at all: it is gone, or storage refused it.
      throw new RequestViewError(
        `session "${String(sessionId)}" was not found`,
        'SESSION_NOT_FOUND',
      )
    }
    try {
      const read = await handle.read(0)
      return read.events
    } finally {
      await handle.close()
    }
  }

  /**
   * Queue one identified prompt without assigning later activity to it.
   * @param params - target session and user content.
   * @returns the queued message identity; no storage flush is awaited.
   */
  async prompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    if (!this.initialized) throw new Error('SDK server is not initialized')
    // Snapshot before any await: this prompt owns the generation it arrived in.
    const generation = this.cancelGenerationOf(params.sessionId)
    const rec = await this.getOrCreateSession(params)
    // An agent-loop-only reload disposes the loop's agents while this record
    // survives; a retained agent accepts followup() silently, so validate the
    // record against the live registry before delivery.
    this.assertLiveAgent(rec, params.sessionId)
    const content = await durablePromptContent(this.ctx, params.contentBlocks)
    // Attachment admission crosses an async boundary where shutdown or an
    // agent-loop reload may detach the retained handle.
    this.assertLiveAgent(rec, params.sessionId)
    // Re-read after the last await: a cancel that arrived while this prompt
    // was prepared owns this generation, so the prompt must not start work the
    // caller already stopped. The check and followup below run without an
    // await, so a cancel cannot interleave between them.
    if (this.cancelGenerationOf(params.sessionId) !== generation) {
      throw new Error(`session was cancelled while this prompt was in flight: ${params.sessionId}`)
    }
    const message = createUserMessage({
      content,
      source: { kind: 'user' },
    })
    rec.handle.agent.followup(message)
    return { messageId: message.id }
  }

  private cancelGenerationOf(sessionId: string): number {
    return this.cancelGenerations.get(sessionId) ?? 0
  }

  /**
   * Cancel one session's active and queued work, then wait for it to stop.
   * Other sessions and the surrounding runtime are untouched.
   * @param params - the session whose work must stop.
   * @returns confirmation only after the session reached quiescence.
   */
  async cancel(params: SessionCancelParams): Promise<SessionCancelResult> {
    if (!this.initialized) throw new Error('SDK server is not initialized')
    // Advance before any await: a prompt already preparing re-reads this
    // generation before its synchronous delivery and is refused, while a
    // prompt sent after this call starts a later generation and still runs.
    this.cancelGenerations.set(params.sessionId, this.cancelGenerationOf(params.sessionId) + 1)
    const rec = this.sessions.get(params.sessionId)
    if (rec === undefined) {
      // No live agent means no work to stop. A prompt still awaiting session
      // creation is refused by the generation check, so none can start later.
      return { sessionId: params.sessionId, cancelled: true }
    }
    this.assertLiveAgent(rec, params.sessionId)
    rec.handle.agent.cancel({ kind: 'user' })
    // Settlement, not the request above, is what this method reports.
    await rec.handle.agent.whenIdle()
    return { sessionId: params.sessionId, cancelled: true }
  }

  private assertLiveAgent(rec: SessionRecord, sessionId: string): void {
    if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${sessionId}`)
    }
  }

  /**
   * Dispose server-owned agents, adapter, and subscriptions to quiescence.
   * The surrounding context remains running.
   * @returns empty JSON-RPC result.
   */
  shutdown(): Promise<Record<string, never>> {
    this.shutdownTask ??= this.performShutdown()
    return this.shutdownTask
  }

  private async performShutdown(): Promise<Record<string, never>> {
    this.shuttingDown = true
    this.dispatchRecorderDispose?.()
    this.dispatchRecorderDispose = undefined
    const pendingCreations = [...this.sessionCreations.values()]
    await Promise.allSettled(pendingCreations)
    this.sessionCreations.clear()
    const records = [...this.sessions.values()]
    this.sessions.clear()
    this.cancelGenerations.clear()
    const failures: unknown[] = []
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardownResults = await Promise.allSettled([
      ...records.map(rec => Promise.resolve().then(() => rec.handle.dispose())),
      ...(this.llmFiber === undefined ? [] : [Promise.resolve().then(() => this.llmFiber?.dispose())]),
    ])
    this.llmFiber = undefined
    failures.push(...teardownResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'SDK server teardown failed')
    return {}
  }

  /**
   * Dispatch one incoming JSON-RPC request to its typed handler. Throws (→ a
   * JSON-RPC error response) on an unknown method.
   * @param method - the JSON-RPC method name.
   * @param params - the raw params object from the wire.
   * @returns the handler's result, to be serialized as the response.
   */
  async handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params as unknown as InitializeParams)
      case 'session/prompt':
        return this.prompt(params as unknown as SessionPromptParams)
      case 'session/cancel':
        return this.cancel(cancelParams(params))
      case 'session/dispatches':
        return this.dispatches(dispatchesParams(params))
      case 'session/request-view':
        return this.requestView(requestViewParams(params))
      case 'shutdown':
        return this.shutdown()
      default:
        throw new Error(`unknown APUS Reflex Harness SDK runtime method: ${method}`)
    }
  }

  private async getOrCreateSession(params: SessionPromptParams): Promise<SessionRecord> {
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const { sessionId, cwd, agentPreset } = params
    if (agentPreset !== undefined && (typeof agentPreset !== 'string' || agentPreset.trim() === '')) {
      throw new TypeError('session agentPreset must be a nonempty string')
    }
    if (cwd !== undefined && (typeof cwd !== 'string' || !isAbsolute(cwd))) {
      throw new TypeError('session cwd must be an absolute path')
    }
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) return this.assertSessionOptions(existing, params)
    const pending = this.sessionCreations.get(sessionId)
    if (pending !== undefined) return this.assertSessionOptions(await pending, params)
    const creation = this.createSession(sessionId, cwd ?? this.cwd, agentPreset)
    this.sessionCreations.set(sessionId, creation)
    void creation.then(
      () => { this.sessionCreations.delete(sessionId) },
      () => { this.sessionCreations.delete(sessionId) },
    )
    return creation
  }

  private assertSessionOptions(record: SessionRecord, params: SessionPromptParams): SessionRecord {
    if (params.cwd !== undefined && params.cwd !== record.cwd) {
      throw new Error(`session "${params.sessionId}" already uses cwd "${record.cwd}"`)
    }
    if (params.agentPreset !== undefined && params.agentPreset !== record.agentPreset) {
      throw new Error(`session "${params.sessionId}" already uses preset "${record.agentPreset ?? ''}"`)
    }
    return record
  }

  private async createSession(
    sessionId: string, cwd: string, agentPreset: string | undefined,
  ): Promise<SessionRecord> {
    let setup: AgentSetup | undefined
    if (agentPreset !== undefined) {
      const presets = this.ctx.get('agentPresets')
      if (presets === undefined) throw new Error('session agentPreset requires an Agent preset registry')
      setup = async (agentCtx: Context) => { await presets.mount(agentCtx, agentPreset) }
    }
    const handle = await this.ctx.agents.create({
      sessionId: brandString<SessionId>(sessionId),
      meta: { cwd, ...agentPreset === undefined ? {} : { agentPreset } },
      ...setup === undefined ? {} : { setup },
      agentOptions: {
        provider: this.provider,
        model: this.model,
        ...this.reasoningEffort === undefined ? {} : { reasoningEffort: this.reasoningEffort },
        ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
      },
    })
    const rec: SessionRecord = { handle, cwd, agentPreset }
    this.sessions.set(sessionId, rec)
    return rec
  }

  private hasAdapterFor(provider: string): boolean {
    return this.ctx.get('llm')?.listProviders().some(entry => entry.id === provider) ?? false
  }
}

/**
 * Classify a request-view failure for the wire. Known refusals keep their
 * machine code; an uninterpretable prefix becomes an explicit unsupported
 * projection rather than a generic error. The transport forwards `data`.
 * @param error - the failure raised while rebuilding a request view.
 * @returns the typed refusal payload carried in the JSON-RPC error data.
 */
function refusalOf(error: unknown): SdkRequestViewRefusal {
  if (error instanceof RequestViewError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof RequestViewUnsupportedError) {
    return { code: 'UNSUPPORTED_PROJECTION', message: error.message }
  }
  throw error
}
