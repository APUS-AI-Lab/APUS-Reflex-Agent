import type { MemoryRetrievalConfig, MemoryRetrievalOutcome, MemoryWorkingSet } from './retrieval.ts'
import { retrieveMemoryWorkingSetWithReport } from './retrieval.ts'
import type { MemoryRecordStore, MemoryId, MemoryRecord } from './records.ts'
import { MemoryRecordIndex, type MemoryIndexRebuildResult } from './memory-index.ts'
import { buildContinuumSummaryView, zoomContinuumSummaryView, type ContinuumSummarySource } from './summary-view.ts'
import type { ContinuumSummaryTreeConfig, ContinuumSummaryTreeNode } from './summary-tree.ts'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  appendMemoryIndexQueuedEvent,
  appendMemoryIndexRebuiltEvent,
  type MemoryIndexRebuildEventDetails,
  type MemoryWriteAttribution,
} from './persistence.ts'

/** Product state for the Reflex-only Continuum switch. */
export interface ContinuumMemorySwitch {
  readonly enabled: boolean
  readonly mode: 'off' | 'shadow' | 'active'
  readonly reflexMounted: boolean
}

/** Explicit read authority for one memory request. Scopes are exact matches. */
export interface ContinuumMemoryPrincipal {
  readonly scopes: readonly string[]
}

/** Decision made when resolving the product switch. */
export interface ContinuumMemorySwitchDecision {
  readonly enabled: boolean
  readonly mode: ContinuumMemorySwitch['mode']
  readonly reason: 'disabled' | 'reflex-required' | 'ready'
}

/** Resolve the switch without silently turning a missing Reflex into a new product mode.
 * @param config - Feature and Reflex availability inputs.
 * @returns The resolved product switch.
 */
export function resolveContinuumMemorySwitch(config: ContinuumMemorySwitch): ContinuumMemorySwitchDecision {
  if (!config.enabled) return { enabled: false, mode: 'off', reason: 'disabled' }
  if (!config.reflexMounted) return { enabled: false, mode: 'off', reason: 'reflex-required' }
  if (config.mode === 'off') return { enabled: false, mode: 'off', reason: 'disabled' }
  return { enabled: true, mode: config.mode, reason: 'ready' }
}

/** Index events one `observe` call appended, so a caller can attribute them to its write trigger. */
export type MemoryIndexObservation = readonly SessionEvent<'continuum/memory-index-rebuilt' | 'continuum/memory-index-queued'>[]

/** A read token whose generation prevents a stopped or disabled request from committing. */
export interface ContinuumMemoryReadTicket {
  readonly generation: number
  readonly principal: ContinuumMemoryPrincipal
}

/**
 * Lifecycle and authorization owner for one Continuum store.
 * Records remain durable when the switch is disabled; only future reads and
 * in-flight results are stopped. This class does not grant cross-user access.
 */
export class ContinuumMemoryController {
  private generation = 0
  private readonly index = new MemoryRecordIndex()
  private switchConfig: ContinuumMemorySwitch

  /** Counts from the cold-start rebuild, reported once the Session can accept events. */
  private coldStart: MemoryIndexRebuildResult | undefined
  /** Records that cold start indexed, and the interval the construction-time rebuild actually ran. */
  private coldStartDetails: MemoryIndexRebuildEventDetails | undefined

  constructor(
    private readonly store: MemoryRecordStore,
    config: ContinuumMemorySwitch,
  ) {
    // A cold start folds the whole record log into the index. The counts are
    // held here rather than appended: the controller is built while the
    // projection is still being installed, and appending then would put an
    // index event ahead of the record event that follows it.
    const rebuildStartedAt = Date.now()
    const snapshot = store.snapshot()
    this.coldStart = this.index.rebuild(snapshot)
    this.coldStartDetails = {
      appliedRecords: snapshot.map(record => ({
        recordId: record.id, revision: record.revision, terms: MemoryRecordIndex.termsOf(record),
      })),
      startedAt: rebuildStartedAt, endedAt: Date.now(),
    }
    this.switchConfig = { ...config }
  }

  /** Current resolved switch state.
   * @returns The current product switch.
   */
  state(): ContinuumMemorySwitchDecision {
    return resolveContinuumMemorySwitch(this.switchConfig)
  }

  /** Change the switch; changing it invalidates in-flight reads.
   * @param config - New feature and Reflex availability inputs.
   * @returns The resolved product switch.
   */
  setSwitch(config: ContinuumMemorySwitch): ContinuumMemorySwitchDecision {
    if (this.switchConfig.enabled === config.enabled
      && this.switchConfig.mode === config.mode
      && this.switchConfig.reflexMounted === config.reflexMounted) return this.state()
    this.switchConfig = { ...config }
    this.generation += 1
    return this.state()
  }

  /** Start an authorized read, or return undefined when the feature is off.
   * @param principal - Exact scopes visible to the request.
   * @returns A generation-bound read ticket when enabled.
   */
  beginRead(principal: ContinuumMemoryPrincipal): ContinuumMemoryReadTicket | undefined {
    if (!this.state().enabled) return undefined
    return { generation: this.generation, principal: { scopes: [...principal.scopes] } }
  }

