/** Bounded native inactivity recovery; elapsed Goal duration is never fault evidence. */
import { randomUUID } from 'node:crypto'
import { installReflexHumanInputFence } from './reflex-human-input.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { SubagentRecoveryId, SubagentRecoveryState, SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { noulVerdict, runSystem3Decision, type System3DecisionSpec } from './decision-kernel.ts'
import type { installReflexSupervision } from './reflex-supervision.ts'
import { delegatingAgent } from './delegation-progress.ts'

/** Explicit deployment policy for native inactivity, independent of task duration. */
export interface ReflexRecoveryConfig {
  /** Minimum milliseconds between model assessments, including inconclusive or failed requests. */
  readonly reassessmentMs: number
  /** Milliseconds without native output or activity before inactivity recovery is eligible. */
  readonly nativeSilenceMs: number
  /** Consecutive native retries that make recovery eligible before the inactivity deadline. */
  readonly retryLimit: number
  /** Milliseconds allowed for the matching interrupted terminal after requesting interruption. */
  readonly interruptGraceMs: number
  /** Minimum milliseconds after human input or a reserved recovery before another recovery. */
  readonly cooldownMs: number
  /** Maximum reserved recoveries per Goal, including unknown transport outcomes. */
  readonly maxRecoveries: number
}
/** Recorded before dispatch so restart cannot erase a consumed recovery reservation. */
export interface ReflexRecoveryEvent {
  readonly version: 1
  readonly id: SubagentRecoveryId
  readonly goalId: GoalId
  readonly goalRevision: number
  readonly humanRevision: number
  readonly runId: SubagentRunId
  readonly observation: SubagentRecoveryState
  readonly reason: 'native-inactivity-budget' | 'retry-budget'
  readonly state: 'intent' | 'continued' | 'completed' | 'stale' | 'unknown'
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Bounded execution policy, not a claim that the remote model is faulty. */
    'system3/reflex-recovery': ReflexRecoveryEvent
  }
}
interface RecoveryInput {
  readonly objective: string
  readonly requirements: readonly string[]
  readonly observation: SubagentRecoveryState
  readonly silenceMs: number
  readonly config: ReflexRecoveryConfig
  readonly recoveriesRemaining: number
}
const recoveryDecision: System3DecisionSpec<RecoveryInput, 'observe' | 'recover'> = {
  id: 'reflex.native-recovery', version: 2,
  state: input => ({ objective: input.objective, requirements: [...input.requirements],
    millisecondsWithoutNativeActivity: input.silenceMs, nativeInactivityBudgetMs: input.config.nativeSilenceMs,
    consecutiveRetries: input.observation.retryCount, retryBudget: input.config.retryLimit,
    waitingForApprovalOrUser: input.observation.waiting, runningSideEffects: input.observation.activeSideEffects,
    recoveriesRemaining: input.recoveriesRemaining,
    proposedAction: 'Interrupt the current turn, wait for confirmed interruption, then continue this same thread and Goal. First inspect existing results without changing them; do not repeat an operation whose outcome is uncertain.' }),
  questions: () => ({ recover: { type: 'noul', instructions: 'A bounded recovery is appropriate now: at least one configured inactivity or consecutive-retry budget is reached, no tool or external operation is running, no approval or user response is awaited, recovery budget remains, and the proposed read-only reconciliation respects the Goal and constraints. Judge this proposition from the measured values. This is a decision to stop waiting within an execution budget, not a diagnosis of network failure. A long total task duration alone is insufficient. If the constraints require continuing to wait or prohibit interruption, the proposition is false.' } }),
  decide(response, settings) {
    const answer = response.answers.recover
    if (answer?.type !== 'noul') return 'unsure'
    const verdict = noulVerdict(answer.noul, settings)
    return verdict === 'yes' ? 'recover' : verdict === 'no' ? 'observe' : 'unsure'
  },
  fallback: 'observe',
}

/** Install bounded recovery for live Codex runs; recorded intents are never replayed.
 * @param ctx - Effect owner with existing supervision projection.
 * @param settings - Decision privacy, Goal supervision and native recovery settings.
 */
