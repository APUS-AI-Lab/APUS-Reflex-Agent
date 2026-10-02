/** Throttled, content-free progress snapshots of subagent runs, persisted in the delegating parent's Session. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type { SubagentActivityInfo, SubagentActivityKind, SubagentRunEndInfo, SubagentRunInfo, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** How often a running subagent's progress may be written to the parent Session. */
export interface System3DelegationProgressConfig {
  /** Minimum time between two running snapshots of one run; start and end are written at once. */
  readonly intervalMs: number
}

/** One progress snapshot of a subagent run; the latest snapshot per run supersedes earlier ones. */
export interface System3DelegationProgress {
  readonly version: 1
  /** Run identity shared with the live subagent lifecycle events. */
  readonly runId: string
  /** Subagent provider name, such as `codex`. */
  readonly provider: string
  /** `running` until the run settles, then its stop reason. */
  readonly state: 'running' | SubagentStopReason
  /** Host wall-clock milliseconds when the run started. */
  readonly startedAt: number
  /** Milliseconds from start to this snapshot. */
  readonly elapsedMs: number
  /** Completed steps per category; categories with none are omitted. */
  readonly completed: Partial<Record<SubagentActivityKind, number>>
  /** Category of the latest step that started and has not completed, or null. */
  readonly current: SubagentActivityKind | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Throttled progress of a subagent run delegated by this Session's Agent; carries step categories, never child content. */
    'system3/delegation-progress': System3DelegationProgress
  }
}

interface RunState {
  readonly agent: Agent
  readonly runId: string
  readonly provider: string
  readonly startedAt: number
  readonly completed: Partial<Record<SubagentActivityKind, number>>
  current: SubagentActivityKind | null
  lastWrite: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/** The carrier of subagent lifecycle events is the delegating parent Agent. */
function delegatingAgent(carrier: unknown): Agent | undefined {
  const key = carrierKeyOf(carrier)
  return key !== undefined && 'session' in key && 'id' in key ? key as Agent : undefined
}

/**
 * Persist start, throttled running, and end snapshots of every subagent run an Agent delegates.
 * @param ctx - Plugin context; pending snapshots are dropped when it is disposed.
 * @param config - Minimum interval between running snapshots, within the Node timer range.
 */
export function installSystem3DelegationProgress(ctx: Context, config: System3DelegationProgressConfig): void {
  if (!Number.isSafeInteger(config.intervalMs) || config.intervalMs <= 0 || config.intervalMs > MAX_TIMER_DELAY_MS) {
    throw new Error('delegationProgress intervalMs must be a positive integer within the timer range')
  }
  const runs = new Map<string, RunState>()
  const write = (run: RunState, state: System3DelegationProgress['state']): void => {
    clearTimeout(run.timer)
    run.timer = undefined
    const now = Date.now()
    run.lastWrite = now
    run.agent.session.append('system3/delegation-progress', {
      version: 1, runId: run.runId, provider: run.provider, state, startedAt: run.startedAt,
      elapsedMs: now - run.startedAt, completed: { ...run.completed }, current: run.current,
    })
  }
  ctx.effect(() => () => {
    for (const run of runs.values()) clearTimeout(run.timer)
    runs.clear()
  }, 'system3.delegationProgress()')
  ctx.on('subagent/start', function (info: SubagentRunInfo) {
    const agent = delegatingAgent(this)
    if (agent === undefined) return
    const run: RunState = { agent, runId: info.runId, provider: info.provider, startedAt: Date.now(),
      completed: {}, current: null, lastWrite: 0, timer: undefined }
    runs.set(info.runId, run)
    write(run, 'running')
  })
  ctx.on('subagent/activity', (info: SubagentActivityInfo) => {
    const run = runs.get(info.runId)
    if (run === undefined) return
    if (info.phase === 'started') run.current = info.kind
    else {
      run.completed[info.kind] = (run.completed[info.kind] ?? 0) + 1
      if (run.current === info.kind) run.current = null
    }
    if (run.timer !== undefined) return
    const wait = run.lastWrite + config.intervalMs - Date.now()
    if (wait <= 0) write(run, 'running')
    else run.timer = setTimeout(() => { write(run, 'running') }, wait)
  })
  ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
    const run = runs.get(info.runId)
    if (run === undefined) return
    runs.delete(info.runId)
    run.current = null
    write(run, info.stopReason)
  })
}
