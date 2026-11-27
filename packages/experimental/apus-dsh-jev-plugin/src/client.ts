/** HTTP System One provider for a local or remote vLLM-compatible Jev gateway. */
import { TypeSafeClient, APIError, APITimeoutError, type Questions } from '@typesafe-ai/sdk'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { parseJevResponse, JevProtocolError, validateJevRequest } from './protocol.ts'
import type { JevAnswer, JevChoiceAnswer, JevChoiceQuestion, JevFailure, JevProvider, JevProviderInfo, JevQuestion, JevRequest, JevResponse, JevUsage } from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

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
  /**
   * Wire dialect of the gateway. `openjev`/`typesafe` speak the System One
   * protocol; `chat-completions` drives any OpenAI-compatible endpoint by
   * asking a yes/no question per candidate and reading the answer's token
   * probability. Same decision, different transport.
   */
  readonly protocol?: 'openjev' | 'typesafe' | 'chat-completions'
  readonly timeoutMs: number
  /**
   * Room for the chat-completions protocol's answer. A thinking model spends
   * hundreds of tokens reasoning before its verdict, so this bounds that
   * reasoning rather than the one-word answer.
   */
  readonly maxAnswerTokens?: number
  /**
   * Extra chat-template switches for the chat-completions dialect, sent verbatim
   * as `chat_template_kwargs`. A reasoning model asked to answer one word spends
   * its budget thinking first, which both delays the verdict and can exhaust a
   * caller's deadline; a deployment that trained the model to answer directly
   * turns that reasoning off here rather than in this provider.
   */
  readonly chatTemplateKwargs?: Readonly<Record<string, string | number | boolean>>
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
    if (this.options.protocol === 'chat-completions') {
      return this.decideByChatCompletions(normalized, signal)
    }
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

  /**
   * Decide an OpenAI-compatible endpoint by asking each question in words and
   * reading the answer token's probability.
   *
   * A `noul` question is asked as yes/no and answered by P(yes). A `choice`
   * question is asked with one letter per option and answered by the probability
   * of the chosen letter. `score` has no letter or yes/no form, so it is refused
   * rather than answered with a guess.
   *
   * The query walks the whole token stream and takes the last matching token: a
   * reasoning model spends its opening tokens thinking, so the verdict is the
   * one it ends with. A reply that never reaches a verdict is a protocol
   * failure, not a low score: reporting 0 would silently rank a candidate the
   * model never judged.
   */
  private async decideByChatCompletions(
    request: JevRequest,
    signal?: AbortSignal,
  ): Promise<JevResponse> {
    const unsupported = Object.entries(request.questions)
      .filter(([, question]) => question.type === 'score')
      .map(([name]) => name)
    if (unsupported.length > 0) {
      throw new JevProtocolError(
        `chat-completions protocol cannot ask a score question; got ${unsupported.join(', ')}`,
      )
    }
    const key = await this.options.resolveApiKey?.()
    signal?.throwIfAborted()
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.options.timeoutMs)
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    try {
      const answers: Record<string, JevAnswer> = {}
      let usage: JevUsage | undefined
      for (const [name, question] of Object.entries(request.questions)) {
        const outcome = await this.askOne(request.state, name, question, key, combined)
        answers[name] = outcome.answer
        usage = outcome.usage ?? usage
      }
      return { model: this.options.model, answers, ...usage === undefined ? {} : { usage } }
    } catch (error) {
      signal?.throwIfAborted()
      if (controller.signal.aborted) throw failure('timeout', `jev provider timed out after ${this.options.timeoutMs}ms`)
      // A reply the question set cannot be read from is the provider's response
      // failing validation, not the transport: callers report the two apart.
      if (error instanceof JevProtocolError) throw failure('invalid-response', 'jev provider response failed validation', undefined, error)
      if (error instanceof JevProviderError) throw error
      throw failure('transport', 'jev provider request failed', undefined, error)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Ask one question and map the reply's verdict onto its typed answer. */
  private async askOne(
    state: JsonValue,
    name: string,
    question: JevQuestion,
    key: string | undefined,
    signal: AbortSignal,
  ): Promise<{ readonly answer: JevAnswer; readonly usage?: JevUsage }> {
    const options = question.type === 'choice' ? Object.keys(question.criteria) : undefined
    if (options !== undefined && options.length > CHOICE_LETTERS.length) {
      throw new JevProtocolError(`chat-completions protocol supports at most ${CHOICE_LETTERS.length} options; got ${options.length}`)
    }
    const prompt = question.type === 'choice' && options !== undefined
      ? renderChoicePrompt(state, name, question, options)
      : renderYesNoPrompt(state, name, question)    // `this.options.endpoint` is already normalized; it may or may not name
    // its API root, so strip one `/v1` before adding the full path — appending
    // twice would 404.
    const base = this.options.endpoint.replace(/\/v1$/, '')
    const response = await this.fetcher(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...key === undefined ? {} : { authorization: `Bearer ${key}` },
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: this.options.maxAnswerTokens ?? 4096,
        logprobs: true,
        top_logprobs: 20,
        ...this.options.chatTemplateKwargs === undefined ? {} : { chat_template_kwargs: this.options.chatTemplateKwargs },
      }),
      signal,
    })
    if (!response.ok) throw failure('http', `jev provider returned HTTP ${response.status}`, response.status)
    const payload = await response.json() as ChatCompletionPayload
    const usage = payload.usage === undefined ? undefined : {
      ...payload.usage.prompt_tokens === undefined ? {} : { inputTokens: payload.usage.prompt_tokens },
      ...payload.usage.completion_tokens === undefined ? {} : { outputTokens: payload.usage.completion_tokens },
    }
    return { answer: options === undefined ? { type: 'noul', noul: verdictProbability(payload) } : choiceAnswer(payload, name, options), ...usage === undefined ? {} : { usage } }
  }
}

