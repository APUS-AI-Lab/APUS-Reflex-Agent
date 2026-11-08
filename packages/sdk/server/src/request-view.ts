/**
 * Read-only request views over durable dispatch facts (C09A).
 *
 * The `llm/stream` waterfall is the one seam every model dispatch passes
 * through. This module records the minimum a later reader cannot recover from
 * the log: which session dispatched, the exact committed prefix end the
 * request was built from, and its turn/step — never a copy of messages or
 * tools. When the attempt settles, a second record names that dispatch and
 * the assistant settlement event that closed it.
 *
 * {@link buildRequestView} rebuilds one dispatch's messages, header, and tool
 * history from the exact log prefix through the native Session primitives
 * (`Session.fromRestore`, `deriveMessages`, `requestHeader`, `toolHistory`)
 * and the message projections supplied by the caller. A log whose message
 * projection cannot be supplied is refused; the view is never flattened to an
 * approximate success.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/request-view
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, RequestMessage, StreamChunk, ToolHistory, ToolSchema } from '@deepseek-ai/dsh-llm'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type {
  EpochHeader,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset,
  SessionMessageProjection,
} from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One actual loop-built model dispatch, recorded at the `llm/stream`
     * waterfall before the adapter runs. Carries only the native references a
     * later reader cannot reconstruct from the log: the dispatching session,
     * the exact committed prefix end the request was derived from, and its
     * turn/step. It never copies messages or tool declarations and never
     * enters the model-visible surface. Log-only and informational: losing it
     * cannot change how the rest of the log is interpreted.
     */
    'llm/dispatch': {
      sessionId: SessionId
      /** Last committed event seq the request was derived from. */
      prefixEnd: SessionSeq
      turn: number
      step: number
    }
    /**
     * The assistant settlement that closed one `llm/dispatch`. `settlementSeq`
     * names the `assistant/message` or `assistant/attempt` event; this record
     * is appended after it. Log-only and informational, like its dispatch.
     */
    'llm/dispatch-settled': {
      sessionId: SessionId
      /** Seq of the `llm/dispatch` record this settlement closes. */
      dispatchSeq: SessionSeq
      /** Seq of the assistant settlement event that closed the attempt. */
      settlementSeq: SessionSeq
    }
  }
}

/** Why a request view cannot be produced. */
export type RequestViewErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'DISPATCH_NOT_FOUND'
  | 'PREFIX_UNAVAILABLE'

/** A request view was asked for a fact this runtime cannot establish. */
export class RequestViewError extends Error {
  /**
   * @param message - which fact is unavailable and why.
   * @param code - stable machine classification of the refusal.
   */
  constructor(message: string, readonly code: RequestViewErrorCode) {
    super(message)
    this.name = 'RequestViewError'
  }
}

/**
 * The log cannot be interpreted with the supplied message projections (or the
 * prefix this build loaded is not enough to represent the dispatch). Callers
 * report the dispatch as unsupported instead of substituting an approximation.
 */
