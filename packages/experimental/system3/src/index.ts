/** Cordis service composing the System3 policy, evidence, and supervision seams. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import { system3DecisionProjection } from './decision-projection.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import { recordSystem3Decision, type System3DecisionRequest, type System3DecisionReceipt, type System3JevOptions } from './decisions.ts'

export type { System3DecisionId, System3DecisionRequest, System3DecisionReceipt, System3DecisionOutcome } from './decisions.ts'
import { selectSystem3Evidence, type System3EvidenceRequest, type System3EvidenceSelection } from '@deepseek-ai/dsh-experimental-system3-evidence'
import { selectSystem3Route, type System3PrivacyMode, type System3RouteCandidate, type System3RouteSelection, type System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import { compareSystem3Advice, superviseSystem3Advice, sumSystem3CostRecords, validateSystem3CostRecord, type System3AdviceAction, type System3CostRecord, type System3SupervisorRequest, type System3SupervisorResult, type System3ShadowComparison } from '@deepseek-ai/dsh-experimental-system3-supervisor'

export type { System3EvidenceRequest, System3EvidenceSelection } from '@deepseek-ai/dsh-experimental-system3-evidence'
export type { System3PrivacyMode, System3PrivacyPolicy, System3RouteCandidate, System3RouteSelection } from '@deepseek-ai/dsh-experimental-system3-policy'
export type { System3AdviceAction, System3CostRecord, System3ShadowComparison, System3SupervisorRequest, System3SupervisorResult } from '@deepseek-ai/dsh-experimental-system3-supervisor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental System3 decision, evidence, and supervision service. */
    system3: System3Service
  }
}

/** Configures the default local-first privacy boundary. */
export interface Config {
  /** Privacy policy applied before route selection or explicit Jev calls. @default 'local-only' */
  readonly privacyMode?: System3PrivacyMode
  /** Remote route identities permitted when the privacy mode allows network execution. */
  readonly approvedRemoteIds?: readonly string[]
  /** Data classes permitted on approved remote routes; undeclared classes are refused. */
  readonly approvedRemoteDataClasses?: readonly ('public' | 'workspace' | 'sensitive' | 'secret')[]
  /** Additional explicit approval required by cloud-approved mode. @default false */
  readonly cloudApproval?: boolean
  /** Observe AgentLoop boundaries without changing prompts, routes, or results. */
  readonly observeAgentLoop?: boolean
  /** Privacy-policy route identity for explicit Jev calls. */
  readonly jevRouteId?: string
  /** Actual execution location, including the remote destination of any tunnel. */
  readonly jevExecutionDomain?: 'local' | 'network'
  /** Execution effort sent to the Jev provider. */
  readonly jevEffort?: 'low' | 'high'
}

/** Small operational counters, intentionally free of user data. */
export interface System3ServiceSnapshot {
  readonly routes: number
  readonly evidence: number
  readonly supervision: number
  readonly shadow: number
  readonly costs: number
  readonly agent: {
    readonly preSteps: number
    readonly requests: number
    readonly requestErrors: number
    readonly turnStops: number
  }
}

/** Unified runtime seam for the System3 pure policies. */
export interface System3Service {
  readonly privacyPolicy: System3PrivacyPolicy
  /**
   * Choose the route a request may take under the privacy policy.
   * @param candidates - Routes the caller could use, in preference order.
   * @param preferredId - Route to take when it is admitted.
   * @returns The admitted route, or the reasons every candidate was refused.
   */
  route(candidates: readonly System3RouteCandidate[], preferredId?: string): System3RouteSelection
  /**
   * Select recoverable evidence that fits the request's budget.
   * @param request - Candidate evidence items and the budget.
   * @returns The chosen items and what was left out.
   */
  evidence(request: System3EvidenceRequest): System3EvidenceSelection
  /**
   * Decide whether a turn may complete from its classified facts.
   * @param request - Supervisor facts and independent checks.
   * @returns The deterministic completion decision.
   */
  supervise(request: System3SupervisorRequest): System3SupervisorResult
  /**
   * Compare model advice with the deterministic decision without changing it.
   * @param modelAction - Action the model advised.
   * @param baseline - Deterministic supervisor decision.
   * @returns Agreement and disagreement facts for the ledger.
   */
  shadow(modelAction: System3AdviceAction, baseline: System3SupervisorResult): System3ShadowComparison
  /**
   * Validate one usage record before it enters the ledger.
   * @param record - Usage and cost of one call.
   * @returns The same record when valid.
   */
  validateCost(record: System3CostRecord): System3CostRecord
  /**
   * Add usage records into one total.
   * @param records - Validated usage records.
   * @returns Their sum.
   */
  sumCosts(records: readonly System3CostRecord[]): System3CostRecord
  /**
   * Read operational counters, free of user data.
   * @returns Current counters.
   */
  snapshot(): System3ServiceSnapshot
  /**
   * Record Jev advice beside the unchanged deterministic baseline.
   * @param session - Session owning the persisted decision.
   * @param request - Classified supervisor facts and independent checks.
   * @param signal - Caller cancellation.
   * @returns Committed, non-model-visible receipt.
   */
  shadowDecision(session: Session, request: System3DecisionRequest, signal?: AbortSignal): Promise<System3DecisionReceipt>
  /**
   * Read the latest projected receipt without calling Jev during replay.
   * @param session - Live or restored Session.
   * @returns Latest committed receipt, or null before the first decision.
   */
  lastDecision(session: Session): System3DecisionReceipt | null
}

