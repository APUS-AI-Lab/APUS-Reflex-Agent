/** HTTP System One provider for a local or remote vLLM-compatible Jev gateway. */
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
  readonly timeoutMs: number
  readonly apiKeyEnv?: string
  readonly fetcher?: JevFetch
  readonly resolveApiKey?: () => Promise<string | undefined>
}

function endpointUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/systemone` : `${base}/v1/systemone`
}

function publicEndpoint(endpoint: string): string {
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
    this.options = { ...options, endpoint: publicEndpoint(options.endpoint) }
    this.info = { id: options.id, endpoint: this.options.endpoint, model: options.model }
    this.fetcher = options.fetcher ?? fetch
    if (options.timeoutMs <= 0 || options.timeoutMs > MAX_TIMER_DELAY_MS || !Number.isFinite(options.timeoutMs)) throw new Error(`jev timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
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
    const key = this.options.resolveApiKey === undefined ? undefined : await this.options.resolveApiKey()
    signal?.throwIfAborted()
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.options.timeoutMs)
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    const { providerId: _providerId, ...wireRequest } = normalized
    const body = { ...wireRequest, model: normalized.model ?? this.options.model, effort: normalized.effort ?? this.options.effort }
    try {
      const response = await this.fetcher(endpointUrl(this.options.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...key === undefined ? {} : { authorization: `Bearer ${key}` } },
        body: JSON.stringify(body),
        signal: combined,
      })
      if (!response.ok) {
        throw failure(response.status === 429 || response.status === 529 ? 'rate-limited' : 'http', `jev provider returned HTTP ${response.status}`, response.status)
      }
      let raw: unknown
      try {
        raw = await response.json()
      } catch (error) {
        throw failure('invalid-response', `jev provider returned non-JSON response (${response.status})`, response.status, error)
      }
      try {
        return parseJevResponse(raw, body)
      } catch (error) {
        if (error instanceof JevProtocolError) throw failure('invalid-response', 'jev provider response failed validation', response.status, error)
        throw error
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (controller.signal.aborted) throw failure('timeout', `jev provider timed out after ${this.options.timeoutMs}ms`)
      if (error instanceof JevProviderError) throw error
      throw failure('transport', 'jev provider request failed', undefined, error)
    } finally {
      clearTimeout(timer)
    }
  }
}
