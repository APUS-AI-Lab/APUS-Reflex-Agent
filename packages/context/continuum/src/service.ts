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
  maxCandidates: z.number().step(1).min(1).required(),
  maxExcerptBytes: z.number().step(1).min(1).required(),
  maxTotalBytes: z.number().step(1).min(1).required(),
})

/** Public service seam used by profile consumers and tests. */
export interface ContinuumMemoryService {
  /** Return the current switch decision for this profile. */
  state(): ReturnType<ContinuumMemoryController['state']>
  /** Get the controller associated with one Agent, restoring it from Session events once. */
  controller(agent: Agent): ContinuumMemoryController
  /** Admit and persist one source-backed record in the Agent's Session. */
  create(agent: Agent, record: NewMemoryRecord): MemoryRecord
  /** Supersede and persist one record correction. */
  supersede(agent: Agent, id: MemoryId, expectedRevision: number, replacement: NewMemoryRecord): MemoryRecord
  /** Deactivate and persist one record. */
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
      const switchConfig: ContinuumMemorySwitch = { enabled: readSetting(config.enabled), mode: readSetting(config.mode), reflexMounted }
      const principal = { scopes: [...config.scopes] }
      installContinuumMemoryControllerContext(ctx, agent => this.controllerWithConfig(agent, switchConfig), () => principal, config, () => ctx.get('continuumMemorySelector'))
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
    this.controller(agent).observe(next)
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
    if (existing !== undefined) return existing
    const store = foldMemoryRecordEvents(agent.session.snapshotEvents(), new MemoryRecordStore())
    const controller = new ContinuumMemoryController(store, switchConfig)
    this.controllers.set(agent, controller)
    controllerStores.set(controller, store)
    return controller
  }
}

const controllerStores = new WeakMap<ContinuumMemoryController, MemoryRecordStore>()

function readSetting<T extends boolean | 'off' | 'shadow' | 'active'>(value: T | Volatile<T>): T {
  if (typeof value === 'object' && value !== null && 'get' in value) return value.get() as T
  return value
}
