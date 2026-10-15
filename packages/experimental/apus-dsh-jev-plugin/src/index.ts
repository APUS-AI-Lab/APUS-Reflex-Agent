/** Experimental generic Jev capability with a built-in APUS System One provider. */
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { parseReflexConnectionInput, testReflexConnection } from './settings.ts'
import type { ReflexCapabilityId, ReflexCapabilityState, ReflexConnectionInput, ReflexConnectionResult, ReflexStatus } from './types.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { JevProviderError, SystemOneProvider, resolveJevApiKey, normalizeJevEndpoint } from './client.ts'
import { createPooledFetch } from './pool.ts'
import { MAX_JEV_QUESTIONS, validateJevRequest } from './protocol.ts'
import type { JevFailure, JevOutcome, JevProvider, JevProviderInfo, JevRequest, JevResponse, JevSpec } from './types.ts'

export type * from './types.ts'
export { JevProtocolError, MAX_JEV_CHOICES, MAX_JEV_QUESTIONS, parseJevResponse, validateJevRequest } from './protocol.ts'
export { JevProviderError, SystemOneProvider } from './client.ts'
export type { JevFetch, SystemOneProviderOptions } from './client.ts'

/** A selected Jev provider is missing its deployment configuration or registration. */
export class JevConfigurationError extends Error {
  override name = 'JevConfigurationError'
}

/** Reflex is turned off in settings; callers that treat a missing provider as fatal can keep their native path instead. */
export class JevDisabledError extends JevConfigurationError {
  override name = 'JevDisabledError'
}

export const name = 'apus-dsh-jev-plugin'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-neutral typed Jev decision service. */
    jev: Jev
  }
  interface Events {
    /**
     * The Reflex settings switch changed; `loader/volatile-update` reaches only the Jev entry, so dependents listen here.
     * @param enabled - Whether Reflex decisions now run.
     * @mode emit
     */
    'jev/enabled'(enabled: boolean): void
  }
}

