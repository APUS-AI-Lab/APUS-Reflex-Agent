/** One AG-UI run: a user message driven through a DSH Agent while its events stream to the client. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { CUSTOM_SUBAGENT_ACTIVITY, type AguiEvent, type SseWriter } from './agui.ts'
import { textOf } from './projection.ts'

/** A running turn's client-facing state. */
export interface ActiveRun {
  readonly runId: string
  readonly threadId: string
  readonly agent: Agent
  readonly sse: SseWriter
}

/** Live-stream bookkeeping for one model attempt. */
interface AttemptState {
  messageId: string
  reasoningOpen: boolean
  textOpen: boolean
  toolCalls: Map<number, string>
}

/**
 * Drive one turn and translate every observable Agent fact into AG-UI events
 * until the turn the message opened has ended.
 * @param ctx - plugin context carrying the session event feed.
 * @param run - client-facing run identity, owning Agent and stream.
 * @param text - the user's message.
 */
export async function driveRun(ctx: Context, run: ActiveRun, text: string): Promise<void> {
  const { agent, sse } = run
  const base = { threadId: run.threadId, runId: run.runId }
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  const finished = Promise.withResolvers<SessionEvent<'turn/end'>['data']['reason'] | undefined>()
  let turn: number | undefined
  let attempt: AttemptState | undefined
  const disposers: (() => void)[] = []

  const closeAttempt = (): void => {
    if (attempt === undefined) return
    if (attempt.reasoningOpen) sse.send({ type: 'REASONING_MESSAGE_END', messageId: `${attempt.messageId}-reasoning` })
    if (attempt.textOpen) sse.send({ type: 'TEXT_MESSAGE_END', messageId: attempt.messageId })
    attempt = undefined
  }

  const onChunk = (state: AttemptState, chunk: StreamChunk): void => {
    switch (chunk.type) {
      case 'reasoning-delta':
        if (!state.reasoningOpen) {
          state.reasoningOpen = true
          sse.send({ type: 'REASONING_MESSAGE_START', messageId: `${state.messageId}-reasoning`, role: 'reasoning' })
        }
        sse.send({ type: 'REASONING_MESSAGE_CONTENT', messageId: `${state.messageId}-reasoning`, delta: chunk.text })
        return
      case 'text-delta':
        if (state.reasoningOpen) {
          state.reasoningOpen = false
          sse.send({ type: 'REASONING_MESSAGE_END', messageId: `${state.messageId}-reasoning` })
        }
        if (!state.textOpen) {
          state.textOpen = true
          sse.send({ type: 'TEXT_MESSAGE_START', messageId: state.messageId, role: 'assistant' })
        }
        sse.send({ type: 'TEXT_MESSAGE_CONTENT', messageId: state.messageId, delta: chunk.text })
        return
      case 'tool-call-delta':
        if (!state.toolCalls.has(chunk.index)) {
          state.toolCalls.set(chunk.index, chunk.id)
          sse.send({ type: 'TOOL_CALL_START', toolCallId: chunk.id, toolCallName: chunk.name ?? '', parentMessageId: state.messageId })
        }
        if (chunk.argumentsDelta !== '') sse.send({ type: 'TOOL_CALL_ARGS', toolCallId: chunk.id, delta: chunk.argumentsDelta })
        return
      case 'block-end':
        if (chunk.block.type === 'tool-call') {
          const started = state.toolCalls.get(chunk.index)
          if (started === undefined) {
            state.toolCalls.set(chunk.index, chunk.block.id)
            sse.send({ type: 'TOOL_CALL_START', toolCallId: chunk.block.id, toolCallName: chunk.block.name, parentMessageId: state.messageId })
            sse.send({ type: 'TOOL_CALL_ARGS', toolCallId: chunk.block.id, delta: chunk.block.arguments })
          }
          sse.send({ type: 'TOOL_CALL_END', toolCallId: chunk.block.id })
        } else if (chunk.block.type === 'text' && state.textOpen) {
          state.textOpen = false
          sse.send({ type: 'TEXT_MESSAGE_END', messageId: state.messageId })
        } else if (chunk.block.type === 'reasoning' && state.reasoningOpen) {
          state.reasoningOpen = false
          sse.send({ type: 'REASONING_MESSAGE_END', messageId: `${state.messageId}-reasoning` })
        }
        return
      default:
        return
    }
  }

  disposers.push(ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject !== agent) return
    if (frame.type === 'start') {
      closeAttempt()
      attempt = { messageId: `${run.runId}-${String(frame.turn)}-${String(frame.step)}`, reasoningOpen: false, textOpen: false, toolCalls: new Map() }
      return
    }
    if (frame.type === 'end') {
      closeAttempt()
      return
    }
    if (attempt !== undefined) onChunk(attempt, frame.chunk)
  }))

  disposers.push(ctx.on('agent/inbox/claimed', ({ agent: subject, message: claimed, turn: claimedTurn }) => {
    if (subject === agent && claimed.id === message.id) turn = claimedTurn
  }))

  // A cancel or archive can clear the inbox before a busy Agent claims this
  // message; no turn will ever start for it, so the run ends as aborted.
  disposers.push(ctx.on('agent/inbox/discarded', ({ agent: subject, message: dropped }) => {
    if (subject === agent && dropped.id === message.id && turn === undefined) {
      finished.resolve({ kind: 'aborted', reason: { kind: 'user' } })
    }
  }))
  disposers.push(ctx.on('agent/disposed', ({ agent: subject }) => {
    if (subject === agent) finished.resolve({ kind: 'aborted', reason: { kind: 'disposed' } })
  }))

  disposers.push(ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'tool/result') {
      const result = event.data.message
      sse.send({
        type: 'TOOL_CALL_RESULT',
        messageId: result.id,
        toolCallId: result.toolCallId,
        content: textOf(result.content),
        role: 'tool',
      })
    } else if (event.type === 'turn/end' && turn !== undefined && event.data.turn === turn) {
      finished.resolve(event.data.reason)
    }
  }))

  disposers.push(ctx.on('agent/error', ({ agent: subject, turn: failedTurn, error }) => {
    if (subject !== agent || (turn !== undefined && failedTurn !== turn)) return
    finished.resolve({ kind: 'error', error: { message: error instanceof Error ? error.message : String(error), code: 'AGENT_ERROR' } })
  }))

  // Subagent events are process-wide; follow only runs this thread's agent delegated.
  // An out-of-process child has no Session, so the delegating parent identifies it.
  const children = new Set<string>()
  disposers.push(ctx.on('subagent/start', function (info) {
    if (carrierKeyOf(this) !== agent && ctx.sessions.get(info.id)?.header.parentSession !== agent.session.id) return
    children.add(info.runId)
    sse.send({ type: 'SUBAGENT_STARTED', subagentRunId: info.runId, name: info.provider })
  }))
  disposers.push(ctx.on('subagent/activity', (info) => {
    if (!children.has(info.runId)) return
    sse.send({ type: 'CUSTOM', name: CUSTOM_SUBAGENT_ACTIVITY, value: { subagentRunId: info.runId, kind: info.kind, phase: info.phase } })
  }))
  disposers.push(ctx.on('subagent/end', (info) => {
    if (!children.delete(info.runId)) return
    const event: AguiEvent = info.stopReason === 'error'
      ? { type: 'SUBAGENT_ERROR', subagentRunId: info.runId, message: 'subagent failed' }
      : { type: 'SUBAGENT_FINISHED', subagentRunId: info.runId, outcome: { type: info.stopReason === 'completed' ? 'success' : 'suspended' } }
    sse.send(event)
  }))

  try {
    sse.send({ type: 'RUN_STARTED', ...base })
    agent.followup(message)
    const reason = await finished.promise
    closeAttempt()
    if (reason?.kind === 'error') {
      sse.send({ type: 'RUN_ERROR', message: reason.error.message, code: reason.error.code })
    } else {
      sse.send({
        type: 'RUN_FINISHED',
        ...base,
        outcome: reason?.kind === 'completed' || reason === undefined
          ? { type: 'success' }
          : { type: 'interrupt', interrupt: { id: reason.kind, reason: reason.kind } },
      })
    }
  } finally {
    for (const dispose of disposers) dispose()
    await ctx.sessions.flush(agent.session).catch((error: unknown) => {
      ctx.logger.warn(`agui: session flush failed: ${String(error)}`)
    })
  }
}

/**
 * The session identity an AG-UI thread maps to: the thread id itself.
 * @param threadId - admitted thread identifier.
 * @returns The corresponding Session identifier.
 */
export function sessionIdOf(threadId: string): SessionId {
  return threadId as SessionId
}
