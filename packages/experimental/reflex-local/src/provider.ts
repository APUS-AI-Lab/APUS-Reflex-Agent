/** Jev provider answering typed decisions with the local APUS Reflex runner, one contract prompt per question. */
import { JevProtocolError, JevProviderError, parseJevResponse, validateJevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type { JevAnswer, JevFailure, JevProvider, JevProviderInfo, JevQuestion, JevRequest, JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import {
  CANDIDATE_LABELS, MAX_CONTRACT_CANDIDATES, contractQuestion, distributionConfidence, normalizeLogprobs, renderPrompt,
  type CandidateWeights, type ContractQuestion,
} from './contract.ts'
import type { ReflexRunnerClient } from './runner.ts'

/** Identity and runner access of one local Jev provider. */
export interface ReflexProviderOptions {
  readonly id: string
  readonly model: string
  readonly endpoint: string
  /**
   * Return the ready runner; throws `JevProviderError` with code `transport` when local decisions are disabled or not ready.
   * @param signal - Decision cancellation.
   * @returns A runner that stays usable for the rest of the request.
   */
  acquire(signal: AbortSignal): Promise<ReflexRunnerClient>
  /**
   * Start the runner process and load the model.
   * @param signal - Caller cancellation.
   */
  warm?(signal?: AbortSignal): Promise<void>
}

function failure(code: JevFailure['code'], message: string, cause?: unknown): JevProviderError {
  return new JevProviderError({ code, message }, cause instanceof Error ? { cause } : undefined)
}

function labelLogprobs(logprobs: ReadonlyMap<string, number>, keys: readonly string[]): CandidateWeights {
  return keys.map((key, index) => {
    const logprob = logprobs.get(CANDIDATE_LABELS.charAt(index))
    if (logprob === undefined) throw failure('invalid-response', 'local jev runner omitted a candidate label from its log probabilities')
    return [key, logprob] as const
  })
}

function answer(question: JevQuestion, distribution: CandidateWeights): JevAnswer {
  const probabilities = Object.fromEntries(distribution)
  const confidence = distributionConfidence(distribution.map(([, probability]) => probability))
  switch (question.type) {
    case 'choice': {
      const [choice] = distribution.reduce((best, entry) => entry[1] > best[1] ? entry : best)
      return { type: 'choice', choice, probabilities, confidence }
    }
    case 'score': {
      const score = distribution.reduce((sum, [key, probability]) => sum + Number(key) * probability, 0)
      const legend = Object.fromEntries(question.criteria.map((level, index) => [String(index), level]))
      return { type: 'score', score, legend, probabilities, confidence }
    }
    case 'noul':
      return { type: 'noul', noul: distribution.reduce((sum, [key, probability]) => key === 'yes' ? sum + probability : sum, 0) }
    /* v8 ignore next -- closed-union exhaustiveness guard; validateJevRequest admits only these three types. */
    default: return assertNever(question, 'Jev question type')
  }
}

function waitTurn(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(new Error('local jev request aborted while queued', { cause: signal.reason })) }
    signal.addEventListener('abort', abort, { once: true })
    void previous.then(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    })
  })
}

/**
 * Local Jev provider. Requests run one at a time in arrival order; a request holds the provider until all its
 * questions finish so later questions reuse the runner's prefix cache. Each question with two or more candidates
 * costs one runner completion; a one-candidate Choice is answered with probability 1 without a runner call.
 */
export class ReflexJevProvider implements JevProvider {
  readonly info: JevProviderInfo
  readonly warm?: (signal?: AbortSignal) => Promise<void>
  private readonly options: ReflexProviderOptions
  private tail: Promise<void> = Promise.resolve()

  constructor(options: ReflexProviderOptions) {
    this.options = options
    this.info = { id: options.id, model: options.model, endpoint: options.endpoint }
    if (options.warm !== undefined) this.warm = options.warm.bind(options)
  }

  /**
   * Answer every question through the local runner and validate the assembled response.
   * @param request - JSON state and typed questions with at most 16 candidates each.
   * @param signal - Caller cancellation; an abort rethrows its reason.
   * @returns Validated answers; usage `input_tokens` counts all prompt tokens, `cached_tokens` the subset served from
   *   the runner prefix cache, and `output_tokens` the runner calls.
   */
  async decide(request: JevRequest, signal?: AbortSignal): Promise<JevResponse> {
    signal?.throwIfAborted()
    const normalized = validateJevRequest(request)
    const questions = Object.entries(normalized.questions).map(([name, question]) => [name, question, contractQuestion(question)] as const)
    if (questions.some(([, , contract]) => contract.keys.length > MAX_CONTRACT_CANDIDATES)) {
      throw failure('invalid-response', `local jev questions support at most ${MAX_CONTRACT_CANDIDATES} candidates`)
    }
    const active = signal ?? new AbortController().signal
    const previous = this.tail
    const turn = Promise.withResolvers<void>()
    this.tail = previous.then(() => turn.promise)
    try {
      await waitTurn(previous, active)
      return await this.answerAll(normalized, questions, active)
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof JevProviderError) throw error
      if (error instanceof JevProtocolError) throw failure('invalid-response', 'local jev response failed validation', error)
      if (error instanceof Error && error.name === 'TimeoutError') throw failure('timeout', 'local jev runner timed out', error)
      throw failure('transport', 'local jev runner request failed', error)
    } finally {
      turn.resolve()
    }
  }

  private async answerAll(
    request: JevRequest,
    questions: ReadonlyArray<readonly [name: string, question: JevQuestion, contract: ContractQuestion]>,
    signal: AbortSignal,
  ): Promise<JevResponse> {
    let runner: ReflexRunnerClient | undefined
    let inputTokens = 0
    let cachedTokens = 0
    let calls = 0
    const answers = new Map<string, JevAnswer>()
    for (const [name, question, contract] of questions) {
      let distribution: CandidateWeights = contract.keys.map(key => [key, 1] as const)
      if (contract.keys.length > 1) {
        runner ??= await this.options.acquire(signal)
        const prompt = renderPrompt(request.state, contract.primitive, contract.instructions, contract.descriptions)
        const completion = await runner.complete(prompt, signal)
        inputTokens += completion.promptTokens + completion.cachedTokens
        cachedTokens += completion.cachedTokens
        calls += 1
        distribution = normalizeLogprobs(labelLogprobs(completion.logprobs, contract.keys))
      }
      answers.set(name, answer(question, distribution))
    }
    const usage = { input_tokens: inputTokens, cached_tokens: cachedTokens, output_tokens: calls }
    return parseJevResponse({ model: this.info.model, answers: Object.fromEntries(answers), usage }, request)
  }
}
