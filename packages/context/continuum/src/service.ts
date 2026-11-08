import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-compaction'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionSeq, type Session, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { ContinuumMemoryController, resolveContinuumMemorySwitch, type ContinuumMemorySwitch } from './policy.ts'
import {
  appendMemoryIndexEvent, appendMemoryRecordEvent, appendMemoryWriteDecision, executionSourceFacts,
  foldMemoryRecordEvents, memorySourceText, type MemoryWriteDecisionEventData,
} from './persistence.ts'
import { MemoryId as createMemoryId, MemoryRecordStore, type MemoryId, type MemoryRecord, type NewMemoryRecord } from './records.ts'
import {
  installContinuumMemoryControllerContext,
  type ContinuumAdmissionCandidate,
  type ContinuumAdmittedMemory,
  type ContinuumMemoryContextConfig,
} from './context.ts'
import type { MemoryCandidatePool } from './retrieval.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-backed Continuum memory service and explicit lifecycle API. */
    continuumMemory: ContinuumMemoryService
  }
}

/** Profile settings accepted by direct service consumers before Loader normalization. */
export interface ContinuumConfig extends ContinuumMemoryContextConfig {
  readonly enabled: boolean
  readonly mode: 'off' | 'shadow' | 'active'
  readonly scopes: string[]
  /**
   * `explicit` admits only caller-created records. `user-message` admits every committed human message.
   * `compaction` indexes the human messages a compaction checkpoint replaces, as selected and tagged by the mounted
   * Reflex admitter; without that admitter it neither indexes nor recalls, so the Session behaves as without Continuum.
   */
  readonly admission?: ContinuumAdmissionMode
  /**
   * `off` records no execution facts. `verified` offers the assistant and tool text each closed step produced to the
   * mounted admitter's `judgeExecution`, which decides what becomes a record; without that method nothing is written.
   */
  readonly executionAdmission?: ContinuumExecutionAdmissionMode
  readonly candidatePool?: MemoryCandidatePool
  readonly maxPool?: number
  /** Record retrieval audit events; the schema supplies `false` when omitted. */
  readonly trace?: boolean
}

/** Which human messages become memory records without an explicit caller. */
export type ContinuumAdmissionMode = 'explicit' | 'user-message' | 'compaction'

/** Whether closed steps offer their executed facts to the admitter for verification. */
export type ContinuumExecutionAdmissionMode = 'off' | 'verified'

type ContinuumResolvedConfig = Omit<ContinuumConfig, 'enabled' | 'mode'> & {
  readonly enabled: Volatile<boolean>
  readonly mode: Volatile<'off' | 'shadow' | 'active'>
}

interface MemoryProjection {
  readonly controller: ContinuumMemoryController
  readonly store: MemoryRecordStore
  /** L1 index tags by record ID, derived from `continuum/memory-index` events. */
  readonly tags: Map<MemoryId, readonly string[]>
}

/** Typed schema fields reusable by profile providers with their own defaults. */
export const ContinuumConfigFields = {
  enabled: z.boolean().default(false).volatile(),
  mode: z.union([z.const('off'), z.const('shadow'), z.const('active')]).default('off').volatile(),
  scopes: z.array(z.string()).default([]),
  admission: z.union([z.const('explicit'), z.const('user-message'), z.const('compaction')]).default('explicit'),
  /** Execution-fact admission; `off` writes no judgement and no record. */
  executionAdmission: z.union([z.const('off'), z.const('verified')]).default('off'),
  candidatePool: z.union([z.const('lexical'), z.const('all')]).default('lexical'),
  maxCandidates: z.number().step(1).min(1).default(8),
  maxExcerptBytes: z.number().step(1).min(1).default(2048),
  maxTotalBytes: z.number().step(1).min(1).default(8192),
  maxPool: z.number().step(1).min(1).default(8),
  /** Record retrieval audit events; configurable independently of the feature switch, never a numeric budget. */
  trace: z.boolean().default(false),
}

/** Schemastery validation for {@link ContinuumConfig}. */
export const ContinuumConfig = z.object(ContinuumConfigFields)

