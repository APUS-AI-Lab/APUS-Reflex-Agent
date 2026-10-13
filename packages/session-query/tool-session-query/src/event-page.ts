/** Exact, version-bound text pages with a complete rendered-output byte budget. */
import { createHash } from 'node:crypto'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

/** Model-selected source view and continuation position. */
export interface EventPageArgs {
  readonly view?: 'event-json' | 'text-block'
  readonly block?: number
  readonly offset?: number
  readonly expected_sha256?: string
  readonly before?: number
  readonly after?: number
}

/** Whether the caller explicitly requested a page.
 * @param args - Tool arguments.
 * @returns Whether any page selector or continuation was supplied.
 */
export function requestsEventPage(args: EventPageArgs): boolean {
  return args.view !== undefined || args.block !== undefined || args.offset !== undefined || args.expected_sha256 !== undefined
}

/** Validate page selectors before source reads.
 * @param args - Model arguments.
 * @throws When selectors, continuation, or neighbor arguments conflict.
 */
export function validateEventPageArgs(args: EventPageArgs): void {
  if (!requestsEventPage(args)) return
  if ((args.before ?? 0) !== 0 || (args.after ?? 0) !== 0) invalid('Read neighboring events separately when paging.')
  if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0)) invalid('offset must be a non-negative safe integer.')
  if (args.view === 'text-block') {
    if (args.block === undefined || !Number.isSafeInteger(args.block) || args.block < 0) invalid('text-block requires a non-negative block index.')
  } else if (args.block !== undefined) invalid('block requires view text-block.')
  if (args.expected_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(args.expected_sha256)) invalid('expected_sha256 must be a lowercase SHA-256 digest.')
  if ((args.offset ?? 0) > 0 && args.expected_sha256 === undefined) invalid('Continuation requires expected_sha256 from the first page.')
}

/** Render an exact source page; concatenated content reconstructs the selected string.
 * @param sessionId - Authorized source Session.
 * @param event - Event from the authorized observation.
 * @param args - Validated page selection.
 * @param maxBytes - Complete JSON output byte budget.
 * @param neighborsOmitted - Whether an oversized legacy read omitted requested neighbors.
 * @returns One JSON object with source identity, event digest and continuation metadata.
 * @throws When the source changed, the position is invalid, or the budget cannot make progress.
 */
export function renderEventPage(
  sessionId: SessionId, event: SessionEvent, args: EventPageArgs, maxBytes: number, neighborsOmitted = false,
): string {
  const raw = JSON.stringify(event, null, 2)
  const sha256 = createHash('sha256').update(raw).digest('hex')
  if (args.expected_sha256 !== undefined && args.expected_sha256 !== sha256) {
    throw new HarnessError('Event changed; restart the read from offset 0.', 'SESSION_QUERY_TOOL_SOURCE_CHANGED')
  }
  const view = args.view ?? 'event-json'
  let text = raw
  if (view === 'text-block') {
    const index = args.block
    if (index === undefined) invalid('text-block requires a block index.')
    const content = event.type === 'user/message' ? event.data.content
      : event.type === 'assistant/message' ? event.data.message.content : []
    const block = content[index]
    if (block?.type !== 'text') invalid('The selected event block is not text.')
    text = block.text
  }
  const offset = args.offset ?? 0
  if (offset > text.length || splitsPair(text, offset)) invalid('offset is outside the text or splits a Unicode character.')
  const render = (end: number) => JSON.stringify({
    session_id: sessionId, seq: event.seq, view, ...(view === 'text-block' ? { block: args.block } : {}),
    sha256, offset, end, total: text.length, content: text.slice(offset, end),
    next_offset: end === text.length ? null : end,
    ...(neighborsOmitted ? { neighbors_omitted: true } : {}),
  })
  const complete = render(text.length)
  if (Buffer.byteLength(complete) <= maxBytes) return complete
  let low = offset
  let high = text.length - 1
  let best = offset
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2)
    const end = splitsPair(text, middle) ? middle - 1 : middle
    if (Buffer.byteLength(render(end)) <= maxBytes) {
      best = end
      low = middle + 1
    } else high = middle - 1
  }
  if (best === offset) throw new HarnessError('Read budget cannot fit a source page; increase maxReadBytes.', 'SESSION_QUERY_TOOL_READ_BUDGET_TOO_SMALL')
  return render(best)
}

function splitsPair(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF
}

function invalid(message: string): never {
  throw new HarnessError(message, 'SESSION_QUERY_TOOL_INVALID_PAGE')
}
