/**
 * Real-runner smokes: hash verification, self-test, automatic enabling, Jev decisions, decision latency right after `enable()`,
 * and a model switch through the plugin.
 * Each self-skips unless `REFLEX_LOCAL_RUNNER` names a llama-server b11118 executable and its weights variables name pinned
 * GGUF files on the same volume as the temporary directory (the tests hard-link them; nothing is downloaded).
 * `REFLEX_LOCAL_WEIGHTS` is the `REFLEX_LOCAL_VARIANT` file (default `4b-q8_0`); `REFLEX_LOCAL_SWITCH_WEIGHTS` is the
 * `REFLEX_LOCAL_SWITCH_VARIANT` file (default `9b-q8_0`) the switch smoke selects second.
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
const switchWeights = process.env.REFLEX_LOCAL_SWITCH_WEIGHTS ?? ''
const switchKey = (process.env.REFLEX_LOCAL_SWITCH_VARIANT ?? '9b-q8_0') as VariantKey
const request = {
  state: 'Order 731 was delivered. The customer confirms that the issue is resolved.',
  questions: { action: { type: 'choice', instructions: 'Select the next support action.',
    criteria: { close_ticket: 'Close the ticket as resolved.', escalate: 'Escalate to a human agent.', refund: 'Issue a refund.' } } },
} as const

/** Mount Jev, a profile editor stand-in, and the plugin over a data root holding hard links to the given weights. */
async function mount(files: ReadonlyArray<readonly [VariantKey, string]>) {
  const dataRoot = await temporaryRoot()
  await mkdir(join(dataRoot, 'models'))
  for (const [variant, path] of files) await link(path, join(dataRoot, 'models', readCatalog()[variant].name))
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
  return { ctx, jev, service: ctx.get('reflexLocal')! }
}

describe.skipIf(runnerPath === '' || weights === '')('local Reflex engine with a real runner', () => {
  it('verifies weights, passes the self-test, enables itself, and answers decisions', async () => {
    const { ctx, jev, service } = await mount([[key, weights]])
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('paused')
    service.prepare({ variant: variantOf(key) })
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('ready')
    await expect.poll(() => service.snapshot().enabled, { timeout: 10_000 }).toBe(true)
    expect(jev.options.config).toEqual({ defaultProviderId: 'reflex-local' })
    expect(await ctx.jev.decide(request)).toMatchObject({ kind: 'ok', response: { answers: { action: { choice: 'close_ticket' } } } })
  }, 300_000)

  it('answers the first decision after enable within the 3 s decision budget', async () => {
    // Phase timings make a slow hash or model load diagnosable from the test output.
    const timed = async <T>(phase: string, run: () => Promise<T>): Promise<T> => {
      const started = performance.now()
      try { return await run() } finally { console.info(`reflex-local e2e ${phase}: ${Math.round(performance.now() - started)} ms`) }
    }
    const { ctx, service } = await mount([[key, weights]])
    await timed('hash at activation', async () => {
      await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('paused')
    })
    service.prepare({ variant: variantOf(key) })
    await timed('self-test load and automatic enable', async () => {
      await expect.poll(() => service.snapshot().enabled, { timeout: 120_000, interval: 100 }).toBe(true)
    })
    await service.disable()
    expect(service.snapshot().runner.state).toBe('stopped')
    await timed('enable with model load', async () => { await service.enable() })
    expect(service.snapshot().runner).toMatchObject({ state: 'running', model: variantOf(key) })
    const started = performance.now()
    expect(await ctx.jev.decide(request)).toMatchObject({ kind: 'ok', response: { answers: { action: { choice: 'close_ticket' } } } })
    expect(performance.now() - started).toBeLessThan(3000)
  }, 300_000)
})

describe.skipIf(runnerPath === '' || weights === '' || switchWeights === '')('PROBE undo', () => {
  it('undoes a background switch as soon as it is announced', async () => {
    const { service } = await mount([[key, weights], [switchKey, switchWeights]])
    const first = variantOf(key), second = variantOf(switchKey)
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('paused')
    service.select(first)
    await expect.poll(() => service.snapshot().enabled && service.snapshot().active, { timeout: 120_000, interval: 100 }).toEqual(first)
    service.select(second)
    await expect.poll(() => service.snapshot().unacknowledgedSwitch, { timeout: 300_000, interval: 20 }).toBeDefined()
    console.info('PROBE switched', JSON.stringify(service.snapshot().unacknowledgedSwitch), JSON.stringify(service.snapshot().preparation))
    void service.acknowledgeSwitch()
    try { service.select(service.snapshot().unacknowledgedSwitch?.from ?? first) } catch (error) { console.info('PROBE select threw', String(error)) }
    console.info('PROBE after', JSON.stringify(service.snapshot().active))
    await new Promise(resolve => setTimeout(resolve, 2000))
    console.info('PROBE 2s', JSON.stringify(service.snapshot().active), JSON.stringify(service.snapshot().runner))
  }, 600_000)
})

describe.skipIf(runnerPath === '' || weights === '' || switchWeights === '')('local Reflex model switch with a real runner', () => {
  it('switches to a second downloaded model in the background and back at once', async () => {
    const { ctx, service } = await mount([[key, weights], [switchKey, switchWeights]])
    const first = variantOf(key), second = variantOf(switchKey)
    await expect.poll(() => service.snapshot().preparation.phase, { timeout: 120_000, interval: 100 }).toBe('paused')
    service.select(first)
    await expect.poll(() => service.snapshot().enabled && service.snapshot().active, { timeout: 120_000, interval: 100 }).toEqual(first)
    expect(await ctx.jev.decide(request)).toMatchObject({ kind: 'ok', response: { answers: { action: { choice: 'close_ticket' } } } })
    service.select(second)
    await expect.poll(() => service.snapshot().active, { timeout: 300_000, interval: 200 }).toEqual(second)
    expect(service.snapshot().unacknowledgedSwitch).toMatchObject({ from: first, to: second })
    expect(await ctx.jev.decide(request)).toMatchObject({ kind: 'ok', response: { answers: { action: { choice: 'close_ticket' } } } })
    expect(service.snapshot().runner).toMatchObject({ state: 'running', model: second })
    await service.acknowledgeSwitch()
    service.select(first)
    expect(service.snapshot().active).toEqual(first)
    expect(await ctx.jev.decide(request)).toMatchObject({ kind: 'ok', response: { answers: { action: { choice: 'close_ticket' } } } })
    expect(service.snapshot().runner).toMatchObject({ state: 'running', model: first })
  }, 600_000)
})
