/**
 * Real-runner preparation smoke: hash verification, self-test, automatic enabling, and Jev decisions through the plugin.
 * Self-skips unless `REFLEX_LOCAL_RUNNER` names a llama-server b11118 executable and `REFLEX_LOCAL_WEIGHTS` the pinned
 * Q8_0 GGUF on the same volume as the temporary directory (the test hard-links it; nothing is downloaded).
 */
import { link, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it, onTestFinished } from 'vitest'
import ReflexLocal from '../src/index.ts'
import { temporaryRoot } from './harness.ts'

const runnerPath = process.env.REFLEX_LOCAL_RUNNER ?? ''
const weights = process.env.REFLEX_LOCAL_WEIGHTS ?? ''

describe.skipIf(runnerPath === '' || weights === '')('local Reflex engine with a real runner', () => {
  it('verifies weights, passes the self-test, enables itself, and answers decisions', async () => {
    const dataRoot = await temporaryRoot()
    await mkdir(join(dataRoot, 'models'))
    await link(weights, join(dataRoot, 'models', 'APUS-OpenJev-v1-4B-Q8_0.gguf'))
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(Jev, { defaultProviderId: 'reflex-local' })
    await ctx.plugin(ReflexLocal, { dataRoot, runnerPath, variant: 'q8_0' })
    const service = ctx.get('reflexLocal')!
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('paused')
    service.prepare()
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('ready')
    await expect.poll(() => service.snapshot().enabled, { timeout: 10_000 }).toBe(true)
    const outcome = await ctx.jev.decide({ state: 'Order 731 was delivered. The customer confirms that the issue is resolved.', questions: {
      action: { type: 'choice', instructions: 'Select the next support action.',
        criteria: { close_ticket: 'Close the ticket as resolved.', escalate: 'Escalate to a human agent.', refund: 'Issue a refund.' } },
    } })
    expect(outcome).toMatchObject({ kind: 'ok', response: { answers: { action: { choice: 'close_ticket' } } } })
  }, 300_000)
})
