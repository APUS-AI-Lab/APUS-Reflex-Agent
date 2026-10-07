/** Cordis service composing the System3 policy, evidence, and supervision seams. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createSystem3EntryRouter, type System3EntryRoutingConfig } from './entry-routing.ts'
import { system3DecisionProjection } from './decision-projection.ts'
import { system3RuntimeProjection } from './runtime-projection.ts'
import { installSystem3SkillSelection, type System3SkillSelectionConfig } from './skill-selection.ts'
import { installSystem3KeepWarm } from './keep-warm.ts'
import { installSystem3Delegation } from './delegation.ts'
import { validateSystem3HandoffPack } from './handoff-pack.ts'
import { installSystem3DelegationProgress, type System3DelegationProgressConfig } from './delegation-progress.ts'
import { installSystem3ProcessSupervision, type System3ProcessSupervisionConfig } from './process-supervision.ts'
import { installSystem3RouteHealth } from './route-health.ts'
import { installSystem3OutputFolding, type System3OutputFoldingConfig } from './output-folding.ts'
import { installSystem3TaskFrame, type System3TaskFrameConfig } from './task-frame.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import { recordSystem3Decision, type System3DecisionRequest, type System3DecisionReceipt, type System3JevOptions } from './decisions.ts'

export type { System3DecisionId, System3DecisionRequest, System3DecisionReceipt, System3DecisionOutcome } from './decisions.ts'
export type { System3JevOptions } from './decisions.ts'
export type { System3SkillSelectionConfig, System3SkillDecisionReceipt } from './skill-selection.ts'
export type { System3EntryView, System3SkillView, System3RuntimeView, System3TaskFrameView } from './types.ts'
export { createSystem3EntryRouter } from './entry-routing.ts'
export type { System3DelegationSource } from './delegation.ts'
export type { System3DelegationAlert, System3DelegationMonitorConfig, System3DelegationProgress, System3DelegationProgressConfig } from './delegation-progress.ts'
export type { System3EntryCandidate, System3EntryDelegateCandidate, System3EntryModelCandidate, System3EntryRoutingConfig, System3EntryDecisionReceipt, System3EntryOutcome } from './entry-routing.ts'
export type { System3KeepWarmConfig } from './keep-warm.ts'
export type { System3HandoffOutcome, System3HandoffPack, System3HandoffPackConfig } from './handoff-pack.ts'
export type { System3ProcessNotice, System3ProcessRule, System3ProcessSupervisionConfig, System3SupervisionSource } from './process-supervision.ts'
export type { System3TaskFrame, System3TaskFrameConfig, System3TaskMessage } from './task-frame.ts'
export type { System3DecisionMode, System3DecisionSettings, System3Judgement, System3JudgementReason } from './decision-kernel.ts'
export type { System3RouteHealth, System3RouteHealthConfig, System3RouteHealthReason, System3RouteHealthStatus } from './route-health.ts'
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
  /** Opt-in model recommendations for idle text prompts admitted through the Session API. */
  readonly entryRouting?: false | System3EntryRoutingConfig
  /** Opt-in scoped Skill advice and native pre-step instruction injection. */
  readonly skillSelection?: false | System3SkillSelectionConfig
  /** Opt-in persistent progress snapshots of subagent runs, written to the delegating Agent's Session. */
  readonly delegationProgress?: false | System3DelegationProgressConfig
  /** Stall rules and acceptance-evidence checks over each Agent loop; `false` or omission disables them. */
  readonly processSupervision?: false | System3ProcessSupervisionConfig
  /** Lossless folding of repeated lines in matching shell results; `false` or omission disables it. */
  readonly outputFolding?: false | System3OutputFoldingConfig
  /** The person's goal and later requirements, judged by Jev and shown to the main model verbatim; `false` or omission disables it. */
  readonly taskFrame?: false | System3TaskFrameConfig
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

