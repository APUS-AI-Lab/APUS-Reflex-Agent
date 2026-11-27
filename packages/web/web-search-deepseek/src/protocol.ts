/**
 * Two wire dialects for the same server-side search capability.
 *
 * Anthropic-compatible endpoints answer a search with `POST /v1/messages` and
 * the `web_search_20250305` server tool. OpenAI-compatible gateways expose the
 * same capability through the Responses API — `POST /v1/responses` with
 * `tools: [{ type: 'web_search' }]` — and reject the Anthropic shape outright
 * (`1 validation error: Input should be 'function'`).
 *
 * A deployment may move between the two when its gateway or key changes, so the
 * provider probes once and remembers which dialect answered: the probe costs one
 * request, and every later search goes straight to the dialect that worked.
 *
 * @module @deepseek-ai/dsh-web-search-deepseek/protocol
 */

/** Which wire dialect a search request uses. */
export type SearchProtocol = 'anthropic' | 'openai-responses'

/** Protocol setting: a fixed dialect, or `auto` to probe once and remember. */
export type SearchProtocolSetting = SearchProtocol | 'auto'

/** One candidate request the provider can send. */
export interface SearchAttempt {
  /** Dialect this attempt speaks. */
  readonly protocol: SearchProtocol
  /** Absolute URL the attempt posts to. */
  readonly endpoint: string
  /** Exact JSON body, recorded before dispatch. */
  readonly body: Record<string, unknown>
  /** Headers the attempt sends, minus the credential. */
  readonly headers: Record<string, string>
}

/** The normalized search output both dialects reduce to. */
export interface SearchAnswer {
  /** Provider-generated answer text, when the dialect returns one. */
  readonly text: string
  /** Citeable sources, in the order the provider presented them. */
  readonly sources: readonly { readonly url: string; readonly title?: string }[]
  /** Queries the provider reports having searched, when it reports them. */
  readonly queries: readonly string[]
}

/**
 * Endpoint roots one dialect may live at.
 *
 * A configured base is often the API root itself (`…/v1`) and sometimes the
 * host above it, so each dialect tries both spellings rather than assuming one
 * — the probe absorbs the wrong guess at the cost of a request.
 * @param baseURL - the configured search base.
 * @returns candidate roots, the more likely one first.
 */
export function endpointCandidates(baseURL: string): string[] {
  const base = baseURL.replace(/\/+$/u, '')
  // Every candidate must be an API root ending in `/v1`: the dialect paths are
  // `/v1/messages` and `/v1/responses`, and a root without `/v1` would produce
  // `/messages` — a path no gateway serves.
  return base.endsWith('/v1') ? [base] : [`${base}/v1`]
}

/**
 * The Anthropic Messages request for one query.
 * @param root - API root ending in `/v1`.
 * @param model - provider model id.
 * @param query - the model's search query.
 * @param options - token and server-tool bounds.
 * @returns the attempt to send.
 */
export function anthropicAttempt(
  root: string,
  model: string,
  query: string,
  options: { readonly maxTokens: number; readonly maxUses: number; readonly apiVersion: string },
): SearchAttempt {
  return {
    protocol: 'anthropic',
    endpoint: `${root}/messages`,
    body: {
      model,
      max_tokens: options.maxTokens,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }],
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: options.maxUses }],
    },
    headers: { 'anthropic-version': options.apiVersion },
  }
}

/**
 * The OpenAI Responses request for one query.
 *
 * The gateway does not answer `chat/completions` with a server tool — it rejects
 * any tool whose type is not `function`. The Responses API is the one that runs
 * `web_search` itself and returns the queries it issued.
 * @param root - API root ending in `/v1`.
 * @param model - provider model id.
 * @param query - the model's search query.
 * @param options - output-token bound.
 * @returns the attempt to send.
 */
export function openaiAttempt(
  root: string,
  model: string,
  query: string,
  options: { readonly maxTokens: number },
): SearchAttempt {
  return {
    protocol: 'openai-responses',
    endpoint: `${root}/responses`,
    body: {
      model,
      input: `Search the web for: ${query}\nReturn the most relevant results. Include source URLs.`,
      tools: [{ type: 'web_search' }],
      max_output_tokens: options.maxTokens,
    },
    headers: {},
  }
}

