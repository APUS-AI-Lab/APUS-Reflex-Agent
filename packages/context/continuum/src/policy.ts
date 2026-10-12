import type { MemoryRetrievalConfig, MemoryWorkingSet } from './retrieval.ts'
import { retrieveMemoryWorkingSet } from './retrieval.ts'
import { MemoryRecordStore, type MemoryId, type MemoryRecord } from './records.ts'
import { MemoryRecordIndex } from './memory-index.ts'
import { buildContinuumSummaryView, zoomContinuumSummaryView, type ContinuumSummarySource } from './summary-view.ts'
import type { ContinuumSummaryTreeConfig, ContinuumSummaryTreeNode } from './summary-tree.ts'

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

  constructor(
    private readonly store: MemoryRecordStore,
    config: ContinuumMemorySwitch,
  ) {
    this.index.rebuild(store.snapshot())
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
    if (!this.isCurrent(ticket)) return undefined
    const authorized = new Set(ticket.principal.scopes)
    const visible = new MemoryRecordStore()
    for (const record of this.store.snapshot()) {
      if (record.status !== 'active' || !authorized.has(record.scope)) continue
      copyRecord(visible, record)
    }
    return retrieveMemoryWorkingSet(visible, { ...config, index: this.index }, query)
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
   * @param record - Committed record snapshot.
   */
  observe(record: MemoryRecord): void {
    this.index.enqueue(record)
    this.index.rebuildPending(1)
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

function copyRecord(target: MemoryRecordStore, record: MemoryRecord): void {
  target.create({ id: record.id, kind: record.kind, scope: record.scope, content: record.content, sourceRefs: record.sourceRefs })
}
