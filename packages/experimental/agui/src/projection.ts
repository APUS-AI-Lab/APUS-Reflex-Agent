/** Durable DSH session events projected to AG-UI history messages and replay events. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AguiMessage } from './agui.ts'

/**
 * Concatenate the text blocks of a message, ignoring images and tool metadata.
 * @param content - message content blocks in order.
 * @returns Concatenated text blocks.
 */
export function textOf(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Concatenate reasoning blocks.
 * @param content - message content blocks in order.
 * @returns Concatenated reasoning text.
 */
export function reasoningOf(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'reasoning').map(block => block.text).join('')
}

/**
 * Project committed session events to the AG-UI message list a client shows
 * when it opens a thread. Injected context (system, developer, skill and
 * schedule messages) stays out: only what the person typed, what the model
 * answered, and what tools returned.
 * @param events - durable events in log order.
 * @returns AG-UI user, assistant and tool messages in order.
 */
export function historyMessages(events: Iterable<SessionEvent>): AguiMessage[] {
  const messages: AguiMessage[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') continue
      messages.push({ id: event.data.id, role: 'user', content: textOf(event.data.content) })
    } else if (event.type === 'assistant/message') {
      const message = event.data.message
      const toolCalls = message.content
        .filter(block => block.type === 'tool-call')
        .map(block => ({ id: block.id, type: 'function' as const, function: { name: block.name, arguments: block.arguments } }))
      const text = textOf(message.content)
      messages.push({
        id: message.id,
        role: 'assistant',
        ...text === '' ? {} : { content: text },
        ...toolCalls.length === 0 ? {} : { toolCalls },
      })
    } else if (event.type === 'tool/result') {
      const message = event.data.message
      messages.push({
        id: message.id,
        role: 'tool',
        toolCallId: message.toolCallId,
        content: textOf(message.content),
        ...message.isError === true ? { error: event.data.error?.reason ?? 'tool failed' } : {},
      })
    }
  }
  return messages
}
