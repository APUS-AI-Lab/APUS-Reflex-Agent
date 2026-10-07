/** Throttled, content-free progress snapshots of subagent runs, persisted in the delegating parent's Session. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type { SubagentActivityInfo, SubagentActivityKind, SubagentRunEndInfo, SubagentRunInfo, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Thresholds after which a running delegation is reported to the person as needing attention. */
export interface System3DelegationMonitorConfig {
  /** Run time after which an overtime alert is written, again at every further multiple. */
  readonly overtimeMs: number
  /** Time without a new step, after the first step, before a stalled alert is written. */
  readonly stallMs: number
  /** Time without any step after start before a starting alert is written. */
  readonly startupMs: number
}

/** How often a running subagent's progress may be written to the parent Session, and when it needs attention. */
export interface System3DelegationProgressConfig {
  /** Minimum time between two running snapshots of one run; start and end are written at once. */
  readonly intervalMs: number
  /** Alert thresholds; omission writes no alerts. */
  readonly monitor?: System3DelegationMonitorConfig
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
  /** Milliseconds from start to the latest step, or null before the first step. */
  readonly lastStepAt?: number | null
  /** Latest short progress text the child wrote for a person, or null. Not model-visible. */
  readonly note?: string | null
  /** Whether the run accepts a person's mid-run input; absent in snapshots written before the field existed. */
  readonly steerable?: boolean
}

/** One alert that a delegated run needs the person's attention. */
export interface System3DelegationAlert {
  readonly version: 1
  readonly runId: string
  readonly provider: string
  /** `overtime`: run time passed a multiple of the threshold; `stalled`: no new step; `starting`: no first step. */
  readonly kind: 'overtime' | 'stalled' | 'starting'
  /** Milliseconds from start when the alert was written. */
  readonly elapsedMs: number
  /** Milliseconds from start to the latest step at that moment, or null before the first step. */
  readonly lastStepAt: number | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Throttled progress of a subagent run this Session's Agent delegated: step categories, timing,
     * and the child's latest note; not model-visible.
     */
    'system3/delegation-progress': System3DelegationProgress
    /** A delegated subagent run exceeded a configured time or progress threshold; not model-visible. */
    'system3/delegation-alert': System3DelegationAlert
  }
}

interface RunState {
  readonly agent: Agent
  readonly runId: string
  readonly provider: string
  readonly startedAt: number
  readonly steerable: boolean
  readonly completed: Partial<Record<SubagentActivityKind, number>>
  current: SubagentActivityKind | null
  note: string | null
  lastStepAt: number | null
  lastWrite: number
  timer: ReturnType<typeof setTimeout> | undefined
  monitor: ReturnType<typeof setTimeout> | undefined
  overtimeAlerts: number
  stepAlerted: boolean
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
  const limits = { intervalMs: config.intervalMs, ...config.monitor }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
      throw new Error(`delegationProgress ${key} must be a positive integer within the timer range`)
    }
  }
  const monitor = config.monitor
  const runs = new Map<string, RunState>()
  const alert = (run: RunState, kind: System3DelegationAlert['kind']): void => {
    run.agent.session.append('system3/delegation-alert', {
      version: 1, runId: run.runId, provider: run.provider, kind, elapsedMs: Date.now() - run.startedAt, lastStepAt: run.lastStepAt,
    })
  }
  // One timer per run, armed for the earliest pending threshold and re-armed after each check or step.
  const watch = (run: RunState): void => {
    if (monitor === undefined) return
    clearTimeout(run.monitor)
    const overtimeAt = run.startedAt + monitor.overtimeMs * (run.overtimeAlerts + 1)
    const stepAt = run.stepAlerted ? Number.POSITIVE_INFINITY : run.lastStepAt === null
      ? run.startedAt + monitor.startupMs : run.startedAt + run.lastStepAt + monitor.stallMs
    const due = Math.min(overtimeAt, stepAt)
    run.monitor = setTimeout(() => {
      const now = Date.now()
      if (now >= overtimeAt) { run.overtimeAlerts += 1; alert(run, 'overtime') }
      if (now >= stepAt) { run.stepAlerted = true; alert(run, run.lastStepAt === null ? 'starting' : 'stalled') }
      watch(run)
    }, Math.max(0, due - Date.now()))
  }
  const write = (run: RunState, state: System3DelegationProgress['state']): void => {
    clearTimeout(run.timer)
    run.timer = undefined
    const now = Date.now()
    run.lastWrite = now
    run.agent.session.append('system3/delegation-progress', {
      version: 1, runId: run.runId, provider: run.provider, state, startedAt: run.startedAt,
      elapsedMs: now - run.startedAt, completed: { ...run.completed }, current: run.current,
      lastStepAt: run.lastStepAt, note: run.note, steerable: run.steerable,
    })
  }
  ctx.effect(() => () => {
    for (const run of runs.values()) { clearTimeout(run.timer); clearTimeout(run.monitor) }
    runs.clear()
  }, 'system3.delegationProgress()')
  ctx.on('subagent/start', function (info: SubagentRunInfo) {
    const agent = delegatingAgent(this)
    if (agent === undefined) return
    const run: RunState = { agent, runId: info.runId, provider: info.provider, startedAt: Date.now(), steerable: info.steerable,
      completed: {}, current: null, note: null, lastStepAt: null, lastWrite: 0, timer: undefined, monitor: undefined,
      overtimeAlerts: 0, stepAlerted: false }
    runs.set(info.runId, run)
    write(run, 'running')
    watch(run)
  })
  ctx.on('subagent/activity', (info: SubagentActivityInfo) => {
    const run = runs.get(info.runId)
    if (run === undefined) return
    run.lastStepAt = Date.now() - run.startedAt
    run.stepAlerted = false
    if (info.note !== undefined) run.note = info.note
    watch(run)
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
    clearTimeout(run.monitor)
    run.current = null
    write(run, info.stopReason)
  })
}
