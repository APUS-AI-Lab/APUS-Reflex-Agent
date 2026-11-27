import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime, {
  WebError,
  type WebFetchProvider,
  type WebFetchResult,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
} from '@deepseek-ai/dsh-web'

/** A scripted search provider for contract tests. */
function makeSearchProvider(
  id: string,
  available: boolean,
  search: (request: WebSearchRequest) => Promise<WebSearchResult>,
): WebSearchProvider {
  return { id, available: () => available, search: request => search(request) }
}

function makeFetchProvider(id: string, available: boolean, result: WebFetchResult): WebFetchProvider {
  return { id, available: () => available, fetch: () => Promise.resolve(result) }
}

const available = true
const unavailable = false

function searchResult(marker: string, overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  return { content: marker, sources: [], truncated: false, ...overrides }
}

function fetchResult(marker: string): WebFetchResult {
  return { url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: marker }, truncated: false }
}

/** Mount a WebRuntime on a fresh root context with the given config. */
async function mountWeb(config: ConstructorParameters<typeof WebRuntime>[1] = {}): Promise<{ ctx: Context; web: WebRuntime }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, config)
  return { ctx, web: ctx.web }
}

describe('WebRuntime registration', () => {
  it('registers a search provider and unregisters it via the returned disposer', async () => {
    const { web } = await mountWeb()

    const dispose = web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })

    dispose()
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })

  it('throws WEB_DUPLICATE_PROVIDER on a duplicate search id', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    expect(() => web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa')))))
      .toThrow(expect.objectContaining({ code: 'WEB_DUPLICATE_PROVIDER' }))
  })

  it('keeps search and fetch id namespaces independent', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('shared', available, () => Promise.resolve(searchResult('shared'))))
    expect(() => web.registerFetchProvider(makeFetchProvider('shared', available, fetchResult('shared')))).not.toThrow()
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, web } = await mountWeb()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    }, { inject: ['web'] }))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
    await fiber.dispose()
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })
})

describe('WebRuntime execution resolution', () => {
  it('throws WEB_PROVIDER_UNAVAILABLE when nothing is registered', async () => {
    const { web } = await mountWeb()
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })

  it('throws WEB_PROVIDER_UNAVAILABLE when providers exist but none are usable', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })

  it('throws WEB_PROVIDER_CONFIGURED_MISSING for an unregistered configured id', async () => {
    const { web } = await mountWeb({ searchProvider: 'perplexity' })
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('throws WEB_PROVIDER_CONFIGURED_UNAVAILABLE for an unusable configured id', async () => {
    const { web } = await mountWeb({ searchProvider: 'exa' })
    web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('throws WEB_PROVIDER_AMBIGUOUS rather than picking by order', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_AMBIGUOUS' }))
  })

  it('runs the configured provider even when another usable provider is registered', async () => {
    const { web } = await mountWeb({ searchProvider: 'perplexity' })
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
  })

  it('ignores unusable providers when auto-selecting', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    web.registerSearchProvider(makeSearchProvider('perplexity', unavailable, () => Promise.resolve(searchResult('perplexity'))))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
  })

  it('does not let registration order change auto-selection', async () => {
    const a = await mountWeb()
    a.web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    a.web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    await expect(a.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })

    const b = await mountWeb()
    b.web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    b.web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    await expect(b.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
  })

  it('runs the selected provider and returns its result', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(
      searchResult('exa', { content: 'answer', sources: [{ url: 'https://a' }] }),
    )))
    const result = await web.search({ query: 'q' })
    expect(result.content).toBe('answer')
    expect(result.sources).toEqual([{ url: 'https://a' }])
  })

  it('propagates the abort signal to the provider', async () => {
    const { web } = await mountWeb()
    const seen: (AbortSignal | undefined)[] = []
    web.registerSearchProvider({
      id: 'exa',
      available: () => available,
      search: (_request, signal) => { seen.push(signal); return Promise.resolve(searchResult('exa')) },
    })
    const controller = new AbortController()
    await web.search({ query: 'q' }, controller.signal)
    expect(seen[0]).toBe(controller.signal)
  })
})

describe('WebRuntime maxResults enforcement', () => {
  it('truncates sources and sets truncated when a provider over-returns', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa', {
      sources: [{ url: 'https://1' }, { url: 'https://2' }, { url: 'https://3' }],
    }))))
    const result = await web.search({ query: 'q', maxResults: 2 })
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('leaves truncated false when within the bound', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa', {
      sources: [{ url: 'https://1' }],
    }))))
    const result = await web.search({ query: 'q', maxResults: 8 })
    expect(result.sources).toHaveLength(1)
    expect(result.truncated).toBe(false)
  })

  it('does not bound when maxResults is omitted', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa', {
      sources: [{ url: 'https://1' }, { url: 'https://2' }],
    }))))
    const result = await web.search({ query: 'q' })
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })
})

describe('WebRuntime fetch capability', () => {
  it('resolves and runs the fetch provider independently of search', async () => {
    const { web } = await mountWeb()
    web.registerFetchProvider(makeFetchProvider('http', available, fetchResult('http')))
    const result = await web.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('http')
    expect(result.statusCode).toBe(200)
  })

  it('throws WEB_PROVIDER_UNAVAILABLE for fetch when no fetch provider is registered', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    await expect(web.fetch({ url: 'https://example.com' })).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }),
    )
  })
})

describe('WebError', () => {
  it('is a HarnessError carrying its code', () => {
    const error = new WebError('boom', 'WEB_INVALID_URL')
    expect(error.code).toBe('WEB_INVALID_URL')
    expect(error.name).toBe('WebError')
  })
})