/** Plugin configuration for the built-in System One provider. */
export interface Config {
  /**
   * Whether Reflex decisions run. When false, resolving or sending a decision throws {@link JevDisabledError}, a
   * {@link JevConfigurationError} like an unconfigured provider's, and nothing reaches the gateway, so each caller keeps
   * its native path; provider metadata stays listed. Changes apply to the next decision. @default true
   */
  readonly enabled: Volatile<boolean>
  /** System One gateway URL; empty with model leaves the provider unconfigured. Credentials use apiKeyEnv. */
  readonly endpoint: Volatile<string>
  /** Wire protocol; the official API does not receive the OpenJev effort extension. @default 'openjev' */
  readonly protocol: Volatile<'openjev' | 'typesafe'>
  /** Model identifier used when a decision request omits its model; empty with endpoint permits first-run settings. */
  readonly model: Volatile<string>
  /** Decision effort used when a request omits it. @default 'low' */
  readonly effort: Volatile<'low' | 'high'>
  /** Maximum duration in milliseconds for the gateway HTTP request. @default 30000 */
  readonly timeoutMs: Volatile<number>
  /** Credential reference for bearer authentication; omission permits an unauthenticated gateway. */
  readonly apiKeyEnv: Volatile<string | undefined>
  /**
   * Registry identity of the built-in provider; selected when a request omits providerId and `defaultProviderId` is
   * unset. @default 'system-one'
   */
  readonly providerId?: string
  /**
   * Provider selected when a request omits providerId. Another plugin may register it; changing it switches the next
   * decision without renaming or reloading the built-in provider. Omission selects `providerId`.
   */
  readonly defaultProviderId?: Volatile<string | undefined>
  /**
   * Idle time in milliseconds a direct connection to the gateway stays open for reuse. Omission keeps
   * the process-wide transport. A request routed through a configured HTTP proxy always uses that proxy's transport.
   */
  readonly keepAliveMs?: number
  /** Negotiate HTTP/2 on the dedicated direct connection; requires `keepAliveMs`. @default false */
  readonly http2?: boolean
  /** Consecutive requests without a response after which the dedicated pool reopens; requires `keepAliveMs`. Omission never reopens it. */
  readonly resetAfterFailures?: number
  /**
   * Most questions one gateway request carries. A decision with more questions is sent as consecutive groups of this
   * size in parallel requests with the same state, and their answers are merged into one response; gateway time grows
   * with the question count, so parallel groups answer sooner. Omission sends every decision as one request.
   */
  readonly questionsPerRequest?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_PROVIDER_ID = 'system-one'

/** Validate complete provider settings while allowing an empty first-run configuration. */
function providerIdentity(config: Config): { endpoint: string; model: string } | undefined {
  const endpoint = config.endpoint.get().trim()
  const model = config.model.get().trim()
  if (!endpoint && !model) return undefined
  if (!endpoint || !model) throw new Error('Jev requires both an endpoint and a model')
  return { endpoint: normalizeJevEndpoint(endpoint), model }
}

/** Cordis service that resolves one pinned Jev provider per request. */
export default class Jev extends TypertRemoteService {
  static Config = z.object({
    enabled: z.boolean().default(true).volatile(),
    endpoint: z.string().default('').volatile(),
    protocol: z.union([z.const('openjev'), z.const('typesafe')]).default('openjev').volatile(),
    model: z.string().max(256).default('').volatile(),
    effort: z.union([z.const('low'), z.const('high')]).default('low').volatile(),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS).volatile(),
    apiKeyEnv: z.string().role('credential-ref').volatile(),
    providerId: z.string().default(DEFAULT_PROVIDER_ID),
    defaultProviderId: z.string().volatile(),
    keepAliveMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
    http2: z.boolean().default(false),
    resetAfterFailures: z.number().step(1).min(1),
    questionsPerRequest: z.number().step(1).min(1).max(MAX_JEV_QUESTIONS),
  })

  private readonly providers = new Map<string, JevProvider>()
  private readonly builtinProviderId: string
  private readonly defaultProviderId: () => string
  private readonly defaultEffort: () => 'low' | 'high'
  private readonly configuredProvider: () => SystemOneProvider | undefined
  private readonly capabilityReaders = new Map<ReflexCapabilityId, () => ReflexCapabilityState>()
  private readonly questionsPerRequest: number | undefined
  private readonly enabled: () => boolean

  constructor(ctx: Context, config: Config) {
    super(ctx, 'jev', { namespace: 'reflex' })
    const providerId = config.providerId ?? DEFAULT_PROVIDER_ID
    this.builtinProviderId = providerId
    this.defaultProviderId = () => config.defaultProviderId?.get() ?? providerId
    this.defaultEffort = () => config.effort.get()
    this.questionsPerRequest = config.questionsPerRequest
    this.enabled = () => config.enabled.get()
    let announced = this.enabled()
    ctx.on('loader/volatile-update', () => {
      if (this.enabled() === announced) return
      announced = this.enabled()
      ctx.emit('jev/enabled', announced)
    })
    if (config.http2 === true && config.keepAliveMs === undefined) throw new Error('jev http2 requires keepAliveMs')
    if (config.resetAfterFailures !== undefined && config.keepAliveMs === undefined) throw new Error('jev resetAfterFailures requires keepAliveMs')
    const fetcher = config.keepAliveMs === undefined ? undefined
      : createPooledFetch(ctx, config.keepAliveMs, config.http2 ?? false, config.resetAfterFailures)
    this.configuredProvider = () => {
      const identity = providerIdentity(config)
      if (identity === undefined) return undefined
      const apiKeyEnv = config.apiKeyEnv.get()
      return new SystemOneProvider({
        id: providerId,
        ...fetcher === undefined ? {} : { fetcher },
        ...identity, protocol: config.protocol.get(),
        effort: config.effort.get(), timeoutMs: config.timeoutMs.get(),
        ...apiKeyEnv === undefined ? {} : { apiKeyEnv, resolveApiKey: () => resolveJevApiKey(ctx, apiKeyEnv) },
      })
    }
    // Validate the initial deployment before making the service available.
    this.configuredProvider()
    ctx.on('internal/config', function (this: import('@deepseek-ai/cordis').Fiber, _input, next) {
      const resolved: unknown = next()
      if (this !== ctx.fiber) return resolved
      const candidate = Jev.Config(resolved as Parameters<typeof Jev.Config>[0])
      providerIdentity(candidate)
      return resolved
    }, { prepend: true }) // Validate after the loader evaluates inherited !!js expressions.
  }