/** Schema fields shared by model and delegation entry candidates. */
const candidateFields = {
  id: z.string().required(), description: z.string().required(), label: z.string(),
  executionDomain: z.union([z.const('local'), z.const('network')]).required(),
  dataClasses: z.array(z.union([z.const('public'), z.const('workspace'), z.const('sensitive'), z.const('secret')])).required(),
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
    entryRouting: z.union([z.const(false), z.object({
      deadlineMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      baseline: z.union([z.const(undefined), z.object({ executionDomain: z.union([z.const('local'), z.const('network')]).required(),
        dataClasses: z.array(z.union([z.const('public'), z.const('workspace'), z.const('sensitive'), z.const('secret')])).required() })]),
      candidates: z.array(z.union([z.object({
        ...candidateFields, provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string(),
      }), z.object({
        ...candidateFields, delegate: z.object({ provider: z.string().required(), tool: z.string().required() }).required(),
        explicitPatterns: z.array(z.string()),
      })])).required(),
      sessionDataClasses: z.array(z.union([z.const('public'), z.const('workspace'), z.const('sensitive'), z.const('secret')])).required(),
      minConfidence: z.number().min(0).max(1).required(),
      maxInputBytes: z.number().step(1).min(1).required(),
      retainOnAbstain: z.boolean().default(false),
      keepWarm: z.union([z.const(undefined), z.object({
        windowMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
        intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
      })]),
      routeHealth: z.union([z.const(undefined), z.object({
        window: z.number().step(1).min(1).required(),
        sampleTtlMs: z.number().step(1).min(1).required(),
        minSamples: z.number().step(1).min(1).required(),
        maxFirstTokenMs: z.number().min(0).required(),
        minTokensPerSecond: z.number().min(0).required(),
        minOutputTokens: z.number().step(1).min(1).required(),
        maxErrorRate: z.number().min(0).max(1).required(),
        probe: z.union([z.const(false), z.object({
          idleMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
          maxTokens: z.number().step(1).min(1).required(),
        })]).required(),
      })]),
      handoffPack: z.union([z.const(undefined), z.object({
        recentMessages: z.number().step(1).min(1).max(16).required(),
        maxMessageChars: z.number().step(1).min(1).required(),
        minProbability: z.number().min(0).max(1).required(),
        deadlineMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
      })]),
    })]).default(false),
    skillSelection: z.union([z.const(false), z.object({
      sessionDataClasses: z.array(z.union([z.const('public'), z.const('workspace'), z.const('sensitive'), z.const('secret')])).required(),
      minConfidence: z.number().min(0).max(1).required(), maxInputBytes: z.number().step(1).min(1).required(),
      maxContentBytes: z.number().step(1).min(1).required(), maxCandidates: z.number().step(1).min(1).max(254).required(),
      deadlineMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
    })]).default(false),
    delegationProgress: z.union([z.const(false), z.object({
      intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
      monitor: z.union([z.const(undefined), z.object({
        overtimeMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
        stallMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
        startupMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
      })]),
    })]).default(false),
    processSupervision: z.union([z.const(false), z.object({
      mode: z.union([z.const('observe'), z.const('advise')]).required(),
      repeatedError: z.number().step(1).min(1).required(),
      failedAttempts: z.number().step(1).min(1).required(),
      stalledSteps: z.number().step(1).min(1).required(),
      delegateFailures: z.number().step(1).min(1).required(),
      editTools: z.array(z.string()).required(),
      delegationTools: z.array(z.string()).required(),
      shellTools: z.array(z.string()).required(),
      progressTools: z.array(z.string()).required(),
      verifyPattern: z.string().required(),
      failurePattern: z.string().required(),
    })]).default(false),
    outputFolding: z.union([z.const(false), z.object({
      mode: z.union([z.const('shadow'), z.const('active')]).required(),
      shellTools: z.array(z.string()).required(),
      commandPattern: z.string().required(),
      minLines: z.number().step(1).min(1).required(),
      minChars: z.number().step(1).min(1).required(),
      minNetChars: z.number().step(1).min(1).required(),
      minNetShare: z.number().min(0).max(1).required(),
    })]).default(false),
    taskFrame: z.union([z.const(false), z.object({
      mode: z.union([z.const('off'), z.const('shadow'), z.const('active')]).required(),
      yes: z.number().min(0).max(1).required(),
      no: z.number().min(0).max(1).required(),
      deadlineMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
      sessionDataClasses: z.array(z.union([z.const('public'), z.const('workspace'), z.const('sensitive'), z.const('secret')])).required(),
      maxItems: z.number().step(1).min(1).required(),
      maxMessageChars: z.number().step(1).min(1).required(),
    })]).default(false),
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
    ctx.inject(['sessionProjections'], (ctx) => {
      ctx.sessionProjections.register(system3DecisionProjection)
      ctx.sessionProjections.register(system3RuntimeProjection)
    })
    if (config.entryRouting !== undefined && config.entryRouting !== false) {
      const routes = config.entryRouting.candidates.filter(candidate => candidate.delegate === undefined)
        .map(candidate => ({ provider: candidate.provider, model: candidate.model }))
      const health = config.entryRouting.routeHealth === undefined ? undefined
        : installSystem3RouteHealth(ctx, config.entryRouting.routeHealth, routes)
      const router = createSystem3EntryRouter(ctx, config.entryRouting, this.privacyPolicy, this.jevOptions, health)
      const retains = config.entryRouting.retainOnAbstain === true
      ctx.inject(retains ? ['sessionController', 'llm', 'sessionProjections'] : ['sessionController', 'llm'], (ctx) => {
        ctx.effect(() => ctx.sessionController.registerPromptRouter(router))
      })
      if (config.entryRouting.candidates.some(candidate => candidate.delegate !== undefined)) {
        const handoff = config.entryRouting.handoffPack
        if (handoff !== undefined) validateSystem3HandoffPack(handoff)
        const settings = handoff === undefined ? undefined : { config: handoff, policy: this.privacyPolicy, options: this.jevOptions,
          dataClasses: config.entryRouting.sessionDataClasses }
        ctx.inject(['sessionProjections'], (ctx) => { installSystem3Delegation(ctx, settings) })
      }
      const keepWarm = config.entryRouting.keepWarm
      if (keepWarm !== undefined) ctx.inject(['jev'], (ctx) => { installSystem3KeepWarm(ctx, keepWarm) })
    }
    if (config.delegationProgress !== undefined && config.delegationProgress !== false) {
      installSystem3DelegationProgress(ctx, config.delegationProgress)
    }
    if (config.processSupervision !== undefined && config.processSupervision !== false) {
      installSystem3ProcessSupervision(ctx, config.processSupervision)
    }
    if (config.outputFolding !== undefined && config.outputFolding !== false) {
      installSystem3OutputFolding(ctx, config.outputFolding)
    }
    if (config.taskFrame !== undefined && config.taskFrame !== false) {
      const taskFrame = { config: config.taskFrame, policy: this.privacyPolicy, options: this.jevOptions }
      ctx.inject(['systemPrompt'], (ctx) => { installSystem3TaskFrame(ctx, taskFrame) })
    }
    if (config.observeAgentLoop === true) this.observeAgentLoop()
    if (config.skillSelection !== undefined && config.skillSelection !== false) {
      const skillConfig = config.skillSelection
      ctx.inject(['skills', 'jev', 'agents'], (ctx) => { installSystem3SkillSelection(ctx, skillConfig, this.privacyPolicy, this.jevOptions) })
    }
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
