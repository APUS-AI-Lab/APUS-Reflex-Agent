/** Dedicated keep-alive transport for the Jev gateway, deferring to the HTTP proxy policy. */
import type { Context } from '@deepseek-ai/cordis'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import type { Agent } from 'undici'
import type { JevFetch } from './client.ts'

/**
 * Create a fetch that reuses one long-lived connection pool for direct requests.
 * A request the active proxy policy routes through a proxy uses the process-wide dispatcher instead,
 * so the dedicated pool never bypasses a configured proxy. The pool closes with the plugin.
 * @param ctx - Plugin context owning the pool lifetime.
 * With `resetAfterFailures`, that many consecutive requests without a response destroy the pool, so a
 * stalled connection (on HTTP/2 every request shares one) is replaced by a fresh one on the next request.
 * @param keepAliveMs - Idle time a connection stays open for reuse.
 * @param http2 - Whether to negotiate HTTP/2.
 * @param resetAfterFailures - Consecutive failed requests that reopen the pool; omission never reopens it.
 * @returns Fetch with the {@link JevFetch} signature.
 */
export function createPooledFetch(ctx: Context, keepAliveMs: number, http2: boolean, resetAfterFailures?: number): JevFetch {
  type Pool = Promise<{ readonly agent: Agent; readonly fetch: typeof import('undici').fetch }>
  let pool: Pool | undefined
  let failures = 0
  ctx.effect(() => () => {
    const closing = pool
    pool = undefined
    // close() lets a request already in flight finish instead of destroying its socket.
    void closing?.then(({ agent }) => agent.close()).catch((error: unknown) => {
      ctx.logger.warn(`jev: connection pool close failed: ${String(error)}`)
    })
  }, 'jev.connectionPool()')
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (proxyRouteFor(url).proxied) return await fetch(input, init)
    pool ??= import('undici').then(undici => ({
      agent: new undici.Agent({ keepAliveTimeout: keepAliveMs, keepAliveMaxTimeout: keepAliveMs, allowH2: http2 }),
      fetch: undici.fetch,
    }))
    // Node's built-in fetch bundles an older undici whose handler protocol this Agent rejects,
    // so the request uses the same package's fetch and is re-wrapped as a standard Response.
    const current = pool
    const { agent, fetch: pooledFetch } = await current
    const request = new Request(input, init)
    let response: Awaited<ReturnType<typeof pooledFetch>>
    try {
      response = await pooledFetch(request.url, {
        method: request.method, headers: [...request.headers], signal: request.signal,
        // proxy-exempt: reached only when proxyRouteFor reports a direct route for this URL.
        dispatcher: agent,
        ...request.body === null ? {} : { body: await request.arrayBuffer() },
      })
    } catch (error) {
      failures += 1
      if (resetAfterFailures !== undefined && failures >= resetAfterFailures && pool === current) {
        ctx.logger.warn(`jev: ${String(failures)} consecutive requests got no response; reopening the connection pool`)
        failures = 0
        pool = undefined
        // destroy() drops the stalled sockets; close() would wait for requests that never finish.
        void agent.destroy().catch((destroyError: unknown) => {
          ctx.logger.warn(`jev: connection pool destroy failed: ${String(destroyError)}`)
        })
      }
      throw error
    }
    failures = 0
    return new Response(response.body === null ? null : await response.arrayBuffer(),
      { status: response.status, statusText: response.statusText, headers: [...response.headers] })
  }
}
