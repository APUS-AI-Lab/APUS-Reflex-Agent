import { JevProtocolError, JevProviderError, type JevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHOICE_INSTRUCTIONS, DEFAULT_NOUL_INSTRUCTIONS, NOUL_DESCRIPTIONS, renderPrompt } from '../src/contract.ts'
import { ReflexJevProvider, type ReflexProviderOptions } from '../src/provider.ts'
import type { ReflexCompletion, ReflexRunnerClient } from '../src/runner.ts'

type Complete = (prompt: string, signal: AbortSignal) => Promise<ReflexCompletion>

function completion(probabilities: Readonly<Record<string, number>>, promptTokens = 100, cachedTokens = 0): ReflexCompletion {
  return {
    logprobs: new Map(Object.entries(probabilities).map(([token, probability]) => [token, Math.log(probability)])),
    promptTokens, cachedTokens, promptMs: 5,
  }
}

function harness(complete: Complete, overrides: Partial<ReflexProviderOptions> = {}) {
  const prompts: string[] = []
  const runner: ReflexRunnerClient = {
    complete: (prompt, signal) => {
      prompts.push(prompt)
      return complete(prompt, signal)
    },
  }
  const acquire = vi.fn(async (_signal: AbortSignal) => runner)
  const provider = new ReflexJevProvider({ id: 'reflex-local', model: 'apus-reflex-4b-q8_0', endpoint: 'http://127.0.0.1:1', acquire, ...overrides })
  return { provider, acquire, prompts }
}

async function failureOf(promise: Promise<unknown>): Promise<JevProviderError> {
  const error = await promise.then(() => undefined, (reason: unknown) => reason)
  if (!(error instanceof JevProviderError)) throw new Error('expected JevProviderError', { cause: error })
  return error
}

const choiceRequest: JevRequest = {
  state: { ticket: 731, resolved: true },
  questions: { next: { type: 'choice', instructions: 'Select the next support action.', criteria: { close: 'Close the ticket.', escalate: 'Escalate.', refund: 'Refund.' } } },
}

