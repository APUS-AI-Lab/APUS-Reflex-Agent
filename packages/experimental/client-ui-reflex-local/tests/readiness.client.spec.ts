/** One readiness mirror follows the Host across reconnects and hands each accepted snapshot to its owner. */
import { Context } from '@deepseek-ai/cordis'
import type { RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import { expect, it, onTestFinished, vi } from 'vitest'
import { observeReadiness } from '../src/client/readiness.ts'
import { FAST, snapshotOf } from './snapshot-fixture.client.ts'

/** Gateway-owned transport replaced by a queue the test feeds; the readiness publication stays real. */
function fixture() {
  const abort = new AbortController(), accept = vi.fn()
  const onSnapshot = vi.fn((_snapshot: ReflexSnapshot) => {})
  const queue: ({ readonly value: ReflexSnapshot } | { readonly thrown: unknown })[] = []
  let wake: (() => void) | undefined
  let options!: RemoteStreamOptions<ReflexSnapshot>
  const follow = vi.fn()
  const stream = {
    signal: abort.signal,
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queue.shift()
        if (next === undefined) { await new Promise<void>((resolve) => { wake = resolve }); continue }
        if ('thrown' in next) { abort.abort(); throw next.thrown }
        yield { value: next.value, accept }
      }
    },
    dispose: async () => { abort.abort(); queue.push({ thrown: new Error('disposed') }); wake?.() },
  }
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  ctx.provide('remote', { reflexLocal: { follow }, $stream: (value: typeof options) => { options = value; return stream } })
  const mirror = observeReadiness(ctx, onSnapshot)
  return { mirror, options, follow, accept, onSnapshot,
    push(value: ReflexSnapshot) { queue.push({ value }); wake?.() },
    throw(thrown: unknown) { queue.push({ thrown }); wake?.() } }
}

const ready = (enabled: boolean) => snapshotOf({ phase: 'ready', variant: 'q8_0', selfTest: FAST }, { enabled })

it('accepts snapshots, opens the Host stream, and keeps the last snapshot through a carrier outage', async () => {
  const b = fixture()
  b.push(ready(false))
  await vi.waitFor(() => { expect(b.mirror.state.getSnapshot()).toEqual({ snapshot: ready(false), connected: true, error: null }) })
  expect(b.accept).toHaveBeenCalledOnce()
  const signal = new AbortController().signal
  b.options.open(signal)
  expect(b.follow).toHaveBeenCalledWith(signal)
  expect(b.options.ended(true)).toBeInstanceOf(RemoteStreamCarrierError)
  b.options.carrierFailed?.(new RemoteStreamCarrierError('connection lost'))
  expect(b.mirror.state.getSnapshot()).toEqual({ snapshot: ready(false), connected: false, error: 'connection lost' })
  b.push(ready(true))
  await vi.waitFor(() => { expect(b.mirror.state.getSnapshot()).toMatchObject({ connected: true, error: null }) })
  expect(b.onSnapshot.mock.calls).toEqual([[ready(false)], [ready(true)]])
  await b.mirror.dispose()
})

it('publishes each snapshot before handing it to the owner', async () => {
  const b = fixture()
  b.onSnapshot.mockImplementationOnce((snapshot) => { expect(b.mirror.state.getSnapshot().snapshot).toBe(snapshot) })
  b.push(ready(true))
  await vi.waitFor(() => { expect(b.onSnapshot).toHaveBeenCalledOnce() })
  await b.mirror.dispose()
})

it.each([new Error('invalid snapshot'), 'invalid snapshot'])('reports a terminal stream failure', async (failure) => {
  const b = fixture()
  b.throw(failure)
  await vi.waitFor(() => { expect(b.mirror.state.getSnapshot()).toMatchObject({ connected: false, error: 'invalid snapshot' }) })
  await b.mirror.dispose()
})

it('does not publish a disposal rejection as a Host failure', async () => {
  const b = fixture()
  b.push(ready(false))
  await vi.waitFor(() => { expect(b.mirror.state.getSnapshot().connected).toBe(true) })
  await b.mirror.dispose()
  expect(b.mirror.state.getSnapshot().error).toBeNull()
})
