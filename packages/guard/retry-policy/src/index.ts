/**
 * Opt-in tool-call retry policy. A tool declares `retry` in its definition and
 * this `tools/execute` wrapper retries that call on failure, recording one
 * `tool/retry-started` fact per retried attempt. Tools that declare no budget
 * are delegated unchanged, so the default composition keeps today's
 * single-attempt behavior.
 *
 * Retrying a tool body has side effects, so the budget is a per-tool declaration
 * rather than a deployment-wide default: only a tool whose author asserts the
 * body is replayable opts in. A call cancelled by the caller is never retried —
 * cancellation is a caller decision, not a transient tool failure.
 *
 * @module @deepseek-ai/dsh-tool-call-retry-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-session/types'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'

/**
 * Attempts recorded on one `tool/retry-started` record. The wrapper appends the
 * record immediately before dispatching an attempt that is not the first, so a
 * hard interrupt still leaves every started retry behind.
 */
export interface ToolRetryStartedEventData {
  /** The call this record describes; pairs it with `tool/call` and `tool/result`. */
  callId: ToolCallId
  /** The declared tool name, so a consumer need not join the definition back in. */
  toolName: string
  /** The attempt about to start; `2` is the first retry, never `1`. */
  attempt: number
  /** The declared total attempt budget, including the original attempt. */
  maxAttempts: number
  /** Backoff slept before this attempt started, in milliseconds; `0` for the first retry when no delay is declared. */
  backoffMs: number
  /** Error code of the attempt that this retry follows, or `null` when it produced no structured code. */
  priorErrorCode: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One retried tool attempt about to start. Appended by the `tools/execute`
     * wrapper immediately before dispatching a non-first attempt, and only when
     * the call has an owning Agent. Log-only: `deriveMessages()` ignores it.
     */
    'tool/retry-started': ToolRetryStartedEventData
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'retry-policy'

/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export const inject = ['tools']

/** Codes that mean the caller cancelled, never a retryable tool failure. */
const CANCELLATION_CODES: ReadonlySet<string> = new Set([TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH])

/**
 * Read one failed attempt's structured error code.
 * @param result - the settled dispatch outcome.
 * @returns the code, or `null` when the failure carried none.
 */
function errorCodeOf(result: ToolExecutionResult): string | null {
  return result.isError ? (result.error.info?.code ?? null) : null
}

/**
 * Whether one settled attempt is worth retrying.
 *
 * A success is final. A caller cancellation is final — the caller chose to stop,
 * and retrying would ignore `exec.signal`. Any other failure is retryable: the
 * declared budget is the tool author's assertion that the body can be replayed.
 * @param result - the settled dispatch outcome.
 * @param signal - the caller's own signal, inspected for cancellation.
 * @returns whether another attempt may start.
 */
function shouldRetry(result: ToolExecutionResult, signal: AbortSignal): boolean {
  if (!result.isError) return false
  if (signal.aborted) return false
  const code = errorCodeOf(result)
  return code === null || !CANCELLATION_CODES.has(code)
}

/**
 * Sleep the declared backoff, waking early on caller cancellation.
 * @param ms - the delay; `0` resolves on the next microtask.
 * @param signal - the caller's own signal.
 */
async function backoff(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    /** Settle once: the timer and the abort listener both reach here. */
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
  })
}

/**
 * Append the log-only retry record for one attempt about to start. Recording is
 * observational: a rejected append must not abort the retry.
 * @param exec - the dispatch whose owning Agent owns the record.
 * @param data - the settled fact for this retry.
 */
function recordRetryStarted(exec: ToolDispatchExecution, data: ToolRetryStartedEventData): void {
  try {
    exec.agent?.session.append('tool/retry-started', data)
  } catch (error: unknown) {
    // The record is diagnostic only; its rejection must not become the tool result.
    void error
  }
}

/**
 * Register the retry wrapper. It reads the resolved definition's declared
 * budget, delegates the first attempt, and retries failed attempts until the
 * budget is spent or the caller cancels.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const budget = ctx.tools.get(exec.name, exec.agent)?.retry
    // A tool that declares no budget: one attempt, no wrapper behavior.
    if (budget === undefined) return next()

    const upstream = exec.signal
    const maxAttempts = budget.maxAttempts
    const backoffMs = budget.backoffMs ?? 0
    let attempt = 1
    let result = await next()
    while (attempt < maxAttempts && shouldRetry(result, upstream)) {
      await backoff(backoffMs, upstream)
      // The wait may have consumed the caller's cancellation; a cancelled call
      // stops here and keeps the last real outcome.
      if (upstream.aborted) break
      attempt += 1
      recordRetryStarted(exec, {
        callId: exec.callId,
        toolName: exec.name,
        attempt,
        maxAttempts,
        backoffMs,
        priorErrorCode: errorCodeOf(result),
      })
      result = await next()
    }
    return result
  })
}