export class RequestViewUnsupportedError extends Error {
  /**
   * @param message - which projection, event, or prefix is unavailable.
   * @param options - the underlying rebuild failure, when one exists.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RequestViewUnsupportedError'
  }
}

/** One dispatch observer, from the `llm/stream` boundary through settlement. */
interface ActiveDispatch {
  readonly session: Session
  readonly dispatchSeq: SessionSeq
  readonly turn: number
  readonly step: number
  settlementSeq: SessionSeq | undefined
  streamEnded: boolean
  flushScheduled: boolean
}

/** Turn/step of the step currently dispatching, tracked from committed `step/start` events. */
type DispatchPosition = { readonly turn: number; readonly step: number }

/**
 * Install the dispatch recorder on `ctx`. Every loop-built `llm/stream`
 * request appends one `llm/dispatch` record; the matching assistant
 * settlement appends its `llm/dispatch-settled` record after the settlement
 * event commits. Hand-built calls are not recorded, and a rejected
 * observation never changes the model call.
 * @param ctx - context whose `llm/stream` waterfall and `sessions` store are observed.
 * @returns the disposer removing every listener and pending observer.
 */
export function installRequestDispatchRecorder(ctx: Context): () => void {
  const store = ctx.get('sessions')
  if (store === undefined) return () => undefined
  const positions = new Map<string, DispatchPosition>()
  const active = new Set<ActiveDispatch>()

  const appendSettled = (state: ActiveDispatch): void => {
    if (state.settlementSeq === undefined) return
    active.delete(state)
    try {
      state.session.append('llm/dispatch-settled', {
        sessionId: state.session.id,
        dispatchSeq: state.dispatchSeq,
        settlementSeq: state.settlementSeq,
      })
    } catch (error: unknown) {
      ctx.logger.warn(`sdk request view: failed to record llm/dispatch-settled for "${String(state.session.id)}": ${String(error)}`)
    }
  }

  // A settlement record may only be appended once the publishing append has
  // unwound: Session rejects a reentrant append, and the settlement event is
  // published from inside its own append.
  const scheduleFlush = (state: ActiveDispatch): void => {
    if (state.flushScheduled) return
    state.flushScheduled = true
    queueMicrotask(() => {
      state.flushScheduled = false
      if (state.streamEnded) appendSettled(state)
    })
  }

  const disposers = [
    ctx.on('session/disposed', (session: Session) => {
      // The session left the store: its step position and any dispatch whose
      // settlement never arrived must not outlive it.
      positions.delete(String(session.id))
      for (const state of active) {
        if (state.session === session) active.delete(state)
      }
    }),
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type === 'step/start') {
        positions.set(String(session.id), { turn: event.data.turn, step: event.data.step })
        return
      }
      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return
      for (const state of active) {
        if (state.session !== session
          || state.settlementSeq !== undefined
          || state.turn !== event.data.turn
          || state.step !== event.data.step
          || event.seq <= state.dispatchSeq) continue
        state.settlementSeq = event.seq
        scheduleFlush(state)
      }
    }),
    ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> => {
      if (!isAgentLoopRequest(options) || options.sessionId === undefined) return next()
      const session = store.get(options.sessionId)
      const position = positions.get(String(options.sessionId))
      if (session === undefined || position === undefined) return next()
      // The loop appended every request input before building this request and
      // appended nothing since; the last committed event is its prefix end.
      const prefixEnd = Number(session.seq) - 1
      if (prefixEnd < 0) return next()
      let dispatchSeq: SessionSeq
      try {
        dispatchSeq = session.append('llm/dispatch', {
          sessionId: session.id,
          prefixEnd: SessionSeq(prefixEnd),
          turn: position.turn,
          step: position.step,
        }).seq
      } catch (error: unknown) {
        ctx.logger.warn(`sdk request view: failed to record llm/dispatch for "${String(session.id)}": ${String(error)}`)
        return next()
      }
      const state: ActiveDispatch = {
        session,
        dispatchSeq,
        turn: position.turn,
        step: position.step,
        settlementSeq: undefined,
        streamEnded: false,
        flushScheduled: false,
      }
      active.add(state)
      const stream = next()
      return (async function * observed(): AsyncIterable<StreamChunk> {
        try {
          yield * stream
        } finally {
          state.streamEnded = true
          scheduleFlush(state)
        }
      })()
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
    active.clear()
    positions.clear()
  }
}

/** Parameters of one {@link buildRequestView} query. */
export interface RequestViewQuery {
  /** Session that dispatched the request. */
  sessionId: SessionId
  /** Seq of the `llm/dispatch` record to rebuild. */
  dispatchSeq: SessionSeq
  /**
   * Message projections this caller can supply for plugin-owned message
   * changes. Defaults to the store's registered projections.
   */
  projections?: readonly SessionMessageProjection[]
  /** Optional cancellation for the storage read. */
  signal?: AbortSignal
}

/** One dispatch's reconstructed model input, derived from its exact log prefix. */
export interface RequestView {
  /** Session that dispatched the request. */
  sessionId: SessionId
  /** Seq of the `llm/dispatch` record this view rebuilt. */
  dispatchSeq: SessionSeq
  /** Last committed event seq the dispatched request was derived from. */
  prefixEnd: SessionSeq
  /** Turn the dispatch belonged to. */
  turn: number
  /** Step the dispatch belonged to. */
  step: number
  /** Request header in force at dispatch: call config, adapter defaults, and tools. */
  header: EpochHeader
  /** Derived message history at dispatch, including plugin message projections. */
  messages: RequestMessage[]
  /** Assembled tool schemas at dispatch; absent for a tool-less request. */
  tools?: ToolSchema[]
  /** Session-folded tool history at dispatch. */
  toolHistory: ToolHistory
  /** Seq of the assistant settlement that closed the dispatch, when recorded. */
  settlementSeq?: SessionSeq
  /** Event types of the message projections supplied for this rebuild. */
  projectionTypes: string[]
}

/** The durable facts one query resolves before rebuilding. */
interface DispatchFacts {
  header: SessionHeader
  inheritedEventCount: SessionLogOffset
  eventState: 'detached' | 'shared-frozen'
  dispatch: Extract<SessionEvent, { type: 'llm/dispatch' }>
  settlementSeq: SessionSeq | undefined
  events: readonly SessionEvent[]
}

/**
 * Rebuild the model input of one recorded dispatch from its exact committed
 * log prefix. The read goes through durable storage, so a live session is
 * flushed to its durability barrier first; the prefix is then sliced to the
 * dispatch's recorded end, independent of later appends.
 * @param ctx - context supplying the session store and optional persistence.
 * @param query - session, dispatch record, and projections to interpret with.
 * @returns the dispatch's messages, header, tools, and tool history.
 * @throws {RequestViewError} when the session or dispatch is not found, or the recorded prefix is unavailable.
 * @throws {RequestViewUnsupportedError} when the prefix needs a message projection the caller did not supply.
 */
