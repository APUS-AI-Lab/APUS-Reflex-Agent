/**
 * Lifecycle-edge publication for both subagent shapes: the contained emitter,
 * the one-shot run observer, and the continuable Activation observer.
 *
 * The public payload contracts ({@link SubagentRunInfo},
 * {@link SubagentRunEndInfo}) live in `./types.ts` with the rest of the seam's
 * consumer-facing types; this module owns only the implementation and the
 * package-private {@link ActivationObserver} the continuation manager consumes.
 * Keeping the internal control interface out of the published surface is
 * deliberate: the observer's `start`/`capture`/`settle` ordering is a contract
 * between this module and one in-package caller, not something a plugin may
 * depend on.
 *
 * @module @deepseek-ai/dsh-subagent/lifecycle
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SubagentSupervisorStaleError } from './recovery.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId, SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import { finalAssistantOutput } from './assistant-output.ts'
import { SubagentRunId } from './types.ts'
import type {
  SubagentEvidence, SubagentEvidenceInfo, SubagentActivity, SubagentActivityInfo,
  SubagentResult, SubagentRun, SubagentRunEndInfo, SubagentRunInfo,
} from './types.ts'

/**
 * How one Activation's residency epoch ended, as both the terminal lifecycle
 * edge and the manager's own parent delivery report it.
 */
export interface ActivationTerminal {
  /** Why this epoch's last ordinary turn ended, or `error` when teardown failed. */
  readonly stopReason: SubagentResult['stopReason']
  /** The epoch's final assistant content, absent when it produced none or failed. */
  readonly output?: readonly ContentBlock[]
}

/**
 * Lifecycle observer for one Activation's residency epoch, so continuable
 * children emit the same start/end pair as one-shot runs. Package-private: the
 * continuation manager is the only consumer, and its call ordering is an
 * in-package contract rather than a published extension point.
 */
export interface ActivationObserver {
  /**
   * Publish the start edge once the epoch is resident.
   * @param child - the resident child agent, whose log suffix bounds this epoch.
   */
  start(child: Agent): void
  /**
   * Snapshot the child-dependent terminal facts while the child is still
   * registered, because handle disposal unregisters it and consumers resolve it
   * to read the child's own log and scope.
   * @param child - the quiescent child agent about to be released.
   */
  capture(child: Agent): void
  /**
   * Resolve the terminal facts {@link settle} will publish, without publishing
   * them. The manager's parent delivery must run before the ownership release
   * that lets the parent settle, which is earlier than the terminal edge; both
   * therefore read one computation instead of restating the failure rule.
   * @param failure - the teardown or durability failure, or `undefined` on success.
   * @returns this epoch's stop reason and final assistant content.
   */
  terminal(failure: unknown): ActivationTerminal
  /**
   * Publish the terminal edge exactly once, pairing this epoch's {@link start},
   * after the disposal outcome is known. Called only for a resident epoch: a
   * failure before residency publishes no edge, because inventing one would
   * report a lifecycle the child never had.
   * @param failure - the teardown or durability failure, or `undefined` on success.
   */
  settle(failure: unknown): void
}

/**
 * Publish one lifecycle edge with per-listener exception containment. Run edges
 * carry the delegating parent that keys scoped dispatch; provider removal has no
 * parent carrier and reaches listeners unscoped.
 *
 * The service owns this closure because scoped dispatch keys its carrier by the
 * exact service instance, whose own context filter composes into the carrier;
 * a narrowed stand-in would silently change scope filtering.
 */
export type LifecycleEmitter = {
  (name: 'subagent/start', info: SubagentRunInfo, parent: Agent): void
  (name: 'subagent/end', info: SubagentRunEndInfo, parent: Agent): void
  (name: 'subagent/activity', info: SubagentActivityInfo, parent: Agent): void
  (name: 'subagent/evidence', info: SubagentEvidenceInfo, parent: Agent): void
  (name: 'subagent/provider-removed', info: string): void
}

/**
 * Build the contained lifecycle emitter this seam publishes every edge through.
 * Every listener is independently contained: a synchronous throw or a rejected
 * returned promise is logged without starving peer listeners, changing the run,
 * or — for provider removal, which fires from a disposer — breaking teardown.
 * @param ctx - the service's own context, owning dispatch and the logger.
 * @param carrier - resolve the scoped dispatch carrier for one delegating parent.
 * @returns the emitter both observers and the provider registry publish through.
 */
