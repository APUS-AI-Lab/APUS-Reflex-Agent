import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { installSystem3KeepWarm } from '../src/keep-warm.ts'

const contexts: Context[] = []
beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const warm = vi.spyOn(ctx.jev, 'warm').mockResolvedValue(true)
  return { ctx, warm }
}

it('warms at start and every interval until the window ends, then again after a turn ends', async () => {
  const { ctx, warm } = await setup()
  installSystem3KeepWarm(ctx, { windowMs: 5000, intervalMs: 2000 })
  await vi.advanceTimersByTimeAsync(0)
  expect(warm).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(4000)
  expect(warm).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(warm).toHaveBeenCalledTimes(3)
  await ctx.serial('agent/turn-stopping', { agent: {} as never, turn: 1, signal: new AbortController().signal })
  await vi.advanceTimersByTimeAsync(0)
  expect(warm).toHaveBeenCalledTimes(4)
  // A second turn end inside the window extends it without starting a parallel loop.
  await ctx.serial('agent/turn-stopping', { agent: {} as never, turn: 2, signal: new AbortController().signal })
  await vi.advanceTimersByTimeAsync(2000)
  expect(warm).toHaveBeenCalledTimes(5)
})

it('keeps its schedule but sends no warm-up while front-loaded decisions are off', async () => {
  const { ctx, warm } = await setup()
  let on = false
  installSystem3KeepWarm(ctx, { windowMs: 5000, intervalMs: 2000 }, () => on)
  await vi.advanceTimersByTimeAsync(2000)
  expect(warm).not.toHaveBeenCalled()
  on = true
  await vi.advanceTimersByTimeAsync(2000)
  expect(warm).toHaveBeenCalledOnce()
})

it('stops on disposal, including a warm-up rejected by that disposal', async () => {
  const { ctx, warm } = await setup()
  warm.mockImplementation(async (_id, signal) => await new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { reject(new Error('aborted', { cause: signal.reason })) }, { once: true })
  }))
  const child = ctx.plugin({ apply: (inner: Context) => { installSystem3KeepWarm(inner, { windowMs: 5000, intervalMs: 2000 }) } })
  await child
  await vi.advanceTimersByTimeAsync(0)
  expect(warm).toHaveBeenCalledTimes(1)
  await child.dispose()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(warm).toHaveBeenCalledTimes(1)
})

it('rethrows an unexpected warm-up rejection and rejects invalid timing', async () => {
  const { ctx, warm } = await setup()
  expect(() => { installSystem3KeepWarm(ctx, { windowMs: 0, intervalMs: 2000 }) }).toThrow('windowMs')
  expect(() => { installSystem3KeepWarm(ctx, { windowMs: 1000, intervalMs: 1.5 }) }).toThrow('intervalMs')
  warm.mockRejectedValue(new Error('unexpected'))
  const unhandled = vi.fn()
  process.once('unhandledRejection', unhandled)
  installSystem3KeepWarm(ctx, { windowMs: 5000, intervalMs: 2000 })
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => { expect(unhandled).toHaveBeenCalledWith(expect.objectContaining({ message: 'unexpected' }), expect.anything()) })
})