  /**
   * Read the settings switch; `jev/enabled` announces each change.
   * @returns Whether Reflex decisions run, so callers can hide Reflex-only features while it is off.
   */
  isEnabled(): boolean {
    return this.enabled()
  }

  /** Register the runtime owner of one capability's observed status.
   * @param id - Product capability identity.
   * @param read - Runtime status projection; connection probes never update it.
   * @returns Disposer removing this reader.
   */
  registerCapability(id: ReflexCapabilityId, read: () => ReflexCapabilityState): () => void {
    if (this.capabilityReaders.has(id)) throw new Error(`Reflex capability ${id} is already registered`)
    this.capabilityReaders.set(id, read)
    return () => { if (this.capabilityReaders.get(id) === read) this.capabilityReaders.delete(id) }
  }

  /** Read provider identity and independently observed capability states without credentials.
   * @returns Current provider and capability status.
   */
  @Remote
  readStatus(): ReflexStatus {
    const ids: ReflexCapabilityId[] = ['entryRouting', 'codexSupervision', 'contextMemory', 'skillSelection']
    return {
      provider: this.configuredProvider()?.info ?? null,
      capabilities: ids.map(id => ({ id, ...(this.capabilityReaders.get(id)?.() ?? { implemented: false, enabled: false }) })),
    }
  }

  /** Test a candidate without persisting configuration or modifying capability status.
   * @param input - Candidate endpoint/model and optional transient key; never returned or stored.
   * @param signal - Caller lifetime.
   * @returns Sanitized connectivity and real-decision results.
   */
  @Remote
  async testConnection(input: ReflexConnectionInput, signal: AbortSignal): Promise<ReflexConnectionResult> {
    const candidate = parseReflexConnectionInput(input)
    return testReflexConnection(candidate, () => resolveJevApiKey(this.ctx, candidate.apiKeyEnv), signal)
  }

  /**
   * Register a provider and return the disposer owned by the caller.
   * @param provider - Provider whose identity is unique in the registry.
   * @returns A disposer that removes only this registration.
   */
  register(provider: JevProvider): () => void {
    if (provider.info.id === this.builtinProviderId || this.providers.has(provider.info.id)) throw new Error(`jev provider "${provider.info.id}" is already registered`)
    this.providers.set(provider.info.id, provider)
    return () => {
      if (this.providers.get(provider.info.id) === provider) this.providers.delete(provider.info.id)
    }
  }

  /**
   * List provider metadata without exposing credentials or request data.
   * @returns Detached registered provider metadata.
   */
  listProviders(): readonly JevProviderInfo[] {
    const configured = this.configuredProvider()
    return [...configured ? [configured] : [], ...this.providers.values()].map(provider => ({ ...provider.info }))
  }

  private provider(id: string): JevProvider {
    if (!this.enabled()) throw new JevDisabledError('Reflex is turned off in settings')
    const provider = id === this.builtinProviderId ? this.configuredProvider() : this.providers.get(id)
    if (provider === undefined) {
      if (id === this.builtinProviderId) throw new JevConfigurationError('Jev is not configured; set an endpoint and model in Reflex settings')
      throw new JevConfigurationError(`jev provider "${id}" is not registered`)
    }
    return provider
  }

