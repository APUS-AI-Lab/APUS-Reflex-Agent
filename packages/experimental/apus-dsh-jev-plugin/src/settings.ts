/** Unsaved Reflex connection diagnostics; no probe state or credentials are retained. */
import { z } from 'zod'
import { MAX_TIMER_DELAY_MS, deadline as createDeadline } from '@deepseek-ai/dsh-timeout'
import { JevProviderError, SystemOneProvider } from './client.ts'
import type { JevFetch } from './client.ts'
import type { JevFailure, ReflexConnectionInput, ReflexConnectionResult } from './types.ts'

const connectionInput = z.object({
  endpoint: z.url().max(2048).refine((value) => {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.search && !url.hash
  }),
  model: z.string().trim().min(1).max(256),
  effort: z.enum(['low', 'high']),
  timeoutMs: z.number().int().positive().max(MAX_TIMER_DELAY_MS),
  protocol: z.enum(['openjev', 'typesafe']),
  apiKeyEnv: z.string().min(1).max(256).optional(),
  apiKey: z.string().min(1).max(65536).optional(),
}).strict()

/** Validate a wire candidate without including field values in error messages.
 * @param input - Untrusted connection candidate.
 * @returns Validated candidate.
 */
export function parseReflexConnectionInput(input: ReflexConnectionInput): ReflexConnectionInput {
  const parsed = connectionInput.safeParse(input)
  if (!parsed.success) throw new Error('Invalid Reflex connection settings')
  const { apiKeyEnv, apiKey, ...fields } = parsed.data
  return { ...fields, ...apiKeyEnv === undefined ? {} : { apiKeyEnv }, ...apiKey === undefined ? {} : { apiKey } }
}

/** Authenticate, confirm model availability, then validate a real semantic answer.
 * @param input - Validated candidate; the transient key overrides only this probe.
 * @param resolveKey - Existing credential resolver when no transient key was supplied.
 * @param signal - Caller cancellation.
 * @param fetcher - HTTP transport, replaceable for protocol tests.
 * @returns Sanitized result; cancellation propagates.
 */
export async function testReflexConnection(
  input: ReflexConnectionInput, resolveKey: () => Promise<string | undefined>, signal: AbortSignal, fetcher: JevFetch = fetch,
): Promise<ReflexConnectionResult> {
  const started = performance.now()
  let stage: ReflexConnectionResult['stage'] = input.protocol === 'openjev' ? 'health' : 'models'
  const base = { model: input.model, effort: input.effort }
  using timeout = createDeadline(signal, input.timeoutMs, 'REFLEX_CONNECTION_TIMEOUT')
  const deadline = timeout.signal
  const cancellation = Promise.withResolvers<never>()
  const abortWait = () => { cancellation.reject(new Error('Reflex connection test cancelled', { cause: deadline.reason })) }
  deadline.addEventListener('abort', abortWait, { once: true })
  const execute = async (): Promise<ReflexConnectionResult> => {
    signal.throwIfAborted()
    const key = input.apiKey ?? await resolveKey()
    deadline.throwIfAborted()
    const endpoint = input.endpoint.replace(/\/$/, '').replace(/\/v1$/, '')
    const checkHealth = async (): Promise<void> => {
      if (input.protocol === 'typesafe') return
      const health = await fetcher(`${endpoint}/health`, {
        signal: deadline, ...key === undefined ? {} : { headers: { authorization: `Bearer ${key}` } },
      })
      await health.arrayBuffer()
      if (!health.ok) throw new JevProviderError({ code: 'http', message: 'Reflex health check failed', status: health.status })
    }
    await checkHealth()
    deadline.throwIfAborted()
    stage = 'models'
    const response = await fetcher(`${endpoint}/v1/models`, {
      signal: deadline,
      ...key === undefined ? {} : { headers: { authorization: `Bearer ${key}` } },
    })
    if (!response.ok) {
      await response.arrayBuffer()
      throw new JevProviderError({ code: 'http', message: 'Reflex discovery failed', status: response.status })
    }
    const catalog: unknown = await response.json()
    const parsed = z.union([
      z.object({ models: z.array(z.object({ name: z.string() })) }).transform(value => value.models.map(model => model.name)),
      z.object({ data: z.array(z.object({ id: z.string() })) }).transform(value => value.data.map(model => model.id)),
    ]).safeParse(catalog)
    if (!parsed.success) throw new JevProviderError({ code: 'invalid-response', message: 'Invalid model catalog' })
    if (!parsed.data.includes(input.model)) {
      return { ...base, kind: 'failed', stage, latencyMs: performance.now() - started, code: 'model-missing' }
    }
    deadline.throwIfAborted()
    stage = 'decision'
    const provider = new SystemOneProvider({ id: 'reflex-probe', endpoint: input.endpoint, model: input.model,
      effort: input.effort, protocol: input.protocol, timeoutMs: input.timeoutMs, fetcher,
      resolveApiKey: () => Promise.resolve(key),
    })
    const result = await provider.decide({ state: 'The number two is even.', questions: { connection: { type: 'noul', instructions: 'Is the statement true?' } } }, deadline)
    if (result.model !== input.model) throw new JevProviderError({ code: 'invalid-response', message: 'Reflex response used a different model' })
    const answer = result.answers.connection
    return { ...base, kind: answer?.type === 'noul' && answer.noul > 0.5 ? 'ok' : 'failed', stage,
      latencyMs: performance.now() - started,
      ...answer?.type === 'noul' && answer.noul > 0.5 ? {} : { code: 'decision-rejected' as const },
    }
  }
  try {
    return await Promise.race([execute(), cancellation.promise])
  } catch (error) {
    if (signal.aborted) throw error
    const failure: JevFailure = deadline.aborted ? { code: 'timeout', message: 'Reflex connection timed out' }
      : error instanceof JevProviderError ? error.failure : { code: 'transport', message: 'Reflex connection failed' }
    return { ...base, kind: 'failed', stage, latencyMs: performance.now() - started, code: failure.code,
      ...failure.status !== undefined ? { status: failure.status } : {},
    }
  } finally {
    deadline.removeEventListener('abort', abortWait)
  }
}
