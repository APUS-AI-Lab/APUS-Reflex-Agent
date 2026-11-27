/**
 * Cooperative tool-call timeout enforcer. A tool declares `timeoutMs` and
 * promises to honor `exec.signal`; this wrapper arms that deadline and maps its
 * own expiry to `TOOL_TIMEOUT` without racing or abandoning the tool promise.
 *
 * FIXME: settle the intended `@deepseek-ai/dsh-timeout-guard` rename before the
 * first tagged release — suggestion only, aligning the name with its `guard/`
 * home; decide at resolution time
 * ([regrouping Agent Note](../../../../.agents/notes/archived/architecture/2026-07-29-package-regrouping.md)).
 *
 * @module @deepseek-ai/dsh-tool-call-timeout-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-session/types'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/**
 * The code owned by this plugin, used BOTH as the internal {@link deadline}
 * classification code AND as the structured error `code` on the replacement
 * tool result. Scoping {@link timeoutOf} to it keeps a nested outer deadline
 * (another `tools/execute` wrapper's timer that fired first) from being misread
 * as this plugin's own timeout — it reads as an ordinary upstream cancel.
 */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/** Which cancellation source aborted the fused deadline signal by settlement. */
export type ToolExecuteDeadlineAbortSource = 'self-timer' | 'upstream' | 'none'

/**
 * Deadline facts for one tool call whose definition declared a timeout budget.
 * The wrapper that arms the deadline is the only place these exist: after it
 * restores the caller signal, whether it replaced that signal and which source
 * aborted it are no longer observable from outside.
 */
export interface ToolExecuteDeadlineEventData {
  /** The call this record describes; pairs it with `tool/call` and `tool/result`. */
  callId: ToolCallId
  /** The budget read from the tool definition and armed for this dispatch. */
  timeoutMs: number
  /** Wall-clock milliseconds from arming the deadline to this wrapper returning its result. */
  elapsedMs: number
  /** Whether dispatch received the fused deadline signal instead of the caller's own signal. */
  signalReplaced: boolean
  /** Which source aborted the fused signal, or `none` when neither had aborted by settlement. */
  abortSource: ToolExecuteDeadlineAbortSource
  /** Whether this wrapper's own timer fired, selecting the `TOOL_TIMEOUT` result. */
  selfTimerWon: boolean
  /** Error code on the result this wrapper returned, or `null` when it returned a success. */
  finalErrorCode: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Deadline facts for one settled tool call whose definition declared a
     * `timeoutMs` budget. Appended by the `tools/execute` wrapper after
     * `next()` settles and before it returns, and only when the call has an
     * owning Agent. `signalReplaced` and `abortSource` exist only here: the
     * wrapper restores the caller signal before returning, and a fused-signal
     * abort reads the same whether the timer or the caller caused it. Log-only:
     * `deriveMessages()` ignores it.
     */
    'tool/execute-deadline': ToolExecuteDeadlineEventData
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'timeout-policy'

/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export const inject = ['tools']

/**
 * The structured result substituted when this plugin's deadline wins. `content`
 * is the model-facing message; `error.code` is the same {@link TOOL_TIMEOUT}
 * this plugin owns, so a retry/sandbox plugin (and replay) can route on it.
 *
 * @param timeoutMs - the elapsed budget, rendered into the model-facing message.
 * @returns the `isError` {@link ToolExecutionResult} with a `TOOL_TIMEOUT` error.
 */
function toolTimeoutResult(timeoutMs: number): ToolExecutionResult {
  const message = `tool call timed out after ${timeoutMs}ms`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'ToolTimeoutError', code: TOOL_TIMEOUT } },
  }
}

/**
 * Register the timeout wrapper. It resolves the caller-visible tool definition,
 * temporarily replaces `exec.signal`, delegates, restores the upstream signal,
 * and replaces the result only when this wrapper's own timer fired.
 */
/**
 * Append the log-only deadline record for one settled dispatch. Recording is
 * observational: a rejected append must not replace the tool outcome.
 * @param exec - the dispatch whose owning Agent owns the record.
 * @param data - the settled deadline facts.
 */
function recordDeadline(exec: ToolDispatchExecution, data: ToolExecuteDeadlineEventData): void {
  try {
    exec.agent?.session.append('tool/execute-deadline', data)
  } catch (error: unknown) {
    // The record is diagnostic only; its rejection must not become the tool result.
    void error
  }
}

export function apply(ctx: Context): void {
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const timeoutMs = ctx.tools.get(exec.name, exec.agent)?.timeoutMs
    // A tool that declares no budget: no deadline, delegate unchanged.
    if (timeoutMs === undefined) return next()

    using d = deadline(exec.signal, timeoutMs, TOOL_TIMEOUT)
    // Swap the derived deadline onto exec for dispatch, then restore the
    // caller's own signal so post-execute listeners never see this plugin's
    // (possibly already-aborted) timeout signal.
    const startedAt = Date.now()
    const upstream = exec.signal
    const signalReplaced = d.signal !== upstream
    exec.signal = d.signal
    try {
      const result = await next()
      // If OUR timer fired (scoped by code — a nested outer deadline reads as
      // undefined here), the tool/capability saw the abort and reached
      // quiescence; replace whatever it returned (its own abort result) with the
      // structured TOOL_TIMEOUT the model sees.
      const selfTimerWon = timeoutOf(d.signal, TOOL_TIMEOUT) !== undefined
      const final = selfTimerWon ? toolTimeoutResult(timeoutMs) : result
      recordDeadline(exec, {
        callId: exec.callId,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        signalReplaced,
        abortSource: selfTimerWon ? 'self-timer' : d.signal.aborted ? 'upstream' : 'none',
        selfTimerWon,
        finalErrorCode: final.isError ? (final.error.info?.code ?? null) : null,
      })
      return final
    } finally {
      exec.signal = upstream
    }
  })
}