  /** Retrieve only active records in scopes visible to the ticket.
   * @param ticket - Generation-bound authorization ticket.
   * @param config - Retrieval bounds.
   * @param query - User query used for lexical ranking.
   * @returns A bounded working set when the ticket remains current.
   */
  read(ticket: ContinuumMemoryReadTicket, config: MemoryRetrievalConfig, query: string): MemoryWorkingSet | undefined {
    return this.readWithReport(ticket, config, query)?.workingSet
  }

  /** Retrieve with the deterministic facts that produced the bounded working set.
   * @param ticket - Generation-bound authorization ticket.
   * @param config - Retrieval bounds.
   * @param query - User query used for lexical ranking.
   * @returns The bounded working set and its retrieval report when the ticket remains current.
   */
  readWithReport(ticket: ContinuumMemoryReadTicket, config: MemoryRetrievalConfig, query: string): MemoryRetrievalOutcome | undefined {
    if (!this.isCurrent(ticket)) return undefined
    const authorized = new Set(ticket.principal.scopes)
    const visible = { snapshot: () => this.store.snapshot().filter(record => authorized.has(record.scope)) }
    return retrieveMemoryWorkingSetWithReport(visible, { ...config, index: this.index }, query)
  }

  /** Build a current authorized summary navigation view without model calls.
   * @param ticket - Generation-bound authorization ticket.
   * @param config - Summary tree bounds.
   * @returns An authorized summary tree when current.
   */
  summary(ticket: ContinuumMemoryReadTicket, config: ContinuumSummaryTreeConfig = {}): ContinuumSummaryTreeNode | undefined {
    const view = this.summaryView(ticket, config)
    return view?.tree
  }

  /** Resolve a current tree node to exact Session source references.
   * @param ticket - Generation-bound authorization ticket.
   * @param path - Summary node path.
   * @param config - Summary tree bounds.
   * @returns Exact source references when current.
   */
  zoom(
    ticket: ContinuumMemoryReadTicket,
    path: string,
    config: ContinuumSummaryTreeConfig = {},
  ): readonly ContinuumSummarySource[] | undefined {
    const view = this.summaryView(ticket, config)
    return view === undefined ? undefined : zoomContinuumSummaryView(view, path)
  }

  /** Whether a result may still be committed after an async read or Jev decision.
   * @param ticket - Generation-bound authorization ticket.
   * @returns Whether the ticket remains current.
   */
  isCurrent(ticket: ContinuumMemoryReadTicket): boolean {
    return ticket.generation === this.generation && this.state().enabled
  }

  /** Record a committed snapshot in the disposable derived index.
   *
   * The index is disposable state, so its lag is invisible unless the log says
   * so: one event records the snapshot entering the queue, another records what
   * the bounded rebuild produced. A reader can then tell how far retrieval's
   * working set stood behind the record log at this moment.
   * @param record - Committed record snapshot.
   * @param session - Session that owns the record log; when present the index
   *   queue and rebuild are recorded as events.
   * @param attribution - the write trigger the queued snapshot belongs to.
   * @returns the index events this call appended, for the caller's write result.
   */
  observe(record: MemoryRecord, session?: Session, attribution?: MemoryWriteAttribution): MemoryIndexObservation {
    const observed: SessionEvent<'continuum/memory-index-rebuilt' | 'continuum/memory-index-queued'>[] = []
    if (session !== undefined && this.coldStart !== undefined) {
      // The first write is the first moment this Session accepts index events;
      // the cold-start counts are reported here, before the write's own. The cold
      // start rebuilt from the record store at construction, so its applied set
      // is that snapshot, reported at this later moment.
      observed.push(appendMemoryIndexRebuiltEvent(session, this.coldStart, 'full', undefined, this.coldStartDetails))
      this.coldStart = undefined
      this.coldStartDetails = undefined
    }
    this.index.enqueue(record)
    const pending = this.index.pendingCount()
    if (session !== undefined) {
      observed.push(appendMemoryIndexQueuedEvent(session, record.id, pending, {
        revision: record.revision, ...(attribution === undefined ? {} : { writeId: attribution.writeId }),
      }))
    }
    const startedAt = Date.now()
    const { result, applied } = this.index.rebuildPendingWithApplied(1)
    if (session !== undefined) {
      observed.push(appendMemoryIndexRebuiltEvent(session, result, 'bounded', 1, {
        appliedRecords: [...applied], startedAt, endedAt: Date.now(),
      }))
    }
    return observed
  }

  /** Publish a correction and invalidate reads that started before it.
   * @param record - Successor record snapshot.
   */
  supersede(record: MemoryRecord): void {
    this.observe(record)
    this.generation += 1
  }

  private summaryView(ticket: ContinuumMemoryReadTicket, config: ContinuumSummaryTreeConfig) {
    if (!this.isCurrent(ticket)) return undefined
    const authorized = new Set(ticket.principal.scopes)
    return buildContinuumSummaryView(this.store.snapshot().filter(record => authorized.has(record.scope)), config)
  }

  /** Deactivate a record and invalidate all in-flight projections.
   * @param id - Record identifier.
   * @param expectedRevision - Revision observed by the caller.
   * @returns The deactivated record.
   */
  deactivate(id: MemoryId, expectedRevision: number): MemoryRecord {
    const record = this.store.deactivate(id, expectedRevision)
    this.observe(record)
    this.generation += 1
    return record
  }
}
