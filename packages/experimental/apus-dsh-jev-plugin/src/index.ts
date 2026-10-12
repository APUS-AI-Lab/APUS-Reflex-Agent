/** Experimental generic Jev capability with a built-in APUS System One provider. */
import { Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { parseReflexConnectionInput, testReflexConnection } from './settings.ts'
import type { ReflexCapabilityId, ReflexCapabilityState, ReflexConnectionInput, ReflexConnectionResult, ReflexStatus } from './types.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { JevProviderError, SystemOneProvider, resolveJevApiKey, normalizeJevEndpoint } from './client.ts'
import { createPooledFetch } from './pool.ts'
import { validateJevRequest } from './protocol.ts'
import type { JevFailure, JevOutcome, JevProvider, JevProviderInfo, JevRequest, JevSpec } from './types.ts'

export type * from './types.ts'
export { JevProtocolError, MAX_JEV_CHOICES, MAX_JEV_QUESTIONS, parseJevResponse, validateJevRequest } from './protocol.ts'
export { JevProviderError, SystemOneProvider } from './client.ts'
export type { JevFetch, SystemOneProviderOptions } from './client.ts'

export const name = 'apus-dsh-jev-plugin'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-neutral typed Jev decision service. */
    jev: Jev
  }
}

/** Plugin configuration for the built-in System One provider. */
export interface Config {
  /** System One gateway URL; credentials must use apiKeyEnv rather than URL user information. */
  readonly endpoint: Volatile<string>
  /** Wire protocol; the official API does not receive the OpenJev effort extension. @default 'openjev' */
  readonly protocol: Volatile<'openjev' | 'typesafe'>
  /** Model identifier used when a decision request omits its model. */
  readonly model: Volatile<string>
  /** Decision effort used when a request omits it. @default 'low' */
  readonly effort: Volatile<'low' | 'high'>
  /** Maximum duration in milliseconds for the gateway HTTP request. @default 30000 */
  readonly timeoutMs: Volatile<number>
  /** Credential reference for bearer authentication; omission permits an unauthenticated gateway. */
  readonly apiKeyEnv: Volatile<string | undefined>
  /** Registry identity of the built-in provider, selected when a request omits providerId. @default 'system-one' */
  readonly providerId?: string
  /**
   * Idle time in milliseconds a direct connection to the gateway stays open for reuse. Omission keeps
   * the process-wide transport. A request routed through a configured HTTP proxy always uses that proxy's transport.
   */
  readonly keepAliveMs?: number
  /** Negotiate HTTP/2 on the dedicated direct connection; requires `keepAliveMs`. @default false */
  readonly http2?: boolean
  /** Consecutive requests without a response after which the dedicated pool reopens; requires `keepAliveMs`. Omission never reopens it. */
  readonly resetAfterFailures?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_PROVIDER_ID = 'system-one'

/** Cordis service that resolves one pinned Jev provider per request. */
export default class Jev extends TypertRemoteService {
  static Config = z.object({
    endpoint: z.string().min(1).required().volatile(),
    protocol: z.union([z.const('openjev'), z.const('typesafe')]).default('openjev').volatile(),
    model: z.string().min(1).max(256).required().volatile(),
    effort: z.union([z.const('low'), z.const('high')]).default('low').volatile(),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS).volatile(),
    apiKeyEnv: z.string().role('credential-ref').volatile(),
    providerId: z.string().default(DEFAULT_PROVIDER_ID),
    keepAliveMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
    http2: z.boolean().default(false),
    resetAfterFailures: z.number().step(1).min(1),
  })