/** Whether a status means the *dialect* is wrong rather than the call failing. */
export function isProtocolMismatch(status: number): boolean {
  // 404/405: the path does not exist here. 400/422: the body shape was rejected
  // before any search ran. 503 with `model_not_found` (handled by the caller)
  // means the model has no route on this dialect. Anything else — 401, 429, 5xx
  // — is a real failure of a dialect that does exist, and retrying the other
  // one would only hide it.
  return status === 404 || status === 405 || status === 400 || status === 422
}

/**
 * Reduce an Anthropic Messages response to the normalized answer.
 * @param payload - the parsed response body.
 * @returns text, sources and the queries the server reported.
 */
export function readAnthropicAnswer(payload: unknown): SearchAnswer {
  const content = asArray(asRecord(payload)?.['content'])
  const texts: string[] = []
  const sources: { url: string; title?: string }[] = []
  let searched = false
  for (const block of content) {
    const item = asRecord(block)
    if (item === undefined) continue
    if (item['type'] === 'server_tool_use' && item['name'] === 'web_search') searched = true
    // The result block carries the sources the server actually retrieved;
    // citations repeat only the ones the answer quoted, so reading citations
    // alone loses every result the model did not cite.
    if (item['type'] === 'web_search_tool_result') {
      searched = true
      for (const hit of asArray(item['content'])) {
        const result = asRecord(hit)
        const url = result?.['url']
        if (typeof url !== 'string') continue
        const title = result?.['title']
        sources.push({ url, ...typeof title === 'string' ? { title } : {} })
      }
      continue
    }
    if (item['type'] !== 'text') continue
    const text = item['text']
    if (typeof text === 'string' && text.length > 0) texts.push(text)
    for (const cite of asArray(item['citations'])) {
      const note = asRecord(cite)
      const url = note?.['url']
      if (typeof url !== 'string') continue
      const title = note?.['title']
      sources.push({ url, ...typeof title === 'string' ? { title } : {} })
    }
  }
  if (!searched) {
    throw new Error('the provider answered without issuing a web search')
  }
  return { text: texts.join('\n').trim(), sources: dedupeByUrl(sources), queries: [] }
}

/**
 * Reduce an OpenAI Responses payload to the normalized answer.
 * @param payload - the parsed response body.
 * @returns text, annotated sources and the queries the search calls reported.
 */
export function readOpenAIAnswer(payload: unknown): SearchAnswer {
  const output = asArray(asRecord(payload)?.['output'])
  const texts: string[] = []
  const sources: { url: string; title?: string }[] = []
  const queries: string[] = []
  let searched = false
  for (const entry of output) {
    const item = asRecord(entry)
    if (item === undefined) continue
    if (item['type'] === 'web_search_call') {
      searched = true
      const action = asRecord(item['action'])
      for (const query of asArray(action?.['queries'])) {
        if (typeof query === 'string') queries.push(query)
      }
      continue
    }
    if (item['type'] !== 'message') continue
    for (const part of asArray(item['content'])) {
      const piece = asRecord(part)
      if (piece === undefined) continue
      const text = piece['text']
      if ((piece['type'] === 'output_text' || piece['type'] === 'text') && typeof text === 'string') {
        texts.push(text)
      }
      for (const note of asArray(piece['annotations'])) {
        const record = asRecord(note)
        const url = record?.['url']
        if (typeof url !== 'string') continue
        const title = record?.['title']
        sources.push({ url, ...typeof title === 'string' ? { title } : {} })
      }
    }
  }
  if (!searched) {
    // A response that never issued a search answered from the model's own
    // knowledge. Reporting it as a search result would fabricate grounding.
    throw new Error('the provider answered without issuing a web search')
  }
  return { text: texts.join('\n').trim(), sources: dedupeByUrl(sources), queries }
}

function dedupeByUrl(sources: { url: string; title?: string }[]): { url: string; title?: string }[] {
  const seen = new Map<string, { url: string; title?: string }>()
  for (const source of sources) if (!seen.has(source.url)) seen.set(source.url, source)
  return [...seen.values()]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
