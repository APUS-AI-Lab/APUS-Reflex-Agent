/**
 * Real-runner preparation smoke: hash verification, self-test, automatic enabling, and Jev decisions through the plugin.
 * Self-skips unless `REFLEX_LOCAL_RUNNER` names a llama-server b11118 executable and `REFLEX_LOCAL_WEIGHTS` a pinned GGUF
 * on the same volume as the temporary directory (the test hard-links it; nothing is downloaded). `REFLEX_LOCAL_VARIANT`
 * names its catalog key and defaults to `4b-q8_0`.
 */
import { link, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { RoutingEditor } from '../src/engine.ts'
import ReflexLocal from '../src/index.ts'
import { readCatalog, variantOf, type VariantKey } from '../src/models.ts'
import { temporaryRoot } from './harness.ts'

const runnerPath = process.env.REFLEX_LOCAL_RUNNER ?? ''
const weights = process.env.REFLEX_LOCAL_WEIGHTS ?? ''
const key = (process.env.REFLEX_LOCAL_VARIANT ?? '4b-q8_0') as VariantKey

describe.skipIf(runnerPath === '' || weights === '')('local Reflex engine with a real runner', () => {
  it('verifies weights, passes the self-test, enables itself, and answers decisions', async () => {
    const dataRoot = await temporaryRoot()
    await mkdir(join(dataRoot, 'models'))
    await link(weights, join(dataRoot, 'models', readCatalog()[key].name))
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LocalSubprocess)
    const jev = { options: { id: 'jev', config: {} as Record<string, unknown> } }
    const editor: RoutingEditor = {
      entries: () => [jev],
      edit: async (_entry, change) => { jev.options.config = change(jev.options.config) },
    }
    ctx.provide('configEditor', editor)
    await ctx.plugin(Jev, { defaultProviderId: 'reflex-local' })
    await ctx.plugin(ReflexLocal, { dataRoot, runnerPath })
    const service = ctx.get('reflexLocal')!
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('paused')
    service.prepare({ variant: variantOf(key) })
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('ready')
    await expect.poll(() => service.snapshot().enabled, { timeout: 10_000 }).toBe(true)
    expect(jev.options.config).toEqual({ defaultProviderId: 'reflex-local' })
    const outcome = await ctx.jev.decide({ state: 'Order 731 was delivered. The customer confirms that the issue is resolved.', questions: {
      action: { type: 'choice', instructions: 'Select the next support action.',
        criteria: { close_ticket: 'Close the ticket as resolved.', escalate: 'Escalate to a human agent.', refund: 'Issue a refund.' } },
    } })
    expect(outcome).toMatchObject({ kind: 'ok', response: { answers: { action: { choice: 'close_ticket' } } } })
  }, 300_000)
})