  private readonly providers = new Map<string, JevProvider>()
  private readonly defaultProviderId: string
  private readonly defaultEffort: () => 'low' | 'high'
  private readonly configuredProvider: () => SystemOneProvider
  private readonly capabilityReaders = new Map<ReflexCapabilityId, () => ReflexCapabilityState>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'jev', { namespace: 'reflex' })
    const providerId = config.providerId ?? DEFAULT_PROVIDER_ID
    this.defaultProviderId = providerId
    this.defaultEffort = () => config.effort.get()
    if (config.http2 === true && config.keepAliveMs === undefined) throw new Error('jev http2 requires keepAliveMs')
    if (config.resetAfterFailures !== undefined && config.keepAliveMs === undefined) throw new Error('jev resetAfterFailures requires keepAliveMs')
    const fetcher = config.keepAliveMs === undefined ? undefined
      : createPooledFetch(ctx, config.keepAliveMs, config.http2 ?? false, config.resetAfterFailures)
    this.configuredProvider = () => {
      const apiKeyEnv = config.apiKeyEnv.get()
      return new SystemOneProvider({
        id: providerId,
        ...fetcher === undefined ? {} : { fetcher },
        endpoint: config.endpoint.get(), protocol: config.protocol.get(), model: config.model.get(),
        effort: config.effort.get(), timeoutMs: config.timeoutMs.get(),
        ...apiKeyEnv === undefined ? {} : { apiKeyEnv, resolveApiKey: () => resolveJevApiKey(ctx, apiKeyEnv) },
      })
    }
    // Validate the initial deployment before making the service available.
    this.configuredProvider()
    ctx.on('internal/config', function (this: import('@deepseek-ai/cordis').Fiber, _input, next) {
      const raw: unknown = next()
      if (this !== ctx.fiber) return raw
      const candidate = Jev.Config(raw as Parameters<typeof Jev.Config>[0])
      normalizeJevEndpoint(candidate.endpoint.get())
      return raw
    })
    const currentProvider = this.configuredProvider
    const provider: JevProvider = {
      get info() { return currentProvider().info },
      decide: (request, signal) => currentProvider().decide(request, signal),
      warm: signal => currentProvider().warm(signal),
    }
    ctx.effect(() => this.register(provider))
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
    const ids: ReflexCapabilityId[] = ['entryRouting', 'codexSupervision', 'contextMemory']
    return {
      provider: { ...this.configuredProvider().info },
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
    if (this.providers.has(provider.info.id)) throw new Error(`jev provider "${provider.info.id}" is already registered`)
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
    return [...this.providers.values()].map(provider => ({ ...provider.info }))
  }

  /**
   * Resolve a request to a provider and effective model without performing I/O.
   * @param request - Host request and optional provider selection.
   * @returns Validated request with provider and model pinned.
   */
  resolve(request: JevRequest): JevSpec {
    const normalized = validateJevRequest(request)
    const providerId = normalized.providerId ?? this.defaultProviderId
    const provider = this.providers.get(providerId)
    if (provider === undefined) throw new Error(`jev provider "${providerId}" is not registered`)
    return { ...normalized, providerId, model: normalized.model ?? provider.info.model,
      ...normalized.effort === undefined && providerId === this.defaultProviderId ? { effort: this.defaultEffort() } : {},
    }
  }

  /**
   * Open or keep alive a provider's transport; failures are reported, never thrown.
   * @param providerId - Provider to warm; the default provider when omitted.
   * @param signal - Caller cancellation.
   * @returns Whether the provider answered; false when it has no transport to warm or the request failed.
   */
  async warm(providerId?: string, signal?: AbortSignal): Promise<boolean> {
    const provider = this.providers.get(providerId ?? this.defaultProviderId)
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
   * Execute a typed decision, returning unknown when the provider is unavailable or invalid.
   * @param request - Host state and typed questions.
   * @param signal - Cancellation propagated to the caller.
   * @returns Validated result or a safe failure description.
   */
  async decide(request: JevRequest, signal?: AbortSignal): Promise<JevOutcome> {
    signal?.throwIfAborted()
    const spec = this.resolve(request)
    // oxlint-disable-next-line typescript/no-non-null-assertion -- resolve synchronously rejects unregistered providers.
    const provider = this.providers.get(spec.providerId)!
    try {
      const response = await provider.decide(spec, signal)
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
