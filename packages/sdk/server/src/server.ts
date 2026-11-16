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
  SdkSessionSettlement,
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
import type { Session, SessionEvent, SessionMessageProjection } from '@deepseek-ai/dsh-session'
import {
  buildRequestView,
  installRequestDispatchRecorder,
  RequestViewError,
  RequestViewUnsupportedError,
  type RequestDispatchRecorder,
} from './request-view.ts'

/**
 * The one Continuum surface this server needs: the promise that an Agent's
 * queued observations have settled. Declared here structurally so the SDK
 * server does not take a production dependency on the memory service.
 */
interface SettledObservations {
  whenSettled(agent: Agent): Promise<void>
}

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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The Session log reached its durability barrier for an idle transition.
     * Appended only after the settlement records and the storage flush both
     * completed, so it answers "up to which seq is this session durably
     * stored" from the log itself. Log-only and informational: losing it
     * cannot change how the rest of the log is interpreted.
     */
    'session/flushed': {
      sessionId: import('@deepseek-ai/dsh-session/types').SessionId
      /** Last committed event seq the flush covered. */
      throughSeq: import('@deepseek-ai/dsh-session/types').SessionSeq
    }
  }
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
  /**
   * Upper bound, in milliseconds, on waiting for one Agent's queued facts to
   * settle and its Session log to flush. A barrier that exceeds it fails
   * explicitly instead of hanging the cancel reply or process shutdown.
   * Defaults to 30 seconds.
   */
  settlementTimeoutMs?: number
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
  private dispatchRecorder: RequestDispatchRecorder | undefined
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
      this.dispatchRecorder = installRequestDispatchRecorder(ctx)
    }
    this.disposers.push(ctx.on('session/event', (session, event) => {
      const payload: SessionEventNotification = { sessionId: String(session.id), event }
      this.transport.notify('session.event', payload)
    }))
    this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      const sessionId = String(agent.session.id)
      const epoch = this.bumpStatusEpoch(sessionId)
      // A settled idle is claimed only when some fact source can still be
      // draining: the dispatch recorder's pending settlement records or the
      // memory service's queued admissions. Without either the transition is
      // forwarded exactly as observed.
      if (status !== 'idle' || !this.hasSettlementSources()) {
        if (status !== 'idle') {
          this.idleAnnounced.delete(sessionId)
          // A drain started for the previous idle covers only the facts queued
          // then. New work owns a new pass, so a later `cancel` or idle cannot
          // be answered by the stale one.
          this.settledDrains.delete(agent)
        }
        this.transport.notify('session.status', { sessionId, status })
        return
      }
      void this.announceSettledIdle(agent, sessionId, epoch)
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
    // A preset whose plugins fail to mount (a missing required config field,
    // an unloadable row) makes every session on it fail. The handshake is where
    // the deployment can still see that: a run that starts and then fails at
    // its first message reads as a task failure instead of a broken profile.
    await this.assertDefaultPresetUsable()
    this.cwd = cwd
    this.provider = provider
    this.model = model
    this.reasoningEffort = reasoningEffort
    this.maxTokens = params.maxTokens
    this.initialized = true
    return {
      serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
      ...this.dispatchRecorder === undefined ? {} : { capabilities: [SDK_REQUEST_VIEW_CAPABILITY] },
    }
  }

  /**
   * Refuse the handshake when the composition's default agent preset is broken.
   *
   * Sessions that name no preset run on this one, so a preset that cannot mount
   * would fail every run at its first message. Reporting it here keeps the
   * deployment fault at the point where it can still be corrected; a
   * composition without a preset registry is not affected, because its sessions
   * do not mount one.
   */
  private async assertDefaultPresetUsable(): Promise<void> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return
    const preset = await presets.resolve()
    if (preset.broken === undefined) return
    throw new Error(`default agent preset "${preset.id}" cannot mount: ${preset.broken}`)
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
    if (this.dispatchRecorder === undefined) {
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
    // Settlement, not the request above, is what this method reports. The
    // agent's own idle only drains its turn; observations queued at the last
    // step boundary and their durable flush are the two facts a caller of
    // cancel must be able to read back immediately. The status notification
    // itself stays with the listener, which applies the same barrier.
    await rec.handle.agent.whenIdle()
    await this.drainSettled(rec.handle.agent, params.sessionId)
    return { sessionId: params.sessionId, cancelled: true }
  }

  /** Sessions whose settled-idle notification already went out, until the next running transition. */
  private readonly idleAnnounced = new Set<string>()
  /** Per-session status generation; a later transition makes an older settled-idle stale. */
  private readonly statusEpochs = new Map<string, number>()
  /** One in-flight settle-and-flush per agent, shared by the notification and cancel. */
  private readonly settledDrains = new Map<Agent, Promise<void>>()

  private bumpStatusEpoch(sessionId: string): number {
    const next = (this.statusEpochs.get(sessionId) ?? 0) + 1
    this.statusEpochs.set(sessionId, next)
    return next
  }

  /**
   * The mounted memory service, read structurally: a context that publishes a
   * different implementation under this name (a test stand-in, a stripped
   * composition) has no settlement queue to wait for.
   * @returns the service when it exposes {@link SettledObservations.whenSettled}.
   */
  private settledObservations(): SettledObservations | undefined {
    const candidate = this.ctx.get('continuumMemory') as Partial<SettledObservations> | undefined
    return typeof candidate?.whenSettled === 'function' ? candidate as SettledObservations : undefined
  }

  /** Whether any mounted fact source can still be inserting facts for an idle Agent. */
  private hasSettlementSources(): boolean {
    return this.dispatchRecorder !== undefined || this.settledObservations() !== undefined
  }

  /**
   * Reject when `work` has not settled within this runtime's settlement bound;
   * `settlementTimeoutMs: 0` disables the timer. The timer is unref'd so an
   * otherwise finished process is never held open by a barrier nobody waits on.
   * A rejection of `work` propagates as the same value.
   * @param work - the barrier to bound.
   * @param sessionId - session named in the timeout failure.
   * @returns the barrier's own outcome when it settles in time.
   */
  private withSettlementDeadline<T>(work: Promise<T>, sessionId: string): Promise<T> {
    const timeoutMs = this.options.settlementTimeoutMs ?? 30_000
    if (timeoutMs <= 0) return work
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`session "${sessionId}" did not settle and flush within ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref()
      work.then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error: unknown) => {
          clearTimeout(timer)
          // The barrier's own rejection is the caller-visible failure: it may
          // carry an arbitrary value from a listener, so it is preserved
          // verbatim rather than wrapped.
          reject(error)
        },
      )
    })
  }

  /**
   * Wait for every fact this Agent's last work produced, then make its log
   * durable. Three facts are distinct: the loop stopped, the recorder's
   * scheduled settlement records were inserted, and the queued memory
   * admissions resolved. Only after all three does the Session flush. Concurrent
   * callers (the status listener and `cancel`) share one pass, so a session's
   * observations are never awaited twice.
   * @param agent - the session's live agent.
   * @returns a promise that resolves after settlement and the storage flush.
   * @throws when the recorder, the memory service, or the flush reports failure,
   *   or the barrier exceeds {@link HarnessSdkJsonRpcServerOptions.settlementTimeoutMs}.
   */
  private drainSettled(agent: Agent, sessionId: string): Promise<void> {
    const pending = this.settledDrains.get(agent)
    if (pending !== undefined) return pending
    const drain = (async () => {
      await this.withSettlementDeadline((async () => {
        // Native dispatch settlement records are appended from a microtask
        // after the publishing append unwinds; wait for that queue, not for a
        // scheduler delay.
        await this.dispatchRecorder?.whenSettled(SessionId(sessionId))
        await this.settledObservations()?.whenSettled(agent)
      })(), sessionId)
      // A composition that publishes something else under this name has no
      // live session to flush; only the store's real surface is awaited.
      const sessions = this.ctx.get('sessions')
      const store = typeof sessions?.get === 'function' && typeof sessions.flush === 'function'
        ? sessions as {
          get(id: SessionId): Session | undefined
          flush(session: Session): Promise<boolean>
        }
        : undefined
      const live = store?.get(SessionId(sessionId))
      if (store !== undefined && live !== undefined) {
        // 覆盖范围在 flush 之前固定：等待期间可以有新事件进入内存，
        // 只有这一刻之前的序号才是本次确认真正写进存储的部分。
        const throughSeq = Number(live.seq) - 1
        const participated = await this.withSettlementDeadline(
          Promise.resolve(store.flush(live)), sessionId,
        )
        // `false` 表示没有任何持久化监听器参与：此时没有“已落盘”这件事，
        // 不能凭一次返回就写出成功确认。
        if (participated === true && throughSeq >= 0) {
          live.append('session/flushed', {
            sessionId: SessionId(sessionId),
            throughSeq: SessionSeq(throughSeq),
          })
          // 确认记录本身也必须持久化：它回答“已落盘到哪里”，若重启后这段结论
          // 消失，读者就无法核对。再走一次屏障把它写入存储。
          await this.withSettlementDeadline(Promise.resolve(store.flush(live)), sessionId)
        } else if (participated !== true) {
          // 没有任何持久化监听器参与：这一次没有“已落盘”的事实可报告。
          // 不能静默通过——调用方会看到 settled，却找不到落盘证据。
          this.ctx.logger.warn(
            `session "${sessionId}": flush reported no durability participant; `
            + 'no session/flushed record was written',
          )
        }
      }
    })().finally(() => {
      // Only this pass may retire its own entry: a later turn can have
      // installed a newer pass after a running transition.
      if (this.settledDrains.get(agent) === drain) this.settledDrains.delete(agent)
    })
    this.settledDrains.set(agent, drain)
    return drain
  }

  /**
   * Report one session idle only after its queued facts have settled and the
   * session log is durable. The loop itself already stopped, so the status
   * notification still goes out when the barrier fails — suppressing it would
   * hang a client waiting for quiescence — but the failure is logged at error
   * level and is never reported as settled evidence: `cancel` and `shutdown`
   * surface the same rejection to their callers.
   * @param agent - the session's live agent.
   * @param sessionId - the session whose idle transition this reports.
   * @param epoch - status generation captured when the transition arrived.
   */
  private async announceSettledIdle(agent: Agent, sessionId: string, epoch: number): Promise<void> {
    let settlement: SdkSessionSettlement = 'settled'
    try {
      await this.drainSettled(agent, sessionId)
    } catch (error: unknown) {
      settlement = 'failed'
      this.ctx.logger.error(`sdk session idle settlement failed for "${sessionId}": ${String(error)}`)
    }
    // A later transition owns the current status; a duplicate idle is not sent twice.
    if (this.statusEpochs.get(sessionId) !== epoch) return
    if (this.idleAnnounced.has(sessionId)) return
    this.idleAnnounced.add(sessionId)
    this.transport.notify('session.status', { sessionId, status: 'idle', settlement })
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
    const pendingCreations = [...this.sessionCreations.values()]
    await Promise.allSettled(pendingCreations)
    this.sessionCreations.clear()
    const records = [...this.sessions.entries()]
    const failures: unknown[] = []
    // Stop each target Agent's own loop first and let it converge. The Agent's
    // Session, the event channel and the dispatch recorder all stay mounted
    // here: work still running at shutdown is cancelled by this step, and the
    // facts it commits on the way out must still reach storage. Disposal later
    // only re-runs an already-idle agent.
    const stops = await Promise.allSettled(records.map(async ([sessionId, rec]) => {
      const agent = rec.handle.agent
      const runtime = agent as Partial<Pick<Agent, 'status' | 'cancel' | 'whenIdle'>>
      if (runtime.status !== 'running' || runtime.cancel === undefined) return
      runtime.cancel({ kind: 'disposed' })
      if (runtime.whenIdle !== undefined) await this.withSettlementDeadline(runtime.whenIdle(), sessionId)
    }))
    failures.push(...rejectedReasons(stops))
    // Now the queues are quiet: drain the recorder's scheduled settlement
    // records and the memory admissions, then flush, still before unloading.
    const drains = await Promise.allSettled(records.map(([sessionId, rec]) =>
      this.drainSettled(rec.handle.agent, sessionId)))
    failures.push(...rejectedReasons(drains))
    this.settledDrains.clear()
    this.dispatchRecorder?.()
    this.dispatchRecorder = undefined
    this.sessions.clear()
    this.cancelGenerations.clear()
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardownResults = await Promise.allSettled([
      ...records.map(([, rec]) => Promise.resolve().then(() => rec.handle.dispose())),
      ...(this.llmFiber === undefined ? [] : [Promise.resolve().then(() => this.llmFiber?.dispose())]),
    ])
    this.llmFiber = undefined
    failures.push(...rejectedReasons(teardownResults))
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

/** Rejection reasons of settled results, in order; fulfilled entries contribute nothing. */
function rejectedReasons(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason as unknown)
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
