/**
 * Deterministic transcript rendering of the conversation span one compaction checkpoint replaced.
 *
 * @module @deepseek-ai/dsh-tool-history-recall/transcript
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, type SessionEvent, type SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'

/** One compaction checkpoint found in a session log. */
export interface Checkpoint {
  /** Seq of the `compaction/summary` event; the model-facing checkpoint id. */
  readonly id: SessionSeq
  /** First and last shadowed surface seq. */
  readonly start: SessionSeq
  readonly end: SessionSeq
  /** Surface nodes the checkpoint replaced, in surface order. */
  readonly shadowedSeqs: readonly SessionSeq[]
}

/**
 * List every committed checkpoint in log order.
 * @param events - complete contiguous session log.
 * @returns checkpoints keyed by their summary seq.
 */
export function listCheckpoints(events: readonly SessionEvent[]): Checkpoint[] {
  const checkpoints: Checkpoint[] = []
  for (const event of events) {
    if (event.type !== 'compaction/summary') continue
    checkpoints.push({
      id: event.seq,
      start: event.data.shadowedRange.start,
      end: event.data.shadowedRange.end,
      shadowedSeqs: event.data.shadowedSeqs,
    })
  }
  return checkpoints
}

/**
 * Render the replaced span as the conversation the model once saw. Reasoning blocks are omitted; a replaced
 * earlier checkpoint renders with its own footer so older spans stay reachable through it.
 * @param events - complete contiguous session log.
 * @param checkpoint - checkpoint whose shadowed span is rendered.
 * @returns the transcript text; identical for identical logs.
 */
export function renderCheckpoint(events: readonly SessionEvent[], checkpoint: Checkpoint): string {
  const parts: string[] = []
  for (const seq of checkpoint.shadowedSeqs) {
    const event = events[seq]
    if (event === undefined) continue
    const message = deriveEventMessage(event)
    if (message === null) continue
    const rendered = renderMessage(message)
    if (rendered !== undefined) parts.push(`#${seq} ${rendered}`)
  }
  return parts.join('\n\n')
}

function renderMessage(message: Message): string | undefined {
  const body = message.content.map(renderBlock).filter(text => text.length > 0).join('\n')
  switch (message.role) {
    case 'user':
      return `User: ${body}`
    case 'assistant':
      return `Assistant: ${body}`
    case 'tool':
      return `Tool result${message.isError === true ? ' (error)' : ''}: ${body}`
    case 'system':
    case 'developer':
      return undefined
  }
}

function renderBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'reasoning':
      return ''
    case 'tool-call':
      return `[tool call ${block.name}] ${block.arguments}`
    case 'image':
      return '[image]'
    case 'file':
      return '[file]'
    default:
      // Merge-extensible block union: unknown blocks render as their tag.
      return `[${block.type}]`
  }
}
