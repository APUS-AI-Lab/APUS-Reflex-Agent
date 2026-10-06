/** Optional host-owned model routing before an idle text prompt enters its Agent. */
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from './types.ts'
import type { ApiSessionAgentController } from './agent.ts'

/** One identified input eligible for automatic model selection. */
export interface SessionPromptRouteRequest {
  /** Exact live root Agent receiving the input. */
  readonly agent: Agent
  /** Idempotency identity retained by the API prompt source. */
  readonly requestId: SessionRequestId
  /** Text message that ordinary admission will insert unchanged. */
  readonly message: UserMessage
  /** Session generation route restored after this turn. */
  readonly baseline: ModelSelection
}

/** Host provider that advises a route without admitting or mutating the input. */
export interface SessionPromptRouter {
  /** Total routing and model-preparation budget; omission leaves existing providers unbounded. */
  readonly deadlineMs?: number
  /**
   * Refuse a fallback route whose execution location or data permissions are unknown or denied.
   * @param request - Exact pending input and current baseline.
   */
  validateBaseline?(request: SessionPromptRouteRequest): void
  /**
   * Select a registered generation route; undefined preserves the baseline.
   * @param request - Exact input and baseline captured before admission.
   * @param signal - Aborted on user cancellation, Agent disposal, or provider removal.
   * @returns A model selection for this input's turn, or no override.
   */
  route(request: SessionPromptRouteRequest, signal: AbortSignal): Promise<ModelSelection | undefined>
}

interface Registration {
  readonly router: SessionPromptRouter
  readonly abort: AbortController
}

/** Await an untrusted provider without retaining an abort listener after settlement. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const cancelled = Promise.withResolvers<never>()
  const onAbort = (): void => { cancelled.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([work, cancelled.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Controller-owned registration and cancellation for optional prompt routing. */
export class SessionPromptRouting {
  private registration: Registration | undefined

  /**
   * @param ctx - Host context owning the Agent registry and model adapters.
   * @param agents - Session-local model selection owner.
   */
  constructor(private readonly ctx: Context, private readonly agents: ApiSessionAgentController) {}

  /**
   * Register the sole router. Provider removal aborts pending decisions; admitted turns retain their route.
   * @param router - Provider registered by its plugin's effect.
   * @returns Idempotent disposer, also registered with the controller lifetime.
   */
  register(router: SessionPromptRouter): () => void {
    if (this.registration !== undefined) throw new Error('Session prompt router already registered')
    if (router.deadlineMs !== undefined
      && (!Number.isSafeInteger(router.deadlineMs) || router.deadlineMs <= 0 || router.deadlineMs > MAX_TIMER_DELAY_MS)) {
      throw new Error('Session prompt router deadlineMs must be a positive safe integer')
    }
    const registration: Registration = { router, abort: new AbortController() }
    this.registration = registration
    const dispose = this.ctx.effect(() => () => {
      this.registration = undefined
      registration.abort.abort(new DOMException('Session prompt router removed', 'AbortError'))
    }, 'session-controller.prompt-router')
    return () => { void dispose() }
  }

  /**
   * Route only idle, text-only, unfixed inputs; other prompts use ordinary admission.
   * The caller serializes this operation with prompt admission and manual model selection.
   * @param request - Input not yet inserted into the inbox.
   * @param admit - Original admission; check the signal and call select synchronously after inbox insertion.
   * @returns The original admission result.
   */
  async admit<T>(request: SessionPromptRouteRequest, admit: (signal?: AbortSignal, select?: () => void) => Promise<T>): Promise<T> {
    const registration = this.registration
    const { agent } = request
    if (registration === undefined || agent.status !== 'idle' || (agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0)
      || request.message.content.some(part => part.type !== 'text')
      || this.agents.hasExplicitSelection(agent)) return admit()
    let admission: Promise<T>
    try {
      // Only synchronous ownership refusal permits queueing.
      admission = agent.runMaintenance(async (maintenanceSignal) => {
        const ownerSignal = AbortSignal.any([maintenanceSignal, registration.abort.signal])
        const deadline = new AbortController()
        const timer = registration.router.deadlineMs === undefined ? undefined : setTimeout(() => {
          deadline.abort(new DOMException('Session entry deadline exceeded', 'TimeoutError'))
        }, registration.router.deadlineMs)
        const signal = AbortSignal.any([ownerSignal, deadline.signal])
        try {
          signal.throwIfAborted()
          const baseline = this.agents.selectionFor(agent).current
          const input = { ...request, baseline }
          registration.router.validateBaseline?.(input)
          // Prepare a permitted fallback before making an optional recommendation.
          const baselineConfig = await abortable(this.ctx.llm.resolveCallConfig(baseline, signal), signal)
          let routed: ModelSelection | undefined
          let resolved = baselineConfig
          let admissionSignal = signal
          try {
            routed = await abortable(registration.router.route(input, signal), signal)
            signal.throwIfAborted()
            if (routed !== undefined) resolved = await abortable(this.ctx.llm.resolveCallConfig(routed, signal), signal)
            signal.throwIfAborted()
          } catch (error) {
            ownerSignal.throwIfAborted()
            if (!deadline.signal.aborted) throw error
            // A deadline may use only the already prepared, permitted baseline.
            routed = undefined
            resolved = baselineConfig
            admissionSignal = ownerSignal
          }
          // Competing input keeps its original route and queue priority.
          if (agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0
          || this.agents.hasExplicitSelection(agent)) return await admit(admissionSignal)
          const selected = routed ?? baseline
          admissionSignal.throwIfAborted()
          if (agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0
          || this.agents.hasExplicitSelection(agent)) return await admit(admissionSignal)
          let restore: (() => void) | undefined
          const select = (): void => {
            admissionSignal.throwIfAborted()
            const pending = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
            if (pending.some(message => message.id !== request.message.id)
            || this.agents.hasExplicitSelection(agent)) return
            const restoreSelection = this.agents.installAutomaticSelection(agent, {
              provider: resolved.provider,
              model: resolved.model,
              ...selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort },
            }, baseline, request.requestId)
            restore = (): void => { stop(); restoreSelection() }
            const stop = agent.ctx.on('session/event', (session, event) => {
              if (session === agent.session && event.type === 'turn/end') restore?.()
            })
          }
          try {
            admissionSignal.throwIfAborted()
            return await admit(admissionSignal, select)
          } catch (error: unknown) {
            restore?.()
            agent.inbox.remove(request.message.id)
            throw error
          }
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.message === `agent "${agent.id}" already has active work`) return admit()
      throw error
    }
    return admission
  }
}
