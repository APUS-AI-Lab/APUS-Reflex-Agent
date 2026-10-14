/**
 * Model-facing recall of conversation spans that compaction checkpoints replaced.
 *
 * `history_read` pages through one checkpoint's original span and `history_search` scans every checkpoint's
 * originals for a literal string. Both read the current session's append-only log through
 * `ctx.sessionQuery`, so recall is a pure function of the log and its output lands as ordinary tool results.
 *
 * @module @deepseek-ai/dsh-tool-history-recall
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool, type GenericCallView, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { listCheckpoints, renderCheckpoint, type Checkpoint } from './transcript.ts'

export { listCheckpoints, renderCheckpoint } from './transcript.ts'
export type { Checkpoint } from './transcript.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-history-recall'

/** Capability services required by the model-facing consumer. */
export const inject = ['tools', 'systemPrompt', 'sessionQuery']

/** Deployment-owned page and result bounds. */
export interface Config {
  /** Characters returned by one `history_read` page. Defaults to 24000. */
  pageChars?: number
  /** Maximum matches returned by one `history_search` call. Defaults to 20. */
  maxMatches?: number
  /** Characters of context shown on each side of a match. Defaults to 160. */
  snippetRadius?: number
}

/** Bounds with every default applied. */
export type ResolvedConfig = Required<Config>

const DEFAULTS: ResolvedConfig = { pageChars: 24_000, maxMatches: 20, snippetRadius: 160 }

/** Schemastery config for Loader defaults and generated configuration docs; it resolves every default. */
export const Config: z<Config, ResolvedConfig> = z.object({
  pageChars: z.number().step(1).min(1000).default(DEFAULTS.pageChars),
  maxMatches: z.number().step(1).min(1).default(DEFAULTS.maxMatches),
  snippetRadius: z.number().step(1).min(0).default(DEFAULTS.snippetRadius),
})

const PROMPT_TEXT =
  'Checkpoints that condense earlier conversation may end with a footer naming a checkpoint id, and recalled memories '
  + 'name the event of their source message. The original messages are never lost: use history_read with a checkpoint '
  + 'id or a source event to read them page by page, or history_search to find an exact string, value, path, or error '
  + 'message across every checkpoint. Read the originals before relying on details that a checkpoint summary omits or '
  + 'only paraphrases.'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/** Register both recall tools and their shared prompt guidance. */
export function apply(ctx: Context, resolved: ResolvedConfig): void {
  ctx.systemPrompt.section({
    name: 'tool:history-recall',
    order: ctx.systemPrompt.getSectionOrder('TOOL_HISTORY_RECALL'),
    text: PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'history_read',
    description: 'Read the original conversation that a compaction checkpoint replaced, one page at a time. '
      + 'Name the checkpoint, or the source event of a recalled memory to start at that message.',
    parameters: {
      checkpoint: { type: 'integer', description: 'Checkpoint id from a checkpoint footer.' },
      event: { type: 'integer', description: 'Source event seq of a recalled memory; reads the checkpoint that replaced it, from that message.' },
      offset: { type: 'integer', description: 'Character offset to continue from. Omit to start at the beginning, or at the event.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const events = await loadEvents(ctx, exec)
      if (args.checkpoint !== undefined && args.event === undefined) {
        return readCheckpoint(events, args.checkpoint, args.offset ?? 0, resolved.pageChars)
      }
      if (args.event === undefined || args.checkpoint !== undefined) {
        throw new HarnessError('name exactly one of checkpoint or event', 'HISTORY_RECALL_INVALID_TARGET')
      }
      const located = locateEvent(events, args.event)
      return readCheckpoint(events, located.checkpoint, args.offset ?? located.offset, resolved.pageChars)
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      kind: 'read',
      title: args.checkpoint === undefined ? `Recall event #${String(args.event)}` : `Recall checkpoint c${args.checkpoint}`,
      rawInput: args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'history_search',
    description: 'Find a literal, case-insensitive string in the original conversation behind every compaction checkpoint.',
    parameters: {
      query: { type: 'string', required: true, description: 'Exact text to find, such as an error, value, or path.' },
      checkpoint: { type: 'integer', description: 'Limit the search to one checkpoint id. Omit to search all.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => searchCheckpoints(
      await loadEvents(ctx, exec), args.query, args.checkpoint, resolved),
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      kind: 'search',
      title: 'Search compacted history',
      rawInput: args.query,
    }),
  }))
}

async function loadEvents(ctx: Context, exec: ToolRunContext): Promise<readonly SessionEvent[]> {
  const agent = exec.agent
  if (agent === undefined) {
    throw new HarnessError('history recall requires an agent-bound caller', 'HISTORY_RECALL_NO_AGENT')
  }
  const snapshot = await ctx.sessionQuery.readSession(agent.session.id)
  exec.signal.throwIfAborted()
  return snapshot.events
}

