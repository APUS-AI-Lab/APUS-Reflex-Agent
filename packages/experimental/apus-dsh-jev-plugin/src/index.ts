/** Experimental generic Jev capability with a built-in APUS System One provider. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { JevProviderError, SystemOneProvider, resolveJevApiKey } from './client.ts'
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
  readonly endpoint: string
  /** Wire protocol; the official API does not receive the OpenJev effort extension. @default 'openjev' */
  readonly protocol?: 'openjev' | 'typesafe'
  /** Model identifier used when a decision request omits its model. */
  readonly model: string
  /** Decision effort used when a request omits it. @default 'low' */
  readonly effort?: 'low' | 'high'
  /** Maximum duration in milliseconds for the gateway HTTP request. @default 30000 */
  readonly timeoutMs?: number
  /** Credential reference for bearer authentication; omission permits an unauthenticated gateway. */
  readonly apiKeyEnv?: string
  /** Registry identity of the built-in provider, selected when a request omits providerId. @default 'system-one' */
  readonly providerId?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_PROVIDER_ID = 'system-one'

/** Cordis service that resolves one pinned Jev provider per request. */
export default class Jev extends Service {
  static Config = z.object({
    endpoint: z.string().required(),
    protocol: z.union([z.const('openjev'), z.const('typesafe')]).default('openjev'),
    model: z.string().required(),
    effort: z.union([z.const('low'), z.const('high')]).default('low'),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
    apiKeyEnv: z.string().role('credential-ref'),
    providerId: z.string().default(DEFAULT_PROVIDER_ID),
  })

  private readonly providers = new Map<string, JevProvider>()
  private readonly defaultProviderId: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'jev')
    const providerId = config.providerId ?? DEFAULT_PROVIDER_ID
    this.defaultProviderId = providerId
    const provider = new SystemOneProvider({
      id: providerId,
      endpoint: config.endpoint,
      ...config.protocol === undefined ? {} : { protocol: config.protocol },
      model: config.model,
      effort: config.effort ?? 'low',
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...config.apiKeyEnv === undefined ? {} : {
        apiKeyEnv: config.apiKeyEnv, resolveApiKey: () => resolveJevApiKey(ctx, config.apiKeyEnv),
      },
    })
    ctx.effect(() => this.register(provider))
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
    return { ...normalized, providerId, model: normalized.model ?? provider.info.model }
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
    const provider = this.providers.get(spec.providerId)
    if (provider === undefined) throw new Error(`jev provider "${spec.providerId}" is not registered`)
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
