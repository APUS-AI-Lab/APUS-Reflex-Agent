import { parseJevResponse, type JevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ReflexJevProvider } from '../src/provider.ts'
import type { ReflexRunnerClient } from '../src/runner.ts'

/**
 * Real-runner smoke for the local Jev provider against a running APUS Reflex llama-server.
 * Self-skips unless `REFLEX_LOCAL_URL` (e.g. `http://127.0.0.1:8080`) and `REFLEX_LOCAL_KEY` (its `--api-key`) are set.
 */
const url = process.env.REFLEX_LOCAL_URL
const key = process.env.REFLEX_LOCAL_KEY
const maybe = url !== undefined && url.length > 0 && key !== undefined && key.length > 0 ? describe : describe.skip

const CompletionBody = z.object({
  completion_probabilities: z.array(z.object({ top_logprobs: z.array(z.object({ token: z.string(), logprob: z.number() })) })),
  timings: z.object({ prompt_n: z.number(), cache_n: z.number(), prompt_ms: z.number() }),
})

function httpRunner(base: string, apiKey: string): ReflexRunnerClient {
  return {
    async complete(prompt, signal) {
      const response = await fetch(`${base}/completion`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, n_predict: 1, n_probs: 1024, temperature: 0, cache_prompt: true }),
        signal,
      })
      if (!response.ok) throw new Error(`llama-server returned HTTP ${response.status}`)
      const body = CompletionBody.parse(await response.json())
      const [position] = body.completion_probabilities
      if (position === undefined) throw new Error('llama-server returned no completion position')
      return {
        logprobs: new Map(position.top_logprobs.map(entry => [entry.token, entry.logprob])),
        promptTokens: body.timings.prompt_n,
        cachedTokens: body.timings.cache_n,
        promptMs: body.timings.prompt_ms,
      }
    },
  }
}

maybe('ReflexJevProvider against a real llama-server', () => {
  const provider = new ReflexJevProvider({
    id: 'reflex-local', model: 'apus-reflex-4b', endpoint: url ?? '',
    acquire: async () => httpRunner(url ?? '', key ?? ''),
  })

  it('selects close_ticket for the official support-731 example', async () => {
    const request: JevRequest = {
      state: 'Order 731 was delivered. The customer confirms that the issue is resolved.',
      questions: {
        action: {
          type: 'choice',
          instructions: 'Select the next support action.',
          criteria: { close_ticket: 'Close the ticket as resolved.', escalate: 'Escalate to a human agent.', refund: 'Issue a refund.' },
        },
      },
    }
    const response = await provider.decide(request)
    expect(parseJevResponse(response, request)).toEqual(response)
    expect(response.answers.action).toMatchObject({ type: 'choice', choice: 'close_ticket' })
    expect(response.usage).toMatchObject({ output_tokens: 1 })
  })

  it('answers a Noul and a 16-candidate Choice over one shared state, reusing the prompt prefix', async () => {
    const files = Array.from({ length: 16 }, (_, index) => `report-${String(index).padStart(2, '0')}.txt`)
    const request: JevRequest = {
      state: { request: 'Open the quarterly report for Q3 2026; it is report-07.txt.', test_run: { passed: 42, failed: 0 } },
      questions: {
        passed: { type: 'noul', instructions: 'Judge whether every test in test_run passed.' },
        file: { type: 'choice', instructions: 'Select the file the user asked to open.', criteria: Object.fromEntries(files.map(file => [file, `Open ${file}.`])) },
      },
    }
    const response = await provider.decide(request)
    expect(parseJevResponse(response, request)).toEqual(response)
    expect(response.answers.file).toMatchObject({ type: 'choice', choice: 'report-07.txt' })
    const passed = response.answers.passed
    if (passed?.type !== 'noul') throw new Error('expected a noul answer')
    expect(passed.noul).toBeGreaterThan(0.5)
    expect(response.usage).toMatchObject({ output_tokens: 2 })
    expect(response.usage?.cached_tokens).toBeGreaterThan(0)
    expect(response.usage?.input_tokens).toBeGreaterThan(response.usage?.cached_tokens ?? 0)
  })
})