/**
 * Cordis service that composes policy modules without owning an AgentLoop.
 *
 * The service is deliberately a narrow seam: callers still supply provider
 * candidates, complete artifacts, independent checks, and usage records. This
 * keeps the next integration step explicit instead of silently intercepting
 * every model call.
 */
export default class System3 extends Service implements System3Service {
  static Config = z.object({
    privacyMode: z.union([z.const('local-only'), z.const('controlled'), z.const('cloud-approved')]).default('local-only'),
    approvedRemoteIds: z.array(z.string()).default([]),
    approvedRemoteDataClasses: z.array(z.union([z.const('public'), z.const('workspace'), z.const('sensitive'), z.const('secret')])).default([]),
    cloudApproval: z.boolean().default(false),
    observeAgentLoop: z.boolean().default(false),
    jevRouteId: z.string().default('jev'),
    jevExecutionDomain: z.union([z.const('local'), z.const('network')]).default('network'),
    jevEffort: z.union([z.const('low'), z.const('high')]).default('low'),
  })

  readonly privacyPolicy: System3PrivacyPolicy
  private readonly jevOptions: System3JevOptions
  private readonly counters = { routes: 0, evidence: 0, supervision: 0, shadow: 0, costs: 0 }
  private readonly agentCounters = { preSteps: 0, requests: 0, requestErrors: 0, turnStops: 0 }

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'system3')
    this.jevOptions = { routeId: config.jevRouteId ?? 'jev', executionDomain: config.jevExecutionDomain ?? 'network', effort: config.jevEffort ?? 'low' }
    this.privacyPolicy = {
      mode: config.privacyMode ?? 'local-only',
      ...(config.approvedRemoteIds === undefined ? {} : { approvedRemoteIds: [...config.approvedRemoteIds] }),
      ...(config.approvedRemoteDataClasses === undefined ? {} : { approvedRemoteDataClasses: [...config.approvedRemoteDataClasses] }),
      ...(config.cloudApproval === undefined ? {} : { cloudApproval: config.cloudApproval }),
    }
    ctx.inject(['sessionProjections'], ctx => ctx.sessionProjections.register(system3DecisionProjection))
    if (config.observeAgentLoop === true) this.observeAgentLoop()
  }

  /** Install non-mutating AgentLoop observers for runtime smoke tests and telemetry. */
  private observeAgentLoop(): void {
    this.ctx.on('agent/pre-step', async (_payload, next) => {
      this.agentCounters.preSteps += 1
      return await next()
    })
    this.ctx.on('agent/request', async (_payload, next) => {
      this.agentCounters.requests += 1
      return await next()
    })
    this.ctx.on('agent/request-error', async (_payload, next) => {
      this.agentCounters.requestErrors += 1
      return await next()
    })
    this.ctx.on('agent/turn-stopping', () => {
      this.agentCounters.turnStops += 1
    })
  }

  route(candidates: readonly System3RouteCandidate[], preferredId?: string): System3RouteSelection {
    this.counters.routes += 1
    return selectSystem3Route(this.privacyPolicy, candidates, preferredId)
  }

  evidence(request: System3EvidenceRequest): System3EvidenceSelection {
    this.counters.evidence += 1
    return selectSystem3Evidence(request)
  }

  supervise(request: System3SupervisorRequest): System3SupervisorResult {
    this.counters.supervision += 1
    return superviseSystem3Advice(request)
  }

  shadow(modelAction: System3AdviceAction, baseline: System3SupervisorResult): System3ShadowComparison {
    this.counters.shadow += 1
    return compareSystem3Advice(modelAction, baseline)
  }

  validateCost(record: System3CostRecord): System3CostRecord {
    this.counters.costs += 1
    return validateSystem3CostRecord(record)
  }

  sumCosts(records: readonly System3CostRecord[]): System3CostRecord {
    this.counters.costs += records.length
    return sumSystem3CostRecords(records)
  }

  async shadowDecision(session: Session, request: System3DecisionRequest, signal?: AbortSignal): Promise<System3DecisionReceipt> {
    const receipt = await recordSystem3Decision(this.ctx, session, this.privacyPolicy, this.jevOptions, request, signal)
    this.counters.shadow += 1
    return receipt
  }

  lastDecision(session: Session): System3DecisionReceipt | null {
    const projections = this.ctx.get('sessionProjections')
    if (projections === undefined) throw new Error('System3 receipt reads require sessionProjections')
    const receipt = projections.stateOf(session, 'lastSystem3Decision')
    if (receipt === undefined) throw new Error('System3 decision projection is not registered')
    return receipt
  }

  snapshot(): System3ServiceSnapshot {
    return { ...this.counters, agent: { ...this.agentCounters } }
  }
}