export function createLifecycleEmitter(
  ctx: Context,
  carrier: (parent: Agent) => object,
): LifecycleEmitter {
  return (
    name: 'subagent/start' | 'subagent/end' | 'subagent/activity' | 'subagent/evidence' | 'subagent/provider-removed',
    info: SubagentRunInfo | SubagentRunEndInfo | SubagentActivityInfo | SubagentEvidenceInfo | string,
    parent?: Agent,
  ): void => {
    const dispatchArgs: unknown[] = parent === undefined
      ? [name, info]
      : [carrier(parent), name, info]
    for (const callback of ctx.events.dispatch('emit', dispatchArgs)) {
      try {
        const returned: unknown = callback(info)
        void Promise.resolve(returned).catch((error: unknown) => {
          ctx.logger.warn(`subagent: ${name} listener rejected: ${renderThrown(error)}`)
        })
      } catch (error: unknown) {
        ctx.logger.warn(`subagent: ${name} listener threw: ${renderThrown(error)}`)
      }
    }
  }
}

/** One live one-shot run offering input or native recovery, registered from start until its end edge. */
export interface SteerableRun {
  /** Provider that established the run. */
  readonly provider: string
  /** The delegating parent whose Session owns the run. */
  readonly parent: Agent
  /** The run's own input delivery. */
  readonly steer: ((content: readonly ContentBlock[], signal: AbortSignal, isCurrent?: () => boolean) => Promise<void>) | undefined
  /** Texts the child accepted, in order; reported on the run's result. */
  readonly accepted: string[]
  /** Human admission invalidates older autonomous recovery proposals. */
  humanRevision: number
  readonly recoveryState: SubagentRun['recoveryState']
  readonly recover: SubagentRun['recover']
}

/** Upper bound, in UTF-16 code units, of a published activity note; longer notes are cut with an ellipsis. */
export const SUBAGENT_ACTIVITY_NOTE_MAX_CHARS = 200

/**
 * Emit the start/end lifecycle pair for one accepted one-shot run.
 * @param emit - the contained lifecycle emitter.
 * @param provider - the provider that established the run.
 * @param parent - the delegating parent keying scoped dispatch.
 * @param run - the published run whose settlement closes the pair.
 * @param bindActivity - receives the publisher for this run's steps once start has been emitted.
 * @param steerable - live runs accepting input; a run with `steer` is held here between its start and end edges.
 * @param bindEvidence - optional publisher binding for content-free execution evidence.
 * @returns the published run, whose result also lists the steers the child accepted.
 */
export function observeRun(
  emit: LifecycleEmitter,
  provider: string,
  parent: Agent,
  run: SubagentRun,
  bindActivity: (publish: (activity: SubagentActivity) => void) => void,
  steerable: Map<SubagentRunId, SteerableRun>,
  bindEvidence?: (publish: (evidence: SubagentEvidence) => void) => void,
): SubagentRun {
  let controls: Promise<unknown> = Promise.resolve()
  const ordered = <T>(action: () => Promise<T>): Promise<T> => {
    const next = controls.then(action, action)
    controls = next.catch(() => undefined)
    return next
  }
  const deliver = run.steer?.bind(run)
  const recoverNative = run.recover?.bind(run)
  const steer: SteerableRun['steer'] = deliver === undefined ? undefined
    : (content, signal, isCurrent) => ordered(() => {
      signal.throwIfAborted()
      if (isCurrent !== undefined && !isCurrent()) throw new SubagentSupervisorStaleError('subagent: supervisor input became stale before dispatch')
      return deliver(content, signal)
    })
  const recover: SubagentRun['recover'] = recoverNative === undefined ? undefined
    : (request, signal) => ordered(() => recoverNative(request, signal))
  const recoveryState = run.recoveryState?.bind(run)
  const accepted: string[] = []
  const identity = {
    runId: SubagentRunId(randomUUID()),
    provider,
    id: run.id,
    local: run.localAgent !== undefined,
    steerable: steer !== undefined,
  }
  let settled = false
  // Attach the terminal observer before dispatching start. Promise reactions
  // still run after this synchronous start emission, preserving start → end.
  void run.result.then(
    (result) => {
      settled = true
      steerable.delete(identity.runId)
      emit('subagent/end', {
        ...identity,
        stopReason: result.stopReason,
        // Omit the field when no output exists, matching continuable epochs.
        ...result.output.length === 0 ? {} : { lastAssistantMessage: result.output },
      }, parent)
    },
    () => {
      settled = true
      steerable.delete(identity.runId)
      emit('subagent/end', { ...identity, stopReason: 'error' }, parent)
    },
  )
  if (steer !== undefined || recover !== undefined) {
    steerable.set(identity.runId, { provider, parent, steer, accepted, humanRevision: 0, recover, recoveryState })
  }
  emit('subagent/start', identity, parent)
  bindActivity((activity) => {
    if (settled) return
    const note = activity.note?.trim()
    emit('subagent/activity', {
      runId: identity.runId, provider, id: run.id, kind: activity.kind, phase: activity.phase,
      ...activity.outcome === undefined ? {} : { outcome: activity.outcome },
      ...note === undefined || note === '' ? {} : { note: note.length <= SUBAGENT_ACTIVITY_NOTE_MAX_CHARS
        ? note : `${note.slice(0, SUBAGENT_ACTIVITY_NOTE_MAX_CHARS - 1)}…` },
    }, parent)
  })
  bindEvidence?.((evidence) => {
    if (!settled) emit('subagent/evidence', { ...evidence, runId: identity.runId, provider, id: run.id }, parent)
  })
  // The holder reads steers from the result, so the parent model can check the output against them.
  const result = run.result.then(value => accepted.length === 0 ? value : { ...value, steers: [...accepted] })
  return {
    id: run.id, localAgent: run.localAgent, result, dispose: () => run.dispose(),
    ...steer === undefined ? {} : { steer },
    ...recover === undefined ? {} : { recover },
    ...recoveryState === undefined ? {} : { recoveryState },
  }
}

