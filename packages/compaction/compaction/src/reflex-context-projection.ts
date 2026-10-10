/** Durable, reversible text selections shared by live requests and detached replay. */
import { z } from 'zod'
import type { Message } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionMessageProjection } from '@deepseek-ai/dsh-session/surface'

const rangeSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(),
  firstLine: z.number().int().positive(), lastLine: z.number().int().positive() }).strict()
/** Offsets name the immutable original text, with 1-based inclusive line coordinates. */
export type ReflexTextRange = z.infer<typeof rangeSchema>
/** Complete desired omissions for one original text block; an empty list restores it. */
export const reflexContextTargetSchema = z.object({ seq: z.number().int().nonnegative().transform(SessionSeq),
  block: z.number().int().nonnegative(), tokenDelta: z.number().int(), original: z.string(), hidden: z.array(rangeSchema) }).strict()
/** Original text is an exact collision-free content witness, never a cropped-text reference. */
export type ReflexContextTarget = z.infer<typeof reflexContextTargetSchema>
const projectionSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(),
  action: z.enum(['remove', 'restore']), targets: z.array(reflexContextTargetSchema).min(1) }).strict()
/** One reversible text selection, committed before the request consuming it. */
export type ReflexContextProjection = z.infer<typeof projectionSchema>

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Reversible omissions from original text blocks; message identity and tool pairing remain unchanged.
     * @messageProjection
     */
    'reflex/context-projection': ReflexContextProjection
  }
}

/**
 * Render omissions without joining previously separated words or lines.
 * @param original - Immutable text.
 * @param hidden - Sorted, disjoint original offsets.
 * @returns Text retaining all unselected characters.
 */
export function projectReflexText(original: string, hidden: readonly ReflexTextRange[]): string {
  let cursor = 0
  let output = ''
  for (const range of hidden) {
    if (range.start < cursor || range.end <= range.start || range.end > original.length
      || range.firstLine !== original.slice(0, range.start).split('\n').length
      || range.lastLine !== original.slice(0, range.end - 1).split('\n').length
      || /[\uDC00-\uDFFF]/u.test(original[range.start] ?? '')
      || /[\uDC00-\uDFFF]/u.test(original[range.end] ?? '')) throw new Error('Invalid Reflex original-text range')
    output += original.slice(cursor, range.start) + '\n[Reflex omitted]\n'
    cursor = range.end
  }
  return output + original.slice(cursor)
}

/** Pure projection rejects malformed or stale references before changing any message. */
export const reflexContextMessageProjection: SessionMessageProjection<'reflex/context-projection'> = {
  type: 'reflex/context-projection',
  project(event, context) {
    const data = projectionSchema.parse(event.data)
    const result = new Map<SessionSeq, Message>()
    const seen = new Set<string>()
    for (const target of data.targets) {
      const key = `${target.seq}:${target.block}`
      if (seen.has(key) || !context.nodes.includes(target.seq)) throw new Error('Invalid Reflex target')
      seen.add(key)
      const source = context.events[target.seq - context.baseSeq]
      const original = source?.type === 'user/message' ? source.data
        : source?.type === 'assistant/message' || source?.type === 'tool/result' ? source.data.message : undefined
      if (original === undefined) throw new Error('Reflex cannot edit protected message roles')
      const block = original.content[target.block]
      if (block?.type !== 'text' || block.text !== target.original) throw new Error('Reflex original text mismatch')
      const current = result.get(target.seq) ?? context.messages.get(target.seq) ?? original
      const content = current.content.map((value, index) => index === target.block
        ? { ...block, text: projectReflexText(block.text, target.hidden) } : value)
      result.set(target.seq, { ...current, content })
    }
    return result
  },
}
