import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

const route = vi.hoisted(() => ({ proxied: false }))
vi.mock('@deepseek-ai/dsh-http-proxy', () => ({ proxyRouteFor: () => route }))
const { createPooledFetch } = await import('../src/pool.ts')

let server: Server | undefined
afterEach(async () => {
  route.proxied = false
  vi.restoreAllMocks()
  await new Promise<void>((resolve) => { if (server === undefined) resolve(); else server.close(() => { resolve() }) })
  server = undefined
})

async function listen(): Promise<{ url: string; connections: () => number }> {
  let count = 0
  server = createServer((_request, response) => { response.end('{}') })
  server.on('connection', () => { count += 1 })
  await new Promise<void>((resolve) => { server!.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1/models`, connections: () => count }
}

describe('Jev pooled transport', () => {
  it('reuses one direct connection across idle gaps shorter than keepAliveMs and closes with the plugin', async () => {
    const { url, connections } = await listen()
    const ctx = new Context()
    const pooled = createPooledFetch(ctx, 60_000, false)
    for (const _ of [1, 2, 3]) {
      const response = await pooled(url)
      expect(await response.text()).toBe('{}')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(connections()).toBe(1)
    await ctx.fiber.dispose()
    // The pool closes; a later request opens a new connection through a fresh pool only after re-creation.
    await expect(pooled(new URL(url))).resolves.toBeInstanceOf(Response)
    expect(connections()).toBe(2)
  })

  it('uses the process-wide fetch when the proxy policy routes the request through a proxy', async () => {
    route.proxied = true
    const global = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('proxied'))
    const ctx = new Context()
    const pooled = createPooledFetch(ctx, 60_000, true)
    const response = await pooled(new Request('https://gateway.example/v1/models'))
    expect(await response.text()).toBe('proxied')
    expect(global).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('logs instead of throwing when closing the pool fails', async () => {
    const { url } = await listen()
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const pooled = createPooledFetch(ctx, 60_000, false)
    await (await pooled(url)).text()
    const { Agent } = await import('undici')
    vi.spyOn(Agent.prototype, 'close').mockRejectedValue(new Error('close failed'))
    await ctx.fiber.dispose()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('close failed')) })
  })
})