/** Public service seam used by profile consumers and tests. */
export interface ContinuumMemoryService {
  /**
   * Return the current switch decision for this profile.
   * @returns The effective feature switch decision.
   */
  state(): ReturnType<ContinuumMemoryController['state']>
  /**
   * Get the controller associated with one Agent, restoring it from Session events once.
   * @param agent - Agent whose Session owns the memory projection.
   * @returns The controller for the Agent's memory projection.
   */
  controller(agent: Agent): ContinuumMemoryController
  /**
   * Admit and persist one source-backed record in the Agent's Session.
   * @param agent - Agent whose Session receives the record event.
   * @param record - Source-backed record to admit.
   * @returns The created immutable record.
   */
  create(agent: Agent, record: NewMemoryRecord): MemoryRecord
  /**
   * Supersede and persist one record correction.
   * @param agent - Agent whose Session receives the correction event.
   * @param id - Existing record identifier.
   * @param expectedRevision - Revision observed by the caller.
   * @param replacement - Source-backed successor record.
   * @returns The created successor record.
   */
  supersede(agent: Agent, id: MemoryId, expectedRevision: number, replacement: NewMemoryRecord): MemoryRecord
  /**
   * Deactivate and persist one record.
   * @param agent - Agent whose Session receives the deactivation event.
   * @param id - Existing record identifier.
   * @param expectedRevision - Revision observed by the caller.
   * @returns The deactivated immutable record.
   */
  deactivate(agent: Agent, id: MemoryId, expectedRevision: number): MemoryRecord
  /**
   * Wait for this Agent's queued admissions, without a cross-Session barrier.
   * @param agent - Agent whose queue to drain.
   * @returns a promise that settles when the Agent's current admissions have settled.
   */
  whenSettled(agent: Agent): Promise<void>
}

/**
 * Session-backed Continuum profile service. It owns one projection per Agent,
 * restores that projection from the Agent Session, and installs the explicit
 * same-step consumer when the profile switch resolves to a usable state.
 * Committed live config changes and Jev removal invalidate pending reads;
 * Agent and service disposal invalidate and release their controllers.
 */
export default class ContinuumMemory extends Service implements ContinuumMemoryService {
  static Config = ContinuumConfig

  private readonly config: ContinuumConfig | ContinuumResolvedConfig
  private readonly projections = new Map<Agent, MemoryProjection>()
  private readonly agentsBySession = new Map<SessionId, Agent>()
  /** Compaction admissions in flight, chained per Agent in checkpoint order. */
  private readonly admissions = new Map<Agent, { readonly settled: Promise<void>; readonly abort: AbortController }>()
  /** Sequence of the `step/start` that opened each Agent's current step, and the turn signal that opened it. */
  private readonly openSteps = new Map<Agent, {
    readonly seq: number
    readonly turn: number
    readonly step: number
    readonly signal: AbortSignal
  }>()
  /** Agents whose projection was disposed; their Session may already be detached, so no event may be appended. */
  private readonly disposedAgents = new WeakSet<Agent>()
  /** Cancellation signal of each Agent's current turn, captured at its pre-step. */
  private readonly turnSignals = new WeakMap<Agent, AbortSignal>()