  /**
   * Resolve a request to a provider and effective model without performing I/O.
   * @param request - Host request and optional provider selection.
   * @returns Validated request with provider and model pinned.
   * @throws When the selected provider is unconfigured or not registered.
   */
  resolve(request: JevRequest): JevSpec {
    const normalized = validateJevRequest(request)
    const providerId = normalized.providerId ?? this.defaultProviderId()
    const provider = this.provider(providerId)
    return { ...normalized, providerId, model: normalized.model ?? provider.info.model,
      ...normalized.effort === undefined && providerId === this.builtinProviderId ? { effort: this.defaultEffort() } : {},
    }
  }

  /**
   * Open or keep alive a provider's transport; failures are reported, never thrown.
   * @param providerId - Provider to warm; the default provider when omitted.
   * @param signal - Caller cancellation.
   * @returns Whether the provider answered; false when Reflex is off, the provider has no transport to warm, or the request failed.
   */
  async warm(providerId?: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.enabled()) return false
    const id = providerId ?? this.defaultProviderId()
    const provider = id === this.builtinProviderId ? this.configuredProvider() : this.providers.get(id)
    if (provider?.warm === undefined) return false
    try {
      await provider.warm(signal)
      return true
    } catch (error) {
      if (signal?.aborted) throw error
      return false
    }
  }

  /**
   * Send one resolved decision, split into parallel requests of at most `questionsPerRequest` questions when configured.
   * The first failing group cancels the others and its error is the decision's error.
   * @param provider - Provider pinned by the spec.
   * @param spec - Resolved decision.
   * @param signal - Caller cancellation.
   * @returns One response holding every question's answer, with usage counters summed across groups.
   */
  private async send(provider: JevProvider, spec: JevSpec, signal: AbortSignal | undefined): Promise<JevResponse> {
    const keys = Object.keys(spec.questions)
    const size = this.questionsPerRequest
    if (size === undefined || keys.length <= size) return await provider.decide(spec, signal)
    const groups = Array.from({ length: Math.ceil(keys.length / size) }, (_, index) => keys.slice(index * size, (index + 1) * size))
    const sibling = new AbortController()
    const groupSignal = signal === undefined ? sibling.signal : AbortSignal.any([signal, sibling.signal])
    const responses = await Promise.all(groups.map(async (group) => {
      try {
        const questions = Object.fromEntries(Object.entries(spec.questions).filter(([key]) => group.includes(key)))
        return await provider.decide({ ...spec, questions }, groupSignal)
      } catch (error) {
        sibling.abort(error)
        throw error
      }
    }))
    const usage: Record<string, number> = {}
    for (const response of responses) {
      for (const [name, value] of Object.entries(response.usage ?? {})) usage[name] = (usage[name] ?? 0) + value
    }
    const [first] = responses
    const answers = Object.fromEntries(responses.flatMap(response => Object.entries(response.answers)))
    return { model: first?.model ?? spec.model, answers, ...Object.keys(usage).length === 0 ? {} : { usage } }
  }

  /**
   * Execute a typed decision, returning unknown when the provider is unavailable or invalid.
   * @param request - Host state and typed questions.
   * @param signal - Cancellation propagated to the caller.
   * @returns Validated result or a safe failure description.
   * @throws When the selected provider is unconfigured or not registered, or the caller cancels.
   */
  async decide(request: JevRequest, signal?: AbortSignal): Promise<JevOutcome> {
    signal?.throwIfAborted()
    const spec = this.resolve(request)
    const provider = this.provider(spec.providerId)
    try {
      const response = await this.send(provider, spec, signal)
      return { kind: 'ok', spec, response }
    } catch (error) {
      if (signal?.aborted) throw error
      const failure: JevFailure = error instanceof JevProviderError
        ? error.failure
        : { code: 'transport', message: 'jev provider request failed' }
      return { kind: 'unknown', spec, failure }
    }
  }
}
