/** HTTP System One provider for a local or remote vLLM-compatible Jev gateway. */
import { TypeSafeClient, APIError, APITimeoutError, type Questions } from '@typesafe-ai/sdk'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { parseJevResponse, JevProtocolError, validateJevRequest } from './protocol.ts'
import type { JevFailure, JevProvider, JevProviderInfo, JevRequest, JevResponse } from './types.ts'

/** Fetch seam used by tests and by the built-in provider. */
export type JevFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Provider error with a public Jev failure class. */
export class JevProviderError extends Error {
  override name = 'JevProviderError'

  constructor(readonly failure: JevFailure, options?: ErrorOptions) {
    super(failure.message, options)
  }
}

/** Configuration accepted by the System One HTTP provider. */
export interface SystemOneProviderOptions {
  readonly id: string
  readonly endpoint: string
  readonly model: string
  readonly effort: 'low' | 'high'
  /** OpenJev supports effort; the official TypeSafe API omits that extension. */
  readonly protocol?: 'openjev' | 'typesafe'
  readonly timeoutMs: number
  readonly apiKeyEnv?: string
  readonly fetcher?: JevFetch
  readonly resolveApiKey?: () => Promise<string | undefined>
}


/** Normalize an HTTP endpoint without accepting embedded credentials.
 * @param endpoint - Configured gateway URL.
 * @returns Absolute URL without a trailing slash.
 */
export function normalizeJevEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
    if (url.username || url.password || url.search || url.hash) throw new Error('endpoint cannot contain credentials, query, or fragment')
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new Error('jev endpoint must be an absolute http(s) URL')
  }
}

function failure(code: JevFailure['code'], message: string, status?: number, cause?: unknown): JevProviderError {
  return new JevProviderError({ code, message, ...status === undefined ? {} : { status } }, cause instanceof Error ? { cause } : undefined)
}

/**
 * Resolve a credential reference through the managed store or launch environment.
 * @param ctx - Context providing the optional credential store.
 * @param name - Credential reference, or absent for an unauthenticated gateway.
 * @returns The non-empty credential or undefined when no reference was declared.
 */
export async function resolveJevApiKey(ctx: Context, name: string | undefined): Promise<string | undefined> {
  if (name === undefined) return undefined
  const ref = credentialRef(name)
  const credentials = ctx.get('credentials')
  const value = credentials !== undefined
    ? (await credentials.resolve(ref))?.value
    : launchEnvironmentOf(ctx).get(ref)?.value
  if (value !== undefined && value.length > 0) return value
  throw failure('missing-credential', `jev provider credential ${name} is not configured`)
}

/** Built-in provider for the APUS OpenJev `/v1/systemone` gateway. */
export class SystemOneProvider implements JevProvider {
  readonly info: JevProviderInfo
  private readonly fetcher: JevFetch
  private readonly options: SystemOneProviderOptions

  constructor(options: SystemOneProviderOptions) {
    this.options = { ...options, endpoint: normalizeJevEndpoint(options.endpoint) }
    this.info = { id: options.id, endpoint: this.options.endpoint, model: options.model }
    this.fetcher = options.fetcher ?? fetch
    if (options.timeoutMs <= 0 || options.timeoutMs > MAX_TIMER_DELAY_MS || !Number.isFinite(options.timeoutMs)) throw new Error(`jev timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }

  /**
   * Send an authenticated model-list request so the next decision reuses an open connection.
   * @param signal - Caller cancellation propagated to Fetch.
   */
  async warm(signal?: AbortSignal): Promise<void> {
    const key = await this.options.resolveApiKey?.()
    signal?.throwIfAborted()
    const headers = key === undefined ? undefined : { authorization: `Bearer ${key}` }
    const response = await this.fetcher(`${this.options.endpoint.replace(/\/v1$/, '')}/v1/models`, {
      ...headers === undefined ? {} : { headers },
      signal: AbortSignal.any([...signal === undefined ? [] : [signal], AbortSignal.timeout(this.options.timeoutMs)]),
    })
    // Drain the body so the connection returns to the pool.
    await response.arrayBuffer()
    if (!response.ok) throw failure('http', `jev provider returned HTTP ${response.status}`, response.status)
  }

  /**
   * Send one validated typed decision request and validate the complete answer.
   * @param request - JSON state and typed questions.
   * @param signal - Caller cancellation propagated to Fetch.
   * @returns Validated answers and provider-reported usage.
   */
  async decide(request: JevRequest, signal?: AbortSignal): Promise<JevResponse> {
    signal?.throwIfAborted()
    const normalized = validateJevRequest(request)
    if (typeof normalized.state === 'number' || typeof normalized.state === 'boolean') {
      throw new JevProtocolError('SDK state must be text, an object, an array, or null')
    }
    const questions: Questions = {}
    for (const [name, question] of Object.entries(normalized.questions)) {
      if (question.type !== 'score') {
        questions[name] = question
      } else {
        const [first, second, ...rest] = question.criteria
        // oxlint-disable-next-line typescript/no-non-null-assertion -- validateJevRequest requires at least two score criteria.
        questions[name] = { ...question, criteria: [first!, second!, ...rest] }
      }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.options.timeoutMs)
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    const cancelled = Promise.withResolvers<never>()
    const abortWait = () => { cancelled.reject(combined.reason instanceof Error ? combined.reason : new Error('Jev request aborted', { cause: combined.reason })) }
    combined.addEventListener('abort', abortWait, { once: true })
    try {
      const key = await Promise.race([this.options.resolveApiKey?.(), cancelled.promise])
      combined.throwIfAborted()
      const client = new TypeSafeClient({
        // The SDK requires a nonempty key even for explicitly unauthenticated local gateways.
        // The transport below removes this placeholder instead of transmitting it.
        apiKey: key ?? 'unauthenticated-local-gateway',
        baseURL: this.options.endpoint.replace(/\/v1$/, ''),
        defaultModel: this.options.model,
        timeout: this.options.timeoutMs,
        retry: { maxRetries: 0 },
        logLevel: 'off',
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers)
          if (key === undefined) headers.delete('authorization')
          const response = await this.fetcher(input, { ...init, headers })
          // Keep the network body locked until drained; cloning it in the SDK races Node's abort cleanup.
          const body = response.body === null ? null : await response.arrayBuffer()
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
        },
      })
      const body = {
        state: normalized.state,
        questions,
        model: normalized.model ?? this.options.model,
        ...this.options.protocol === 'typesafe' ? {} : { effort: normalized.effort ?? this.options.effort },
      }
      const raw = await Promise.race([client.systemOne(body, { signal: combined }), cancelled.promise])
      combined.throwIfAborted()
      try {
        return parseJevResponse(raw, normalized)
      } catch (error) {
        throw failure('invalid-response', 'jev provider response failed validation', undefined, error)
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (controller.signal.aborted || error instanceof APITimeoutError) throw failure('timeout', `jev provider timed out after ${this.options.timeoutMs}ms`)
      if (error instanceof JevProviderError) throw error
      if (error instanceof APIError) {
        throw failure(error.status === 429 || error.status === 529 ? 'rate-limited' : 'http', `jev provider returned HTTP ${error.status}`, error.status)
      }
      throw failure('transport', 'jev provider request failed', undefined, error)
    } finally {
      clearTimeout(timer)
      combined.removeEventListener('abort', abortWait)
    }
  }
}