describe('resolved provider identity', () => {
  it('reports which search provider a call would use', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('primary', available, () => Promise.resolve(searchResult('x'))))

    expect(web.resolvedSearchProviderId()).toBe('primary')
  })

  it('reports the configured id when one is set', async () => {
    const { web } = await mountWeb({ searchProvider: 'chosen' })
    web.registerSearchProvider(makeSearchProvider('other', available, () => Promise.resolve(searchResult('x'))))
    web.registerSearchProvider(makeSearchProvider('chosen', available, () => Promise.resolve(searchResult('y'))))

    expect(web.resolvedSearchProviderId()).toBe('chosen')
  })

  it('reports nothing when no provider can serve the call', async () => {
    const { web } = await mountWeb()

    expect(web.resolvedSearchProviderId()).toBeUndefined()
  })
})

describe('provider selection records', () => {
  /** Mount a runtime whose initiator records every appended event. */
  async function mountWithRecorder(config: ConstructorParameters<typeof WebRuntime>[1] = {}) {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, config)
    const recorded: { type: string; data: Record<string, unknown> }[] = []
    ctx.provide('agents', {
      currentInitiator: () => ({
        session: {
          append: (type: string, data: Record<string, unknown>) => { recorded.push({ type, data }) },
        },
      }),
    })
    return { web: ctx.web, recorded }
  }

  it('records the search provider the seam actually ran', async () => {
    const { web, recorded } = await mountWithRecorder()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('x'))))

    await web.search({ query: 'q' })

    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.type).toBe('tool/provider-selected')
    expect(recorded[0]?.data).toMatchObject({
      capability: 'web-search',
      providerId: 'exa',
      selectionMode: 'auto-single',
      outcome: 'completed',
    })
    expect(recorded[0]?.data.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('records a configured selection as such', async () => {
    const { web, recorded } = await mountWithRecorder({ searchProvider: 'chosen' })
    web.registerSearchProvider(makeSearchProvider('other', available, () => Promise.resolve(searchResult('x'))))
    web.registerSearchProvider(makeSearchProvider('chosen', available, () => Promise.resolve(searchResult('y'))))

    await web.search({ query: 'q' })

    expect(recorded[0]?.data).toMatchObject({ providerId: 'chosen', selectionMode: 'configured' })
  })

  it('records a failed fetch as failed', async () => {
    const { web, recorded } = await mountWithRecorder()
    web.registerFetchProvider({
      id: 'broken',
      available: () => true,
      fetch: () => Promise.reject(new Error('boom')),
    })

    await expect(web.fetch({ url: 'https://example.com' })).rejects.toThrow('boom')

    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.data).toMatchObject({ capability: 'web-fetch', providerId: 'broken', outcome: 'failed' })
  })

  it('records nothing when no provider can serve the call', async () => {
    const { web, recorded } = await mountWithRecorder()

    await expect(web.search({ query: 'q' })).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }),
    )
    expect(recorded).toHaveLength(0)
  })
})

describe('provider selection record containment', () => {
  async function mount(config: ConstructorParameters<typeof WebRuntime>[1] = {}) {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, config)
    return ctx
  }

  it('records a failed search as failed', async () => {
    const ctx = await mount()
    const recorded: { type: string; data: Record<string, unknown> }[] = []
    ctx.provide('agents', {
      currentInitiator: () => ({
        session: { append: (type: string, data: Record<string, unknown>) => { recorded.push({ type, data }) } },
      }),
    })
    ctx.web.registerSearchProvider({
      id: 'broken',
      available: () => true,
      search: () => Promise.reject(new Error('upstream down')),
    })

    await expect(ctx.web.search({ query: 'q' })).rejects.toThrow('upstream down')

    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.data).toMatchObject({
      capability: 'web-search', providerId: 'broken', outcome: 'failed',
    })
  })

  it('runs the provider even when no initiator can own the record', async () => {
    // A direct caller outside any agent boundary still gets its result; only
    // the log entry is missing.
    const ctx = await mount()
    ctx.provide('agents', { currentInitiator: () => undefined })
    ctx.web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('ok'))))

    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'ok' })
  })

  it('runs the provider when recording the selection throws', async () => {
    // An observer's failure must not turn a completed search into an error.
    const ctx = await mount()
    ctx.provide('agents', {
      currentInitiator: () => ({
        session: { append: () => { throw new Error('log unavailable') } },
      }),
    })
    ctx.web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('ok'))))

    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'ok' })
  })
})

describe('provider selection call attribution', () => {
  async function mount() {
    const ctx = new Context()
    await ctx.plugin(WebRuntime)
    const recorded: { type: string; data: Record<string, unknown> }[] = []
    ctx.provide('agents', {
      currentInitiator: () => ({
        session: { append: (type: string, data: Record<string, unknown>) => { recorded.push({ type, data }) } },
      }),
    })
    return { web: ctx.web, recorded }
  }

  it('records the tool call a search ran for', async () => {
    // Without the call id a parallel batch shows N selections beside N calls
    // instead of inside the call each one belongs to.
    const { web, recorded } = await mount()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('x'))))

    await web.search({ query: 'q', callId: 'call-1' })

    expect(recorded[0]?.data).toMatchObject({ capability: 'web-search', callId: 'call-1' })
  })

  it('records the tool call a fetch ran for', async () => {
    const { web, recorded } = await mount()
    web.registerFetchProvider(makeFetchProvider('http', available, fetchResult('x')))

    await web.fetch({ url: 'https://example.com', callId: 'call-2' })

    expect(recorded[0]?.data).toMatchObject({ capability: 'web-fetch', callId: 'call-2' })
  })

  it('omits the field when the caller supplies no call id', async () => {
    const { web, recorded } = await mount()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('x'))))

    await web.search({ query: 'q' })

    expect(recorded[0]?.data).not.toHaveProperty('callId')
  })
})
