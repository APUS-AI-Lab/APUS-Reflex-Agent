import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { ContinuumMemoryController, resolveContinuumMemorySwitch, type ContinuumMemorySwitch } from './policy.ts'
import { appendMemoryRecordEvent, foldMemoryRecordEvents } from './persistence.ts'
import { MemoryRecordStore, type MemoryId, type MemoryRecord, type NewMemoryRecord } from './records.ts'
import { installContinuumMemoryControllerContext, type ContinuumMemoryContextConfig } from './context.ts'

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
}

type ContinuumResolvedConfig = Omit<ContinuumConfig, 'enabled' | 'mode'> & {
  readonly enabled: Volatile<boolean>
  readonly mode: Volatile<'off' | 'shadow' | 'active'>
}

/** Schemastery validation for {@link ContinuumConfig}. */
export const ContinuumConfig = z.object({
  enabled: z.boolean().default(false).volatile(),
  mode: z.union([z.const('off'), z.const('shadow'), z.const('active')]).default('off').volatile(),
  scopes: z.array(z.string()).default([]),
  maxCandidates: z.number().step(1).min(1).default(8),
  maxExcerptBytes: z.number().step(1).min(1).default(2048),
  maxTotalBytes: z.number().step(1).min(1).default(8192),
})

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
}

/**
 * Session-backed Continuum profile service. It owns one projection per Agent,
 * restores that projection from the Agent Session, and installs the explicit
 * same-step consumer when the profile switch resolves to a usable state.
 */
export default class ContinuumMemory extends Service implements ContinuumMemoryService {
  static Config = ContinuumConfig

  private readonly config: ContinuumConfig | ContinuumResolvedConfig
  private readonly controllers = new WeakMap<Agent, ContinuumMemoryController>()

  constructor(ctx: Context, config: ContinuumConfig | ContinuumResolvedConfig) {
    super(ctx, 'continuumMemory')
    this.config = config
    ctx.inject(['agents'], (ctx) => {
      const reflexMounted = ctx.get('jev') !== undefined
      const principal = { scopes: [...config.scopes] }
      installContinuumMemoryControllerContext(ctx, agent => this.controllerWithConfig(agent, {
        enabled: readSetting(config.enabled), mode: readSetting(config.mode), reflexMounted,
      }), () => principal, config, () => ctx.get('continuumMemorySelector'))
    })
  }

  state(): ReturnType<ContinuumMemoryController['state']> {
    return resolveContinuumMemorySwitch({ enabled: readSetting(this.config.enabled), mode: readSetting(this.config.mode), reflexMounted: this.ctx.get('jev') !== undefined })
  }

  controller(agent: Agent): ContinuumMemoryController {
    return this.controllerWithConfig(agent, { enabled: readSetting(this.config.enabled), mode: readSetting(this.config.mode), reflexMounted: this.ctx.get('jev') !== undefined })
  }

  create(agent: Agent, record: NewMemoryRecord): MemoryRecord {
    const store = this.storeFor(agent)
    const created = store.create(record)
    appendMemoryRecordEvent(agent.session, 'create', created)
    this.controller(agent).observe(created)
    return created
  }

  supersede(agent: Agent, id: MemoryId, expectedRevision: number, replacement: NewMemoryRecord): MemoryRecord {
    const next = this.storeFor(agent).supersede(id, expectedRevision, replacement)
    appendMemoryRecordEvent(agent.session, 'supersede', next)
    this.controller(agent).supersede(next)
    return next
  }

  deactivate(agent: Agent, id: MemoryId, expectedRevision: number): MemoryRecord {
    const next = this.controller(agent).deactivate(id, expectedRevision)
    appendMemoryRecordEvent(agent.session, 'deactivate', next)
    return next
  }

  private storeFor(agent: Agent): MemoryRecordStore {
    const controller = this.controller(agent)
    const store = controllerStores.get(controller)
    if (store === undefined) throw new Error('Continuum controller store is unavailable')
    return store
  }

  private controllerWithConfig(agent: Agent, switchConfig: ContinuumMemorySwitch): ContinuumMemoryController {
    const existing = this.controllers.get(agent)
    if (existing !== undefined) {
      existing.setSwitch(switchConfig)
      return existing
    }
    // oxlint-disable-next-line typescript/no-deprecated -- deferred until Session exposes a memory projection.
    const store = foldMemoryRecordEvents(agent.session.snapshotEvents(), new MemoryRecordStore())
    const controller = new ContinuumMemoryController(store, switchConfig)
    this.controllers.set(agent, controller)
    controllerStores.set(controller, store)
    return controller
  }
}

const controllerStores = new WeakMap<ContinuumMemoryController, MemoryRecordStore>()

function readSetting<T extends boolean | 'off' | 'shadow' | 'active'>(value: T | Volatile<T>): T {
  if (typeof value === 'object') return value.get() as T
  return value
}
