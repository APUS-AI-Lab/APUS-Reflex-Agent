/** Host-only memory index rebuilt from committed session events on resume. */
import { z } from 'zod'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { reflexContextTargetSchema } from '@deepseek-ai/dsh-compaction/reflex-context-projection'
const blockSchema = reflexContextTargetSchema.extend({ messageId: z.string().transform(MessageId), role: z.enum(['user', 'assistant', 'tool']), protected: z.boolean(), restoredFor: z.string().nullable() })
const stateSchema = z.object({ frozenThrough: z.number().int().min(-1), anchored: z.boolean(), legacyRequest: z.boolean(),
  revision: z.number().int().nonnegative(), topic: z.string(), constraints: z.array(z.string()),
  blocks: z.array(blockSchema), messageSeqs: z.array(z.number().transform(SessionSeq)) })
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Submitted-history protection; does not alter model-visible content. */
    'reflex/context-cache-anchor': { version: 1; throughSeq: SessionSeq }
  }
}
/** Original block index and current selections; retained across process restarts by event folding. */
export type ReflexContextState = z.infer<typeof stateSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Same-session original text and reversible omission index; never sent in client snapshots. */
    reflexContext: ReflexContextState
  }
}
/** Structure-dependent blocks are kept intact rather than partially edited. */
function structured(text: string): boolean {
  return /```|~~~|^\s*[\[{]|^\s*\|.*\|\s*$|^\s*(?:def |class |function |import |export |SELECT |CREATE )/mu.test(text)
}
/** Incremental index; no synchronous historical reads are needed by runtime consumers. */
export const reflexContextStateProjection: ProjectionDefinition<'reflexContext'> = {
  key: 'reflexContext', stateVersion: 2, stateSchema,
  init: () => ({ frozenThrough: -1, anchored: false, legacyRequest: false, revision: 0, topic: '', constraints: [], blocks: [], messageSeqs: [] }),
  apply(state, event) {
    if (event.type === 'reflex/context-cache-anchor') return { ...state, revision: state.revision + 1,
      anchored: true, frozenThrough: Math.max(state.frozenThrough, event.data.throughSeq) }
    if (event.type === 'request/context' || event.type === 'assistant/attempt') return { ...state,
      legacyRequest: true, frozenThrough: Math.max(state.frozenThrough, state.messageSeqs.at(-1) ?? -1) }

    if (event.type === 'agent/inbox/spliced') return { ...state, revision: state.revision + 1 }
    if (event.type === 'reflex/context-projection') {
      const targets = new Map(event.data.targets.map(target => [`${target.seq}:${target.block}`, target]))
      return { ...state, revision: state.revision + 1,
        blocks: state.blocks.map((block) => {
          const target = targets.get(`${block.seq}:${block.block}`)
          return target === undefined ? block : { ...block, ...target, restoredFor: event.data.action === 'restore' ? state.topic : block.restoredFor }
        }) }
    }
    if (event.type === 'system3/task-frame') return { ...state, revision: state.revision + 1, constraints: [event.data.goal.text, ...event.data.items.map(item => item.text)] }
    const message = event.type === 'user/message' ? event.data
      : event.type === 'assistant/message' || event.type === 'tool/result' ? event.data.message : undefined
    if (message === undefined) return state
    const role: 'user' | 'assistant' | 'tool' = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'tool'
    const protectedMessage = message.content.some(block => block.type !== 'text')
      || (message.role === 'user' && message.source.kind !== 'user' && message.source.kind !== 'reflex-memory')
    const blocks: ReflexContextState['blocks'] = message.content.flatMap((block, index) => block.type === 'text'
      ? [{ seq: event.seq, messageId: message.id, block: index, original: block.text, tokenDelta: 0, hidden: [], role,
        restoredFor: null, protected: protectedMessage || structured(block.text) }] : [])
    return { ...state, revision: state.revision + 1,
      frozenThrough: message.role === 'assistant' ? event.seq : state.frozenThrough,
      legacyRequest: state.legacyRequest || message.role === 'assistant', blocks: [...state.blocks, ...blocks],
      messageSeqs: [...state.messageSeqs, event.seq],
      topic: message.role === 'user' && message.source.kind === 'user' ? blocks.map(block => block.original).join('\n') : state.topic }
  },
}