describe('ReflexJevProvider', () => {
  it('answers a Choice from the candidate label log probabilities only', async () => {
    const { provider, acquire, prompts } = harness(async () => completion({ A: 0.6, B: 0.15, C: 0.05, D: 0.1, ' A': 0.1 }, 120, 40))
    const response = await provider.decide(choiceRequest)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(prompts).toEqual([renderPrompt({ ticket: 731, resolved: true }, 'choice', 'Select the next support action.', ['Close the ticket.', 'Escalate.', 'Refund.'])])
    expect(response.model).toBe('apus-reflex-4b-q8_0')
    expect(response.usage).toEqual({ input_tokens: 160, cached_tokens: 40, output_tokens: 1 })
    const answer = response.answers.next
    if (answer?.type !== 'choice') throw new Error('expected a choice answer')
    expect(answer.choice).toBe('close')
    expect(answer.probabilities.close).toBeCloseTo(0.75, 12)
    expect(answer.probabilities.escalate).toBeCloseTo(0.1875, 12)
    expect(answer.probabilities.refund).toBeCloseTo(0.0625, 12)
    expect(answer.confidence).toBeGreaterThan(0)
    expect(answer.confidence).toBeLessThan(1)
    expect(provider.info).toEqual({ id: 'reflex-local', model: 'apus-reflex-4b-q8_0', endpoint: 'http://127.0.0.1:1' })
  })

  it('serves every question type in insertion order through one acquired runner', async () => {
    const replies = [
      completion({ A: 0.2, B: 0.3, C: 0.5 }, 300, 0),
      completion({ A: 0.8, B: 0.2 }, 310, 290),
      completion({ A: 0.5, B: 0.5 }, 305, 295),
    ]
    const { provider, acquire, prompts } = harness(async () => {
      const reply = replies.shift()
      if (reply === undefined) throw new Error('unexpected runner call')
      return reply
    })
    const state = '测试 "state"'
    const response = await provider.decide({
      state,
      questions: {
        risk: { type: 'score', criteria: ['low', 'mid', 'high'] },
        only: { type: 'choice', criteria: { sole: 'The only option.' } },
        fixed: { type: 'noul', criteria: { true: 'It is fixed.', false: 'It is broken.' } },
        tie: { type: 'choice', instructions: 'Pick.', criteria: { first: 'First.', second: 'Second.' } },
      },
    })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(prompts).toEqual([
      renderPrompt(state, 'choice', DEFAULT_CHOICE_INSTRUCTIONS, ['low', 'mid', 'high']),
      renderPrompt(state, 'noul', DEFAULT_NOUL_INSTRUCTIONS, NOUL_DESCRIPTIONS),
      renderPrompt(state, 'choice', 'Pick.', ['First.', 'Second.']),
    ])
    expect(response.usage).toEqual({ input_tokens: 1500, cached_tokens: 585, output_tokens: 3 })
    const { risk, only, fixed, tie } = response.answers
    if (risk?.type !== 'score') throw new Error('expected a score answer')
    expect(risk.score).toBeCloseTo(1.3, 12)
    expect(risk.legend).toEqual({ 0: 'low', 1: 'mid', 2: 'high' })
    expect(Object.keys(risk.probabilities)).toEqual(['0', '1', '2'])
    expect(only).toEqual({ type: 'choice', choice: 'sole', probabilities: { sole: 1 }, confidence: 1 })
    if (fixed?.type !== 'noul') throw new Error('expected a noul answer')
    expect(fixed.noul).toBeCloseTo(0.8, 12)
    expect(tie).toEqual({ type: 'choice', choice: 'first', probabilities: { first: 0.5, second: 0.5 }, confidence: 0 })
  })

  it('selects the most probable candidate wherever its label falls', async () => {
    const { provider } = harness(async () => completion({ A: 0.1, B: 0.2, C: 0.7 }))
    const response = await provider.decide(choiceRequest)
    expect(response.answers.next).toMatchObject({ type: 'choice', choice: 'refund' })
  })

  it('answers one-candidate questions without acquiring the runner', async () => {
    const { provider, acquire } = harness(async () => { throw new Error('unexpected runner call') })
    const response = await provider.decide({ state: null, questions: { only: { type: 'choice', criteria: { sole: 'Sole.' } } } })
    expect(acquire).not.toHaveBeenCalled()
    expect(response.usage).toEqual({ input_tokens: 0, cached_tokens: 0, output_tokens: 0 })
  })

  it('rejects questions with more than 16 candidates before acquiring the runner', async () => {
    const { provider, acquire } = harness(async () => completion({ A: 1 }))
    const criteria = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`c${index}`, `Candidate ${index}`]))
    const error = await failureOf(provider.decide({ state: 's', questions: { wide: { type: 'choice', criteria } } }))
    expect(error.failure).toEqual({ code: 'invalid-response', message: 'local jev questions support at most 16 candidates' })
    expect(acquire).not.toHaveBeenCalled()
  })

  it('reports a candidate label missing from the runner log probabilities as invalid-response', async () => {
    const { provider } = harness(async () => completion({ A: 0.7, C: 0.3 }))
    const error = await failureOf(provider.decide(choiceRequest))
    expect(error.failure.code).toBe('invalid-response')
  })

  it('reports an assembled answer that fails protocol validation as invalid-response', async () => {
    const { provider } = harness(async () => ({ logprobs: new Map([['A', Number.NaN], ['B', 0], ['C', 0]]), promptTokens: 1, cachedTokens: 0, promptMs: 1 }))
    const error = await failureOf(provider.decide(choiceRequest))
    expect(error.failure).toEqual({ code: 'invalid-response', message: 'local jev response failed validation' })
    expect(error.cause).toBeInstanceOf(JevProtocolError)
  })

  it('passes runner availability failures through unchanged', async () => {
    const unavailable = new JevProviderError({ code: 'transport', message: 'local decisions are disabled' })
    const { provider } = harness(async () => completion({ A: 1, B: 1, C: 1 }), { acquire: async () => { throw unavailable } })
    await expect(provider.decide(choiceRequest)).rejects.toBe(unavailable)
  })

  it('maps runner failures to transport without request or response text', async () => {
    const crash = new Error('socket hang up while sending Close the ticket.')
    const { provider } = harness(async () => { throw crash })
    const error = await failureOf(provider.decide(choiceRequest))
    expect(error.failure).toEqual({ code: 'transport', message: 'local jev runner request failed' })
    expect(error.cause).toBe(crash)
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a runner may reject with a non-Error value.
    const thrown = await failureOf(harness(async () => Promise.reject('down')).provider.decide(choiceRequest))
    expect(thrown.failure.code).toBe('transport')
    expect(thrown.cause).toBeUndefined()
  })

  it('maps a runner timeout to timeout', async () => {
    const { provider } = harness(async () => { throw new DOMException('The operation timed out.', 'TimeoutError') })
    const error = await failureOf(provider.decide(choiceRequest))
    expect(error.failure).toEqual({ code: 'timeout', message: 'local jev runner timed out' })
  })

  it('lets request validation errors escape before any runner work', async () => {
    const { provider, acquire } = harness(async () => completion({ A: 1 }))
    await expect(provider.decide({ state: 's', questions: {} })).rejects.toBeInstanceOf(JevProtocolError)
    expect(acquire).not.toHaveBeenCalled()
  })

  it('rethrows the caller abort reason', async () => {
    const reason = new Error('caller left')
    const { provider, acquire } = harness(async (_prompt, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('runner request aborted')) }, { once: true })
    }))
    await expect(provider.decide(choiceRequest, AbortSignal.abort(reason))).rejects.toBe(reason)
    expect(acquire).not.toHaveBeenCalled()
    const controller = new AbortController()
    const pending = provider.decide(choiceRequest, controller.signal)
    await vi.waitFor(() => { expect(acquire).toHaveBeenCalledTimes(1) })
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    await expect(harness(async () => completion({ A: 1, B: 1 })).provider.decide({ state: 's', questions: { q: { type: 'noul' } } })).resolves.toBeDefined()
  })

  it('runs requests one at a time and keeps the queue order when a queued request aborts', async () => {
    const gates: Array<() => void> = []
    const { provider, prompts } = harness(async () => {
      await new Promise<void>((resolve) => { gates.push(resolve) })
      return completion({ A: 0.5, B: 0.5 })
    })
    const request = (state: string): JevRequest => ({ state, questions: { q: { type: 'noul' } } })
    const first = provider.decide(request('first'))
    const controller = new AbortController()
    const second = provider.decide(request('second'), controller.signal)
    const third = provider.decide(request('third'))
    await vi.waitFor(() => { expect(gates).toHaveLength(1) })
    const reason = new Error('second abandoned')
    controller.abort(reason)
    await expect(second).rejects.toBe(reason)
    await Promise.resolve()
    expect(prompts).toHaveLength(1)
    gates.shift()?.()
    await first
    await vi.waitFor(() => { expect(gates).toHaveLength(1) })
    gates.shift()?.()
    await third
    expect(prompts.map(prompt => prompt.split('\n')[2])).toEqual(['first', 'third'])
  })

  it('delegates warm when the options provide it and omits it otherwise', async () => {
    const warm = vi.fn(async (_signal?: AbortSignal) => undefined)
    const { provider } = harness(async () => completion({ A: 1 }), { warm })
    const signal = new AbortController().signal
    await provider.warm?.(signal)
    expect(warm).toHaveBeenCalledWith(signal)
    expect(harness(async () => completion({ A: 1 })).provider.warm).toBeUndefined()
  })
})
