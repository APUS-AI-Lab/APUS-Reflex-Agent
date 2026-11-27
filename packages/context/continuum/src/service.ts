import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-compaction'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { randomUUID } from 'node:crypto'
import { SessionSeq, type Session, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import {
  ContinuumMemoryController, resolveContinuumMemorySwitch, type ContinuumMemorySwitch, type MemoryIndexObservation,
} from './policy.ts'
import {
  appendMemoryIndexEvent, appendMemoryRecordEvent, appendMemoryWriteCandidatesEvent, appendMemoryWriteDecision,
  appendMemoryWriteResultEvent, executionSourceScan, foldMemoryRecordEvents, memorySourceText,
  type MemoryAttemptResultFact, type MemoryCandidateResultFact, type MemoryWriteCandidateFact,
  type MemoryRecordRefFact, type MemoryWriteCandidatesEventData, type MemoryWriteDecisionEventData,
  type MemoryWriteExclusionFact,
  type MemoryWriteOrigin, type MemoryWriteResultEventData, type MemoryWriteTriggerRef, type MemoryWriteWindowFact,
} from './persistence.ts'
import {
  MemoryId as createMemoryId, MemoryRecordStore,
  type MemoryId, type MemoryRecord, type MemorySourceRef, type NewMemoryRecord,
} from './records.ts'
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
    // A caller-owned transition is its own trigger: no automatic entry, and no candidate or result event to write.
    const attempt = this.createAttempt(agent, record, { writeId: randomUUID(), origin: 'explicit', attemptId: randomUUID() })
    return attempt.created
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

  /**
   * One real create attempt: store mutation, record event, lexical index observation. Each stage keeps its own result
   * because they are not atomic — a later failure does not undo an earlier success.
   * @param agent - Agent whose Session receives the record and index events.
   * @param record - proposed record fields from the source-backed caller.
   * @param attribution - the write trigger and attempt this call belongs to.
   * @returns the created record, the append/index evidence, and any stage failure.
   */
  private createAttempt(
    agent: Agent,
    record: NewMemoryRecord,
    attribution: { readonly writeId: string; readonly origin: MemoryWriteOrigin; readonly attemptId: string },
  ): MemoryCreateAttempt {
    const store = this.storeFor(agent)
    const created = store.create(record)
    let recordEvent: SessionEvent<'continuum/memory-record'> | undefined
    try {
      recordEvent = appendMemoryRecordEvent(agent.session, 'create', created, undefined, attribution)
    } catch (error: unknown) {
      // The store already holds the record; returning here would hide that partial success.
      this.ctx.logger.warn(`continuum memory record event was not recorded: ${errorMessage(error)}`)
      return {
        created,
        attempt: {
          attemptId: attribution.attemptId, proposedRecordId: String(created.id), origin: attribution.origin,
          storeStatus: 'created', appendStatus: 'rejected', indexStatus: 'not_attempted', l1Status: 'unverifiable',
          failure: { stage: 'append', message: errorMessage(error) },
        },
        indexEvents: [],
      }
    }
    let observed: MemoryIndexObservation = []
    let indexStatus: MemoryAttemptResultFact['indexStatus'] = 'observed'
    let failure: MemoryAttemptResultFact['failure']
    try {
      observed = this.controller(agent).observe(created, agent.session, attribution)
    } catch (error: unknown) {
      // The record and its log event already exist; the derived index did not observe this snapshot.
      indexStatus = 'unverifiable'
      failure = { stage: 'index', message: errorMessage(error) }
      this.ctx.logger.warn(`continuum memory index observation failed: ${errorMessage(error)}`)
    }
    return {
      created,
      attempt: {
        attemptId: attribution.attemptId, proposedRecordId: String(created.id), origin: attribution.origin,
        storeStatus: 'created', appendStatus: 'accepted', indexStatus, l1Status: 'unverifiable',
        recordEventRef: { sessionId: agent.session.id, seq: recordEvent.seq },
        ...(failure === undefined ? {} : { failure }),
      },
      // A cold-start `full` report describes the construction-time snapshot, not this record; it stays in the log
      // but is not attributed to this attempt.
      indexEvents: observed.filter(event => event.type !== 'continuum/memory-index-rebuilt' || event.data.scope !== 'full'),
    }
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
    const session: Session = agent.session
    const writeId = randomUUID()
    const triggerRef: MemoryWriteTriggerRef = { sessionId: session.id, eventSeq: event.seq, eventType: 'compaction/summary' }
    const window: MemoryWriteWindowFact = {
      kind: 'compaction', summarySeq: event.seq, shadowedSeqs: [...event.data.shadowedSeqs],
    }
    const shadowed = new Set<number>(event.data.shadowedSeqs)
    const projection = this.projectionFor(agent, this.switchConfig())
    const store = projection.store
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const sourceEvents = session.snapshotEvents().filter(source => shadowed.has(source.seq))
    const candidates: (ContinuumAdmissionCandidate & { readonly seq: SessionEvent['seq'] })[] = []
    const exclusions: MemoryWriteExclusionFact[] = []
    for (const source of sourceEvents) {
      const content = memorySourceText(source)
      const id = `${String(session.id)}:${String(source.seq)}`
      if (content.length === 0) { exclusions.push({ sourceRefs: [sourceRefOf(session.id, source.seq)], reason: 'not-human-text' }); continue }
      if (store.get(createMemoryId(id)) !== undefined) {
        exclusions.push({ sourceRefs: [sourceRefOf(session.id, source.seq)], reason: 'existing-record' }); continue
      }
      candidates.push({ id, content, seq: source.seq })
    }
    const offered: MemoryWriteCandidateFact[] = candidates.map(candidate => ({
      candidateId: candidate.id,
      sourceRefs: [sourceRefOf(session.id, candidate.seq)],
      normalization: { textBlocksOnly: true, joinSeparator: '\n', trim: true, sourceChars: candidate.content.length, candidateChars: candidate.content.length, truncated: false },
      targetRecordId: candidate.id,
    }))
    appendMemoryWriteCandidatesEvent(session, {
      version: 1, writeId, origin: 'compaction',
      status: candidates.length === 0 ? 'skipped' : 'candidates_ready',
      ...(candidates.length === 0 ? { reason: 'no-candidates' } : {}),
      triggerRef, window, candidates: offered, exclusions,
      coverage: { sourceWindowComplete: true, candidateListComplete: true, missingEvidence: [] },
    }, warn(this.ctx))
    if (candidates.length === 0) {
      // The exclusions live on the candidates event; this result states that no attempt followed them.
      appendMemoryWriteResultEvent(session, writeResultOf(writeId, 'compaction', triggerRef, offered, [], [], [], [], []), warn(this.ctx))
      return
    }
    const judged = await this.admitted(agent, candidates, signal, writeId)
    const admitted = new Map(judged.admitted.map(memory => [memory.id, memory.tags]))
    if (!this.state().enabled) {
      appendMemoryWriteResultEvent(session, writeResultOf(writeId, 'compaction', triggerRef, offered, [], [], [], [], ['consumer disabled before any record was written']), warn(this.ctx))
      return
    }
    const candidateResults: MemoryCandidateResultFact[] = []
    const attemptResults: MemoryAttemptResultFact[] = []
    const recordEventRefs: { sessionId: SessionId; seq: SessionSeq }[] = []
    const indexEventRefs: { sessionId: SessionId; seq: SessionSeq; kind: 'l1' | 'lexical' }[] = []
    for (const candidate of candidates) {
      const id = createMemoryId(candidate.id)
      const tags = admitted.get(candidate.id)
      if (tags === undefined) { candidateResults.push({ candidateId: candidate.id, status: 'rejected', reason: 'not-admitted' }); continue }
      if (store.get(id) !== undefined) { candidateResults.push({ candidateId: candidate.id, status: 'already_exists', reason: 'existing-record' }); continue }
      const source = { sessionId: session.id, eventSeq: candidate.seq }
      const attemptId = randomUUID()
      let attempt: MemoryCreateAttempt
      try {
        attempt = this.createAttempt(agent, { id, kind: 'fact', scope, content: candidate.content, sourceRefs: [source] }, { writeId, origin: 'compaction', attemptId })
      } catch (error: unknown) {
        // Storing one record can fail on its own. Letting it escape would abandon
        // the whole batch after its candidates were already logged, leaving a
        // write that says what it meant to do and never what happened.
        this.ctx.logger.warn(`continuum compaction record was not written: ${errorMessage(error)}`)
        candidateResults.push({ candidateId: candidate.id, status: 'failed', reason: 'store-rejected', attemptId })
        attemptResults.push({
          attemptId, proposedRecordId: String(id), candidateId: candidate.id, origin: 'compaction',
          storeStatus: 'rejected', appendStatus: 'unverifiable', indexStatus: 'not_attempted', l1Status: 'not_applicable',
          failure: { stage: 'store', message: errorMessage(error) },
        })
        continue
      }
      recordEventRefs.push(...(attempt.attempt.recordEventRef === undefined ? [] : [attempt.attempt.recordEventRef]))
      indexEventRefs.push(...attempt.indexEvents.map(event => indexRef(agent.session.id, event)))
      // The L1 entry is appended after the attempt, so its own outcome settles the candidate and the L1 status.
      let candidateResult: MemoryCandidateResultFact
      let l1Status: MemoryAttemptResultFact['l1Status'] = 'unverifiable'
      if (attempt.attempt.appendStatus !== 'accepted') {
        candidateResult = { candidateId: candidate.id, status: 'failed', reason: 'record-append-rejected', record: recordRefOf(attempt.created), attemptId }
      } else {
        try {
          const indexEvent = appendMemoryIndexEvent(session, { id, scope, tags: [...tags], source },
            { source: 'compaction', tagSource: judged.tagSource }, { writeId, origin: 'compaction', attemptId })
          indexEventRefs.push({ sessionId: session.id, seq: indexEvent.seq, kind: 'l1' })
          projection.tags.set(id, tags)
          l1Status = 'added'
          candidateResult = { candidateId: candidate.id, status: 'record_accepted', record: recordRefOf(attempt.created), attemptId }
        } catch (error: unknown) {
          this.ctx.logger.warn(`continuum L1 index entry was not written: ${String(error)}`)
          l1Status = 'failed'
          candidateResult = { candidateId: candidate.id, status: 'record_accepted', reason: 'l1-index-rejected', record: recordRefOf(attempt.created), attemptId }
        }
      }
      attemptResults.push({ ...attempt.attempt, candidateId: candidate.id, l1Status })
      candidateResults.push(candidateResult)
    }
    appendMemoryWriteResultEvent(session, writeResultOf(
      writeId, 'compaction', triggerRef, offered, candidateResults, attemptResults, recordEventRefs, indexEventRefs,
      writeStagesNotCompleted(attemptResults),
    ), warn(this.ctx))
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
    const session: Session = agent.session
    const writeId = randomUUID()
    const triggerRef: MemoryWriteTriggerRef = { sessionId: session.id, eventSeq: SessionSeq(stepEndSeq), eventType: 'step/end' }
    const window: MemoryWriteWindowFact = { kind: 'execution', stepStartSeq: SessionSeq(opened.seq), stepEndSeq: SessionSeq(stepEndSeq) }
    // Defined before the closures so an early-return branch can never observe a binding in its temporal dead zone.
    // Reading stays lazy: a step that returns before offering has not inspected its window and must not claim it did.
    let scanned: ReturnType<typeof executionSourceScan> | undefined
    const sourceScan = (): ReturnType<typeof executionSourceScan> => {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      scanned ??= executionSourceScan(session.snapshotEvents(), opened.seq, stepEndSeq)
      return scanned
    }
    const candidatesEvent = (
      status: MemoryWriteCandidatesEventData['status'],
      reason: string | undefined,
      candidateFacts: readonly MemoryWriteCandidateFact[],
      exclusions: readonly MemoryWriteExclusionFact[],
    ): void => {
      // A disposed Agent's Session may already be detached; appending then would fork the log.
      if (this.disposedAgents.has(agent) || !this.agentsBySession.has(session.id)) return
      // Coverage follows whether the scan ran, not the entry's status: a read window with no candidates is
      // complete, while a branch that returned before reading must not claim either list is complete.
      const inspected = scanned
      const unexamined = inspected?.unexaminedSourceSeqs ?? []
      const coverage = inspected === undefined
        ? { sourceWindowComplete: false, candidateListComplete: false, missingEvidence: [`${reason ?? status}: source window not inspected`] }
        : unexamined.length === 0
          ? { sourceWindowComplete: true, candidateListComplete: true, missingEvidence: [] }
          : {
            sourceWindowComplete: false,
            candidateListComplete: false,
            missingEvidence: ['execution candidate limit stopped the scan before the window ended'],
          }
      appendMemoryWriteCandidatesEvent(session, {
        version: 1, writeId, origin: 'execution', status,
        ...(reason === undefined ? {} : { reason }),
        triggerRef, window, candidates: candidateFacts, exclusions,
        ...(unexamined.length === 0 ? {} : {
          unexaminedSourceRefs: unexamined.map(seq => sourceRefOf(session.id, SessionSeq(seq))),
        }),
        coverage,
      }, warn(this.ctx))
    }
    const finish = (
      decision: MemoryWriteDecisionEventData,
      result: Omit<MemoryWriteResultEventData, 'version' | 'writeId' | 'origin' | 'triggerRef' | 'nativeWriteDecisionRef' | 'reportedCounts'>,
    ): void => {
      if (this.disposedAgents.has(agent) || !this.agentsBySession.has(session.id)) return
      const decisionEvent = appendMemoryWriteDecision(session, decision, warn(this.ctx))
      appendMemoryWriteResultEvent(session, {
        version: 1, writeId, origin: 'execution', triggerRef, ...result,
        ...(decisionEvent === undefined ? {} : { nativeWriteDecisionRef: { sessionId: session.id, seq: decisionEvent.seq } }),
        reportedCounts: {
          candidateRecords: decision.candidateRecords,
          ...(decision.writtenRecords === undefined ? {} : { writtenRecords: decision.writtenRecords }),
        },
      }, warn(this.ctx))
    }
    const empty = {
      candidateResults: [], attemptResults: [], recordEventRefs: [], indexEventRefs: [],
      partialFailures: [], missingEvidence: [],
    }
    if (signal.aborted || opened.signal.aborted) {
      candidatesEvent('skipped', 'cancelled', [], [])
      finish({ turn: opened.turn, step: opened.step, outcome: 'failed', reason: 'cancelled', candidateRecords: 0 }, empty)
      return
    }
    if (scope === undefined) {
      candidatesEvent('skipped', 'no-scope', [], [])
      finish({ turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-scope', candidateRecords: 0 }, empty)
      return
    }
    const admitter = this.ctx.get('continuumMemoryAdmitter')
    if (admitter?.judgeExecution === undefined) {
      candidatesEvent('skipped', 'no-admitter', [], [])
      finish({ turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-admitter', candidateRecords: 0 }, empty)
      return
    }
    const candidates = sourceScan().candidates
    const offered: MemoryWriteCandidateFact[] = candidates.map(candidate => ({
      candidateId: candidate.id,
      sourceRefs: [sourceRefOf(session.id, SessionSeq(candidate.seq))],
      normalization: {
        textBlocksOnly: true, joinSeparator: '\n', trim: true,
        // The scan keeps only a prefix of the event text; the source event remains the complete text.
        sourceChars: sourceTextLength(session, candidate.seq) ?? candidate.content.length,
        candidateChars: candidate.content.length,
        truncated: (sourceTextLength(session, candidate.seq) ?? candidate.content.length) > candidate.content.length,
      },
    }))
    if (candidates.length === 0) {
      candidatesEvent('skipped', 'no-candidates', [], [])
      finish({ turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-new-facts', candidateRecords: 0 }, empty)
      return
    }
    candidatesEvent('candidates_ready', undefined, offered, [])
    // The projection's generation invalidates a proposal judged across a disable and re-enable.
    const projection = this.projectionFor(agent, this.switchConfig())
    const ticket = projection.controller.beginRead({ scopes: [scope] })
    const isCurrent = (): boolean =>
      !signal.aborted && !opened.signal.aborted && ticket !== undefined && projection.controller.isCurrent(ticket)
    let kept: readonly ContinuumAdmittedMemory[]
    try {
      kept = await admitter.judgeExecution(agent, {
        candidates, isCurrent, writeId,
      }, signal)
    } catch (error: unknown) {
      if (isCurrent()) {
        this.ctx.logger.warn(`continuum execution judge failed: ${String(error)}`)
        finish(
          { turn: opened.turn, step: opened.step, outcome: 'failed', reason: 'error', candidateRecords: candidates.length },
          { ...empty, candidateResults: offered.map(entry => ({ candidateId: entry.candidateId, status: 'failed', reason: 'judge-error' })), partialFailures: ['judge-error'] },
        )
      } else {
        finish(
          { turn: opened.turn, step: opened.step, outcome: 'failed', reason: 'cancelled', candidateRecords: candidates.length },
          { ...empty, candidateResults: offered.map(entry => ({ candidateId: entry.candidateId, status: 'cancelled' })) },
        )
      }
      return
    }
    if (!isCurrent()) {
      finish(
        { turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'stale', candidateRecords: candidates.length },
        { ...empty, candidateResults: offered.map(entry => ({ candidateId: entry.candidateId, status: 'cancelled', reason: 'stale' })) },
      )
      return
    }
    const keptIds = new Set(kept.map(memory => memory.id))
    const candidateResults: MemoryCandidateResultFact[] = []
    const attemptResults: MemoryAttemptResultFact[] = []
    const recordEventRefs: { sessionId: SessionId; seq: SessionSeq }[] = []
    const indexEventRefs: { sessionId: SessionId; seq: SessionSeq; kind: 'l1' | 'lexical' }[] = []
    for (const candidate of candidates) {
      if (!keptIds.has(candidate.id)) {
        candidateResults.push({ candidateId: candidate.id, status: 'rejected', reason: 'judge-rejected' })
        continue
      }
      const id = createMemoryId(`${String(session.id)}:execution:${String(stepEndSeq)}:${candidate.id}`)
      if (projection.store.get(id) !== undefined) {
        candidateResults.push({ candidateId: candidate.id, status: 'already_exists', reason: 'existing-record' })
        continue
      }
      const attemptId = randomUUID()
      let attempt: MemoryCreateAttempt
      try {
        attempt = this.createAttempt(agent, {
          id, kind: 'fact', scope,
          content: candidate.content,
          // The source is the message that carries the text, so history readback resolves it.
          sourceRefs: [{ sessionId: session.id, eventSeq: SessionSeq(candidate.seq) }],
        }, { writeId, origin: 'execution', attemptId })
      } catch (error: unknown) {
        this.ctx.logger.warn(`continuum execution record was not written: ${String(error)}`)
        candidateResults.push({ candidateId: candidate.id, status: 'failed', reason: 'store-rejected', attemptId })
        attemptResults.push({
          attemptId, proposedRecordId: String(id), candidateId: candidate.id, origin: 'execution',
          storeStatus: 'rejected', appendStatus: 'unverifiable', indexStatus: 'not_attempted', l1Status: 'not_applicable',
          failure: { stage: 'store', message: errorMessage(error) },
        })
        continue
      }
      attemptResults.push({ ...attempt.attempt, candidateId: candidate.id })
      recordEventRefs.push(...(attempt.attempt.recordEventRef === undefined ? [] : [attempt.attempt.recordEventRef]))
      indexEventRefs.push(...attempt.indexEvents.map(event => indexRef(session.id, event)))
      candidateResults.push(attempt.attempt.appendStatus === 'accepted'
        ? { candidateId: candidate.id, status: 'record_accepted', record: recordRefOf(attempt.created), attemptId }
        : { candidateId: candidate.id, status: 'failed', reason: 'record-append-rejected', record: recordRefOf(attempt.created), attemptId })
    }
    const written = candidateResults.filter(entry => entry.status === 'record_accepted').length
    finish(written === 0
      ? { turn: opened.turn, step: opened.step, outcome: 'skipped', reason: 'no-new-facts', candidateRecords: candidates.length }
      : {
        turn: opened.turn, step: opened.step, outcome: 'admitted', reason: 'admitted',
        candidateRecords: candidates.length, writtenRecords: written,
      }, {
      candidateResults, attemptResults, recordEventRefs, indexEventRefs,
      partialFailures: attemptResults.flatMap(attempt => attempt.failure === undefined ? [] : [`${attempt.proposedRecordId}: ${attempt.failure.stage}`]),
      missingEvidence: [],
    })
  }

  /** Compaction admission needs a mounted Reflex admitter; the other modes do not depend on it. */
  private reflexReady(): boolean {
    return this.config.admission !== 'compaction' || this.ctx.get('continuumMemoryAdmitter') !== undefined
  }

  /** Candidates the mounted admitter keeps, with tags; every candidate untagged when it fails, none when it was removed. */
  private async admitted(
    agent: Agent, candidates: readonly ContinuumAdmissionCandidate[], signal: AbortSignal, writeId?: string,
  ): Promise<{ readonly admitted: readonly ContinuumAdmittedMemory[]; readonly tagSource: 'reflex' | 'fallback-untagged' | 'unjudged' }> {
    const all = candidates.map(candidate => ({ id: candidate.id, tags: [] }))
    const admitter = this.ctx.get('continuumMemoryAdmitter')
    if (admitter === undefined) return { admitted: [], tagSource: 'unjudged' }
    try {
      const admission = await admitter.admit(agent, {
        candidates: candidates.map(({ id, content }) => ({ id, content })),
        isCurrent: () => !signal.aborted && this.state().enabled,
        ...(writeId === undefined ? {} : { writeId }),
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
    // Recall output and runtime context ride the user role but no person wrote
    // them; admission only describes human input, so they get no candidate and
    // no writeId of their own.
    if (event.data.source.kind !== 'user') return
    const content = memorySourceText(event)
    const scope = this.config.scopes[0]
    const writeId = randomUUID()
    const triggerRef: MemoryWriteTriggerRef = { sessionId: session.id, eventSeq: event.seq, eventType: event.type }
    const sourceRefs: [MemorySourceRef, ...MemorySourceRef[]] = [sourceRefOf(session.id, event.seq)]
    if (content.length === 0 || scope === undefined) {
      appendMemoryWriteCandidatesEvent(session, {
        version: 1, writeId, origin: 'user-message', status: 'skipped',
        reason: scope === undefined ? 'no-scope' : 'empty-text', triggerRef,
        window: { kind: 'user-message', messageSeq: event.seq },
        candidates: [], exclusions: [{ sourceRefs, reason: scope === undefined ? 'not-human-text' : 'empty-text' }],
        coverage: { sourceWindowComplete: true, candidateListComplete: true, missingEvidence: [] },
      }, warn(this.ctx))
      return
    }
    const agent = this.agentsBySession.get(session.id) ?? this.ctx.get('agents')?.currentInitiator()
    if (agent === undefined || agent.session.id !== session.id) {
      appendMemoryWriteCandidatesEvent(session, {
        version: 1, writeId, origin: 'user-message', status: 'skipped', reason: 'no-agent', triggerRef,
        window: { kind: 'user-message', messageSeq: event.seq }, candidates: [],
        exclusions: [{ sourceRefs, reason: 'out-of-window' }],
        coverage: { sourceWindowComplete: true, candidateListComplete: true, missingEvidence: [] },
      }, warn(this.ctx))
      return
    }
    const id = createMemoryId(`${String(session.id)}:${String(event.seq)}`)
    const store = this.storeFor(agent)
    const candidateText = event.data.content
      .filter((block): block is { readonly type: 'text'; readonly text: string } => block.type === 'text')
      .map(block => block.text).join('\n')
    const offered: MemoryWriteCandidateFact[] = [{
      candidateId: String(id), sourceRefs,
      normalization: {
        textBlocksOnly: true, joinSeparator: '\n', trim: true,
        sourceChars: candidateText.length, candidateChars: content.length, truncated: false,
      },
      targetRecordId: String(id),
    }]
    if (store.get(id) !== undefined) {
      appendMemoryWriteCandidatesEvent(session, {
        version: 1, writeId, origin: 'user-message', status: 'skipped', reason: 'existing-record', triggerRef,
        window: { kind: 'user-message', messageSeq: event.seq }, candidates: [],
        exclusions: [{ sourceRefs, reason: 'existing-record' }],
        coverage: { sourceWindowComplete: true, candidateListComplete: true, missingEvidence: [] },
      }, warn(this.ctx))
      appendMemoryWriteResultEvent(session, writeResultOf(writeId, 'user-message', triggerRef, [], [], [], [], [], []), warn(this.ctx))
      return
    }
    appendMemoryWriteCandidatesEvent(session, {
      version: 1, writeId, origin: 'user-message', status: 'candidates_ready', triggerRef,
      window: { kind: 'user-message', messageSeq: event.seq }, candidates: offered, exclusions: [],
      coverage: { sourceWindowComplete: true, candidateListComplete: true, missingEvidence: [] },
    }, warn(this.ctx))
    const attemptId = randomUUID()
    const attempt = this.createAttempt(agent, {
      id, kind: 'fact', scope, content, sourceRefs,
    }, { writeId, origin: 'user-message', attemptId })
    const indexEventRefs: { sessionId: SessionId; seq: SessionSeq; kind: 'l1' | 'lexical' }[] =
      attempt.indexEvents.map(indexed => ({ sessionId: session.id, seq: indexed.seq, kind: 'lexical' as const }))
    let result: MemoryCandidateResultFact
    let l1Status: 'added' | 'failed' | 'unverifiable' = 'unverifiable'
    if (attempt.attempt.appendStatus !== 'accepted') {
      result = { candidateId: String(id), status: 'failed', reason: 'record-append-rejected', record: recordRefOf(attempt.created), attemptId }
    } else {
      // The record says the content was stored; the index says it became findable. `user-message` admission runs no
      // tag judgement, so the entry is written untagged rather than borrowing the compaction path's tags.
      try {
        const indexEvent = appendMemoryIndexEvent(session, {
          id, scope, tags: [], source: { sessionId: session.id, eventSeq: event.seq },
        }, { source: 'user-message', tagSource: 'unjudged' }, { writeId, origin: 'user-message', attemptId })
        indexEventRefs.push({ sessionId: session.id, seq: indexEvent.seq, kind: 'l1' })
        l1Status = 'added'
        result = { candidateId: String(id), status: 'record_accepted', record: recordRefOf(attempt.created), attemptId }
      } catch (error: unknown) {
        this.ctx.logger.warn(`continuum L1 index entry was not written: ${String(error)}`)
        l1Status = 'failed'
        result = { candidateId: String(id), status: 'record_accepted', reason: 'l1-index-rejected', record: recordRefOf(attempt.created), attemptId }
      }
    }
    appendMemoryWriteResultEvent(session, writeResultOf(
      writeId, 'user-message', triggerRef, offered, [result], [{ ...attempt.attempt, candidateId: String(id), l1Status }],
      attempt.attempt.recordEventRef === undefined ? [] : [attempt.attempt.recordEventRef], indexEventRefs,
      writeStagesNotCompleted([{ ...attempt.attempt, candidateId: String(id), l1Status }]),
    ), warn(this.ctx))
  }
}

/** One create attempt's completed boundary, with the index events it appended. */
interface MemoryCreateAttempt {
  readonly created: MemoryRecord
  readonly attempt: MemoryAttemptResultFact
  readonly indexEvents: MemoryIndexObservation
}

/** Message text of an error without assuming its concrete class. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Source reference for one Session event. */
function sourceRefOf(sessionId: SessionId, seq: SessionSeq): MemorySourceRef {
  return { sessionId, eventSeq: seq }
}

/** Record identity without an event reference; callers add the reference when they resolved it. */
function recordRefOf(record: MemoryRecord): MemoryRecordRefFact {
  return { recordId: String(record.id), revision: record.revision }
}

/** Index event reference plus its kind, so L1 and lexical events stay distinguishable. */
function indexRef(sessionId: SessionId, event: SessionEvent<'continuum/memory-index-rebuilt' | 'continuum/memory-index-queued'>): { sessionId: SessionId; seq: SessionSeq; kind: 'lexical' } {
  return { sessionId, seq: event.seq, kind: 'lexical' }
}

/** Warning sink from the service context. */
function warn(ctx: Context): (message: string) => void {
  return (message) => { ctx.logger.warn(message) }
}

/**
 * Stages a create left unfinished, named for the settlement's `partialFailures`.
 *
 * A record can be created while a later stage failed: the append did not land,
 * the index observer did not report, or the L1 entry was rejected. Every such
 * stage belongs in the summary — `l1Status: 'failed'` alone leaves the batch
 * reading as a clean success, and reconciliation reads that as a hidden
 * partial commit.
 * @param attempts - the attempts this write settled.
 * @returns one entry per attempt and unfinished stage, in attempt order.
 */
function writeStagesNotCompleted(attempts: readonly MemoryAttemptResultFact[]): string[] {
  const failures: string[] = []
  for (const attempt of attempts) {
    if (attempt.failure !== undefined) failures.push(`${attempt.proposedRecordId}: ${attempt.failure.stage}`)
    if (attempt.l1Status === 'failed') failures.push(`${attempt.proposedRecordId}: l1`)
  }
  return failures
}

/** One write result built from the candidate and attempt evidence collected so far. */
function writeResultOf(
  writeId: string,
  origin: MemoryWriteOrigin,
  triggerRef: MemoryWriteTriggerRef,
  offered: readonly MemoryWriteCandidateFact[],
  candidateResults: readonly MemoryCandidateResultFact[],
  attemptResults: readonly MemoryAttemptResultFact[],
  recordEventRefs: MemoryWriteResultEventData['recordEventRefs'],
  indexEventRefs: MemoryWriteResultEventData['indexEventRefs'],
  partialFailures: readonly string[],
): MemoryWriteResultEventData {
  const reported = candidateResults.map(result => result.candidateId)
  return {
    version: 1, writeId, origin, triggerRef,
    candidateResults, attemptResults, recordEventRefs, indexEventRefs,
    partialFailures,
    missingEvidence: offered.map(candidate => candidate.candidateId).filter(id => !reported.includes(id)),
  }
}

/** Complete text length of the event that carries one execution candidate, or undefined when absent. */
function sourceTextLength(session: Session, seq: number): number | undefined {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const event = session.snapshotEvents().find(candidate => Number(candidate.seq) === seq)
  if (event === undefined) return undefined
  const content = event.type === 'assistant/message'
    ? event.data.message.content
    : event.type === 'tool/result' ? event.data.message.content : []
  return content
    .filter((block): block is { readonly type: 'text'; readonly text: string } => block.type === 'text')
    .map(block => block.text).join('\n').trim().length
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