function findCheckpoint(checkpoints: readonly Checkpoint[], id: number): Checkpoint {
  const found = checkpoints.find(checkpoint => checkpoint.id === id)
  if (found !== undefined) return found
  const known = checkpoints.map(checkpoint => `c${checkpoint.id}`).join(', ')
  throw new HarnessError(
    `checkpoint ${id} does not exist; known checkpoints: ${known.length === 0 ? '(none)' : known}`,
    'HISTORY_RECALL_UNKNOWN_CHECKPOINT',
  )
}

/**
 * Find the checkpoint that replaced one source event and the event's position in its rendered span.
 * @param events - complete current session log.
 * @param seq - source event seq, such as a recalled memory's source.
 * @returns the checkpoint id and the character offset of the event's rendered message.
 */
export function locateEvent(events: readonly SessionEvent[], seq: number): { readonly checkpoint: number; readonly offset: number } {
  const checkpoint = listCheckpoints(events).find(candidate => candidate.shadowedSeqs.some(shadowed => shadowed === seq))
  if (checkpoint === undefined) {
    throw new HarnessError(`event #${seq} was not replaced by any checkpoint; it is still in the conversation`, 'HISTORY_RECALL_UNKNOWN_EVENT')
  }
  const offset = renderCheckpoint(events, checkpoint).indexOf(`#${seq} `)
  return { checkpoint: checkpoint.id, offset: Math.max(0, offset) }
}

/**
 * Render one page of a checkpoint's original span.
 * @param events - complete current session log.
 * @param id - checkpoint id (its `compaction/summary` seq).
 * @param offset - character offset into the rendered span.
 * @param pageChars - page size in characters.
 * @returns the page with a header and, when more remains, the next offset.
 */
export function readCheckpoint(events: readonly SessionEvent[], id: number, offset: number, pageChars: number): string {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new HarnessError('offset must be a non-negative integer', 'HISTORY_RECALL_INVALID_OFFSET')
  }
  const checkpoint = findCheckpoint(listCheckpoints(events), id)
  const text = renderCheckpoint(events, checkpoint)
  if (offset > text.length) {
    throw new HarnessError(`offset ${offset} is past the end (${text.length} characters)`, 'HISTORY_RECALL_INVALID_OFFSET')
  }
  const end = Math.min(text.length, offset + pageChars)
  const header = `Checkpoint c${checkpoint.id} originals (events #${checkpoint.start}–#${checkpoint.end}), `
    + `characters ${offset}–${end} of ${text.length}:`
  const footer = end < text.length
    ? `[continue with history_read checkpoint ${checkpoint.id} offset ${end}]`
    : '[end of checkpoint]'
  return `${header}\n\n${text.slice(offset, end)}\n\n${footer}`
}

/**
 * Scan checkpoint originals for a literal, case-insensitive string.
 * @param events - complete current session log.
 * @param query - non-empty text to find.
 * @param only - optional checkpoint id that limits the scan.
 * @param config - match count and snippet bounds.
 * @returns matching snippets with checkpoint ids and offsets, plus coverage counts.
 */
export function searchCheckpoints(
  events: readonly SessionEvent[],
  query: string,
  only: number | undefined,
  config: Pick<ResolvedConfig, 'maxMatches' | 'snippetRadius'>,
): string {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    throw new HarnessError('query must contain non-whitespace text', 'HISTORY_RECALL_INVALID_QUERY')
  }
  const all = listCheckpoints(events)
  const scanned = only === undefined ? all : [findCheckpoint(all, only)]
  const lines: string[] = []
  let matched = 0
  let truncated = false
  for (const checkpoint of scanned) {
    const text = renderCheckpoint(events, checkpoint)
    const haystack = text.toLowerCase()
    let checkpointMatched = false
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      if (lines.length === config.maxMatches) {
        truncated = true
        break
      }
      checkpointMatched = true
      const from = Math.max(0, at - config.snippetRadius)
      const to = Math.min(text.length, at + needle.length + config.snippetRadius)
      const snippet = text.slice(from, to).replace(/\s+/gu, ' ')
      lines.push(`- c${checkpoint.id} offset ${from}: …${snippet}…`)
    }
    if (checkpointMatched) matched += 1
    if (truncated) break
  }
  const coverage = `scanned ${scanned.length} checkpoint(s), matched ${matched}${truncated ? ', truncated' : ''}`
  if (lines.length === 0) {
    return `No match (${coverage}). The search is literal; try a shorter exact fragment, or read a plausible `
      + 'checkpoint directly with history_read.'
  }
  return `${lines.join('\n')}\n\n(${coverage}). Read more around a match with history_read at its offset.`
}