  constructor(ctx: Context, config: ContinuumConfig | ContinuumResolvedConfig) {
    super(ctx, 'continuumMemory')
    this.config = config
    ctx.on('loader/volatile-update', () => { this.synchronizeControllers() })
    ctx.on('internal/service', (name) => {
      if (name === 'jev' || name === 'continuumMemoryAdmitter') this.synchronizeControllers()
    })
    ctx.effect(() => () => {
      for (const { controller } of this.projections.values()) controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: false })
      for (const { abort } of this.admissions.values()) abort.abort()
      this.admissions.clear()
      this.projections.clear()
      this.agentsBySession.clear()
      this.openSteps.clear()
    })
    ctx.inject(['agents'], (ctx) => {
      const principal = { scopes: [...config.scopes] }
      const retrievalConfig = {
        maxCandidates: config.maxCandidates, maxExcerptBytes: config.maxExcerptBytes, maxTotalBytes: config.maxTotalBytes,
        candidatePool: config.candidatePool, maxPool: config.maxPool, admission: config.admission ?? 'explicit',
        trace: config.trace,
      }
      installContinuumMemoryControllerContext(ctx, agent => this.reflexReady() ? this.projectionFor(agent, {
        enabled: readSetting(config.enabled), mode: readSetting(config.mode), reflexMounted: ctx.get('jev') !== undefined,
      }).controller : undefined, () => principal, retrievalConfig, () => ctx.get('continuumMemorySelector'),
      agent => this.admissions.get(agent)?.settled, (agent, id) => this.projections.get(agent)?.tags.get(id) ?? [])
    })
    ctx.on('agent/created', ({ agent }) => { this.agentsBySession.set(agent.session.id, agent) })
    ctx.on('agent/pre-step', ({ agent, signal }, next) => {
      // The turn signal outlives this pre-step; a step it opens is cancelled with the same signal.
      this.turnSignals.set(agent, signal)
      return next()
    })
    ctx.on('agent/disposed', ({ agent }) => {
      this.projections.get(agent)?.controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: false })
      this.projections.delete(agent)
      this.admissions.get(agent)?.abort.abort()
      this.admissions.delete(agent)
      this.openSteps.delete(agent)
      this.agentsBySession.delete(agent.session.id)
      this.disposedAgents.add(agent)
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'compaction/summary') {
        this.admitCompacted(session, event)
        return
      }
      if (event.type === 'step/start' || event.type === 'step/end') {
        this.observeStep(session, event)
        return
      }
      if (event.type !== 'user/message') return
      // Session rejects re-entrant append calls while publishing this event;
      // defer admission until the source append has completed.
      queueMicrotask(() => {
        try {
          this.admitUserMessage(session, event)
        } catch (error: unknown) {
          this.ctx.logger.warn(`continuum memory admission failed: ${String(error)}`)
        }
      })
    })
    ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
      // The turn's own boundary cancels the wait, so a pending judgement cannot delay a cancelled turn.
      await settledOrAborted(this.whenSettled(agent), signal)
    })
  }

  state(): ReturnType<ContinuumMemoryController['state']> {
    return resolveContinuumMemorySwitch(this.switchConfig())
  }

  controller(agent: Agent): ContinuumMemoryController {
    return this.projectionFor(agent, this.switchConfig()).controller
  }

  create(agent: Agent, record: NewMemoryRecord): MemoryRecord {
    const store = this.storeFor(agent)
    const created = store.create(record)
    appendMemoryRecordEvent(agent.session, 'create', created)
    this.controller(agent).observe(created, agent.session)
    return created
  }

  supersede(agent: Agent, id: MemoryId, expectedRevision: number, replacement: NewMemoryRecord): MemoryRecord {
    const store = this.storeFor(agent)
    const previous = store.get(id)
    const next = store.supersede(id, expectedRevision, replacement)
    appendMemoryRecordEvent(agent.session, 'supersede', next, previous)
    this.controller(agent).supersede(next)
    return next
  }

  deactivate(agent: Agent, id: MemoryId, expectedRevision: number): MemoryRecord {
    const previous = this.storeFor(agent).get(id)
    const next = this.controller(agent).deactivate(id, expectedRevision)
    appendMemoryRecordEvent(agent.session, 'deactivate', next, previous)
    return next
  }

  whenSettled(agent: Agent): Promise<void> {
    return this.admissions.get(agent)?.settled ?? Promise.resolve()
  }

  private synchronizeControllers(): void {
    const switchConfig = this.switchConfig()
    for (const { controller } of this.projections.values()) controller.setSwitch(switchConfig)
  }

  private switchConfig(): ContinuumMemorySwitch {
    return { enabled: readSetting(this.config.enabled), mode: readSetting(this.config.mode), reflexMounted: this.ctx.get('jev') !== undefined }
  }

  private storeFor(agent: Agent): MemoryRecordStore {
    return this.projectionFor(agent, this.switchConfig()).store
  }

  private projectionFor(agent: Agent, switchConfig: ContinuumMemorySwitch): MemoryProjection {
    const existing = this.projections.get(agent)
    if (existing !== undefined) {
      existing.controller.setSwitch(switchConfig)
      return existing
    }
    const tags = new Map<MemoryId, readonly string[]>()
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const store = foldMemoryRecordEvents(agent.session.snapshotEvents(), new MemoryRecordStore(), tags)
    const controller = new ContinuumMemoryController(store, switchConfig)
    const projection = { controller, store, tags }
    this.projections.set(agent, projection)
    return projection
  }

  /**
   * Queue admission of the human messages one committed checkpoint replaced. The queue entry is registered before
   * this event's publication returns, so a read that follows the compaction waits for its records.
   */
  private admitCompacted(session: Session, event: SessionEvent<'compaction/summary'>): void {
    if (this.config.admission !== 'compaction' || !this.state().enabled || !this.reflexReady()) return
    const agent = this.agentsBySession.get(session.id) ?? this.ctx.get('agents')?.currentInitiator()
    const scope = this.config.scopes[0]
    if (agent === undefined || agent.session.id !== session.id || scope === undefined) return
    const previous = this.admissions.get(agent)
    const abort = previous?.abort ?? new AbortController()
    const settled = (previous?.settled ?? Promise.resolve()).then(async () => {
      // Session rejects re-entrant append calls while publishing this event.
      await Promise.resolve()
      await this.admitCandidates(agent, event, scope, abort.signal)
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) this.ctx.logger.warn(`continuum compaction admission failed: ${String(error)}`)
    })
    this.admissions.set(agent, { settled, abort })
  }

  private async admitCandidates(agent: Agent, event: SessionEvent<'compaction/summary'>, scope: string, signal: AbortSignal): Promise<void> {
    const shadowed = new Set<number>(event.data.shadowedSeqs)
    const projection = this.projectionFor(agent, this.switchConfig())
    const store = projection.store
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const candidates: (ContinuumAdmissionCandidate & { readonly seq: SessionEvent['seq'] })[] = agent.session.snapshotEvents()
      .filter(source => shadowed.has(source.seq))
      .flatMap((source) => {
        const content = memorySourceText(source)
        const id = `${String(agent.session.id)}:${String(source.seq)}`
        return content.length === 0 || store.get(createMemoryId(id)) !== undefined ? [] : [{ id, content, seq: source.seq }]
      })
    if (candidates.length === 0) return
    const judged = await this.admitted(agent, candidates, signal)
    const admitted = new Map(judged.admitted.map(memory => [memory.id, memory.tags]))
    if (!this.state().enabled) return
    for (const candidate of candidates) {
      const id = createMemoryId(candidate.id)
      const tags = admitted.get(candidate.id)
      if (tags === undefined || store.get(id) !== undefined) continue
      const source = { sessionId: agent.session.id, eventSeq: candidate.seq }
      // The record event carries the record's content; the index event states
      // where it became findable. The record goes first, so a fold recovers the
      // record even when the index event was never written.
      this.create(agent, { id, kind: 'fact', scope, content: candidate.content, sourceRefs: [source] })
      appendMemoryIndexEvent(agent.session, { id, scope, tags: [...tags], source },
        { source: 'compaction', tagSource: judged.tagSource })
      projection.tags.set(id, tags)
    }
  }

  /**
   * Track one step boundary. `step/start` records the window; `step/end` queues the execution-fact judgement for the
   * window it closes, so a read after the step waits for that judgement.
   */
  private observeStep(session: Session, event: SessionEvent<'step/start' | 'step/end'>): void {
    const agent = this.agentsBySession.get(session.id)
    if (agent === undefined || agent.session.id !== session.id) return
    if (event.type === 'step/start') {
      this.openSteps.set(agent, {
        seq: Number(event.seq), turn: event.data.turn, step: event.data.step,
        signal: this.turnSignals.get(agent) ?? new AbortController().signal,
      })
      return
    }
    const opened = this.openSteps.get(agent)
    this.openSteps.delete(agent)
    if (opened === undefined) return
    this.admitExecutionFacts(agent, opened, Number(event.seq))
  }

  /** Queue the execution-fact judgement for one closed step, chained after the Agent's earlier admissions. */
  private admitExecutionFacts(
    agent: Agent,
    opened: { readonly turn: number; readonly step: number; readonly seq: number; readonly signal: AbortSignal },
    stepEndSeq: number,
  ): void {
    if ((this.config.executionAdmission ?? 'off') !== 'verified' || !this.state().enabled) return
    const scope = this.config.scopes[0]
    const previous = this.admissions.get(agent)
    const abort = previous?.abort ?? new AbortController()
    const settled = (previous?.settled ?? Promise.resolve()).then(async () => {
      // Session rejects re-entrant append calls while publishing this event.
      await Promise.resolve()
      await this.admitStepFacts(agent, opened, stepEndSeq, scope, abort.signal)
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) this.ctx.logger.warn(`continuum execution admission failed: ${String(error)}`)
    })
    this.admissions.set(agent, { settled, abort })
  }

  /**
   * Offer one closed step's executed text to the admitter and write the records it keeps. A cancelled turn, a
   * disposed Agent, a switched-off projection, or a failed judgement writes no record; the cancelled-turn check
   * reads the turn signal captured when the step opened, because the admission controller outlives the turn.
   */
  private async admitStepFacts(
    agent: Agent,
    opened: { readonly turn: number; readonly step: number; readonly seq: number; readonly signal: AbortSignal },
    stepEndSeq: number,
    scope: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const session = agent.session
    const decide = (decision: MemoryWriteDecisionEventData): void => {
      // A disposed Agent's Session may already be detached; appending then would fork the log.
      if (this.disposedAgents.has(agent) || !this.agentsBySession.has(session.id)) return
      appendMemoryWriteDecision(session, decision, (message) => { this.ctx.logger.warn(message) })
    }
    if (signal.aborted || opened.signal.aborted) {
      decide({ turn: opened.turn, step: opened.step, outcome: 'failed', reason: 'cancelled', candidateRecords: 0 })
      return
    }
    if (scope === undefined) { decide({ turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-scope', candidateRecords: 0 }); return }
    const admitter = this.ctx.get('continuumMemoryAdmitter')
    if (admitter?.judgeExecution === undefined) { decide({ turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-admitter', candidateRecords: 0 }); return }
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const candidates = executionSourceFacts(session.snapshotEvents(), opened.seq, stepEndSeq)
    if (candidates.length === 0) { decide({ turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-new-facts', candidateRecords: 0 }); return }
    // The projection's generation invalidates a proposal judged across a disable and re-enable.
    const projection = this.projectionFor(agent, this.switchConfig())
    const ticket = projection.controller.beginRead({ scopes: [scope] })
    const isCurrent = (): boolean =>
      !signal.aborted && !opened.signal.aborted && ticket !== undefined && projection.controller.isCurrent(ticket)
    let kept: readonly ContinuumAdmittedMemory[]
    try {
      kept = await admitter.judgeExecution(agent, { candidates, isCurrent }, signal)
    } catch (error: unknown) {
      if (isCurrent()) {
        this.ctx.logger.warn(`continuum execution judge failed: ${String(error)}`)
        decide({ turn: opened.turn, step: opened.step, outcome: 'failed', reason: 'error', candidateRecords: candidates.length })
      } else {
        decide({ turn: opened.turn, step: opened.step, outcome: 'failed', reason: 'cancelled', candidateRecords: candidates.length })
      }
      return
    }
    if (!isCurrent()) {
      decide({ turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'stale', candidateRecords: candidates.length })
      return
    }
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
    let written = 0
    for (const memory of kept) {
      const candidate = byId.get(memory.id)
      if (candidate === undefined) continue
      const id = createMemoryId(`${String(session.id)}:execution:${String(stepEndSeq)}:${candidate.id}`)
      if (projection.store.get(id) !== undefined) continue
      try {
        this.create(agent, {
          id, kind: 'fact', scope,
          content: candidate.content,
          // The source is the message that carries the text, so history readback resolves it.
          sourceRefs: [{ sessionId: session.id, eventSeq: SessionSeq(candidate.seq) }],
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`continuum execution record was not written: ${String(error)}`)
        continue
      }
      written += 1
    }
    decide(written === 0
      ? { turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-new-facts', candidateRecords: candidates.length }
      : { turn: opened.turn, step: opened.step, outcome: 'admitted', reason: 'admitted', candidateRecords: candidates.length, writtenRecords: written })
  }

  /** Compaction admission needs a mounted Reflex admitter; the other modes do not depend on it. */
  private reflexReady(): boolean {
    return this.config.admission !== 'compaction' || this.ctx.get('continuumMemoryAdmitter') !== undefined
  }

  /** Candidates the mounted admitter keeps, with tags; every candidate untagged when it fails, none when it was removed. */
  private async admitted(
    agent: Agent, candidates: readonly ContinuumAdmissionCandidate[], signal: AbortSignal,
  ): Promise<{ readonly admitted: readonly ContinuumAdmittedMemory[]; readonly tagSource: 'reflex' | 'fallback-untagged' | 'unjudged' }> {
    const all = candidates.map(candidate => ({ id: candidate.id, tags: [] }))
    const admitter = this.ctx.get('continuumMemoryAdmitter')
    if (admitter === undefined) return { admitted: [], tagSource: 'unjudged' }
    try {
      const admission = await admitter.admit(agent, {
        candidates: candidates.map(({ id, content }) => ({ id, content })),
        isCurrent: () => !signal.aborted && this.state().enabled,
      }, signal)
      return { admitted: admission.admitted, tagSource: 'reflex' }
    } catch (error: unknown) {
      signal.throwIfAborted()
      // Losing a compacted message is worse than keeping one that is not needed.
      this.ctx.logger.warn(`continuum admitter failed; admitting every compacted message: ${String(error)}`)
      return { admitted: all, tagSource: 'fallback-untagged' }
    } finally {
      signal.throwIfAborted()
    }
  }

  /** Admit one committed human message when the protected automatic mode is enabled. */
  private admitUserMessage(session: Session, event: SessionEvent): void {
    if ((this.config.admission ?? 'explicit') !== 'user-message' || !this.state().enabled || event.type !== 'user/message') return
    const content = memorySourceText(event)
    const scope = this.config.scopes[0]
    if (content.length === 0 || scope === undefined) return
    const agent = this.agentsBySession.get(session.id) ?? this.ctx.get('agents')?.currentInitiator()
    if (agent === undefined || agent.session.id !== session.id) return
    const id = createMemoryId(`${String(session.id)}:${String(event.seq)}`)
    const store = this.storeFor(agent)
    if (store.get(id) !== undefined) return
    this.create(agent, {
      id,
      kind: 'fact',
      scope,
      content,
      sourceRefs: [{ sessionId: session.id, eventSeq: event.seq }],
    })
    // The record says the content was stored; the index says it became
    // findable. `user-message` admission runs no tag judgement, so the entry is
    // written untagged rather than borrowing the compaction path's tags.
    appendMemoryIndexEvent(session, {
      id,
      scope,
      tags: [],
      source: { sessionId: session.id, eventSeq: event.seq },
    }, { source: 'user-message', tagSource: 'unjudged' })
  }
}

function readSetting<T extends boolean | 'off' | 'shadow' | 'active'>(value: T | Volatile<T>): T {
  if (typeof value === 'object') return value.get() as T
  return value
}

/** Wait for a promise, or resolve early once the boundary signal aborts. */
async function settledOrAborted(settled: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  const aborted = Promise.withResolvers<never>()
  const cancel = (): void => { aborted.resolve(undefined as never) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await Promise.race([settled, aborted.promise])
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