/**
 * Build the observer for one continuable Activation's residency epoch. Observers
 * see the same vocabulary as a one-shot run, so a child's start and settlement
 * remain observable without exposing whether the manager materialized, woke, or
 * cold-resumed it. Creation failure before residency emits no lifecycle edge.
 * @param emit - the contained lifecycle emitter.
 * @param provider - the provider name recorded in the durable descriptor.
 * @param childId - the durable child session id.
 * @param parent - the exact live direct parent keying scoped dispatch.
 * @returns the observer whose edges this epoch publishes.
 */
export function createActivationObserver(
  emit: LifecycleEmitter,
  provider: string,
  childId: SessionId,
  parent: Agent,
): ActivationObserver {
  const identity = { runId: SubagentRunId(randomUUID()), provider, id: childId, local: true, steerable: false }
  // A cold resume replays earlier turns, so this epoch's telemetry must come
  // from the suffix it actually produced — never the whole session, which
  // would report a previous epoch's answer when this one opened no turn.
  let boundary: SessionLogOffsetType = SessionLogOffset(0)
  // Assigned by `capture()`, which the disposal path always runs before
  // `settle()`; a resident epoch therefore always has its facts by then.
  let captured: ActivationTerminal = { stopReason: 'completed' }
  // Teardown failure overrides the epoch's own outcome and withholds its
  // output: an answer this harness could not durably release is not a result.
  const terminal = (failure: unknown): ActivationTerminal => failure === undefined
    ? captured
    : { stopReason: 'error' }
  return {
    start: (child: Agent): void => {
      boundary = child.session.seq
      emit('subagent/start', identity, parent)
    },
    capture: (child: Agent): void => {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const own = child.session.snapshotEvents(boundary)
      const output = finalAssistantOutput(own)
      captured = {
        stopReason: epochStopReason(own),
        ...output === undefined ? {} : { output },
      }
    },
    terminal,
    settle: (failure: unknown): void => {
      const { stopReason, output } = terminal(failure)
      emit('subagent/end', {
        ...identity,
        stopReason,
        ...output === undefined ? {} : { lastAssistantMessage: output },
      }, parent)
    },
  }
}

/**
 * Why this child's epoch ended, for the terminal lifecycle edge and the
 * manager's own parent delivery. The child's own log is authoritative:
 * teardown succeeding says nothing about whether the model errored, hit its
 * token ceiling, or was cancelled, so deriving the reason from disposal would
 * report failed work as completed.
 *
 * {@link foldConsumedWork} supplies both halves the raw turn sequence cannot:
 * which turn accounts for the work this epoch consumed, and whether accepted
 * work was cancelled after it without any turn opening over it. A recorded
 * failure still wins over a cancellation — stopping a child that had already
 * failed does not turn its failure into a cancellation.
 * @param events - this epoch's own event suffix.
 * @returns its terminal stop reason; `completed` only for an epoch that both
 *   closed cleanly and had nothing left to run.
 */
function epochStopReason(events: readonly SessionEvent[]): SubagentResult['stopReason'] {
  const { end, droppedUnrun } = foldConsumedWork(events)
  switch (end?.data.reason.kind) {
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
    case 'interrupted':
      return 'aborted'
    case 'error':
      return 'error'
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // this epoch had claimed: the work was declined, not done.
    case 'blocked':
      return 'refusal'
    // A clean ending and no accounting turn at all share one rule: the epoch
    // finished what it was given unless a cancelled queue says otherwise.
    case undefined:
    case 'completed':
      return droppedUnrun ? 'aborted' : 'completed'
    /* v8 ignore next 4 -- `forked` appears only in constructor seed history, while
     * this function reads an epoch-owned suffix. `TurnEndReason` is merge-extensible,
     * so a backend-added variant cannot be listed; treating an unnameable reason as
     * success would report failed work as completed. */
    default:
      return 'error'
  }
}

/** Render any listener-thrown value without letting coercion escape containment. */
function renderThrown(value: unknown): string {
  try {
    return value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  } catch {
    return '<unrenderable thrown value>'
  }
}