export async function buildRequestView(ctx: Context, query: RequestViewQuery): Promise<RequestView> {
  const facts = await readDispatchFacts(ctx, query)
  const projections = query.projections ?? ctx.get('sessions')?.messageProjections ?? []
  let rebuilt: Session
  try {
    rebuilt = Session.fromRestore(
      query.sessionId,
      facts.events,
      facts.header,
      facts.inheritedEventCount,
      facts.eventState,
      projections,
    )
  } catch (error: unknown) {
    throw new RequestViewUnsupportedError(
      `dispatch ${Number(query.dispatchSeq)} of session "${String(query.sessionId)}" cannot be rebuilt: `
      + (error instanceof Error ? error.message : String(error)),
      { cause: error },
    )
  }
  const header = rebuilt.requestHeader()
  if (header === undefined) {
    throw new RequestViewUnsupportedError(
      `dispatch ${Number(query.dispatchSeq)} of session "${String(query.sessionId)}" has no request/header in its prefix`,
    )
  }
  return {
    sessionId: query.sessionId,
    dispatchSeq: facts.dispatch.seq,
    prefixEnd: facts.dispatch.data.prefixEnd,
    turn: facts.dispatch.data.turn,
    step: facts.dispatch.data.step,
    header,
    messages: rebuilt.deriveMessages(),
    ...header.tools === undefined ? {} : { tools: header.tools },
    toolHistory: rebuilt.toolHistory(),
    ...facts.settlementSeq === undefined ? {} : { settlementSeq: facts.settlementSeq },
    projectionTypes: projections.map(projection => projection.type),
  }
}

/** Resolve the dispatch record, its settlement, and the exact prefix through storage. */
async function readDispatchFacts(ctx: Context, query: RequestViewQuery): Promise<DispatchFacts> {
  const store = ctx.get('sessions')
  const persistence: SessionPersistence | undefined = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new RequestViewError(
      `session "${String(query.sessionId)}" cannot be read: no session persistence is mounted`,
      'PREFIX_UNAVAILABLE',
    )
  }
  const live = store?.get(query.sessionId)
  if (live !== undefined) {
    // The dispatch prefix is historical by definition; make the live log
    // durable through the store's own barrier before reading it back.
    await store?.flush(live)
  }
  const options = query.signal === undefined ? undefined : { signal: query.signal }
  let handle: SessionHandle
  try {
    handle = await persistence.open(query.sessionId, 'read', options)
  } catch (error: unknown) {
    if (error instanceof SessionPersistenceNotFoundError) {
      throw new RequestViewError(
        `session "${String(query.sessionId)}" was not found`,
        'SESSION_NOT_FOUND',
      )
    }
    // Any other failure means this build cannot establish the dispatch's prefix.
    throw new RequestViewError(
      `session "${String(query.sessionId)}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      'PREFIX_UNAVAILABLE',
    )
  }
  try {
    const dispatchRead = await handle.read(Number(query.dispatchSeq), 1, options)
    const dispatch = dispatchRead.events[0]
    if (dispatch?.type !== 'llm/dispatch' || dispatch.seq !== query.dispatchSeq) {
      throw new RequestViewError(
        `session "${String(query.sessionId)}" has no llm/dispatch record at seq ${Number(query.dispatchSeq)}`,
        'DISPATCH_NOT_FOUND',
      )
    }
    const prefixLength = Number(dispatch.data.prefixEnd) + 1
    const prefixRead = await handle.read(0, prefixLength, options)
    if (prefixRead.events.length < prefixLength) {
      throw new RequestViewError(
        `session "${String(query.sessionId)}" stores only ${prefixRead.events.length} of the ${prefixLength} events dispatch ${Number(query.dispatchSeq)} was derived from`,
        'PREFIX_UNAVAILABLE',
      )
    }
    // Read the whole tail: a bounded look-ahead could report "not recorded"
    // for a settlement that is present, which is the approximation this view
    // must never make.
    const tailRead = await handle.read(Number(query.dispatchSeq) + 1, undefined, options)
    const settlement = tailRead.events.find((event): event is Extract<SessionEvent, { type: 'llm/dispatch-settled' }> =>
      event.type === 'llm/dispatch-settled' && event.data.dispatchSeq === dispatch.seq)
    return {
      header: handle.header,
      inheritedEventCount: handle.inheritedEventCount,
      eventState: prefixRead.eventState,
      dispatch,
      settlementSeq: settlement?.data.settlementSeq,
      events: prefixRead.events,
    }
  } finally {
    await handle.close()
  }
}
