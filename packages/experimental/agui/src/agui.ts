/**
 * The AG-UI wire subset this bridge emits, declared locally so the harness
 * does not depend on the `@ag-ui/*` packages. Field names follow AG-UI 0.0.59;
 * the Muse client validates them against the published schemas.
 */

import type { ServerResponse } from 'node:http'

/** AG-UI event names this bridge emits. */
export type AguiEventType =
  | 'RUN_STARTED' | 'RUN_FINISHED' | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START' | 'TEXT_MESSAGE_CONTENT' | 'TEXT_MESSAGE_END'
  | 'REASONING_MESSAGE_START' | 'REASONING_MESSAGE_CONTENT' | 'REASONING_MESSAGE_END'
  | 'TOOL_CALL_START' | 'TOOL_CALL_ARGS' | 'TOOL_CALL_END' | 'TOOL_CALL_RESULT'
  | 'SUBAGENT_STARTED' | 'SUBAGENT_FINISHED' | 'SUBAGENT_ERROR'
  | 'CUSTOM'

/** One AG-UI event; `type` selects the payload shape. */
export interface AguiEvent {
  readonly type: AguiEventType
  readonly timestamp?: number
  readonly [field: string]: unknown
}

/** AG-UI message shapes returned by the history endpoint. */
export type AguiMessage =
  | { readonly id: string; readonly role: 'user'; readonly content: string }
  | {
    readonly id: string
    readonly role: 'assistant'
    readonly content?: string
    readonly toolCalls?: readonly {
      readonly id: string
      readonly type: 'function'
      readonly function: { readonly name: string; readonly arguments: string }
    }[]
  }
  | { readonly id: string; readonly role: 'tool'; readonly toolCallId: string; readonly content: string; readonly error?: string }

/** The AG-UI run request fields this bridge reads. */
export interface RunAgentInput {
  readonly threadId: string
  readonly runId: string
  readonly messages: readonly {
    readonly id?: string
    readonly role: string
    readonly content?: string | readonly { readonly type: string; readonly text?: string }[]
  }[]
  readonly forwardedProps?: { readonly cwd?: string } | undefined
}

/** Custom event names carried in `CUSTOM.name`; the payload sits in `value`. */
export const CUSTOM_APPROVAL = 'dsh.approval'
export const CUSTOM_QUESTION = 'dsh.question'

/** Text of a user message in either AG-UI content encoding. */
export function userText(message: RunAgentInput['messages'][number]): string {
  if (typeof message.content === 'string') return message.content
  return (message.content ?? [])
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}

/** Server-sent events writer over one node:http response. */
export class SseWriter {
  private closed = false

  constructor(private readonly res: ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.flushHeaders()
    res.on('close', () => { this.closed = true })
  }

  /** Whether the client is still attached. */
  get open(): boolean {
    return !this.closed
  }

  /** Write one event as `data: <json>`; a detached client drops it silently. */
  send(event: AguiEvent): void {
    if (this.closed) return
    this.res.write(`data: ${JSON.stringify({ timestamp: Date.now(), ...event })}\n\n`)
  }

  /** Finish the stream. */
  end(): void {
    if (this.closed) return
    this.closed = true
    this.res.end()
  }
}
