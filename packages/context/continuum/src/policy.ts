import type { MemoryRetrievalConfig, MemoryWorkingSet } from './retrieval.ts'
import { retrieveMemoryWorkingSet } from './retrieval.ts'
import { MemoryRecordStore, type MemoryId, type MemoryRecord } from './records.ts'

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

/** Resolve the switch without silently turning a missing Reflex into a new product mode. */
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
  private switchConfig: ContinuumMemorySwitch

  constructor(
    private readonly store: MemoryRecordStore,
    config: ContinuumMemorySwitch,
  ) {
    this.switchConfig = { ...config }
  }

  /** Current resolved switch state. */
  state(): ContinuumMemorySwitchDecision {
    return resolveContinuumMemorySwitch(this.switchConfig)
  }

  /** Change the switch; changing it invalidates in-flight reads. */
  setSwitch(config: ContinuumMemorySwitch): ContinuumMemorySwitchDecision {
    this.switchConfig = { ...config }
    this.generation += 1
    return this.state()
  }

  /** Start an authorized read, or return undefined when the feature is off. */
  beginRead(principal: ContinuumMemoryPrincipal): ContinuumMemoryReadTicket | undefined {
    if (!this.state().enabled) return undefined
    return { generation: this.generation, principal: { scopes: [...principal.scopes] } }
  }

  /** Retrieve only active records in scopes visible to the ticket. */
  read(ticket: ContinuumMemoryReadTicket, config: MemoryRetrievalConfig, query: string): MemoryWorkingSet | undefined {
    if (!this.isCurrent(ticket)) return undefined
    const authorized = new Set(ticket.principal.scopes)
    const visible = new MemoryRecordStore()
    for (const record of this.store.snapshot()) {
      if (record.status !== 'active' || !authorized.has(record.scope)) continue
      copyRecord(visible, record)
    }
    return retrieveMemoryWorkingSet(visible, config, query)
  }

  /** Whether a result may still be committed after an async read or Jev decision. */
  isCurrent(ticket: ContinuumMemoryReadTicket): boolean {
    return ticket.generation === this.generation && this.state().enabled
  }

  /** Deactivate a record and invalidate all in-flight projections. */
  deactivate(id: MemoryId, expectedRevision: number): MemoryRecord {
    const record = this.store.deactivate(id, expectedRevision)
    this.generation += 1
    return record
  }
}

function copyRecord(target: MemoryRecordStore, record: MemoryRecord): void {
  target.create({ id: record.id, kind: record.kind, scope: record.scope, content: record.content, sourceRefs: record.sourceRefs })
}
