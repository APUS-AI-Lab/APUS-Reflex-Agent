/** Observes actual SDK loop requests without replacing provider responses. */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import System3 from '@deepseek-ai/dsh-experimental-system3'

export const name = 'reflex-cache-benchmark-observer'
export const inject = ['sessionProjections', 'llm']
export async function apply(ctx, config) {
  await ctx.plugin(Jev, { endpoint: config.endpoint, model: config.reflexModel, apiKeyEnv: 'JEV_API_KEY', effort: 'high' })
  await ctx.plugin(System3, { privacyMode: 'controlled', approvedRemoteIds: ['reflex-benchmark'],
    approvedRemoteDataClasses: ['public', 'workspace'], jevExecutionDomain: 'network', jevRouteId: 'reflex-benchmark',
    jevEffort: 'high', reflexContext: { mode: config.enabled ? 'active' : 'off', yes: 0.9, no: 0.1,
      deadlineMs: 15000, sessionDataClasses: ['public', 'workspace'], maxRequestChars: 4000,
      maxCandidates: 16, maxFragmentChars: 1024, protectRecentMessages: 4, maxRestoredChars: 8192, maxSearchResults: 8 } })
  let previous
  if (existsSync(config.trace)) {
    const rows = readFileSync(config.trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    previous = rows.at(-1)?.messageHashes
  }
  ctx.on('llm/stream', async function* (options, next) {
    if (options.purpose !== undefined) { yield* next(); return }
    const messages = options.messages.map(message => createHash('sha256').update(JSON.stringify(message)).digest('hex'))
    const prefixUnchanged = previous === undefined ? null : isDeepStrictEqual(messages.slice(0, previous.length), previous)
    const start = performance.now()
    let firstOutputMs = null
    const usageEvents = []
    let error = null
    try {
      for await (const chunk of next()) {
        if (firstOutputMs === null && (chunk.type === 'text-delta' || chunk.type === 'tool-call-delta')) firstOutputMs = performance.now() - start
        if (chunk.type === 'usage') usageEvents.push(chunk.usage)
        yield chunk
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
      throw caught
    } finally {
      appendFileSync(config.trace, JSON.stringify({ provider: options.provider, model: options.model, effort: options.reasoningEffort,
        toolsSha256: createHash('sha256').update(JSON.stringify(options.tools ?? [])).digest('hex'),
        messageHashes: messages, prefixUnchanged, firstOutputMs,
        totalMs: performance.now() - start, usageEvents, error }) + '\n')
      previous = messages
    }
  })
}
