import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'

/** Fake undici: the first pool's connection is stalled, later pools answer at once. */
const fake = vi.hoisted(() => {
  const agents: Array<{ destroy: () => Promise<void>; destroyed: number; stalled: boolean }> = []
  let destroyFails = false
  class Agent {
    destroyed = 0
    readonly stalled = agents.length === 0
    constructor() { agents.push(this) }
    destroy(): Promise<void> {
      this.destroyed += 1
      return destroyFails ? Promise.reject(new Error('socket busy')) : Promise.resolve()
    }
  }
  const fetch = (_url: string, init: { dispatcher: Agent; signal?: AbortSignal }) => {
    if (init.signal?.aborted) return Promise.reject(new Error('request timed out'))
    if (!init.dispatcher.stalled) {
      return Promise.resolve({ status: 200, statusText: 'OK', headers: [], body: '{}', arrayBuffer: () => Promise.resolve(new TextEncoder().encode('{}').buffer) })
    }
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('request timed out')) }, { once: true })
    })
  }
  const setDestroyFails = (value: boolean): void => { destroyFails = value }
  const reset = (): void => { agents.length = 0; destroyFails = false }
  return { agents, Agent, fetch, setDestroyFails, reset }
})
vi.mock('undici', () => ({ Agent: fake.Agent, fetch: fake.fetch }))
vi.mock('@deepseek-ai/dsh-http-proxy', () => ({ proxyRouteFor: () => ({ proxied: false }) }))
const { createPooledFetch } = await import('../src/pool.ts')

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  fake.reset()
})

const URL_ = 'http://jev.test/v1/systemone'
function pooled(resetAfterFailures?: number) {
  const ctx = new Context()
  contexts.push(ctx)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const request = async (signal: AbortSignal = AbortSignal.timeout(20)) => {
    try {
      const response = await createdFetch(URL_, { signal })
      return response.status
    } catch {
      return 'no response'
    }
  }
  const createdFetch = createPooledFetch(ctx, 60_000, true, resetAfterFailures)
  return { request, warn }
}

async function abortedRequest(h: ReturnType<typeof pooled>) {
  const controller = new AbortController()
  controller.abort()
  return await h.request(controller.signal)
}

it('stays stuck on a stalled connection when no reset is configured', async () => {
  const h = pooled()
  expect([await abortedRequest(h), await abortedRequest(h), await abortedRequest(h)]).toEqual(['no response', 'no response', 'no response'])
  expect(fake.agents).toHaveLength(1)
})

it('reopens the pool after consecutive failures, so the next request reaches a fresh connection', async () => {
  const h = pooled(2)
  expect([await abortedRequest(h), await abortedRequest(h), await h.request(), await h.request()]).toEqual(['no response', 'no response', 200, 200])
  expect(fake.agents.map(agent => agent.destroyed)).toEqual([1, 0])
  expect(h.warn).toHaveBeenCalledWith('jev: 2 consecutive requests got no response; reopening the connection pool')
})

it('counts only consecutive failures and destroys a pool once even when concurrent requests fail on it', async () => {
  const single = pooled(1)
  const [first, second] = await Promise.all([abortedRequest(single), abortedRequest(single)])
  expect([first, second]).toEqual(['no response', 'no response'])
  expect(fake.agents[0]?.destroyed).toBe(1)
  expect(await single.request()).toBe(200)
})

it('logs a failed destroy without breaking the next request', async () => {
  fake.setDestroyFails(true)
  const h = pooled(1)
  expect(await abortedRequest(h)).toBe('no response')
  await vi.waitFor(() => { expect(h.warn).toHaveBeenCalledWith('jev: connection pool destroy failed: Error: socket busy') })
  expect(await h.request()).toBe(200)
})

it('settles cancellation that happened before the pooled transport starts', async () => {
  const h = pooled(1)
  expect(await h.request(AbortSignal.abort())).toBe('no response')
  expect(fake.agents[0]?.destroyed).toBe(1)
  expect(await h.request()).toBe(200)
})