/** Letters offered for each option of a `choice` question, in criteria order. */
const CHOICE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** One candidate's verdict rendered as a yes/no question for a chat endpoint. */
function renderYesNoPrompt(state: JsonValue, name: string, question: JevQuestion): string {
  const criteria = question.type === 'noul' ? question.criteria : undefined
  const trueRule = criteria?.true ?? 'The candidate may provide relevant evidence, context, or constraints.'
  const falseRule = criteria?.false ?? 'The candidate is unrelated to the query.'
  return [
    `State: ${typeof state === 'string' ? state : JSON.stringify(state)}`,
    `Question ${name}: ${question.type === 'noul' ? question.instructions ?? 'Judge this candidate.' : ''}`,
    `Answer YES when: ${trueRule}`,
    `Answer NO when: ${falseRule}`,
    'Reply with exactly one word, YES or NO.',
  ].join('\n')
}

/** One question rendered as a lettered multiple-choice prompt for a chat endpoint. */
function renderChoicePrompt(state: JsonValue, name: string, question: JevChoiceQuestion, options: readonly string[]): string {
  return [
    `State: ${typeof state === 'string' ? state : JSON.stringify(state)}`,
    `Question ${name}: ${question.instructions ?? 'Choose the option that best applies.'}`,
    ...options.map((option, index) => `${CHOICE_LETTERS[index]}. ${option}: ${question.criteria[option] ?? ''}`),
    `Reply with exactly one letter: ${options.map((_, index) => CHOICE_LETTERS[index]).join(', ')}.`,
  ].join('\n')
}

/** Shape of the fields this client reads from an OpenAI-compatible reply. */
interface ChatCompletionPayload {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null }
    readonly logprobs?: { readonly content?: readonly ChatTokenLogprob[] | null } | null
  }[]
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number }
}

/**
 * The probability the model assigned to "relevant", read from its own verdict.
 *
 * Every token is scanned, not just the first: a reasoning model spends its
 * opening tokens thinking, and the verdict appears later. A reply with no
 * yes/no token never reached an answer, so it fails instead of scoring 0.
 */
function verdictProbability(payload: ChatCompletionPayload): number {
  const logprobs = replyLogprobs(payload)
  for (let index = logprobs.length - 1; index >= 0; index -= 1) {
    const entry = logprobs[index]
    const token = entry?.token?.trim().toLowerCase()
    if ((token !== 'yes' && token !== 'no') || typeof entry?.logprob !== 'number' || !Number.isFinite(entry.logprob)) continue
    const probability = Math.exp(entry.logprob)
    return token === 'yes' ? probability : 1 - probability
  }
  throw new JevProtocolError(`provider reply contained no yes/no verdict (content starts ${JSON.stringify(contentHead(payload))})`)
}

/**
 * Read a `choice` answer from the letter the model ended on.
 *
 * The verdict step's `top_logprobs` ranks every option the model considered, so
 * the distribution covers the question's whole candidate set and sums to one.
 * Only the final letter's alternatives are used: a reasoning model names letters
 * throughout its thinking, and those guesses are not its answer.
 */
function choiceAnswer(payload: ChatCompletionPayload, name: string, options: readonly string[]): JevChoiceAnswer {
  const logprobs = replyLogprobs(payload)
  for (let index = logprobs.length - 1; index >= 0; index -= 1) {
    const entry = logprobs[index]
    const chosenIndex = optionIndex(entry?.token)
    const chosen = options[chosenIndex]
    if (chosen === undefined || typeof entry?.logprob !== 'number' || !Number.isFinite(entry.logprob)) continue
    const ranked = new Map<string, number>()
    for (const candidate of entry.top_logprobs ?? []) {
      const option = candidate.token === undefined ? -1 : optionIndex(candidate.token)
      if (option < 0 || option >= options.length) continue
      if (typeof candidate.logprob !== 'number' || !Number.isFinite(candidate.logprob)) continue
      ranked.set(CHOICE_LETTERS[option] ?? '', Math.exp(candidate.logprob))
    }
    ranked.set(CHOICE_LETTERS[chosenIndex] ?? '', Math.exp(entry.logprob))
    const total = [...ranked.values()].reduce((sum, value) => sum + value, 0)
    const probabilities = Object.fromEntries(options.map((option, optionNumber) => {
      const letter = CHOICE_LETTERS[optionNumber] ?? ''
      const probability = total > 0 ? (ranked.get(letter) ?? 0) / total : optionNumber === chosenIndex ? 1 : 0
      return [option, probability]
    }))
    return { type: 'choice', choice: chosen, probabilities, confidence: probabilities[chosen] ?? 0 }
  }
  throw new JevProtocolError(
    `provider reply for ${name} contained no option letter (content starts ${JSON.stringify(contentHead(payload))})`,
  )
}

/** Position of an option letter among the question's options, or -1 when the token is no letter. */
function optionIndex(token: string | undefined): number {
  // A letter beyond the question's options is filtered by the caller, which knows their count.
  return CHOICE_LETTERS.indexOf(token?.trim().toUpperCase() ?? '')
}

function replyLogprobs(payload: ChatCompletionPayload): readonly ChatTokenLogprob[] {
  return payload.choices?.[0]?.logprobs?.content ?? []
}

/** One emitted token with the alternatives the model ranked beside it. */
interface ChatTokenLogprob {
  readonly token?: string
  readonly logprob?: number
  readonly top_logprobs?: readonly {
    readonly token?: string
    readonly logprob?: number
  }[]
}

function contentHead(payload: ChatCompletionPayload): string {
  return (payload.choices?.[0]?.message?.content ?? '').slice(0, 60)
}