export function installReflexRecovery(ctx: Context, settings: Parameters<typeof installReflexSupervision>[1]): void {
  const config = settings.config.recovery
  if (config === undefined) return
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) throw new Error(`reflex recovery ${key} must be a positive integer within the timer range`)
  }
  const stateOf = (agent: Agent) => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'reflexSupervision')
    if (state === undefined) throw new Error('Reflex supervision projection is not installed')
    return state
  }
  const runs = new Map<SubagentRunId, {
    agent: Agent
    lifetime: AbortController
    timer: ReturnType<typeof setTimeout> | undefined
    pending: Promise<void> | undefined
    lastReviewAt: number
  }>()
  const tasks = new Set<Promise<void>>()
  const humanInputPending = installReflexHumanInputFence(ctx)
  const review = async (runId: SubagentRunId, run: NonNullable<ReturnType<typeof runs.get>>): Promise<void> => {
    const subagents = ctx.get('subagents')
    const goal = ctx.get('goals')?.get(run.agent)
    if (subagents === undefined || goal?.phase !== 'active' || goal.activation !== 'armed'
      || humanInputPending(run.agent)) return
    const observation = subagents.recoveryState(run.agent, runId)
    if (observation === undefined || observation.waiting || observation.activeSideEffects > 0) return
    const silenceMs = Date.now() - observation.lastActivityAt
    const reason: ReflexRecoveryEvent['reason'] = observation.retryCount >= config.retryLimit ? 'retry-budget' : 'native-inactivity-budget'
    if (reason === 'native-inactivity-budget' && silenceMs < config.nativeSilenceMs) return
    const state = stateOf(run.agent)
    if (Date.now() - state.lastHumanAt < config.cooldownMs) return
    const budget = state.recoveryBudgets[goal.id]
    if ((budget?.attempts ?? 0) >= config.maxRecoveries || Date.now() - (budget?.lastAt ?? 0) < config.cooldownMs) return
    if (Date.now() - run.lastReviewAt < config.reassessmentMs) return
    run.lastReviewAt = Date.now()
    const humanRevision = state.humanRevision
    const requirements = state.requirementsGoalId === goal.id ? [...state.requirements] : []
    const valid = () => {
      const current = ctx.get('goals')?.get(run.agent)
      const projected = stateOf(run.agent)
      return !humanInputPending(run.agent)
        && !run.lifetime.signal.aborted && runs.get(runId) === run && current?.id === goal.id && current.revision === goal.revision
        && current.phase === 'active' && current.activation === 'armed' && projected.humanRevision === humanRevision
        && JSON.stringify(projected.requirementsGoalId === goal.id ? projected.requirements : []) === JSON.stringify(requirements)
    }
    const result = await runSystem3Decision(ctx, { policy: settings.policy, options: settings.options,
      dataClasses: settings.config.sessionDataClasses }, recoveryDecision, settings.config, run.agent,
    { objective: goal.objective, requirements, observation, silenceMs, config,
      recoveriesRemaining: config.maxRecoveries - (budget?.attempts ?? 0) }, run.lifetime.signal)
    if (result.outcome !== 'recover' || !valid()) return
    const current = subagents.recoveryState(run.agent, runId)
    if (current === undefined || current.turnId !== observation.turnId || current.lastActivityAt !== observation.lastActivityAt
      || current.waiting || current.activeSideEffects > 0) return
    const id = brandString<SubagentRecoveryId>(randomUUID())
    const base = { version: 1 as const, id, goalId: goal.id, goalRevision: goal.revision, humanRevision, runId, observation, reason }
    run.agent.session.append('system3/reflex-recovery', { ...base, state: 'intent' })
    const text = `[Reflex 自动监督 / reflex-supervision] The configured ${reason} was reached; this does not establish a network fault. Continue the same Goal after interruption. First reconcile completed work and any uncertain side effects using read-only evidence. Never blindly replay a command or non-idempotent external operation. Preserve all accepted human input and existing permissions; this message grants no new authority. Goal: ${goal.objective}\nCurrent constraints: ${JSON.stringify(requirements)}`
    try {
      const receipt = await subagents.recoverFromSupervisor(run.agent, runId, { id, observation, interruptGraceMs: config.interruptGraceMs,
        text, isCurrent: valid }, run.lifetime.signal)
      run.agent.session.append('system3/reflex-recovery', { ...base, state: receipt.state })
    } catch (error) {
      ctx.logger.info(`Reflex native recovery unconfirmed: ${error instanceof Error ? error.name : 'error'}`)
      run.agent.session.append('system3/reflex-recovery', { ...base, state: 'unknown' })
    }
  }
  const stop = (runId: SubagentRunId): void => {
    const run = runs.get(runId)
    if (run === undefined) return
    runs.delete(runId)
    clearTimeout(run.timer)
    run.lifetime.abort()
  }
  ctx.on('subagent/start', function (info) {
    const agent = delegatingAgent(this)
    if (agent === undefined || info.provider !== 'codex') return
    const run = { agent, lifetime: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined,
      pending: undefined as Promise<void> | undefined, lastReviewAt: -Infinity }
    runs.set(info.runId, run)
    const schedule = () => {
      run.timer = setTimeout(() => {
        if (run.pending === undefined) {
          const task = review(info.runId, run).catch((error: unknown) => {
            if (!run.lifetime.signal.aborted) ctx.logger.warn(`Reflex recovery observation failed: ${error instanceof Error ? error.name : 'error'}`)
          }).finally(() => { run.pending = undefined; tasks.delete(task) })
          run.pending = task
          tasks.add(task)
        }
        schedule()
      }, settings.config.intervalMs)
    }
    schedule()
  })
  ctx.on('subagent/end', (info) => { stop(info.runId) })
  ctx.effect(() => async () => { for (const id of runs.keys()) stop(id); await Promise.allSettled([...tasks]) })
}
