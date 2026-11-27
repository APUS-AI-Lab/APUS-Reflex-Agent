// Type-only: resolves the `@deepseek-ai/dsh-session/types` export so the
// SessionEventMap augmentation below targets a known module.
import type {} from '@deepseek-ai/dsh-session'

/**
 * Vocabulary for the web capability seam (`ctx.web`). Search and fetch deliberately share one
 * seam so provider selection, cancellation, errors, and product configuration have one owner,
 * while retaining separate request and result types.
 * @module @deepseek-ai/dsh-web/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * What one search-capable backend is asked to search. Each request carries one
 * query; a consumer may issue several requests. `maxResults` is a
 * `dsh-tool-web`-layer bound passed through unchanged and enforced on the way
 * back by the seam (see {@link WebSearchResult}).
 */
export interface WebSearchRequest {
  readonly query: string
  /**
   * Tool call this search runs for, when the caller knows it.
   *
   * The seam records a provider-selection fact per execution; without the call
   * id that fact cannot be attached to the tool call that caused it, and a
   * parallel batch shows N selections beside N calls instead of inside them.
   */
  readonly callId?: string
  /**
   * Upper bound on returned sources; the seam truncates to it. Omitted = no
   * bound. `dsh-tool-web` always sets it. A provider whose API supports a
   * result-count control (Exa's `numResults`) should apply it at the request
   * layer as a cost/latency optimization; the seam enforces the bound
   * regardless.
   */
  readonly maxResults?: number
}

/**
 * Normalized search outcome. `content` is optional provider-generated answer
 * text or summary (Exa and DeepSeek return none; Perplexity returns a
 * generated answer).
 * `sources[]` is the portable citation shape. `truncated` is set by the seam
 * when it cut `sources[]` down to `maxResults`.
 */
export interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  readonly content?: string
  /** Citeable sources, already truncated to the request's `maxResults`. */
  readonly sources: readonly WebSearchSource[]
  /** True when the seam dropped sources to honor `maxResults`. */
  readonly truncated: boolean
}

/**
 * One citeable source. A source always has a URL; `title`, `snippet`, and
 * `publishedAt` are optional because not every provider returns them — forcing
 * adapters to invent them would make the seam lie (Perplexity citations may be
 * URL-only). `dsh-tool-web` renders `title ?? hostname(url)` for display.
 */
export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string. */
  readonly publishedAt?: string
}

/**
 * What one fetch-capable backend is asked to retrieve. The request deliberately
 * omits timeout, format, prompt, and extraction controls: cancellation is a
 * direct execution argument, while presentation and higher-level LLM concerns
 * belong outside safe retrieval.
 */
export interface WebFetchRequest {
  /** Tool call this retrieval runs for, when the caller knows it. */
  readonly callId?: string
  readonly url: string
}

/**
 * Normalized fetch outcome. A successful network fetch of a non-2xx response is
 * a result, not an error: the status code is part of the fetched resource
 * state. {@link WebError} is reserved for failures to safely retrieve or
 * represent the resource.
 */
export interface WebFetchResult {
  /** The final URL after allowed redirects (the request URL is in the request). */
  readonly url: string
  /** HTTP status code of the fetched response. */
  readonly statusCode: number
  /** Decoded body, classified by content kind. */
  readonly body: WebFetchBody
  /** True when the provider capped the decoded body. */
  readonly truncated: boolean
}

/**
 * The decoded body of a fetched resource. A CLOSED discriminated union owned by
 * `dsh-web`: the provider decodes the kind and `dsh-tool-web` renders it, so a
 * new kind is a coordinated change across known packages, not a plugin
 * extension. Consumers `switch` on `kind` ending in `default: assertNever(...)`
 * so adding a kind breaks compilation at every consumer until handled. Each arm
 * stays its own object literal even where fields coincide, so an arm can gain
 * fields the others lack.
 */
export type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }

/**
 * A search-capable backend. Registered with `ctx.web.registerSearchProvider`.
 * `id` is a stable string, unique within the search capability kind.
 */
export interface WebSearchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Run one search; honor `signal` for cancellation. */
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/**
 * A fetch-capable backend. Registered with `ctx.web.registerFetchProvider`.
 * `id` is a stable string, unique within the fetch capability kind.
 */
export interface WebFetchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Retrieve one URL; honor `signal` for cancellation. */
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
}

/**
 * Typed web error with a machine-routable, open-string `code` and chained `cause`.
 * Consumers must tolerate provider-specific codes. Shared codes cover unavailable,
 * missing, unusable, ambiguous, or duplicate providers, cancellation, and provider failure;
 * the local fetch provider additionally distinguishes invalid or blocked URLs, redirects,
 * size and timeout limits, and unsupported content types. Tool execution exposes the code in
 * structured error metadata.
 */
export class WebError extends HarnessError {}

/**
 * Log-only record that one `web` execution resolved a provider.
 *
 * The tool layer records what the model asked; this records which provider the
 * seam ran it through and whether it settled. The two answer different
 * questions, so the seam keeps its own fact rather than leaving a reader to
 * infer selection from the tool call.
 */
export interface ToolProviderSelectedEventData {
  /** Capability that ran: a search fan-out, a URL retrieval, or a language query. */
  readonly capability: ToolProviderSelectedCapability
  /** Tool call this execution served, when the caller supplied one. */
  readonly callId?: string
  /** Lsp query operation whose provider was selected; lsp records only. */
  readonly operation?: string
  /** Registered id of the provider that ran. */
  readonly providerId: string
  /** How selection chose it: an explicit config id, the single usable provider, or the file's extension. */
  readonly selectionMode: ToolProviderSelectionMode
  /** Milliseconds from entering the seam to settling, success or failure. */
  readonly latencyMs: number
  /** Whether the provider call resolved or threw. */
  readonly outcome: 'completed' | 'failed'
  /** Language id the lsp seam derived from the extension mapping; lsp only. */
  readonly languageId?: string
  /** Milliseconds from entering lsp selection until the route was chosen; lsp only. */
  readonly selectionMs?: number
  /**
   * Seam-level fallback candidates the lsp route considered, in order; lsp only.
   * Empty means the seam had exactly one candidate, which is its normal state.
   */
  readonly fallbackChain?: readonly string[]
}

/** The capability whose provider selection one record describes. */
export type ToolProviderSelectedCapability = 'web-search' | 'web-fetch' | 'lsp'

/** How a capability resolved its provider. */
export type ToolProviderSelectionMode =
  | 'configured'
  | 'auto-single'
  | 'extension-route'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One capability operation's provider selection and settlement, appended to
     * the initiating Agent's session. Search, fetch and language service share
     * the record because the question is the same one: which backend served this
     * operation, how was it chosen, and did it finish. `languageId`,
     * `selectionMs`, `fallbackChain` describe the lsp route; `queryCount`,
     * `sourceCount`, `truncated` describe a search fan-out. Each is absent when
     * the capability does not measure it, never zero-filled.
     */
    'tool/provider-selected': ToolProviderSelectedEventData
  }
}
