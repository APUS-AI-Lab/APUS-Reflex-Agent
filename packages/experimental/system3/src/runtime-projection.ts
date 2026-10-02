/** Replayable Client-safe System3 facts, correlated with committed input and the effective request header. */
import { z, type ZodType } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { assistantStreamFirstTokenTime, isVisibleChunk, type AssistantStreamRecord, type MessageId } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { System3RuntimeView } from './types.ts'
import type {} from './entry-routing.ts'
import type {} from './skill-selection.ts'

/** Host fold keeps request metadata private and exposes only the two public facts. */
interface System3RuntimeState extends System3RuntimeView {
  readonly header: ModelSelection | null
  readonly currentTurn: number | null
  readonly currentStep: number | null
  readonly entryTurn: number | null
  readonly startRequestId: SessionRequestId | null
  readonly skillMessageId: MessageId | null
  /** Whether any committed user message or tool result in this Session carries an image block. */
  readonly imageInSession: boolean
  /** Route chosen or retained by the latest entry decision; null when that decision left the baseline. */
  readonly route: { readonly requestId: SessionRequestId; readonly selection: ModelSelection } | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host request metadata used to correlate input admission and the effective model header. */
    system3Runtime: System3RuntimeState
  }
}

const selection = z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() })
  .transform(({ reasoningEffort, ...required }) => ({ ...required, ...reasoningEffort === undefined ? {} : { reasoningEffort } }))
const requestId = z.string().transform(value => brandString<SessionRequestId>(value))
const viewSchema = z.object({
  entry: z.object({ requestId, phase: z.enum(['deciding', 'decided']), outcome: z.string().nullable(),
    suggested: selection.nullable(), adopted: selection.nullable(), used: selection.nullable(),
    elapsedMs: z.number().nullable() }).nullable(),
  skill: z.object({ requestId: requestId.nullable(), turn: z.number(), step: z.number(), outcome: z.string(),
    selected: z.string().nullable(), injected: z.boolean(), elapsedMs: z.number() }).nullable(),
})
const stateSchema: ZodType<System3RuntimeState> = z.object({ entry: viewSchema.shape.entry, skill: viewSchema.shape.skill,
  header: selection.nullable(), currentTurn: z.number().nullable(), currentStep: z.number().nullable(),
  entryTurn: z.number().nullable(), startRequestId: requestId.nullable(),
  skillMessageId: z.string().transform(value => brandString<MessageId>(value)).nullable(),
  imageInSession: z.boolean(), route: z.object({ requestId, selection }).nullable() })

/** Content deltas and completed content blocks prove response; protocol-only records do not. */
function hasResponseContent(stream: readonly AssistantStreamRecord[]): boolean {
  return assistantStreamFirstTokenTime(stream) !== undefined
    || stream.some(record => record.type === 'chunk' && record.chunk.type === 'block-end'
      && (record.chunk.block.type === 'tool-call' || isVisibleChunk(record.chunk)))
}

/** Fold advice and adoption; confirm request use from output or a streamed attempt in the exact input turn. */
export const system3RuntimeProjection = {
  key: 'system3Runtime', stateVersion: 4, stateSchema,
  init: () => ({ entry: null, skill: null, header: null, currentTurn: null, currentStep: null,
    entryTurn: null, startRequestId: null, skillMessageId: null, imageInSession: false, route: null }),
  wire: { viewSchema, view: state => ({ entry: state.entry, skill: state.skill }) },
  apply(state, event) {
    if (!state.imageInSession && (event.type === 'user/message' || event.type === 'tool/result')) {
      const content = event.type === 'user/message' ? event.data.content : event.data.message.content
      if (content.some(block => block.type === 'image')) state = { ...state, imageInSession: true }
    }
    if (event.type === 'step/start') return { ...state, currentTurn: event.data.turn, currentStep: event.data.step }
    if (event.type === 'step/end' || event.type === 'turn/end') return { ...state, currentTurn: null, currentStep: null }
    if (event.type === 'request/header') {
      const config = event.data.header.config
      return { ...state, header: { provider: config.provider, model: config.model,
        ...config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) } } }
    }
    if (event.type === 'system3/entry-start') return { ...state, startRequestId: event.data.requestId, entryTurn: null, entry: { requestId: event.data.requestId,
      phase: 'deciding', outcome: null, suggested: null, adopted: null, used: null, elapsedMs: null } }
    if (event.type === 'system3/entry-decision') {
      if (state.startRequestId !== null && state.startRequestId !== event.data.requestId) return state
      const previous = state.entry?.requestId === event.data.requestId ? state.entry : null
      const route = event.data.selected !== undefined
        ? { requestId: event.data.requestId, selection: event.data.selected }
        : event.data.retained ?? null
      return { ...state, route, entryTurn: previous === null ? null : state.entryTurn,
        entry: { requestId: event.data.requestId, phase: 'decided', outcome: event.data.outcome,
          suggested: event.data.selected ?? null, adopted: previous?.adopted ?? null,
          used: previous?.used ?? null, elapsedMs: event.data.elapsedMs } }
    }
    if (event.type === 'model/automatic-selection' && state.entry?.requestId === event.data.requestId) {
      return { ...state, entry: { ...state.entry, adopted: event.data.selection } }
    }
    if (event.type === 'user/message' && event.data.source.kind === 'user' && 'rpcId' in event.data.source
      && state.entry !== null && event.data.source.rpcId === state.entry.requestId && state.currentTurn !== null) {
      return { ...state, entryTurn: state.currentTurn }
    }
    if (state.entry !== null && state.entry.adopted !== null && state.entryTurn !== null
      && ((event.type === 'assistant/message' && event.data.turn === state.entryTurn)
        || (event.type === 'assistant/attempt' && event.data.turn === state.entryTurn && hasResponseContent(event.data.stream)))) {
      const source = event.type === 'assistant/message' ? event.data.message.source : undefined
      const actual = event.type === 'assistant/message'
        ? source?.kind === 'model' ? { provider: source.provider, model: source.model,
          ...state.header?.reasoningEffort === undefined ? {} : { reasoningEffort: state.header.reasoningEffort } } : null
        : state.header
      const adopted = state.entry.adopted
      if (actual !== null && actual.provider === adopted.provider && actual.model === adopted.model
        && (adopted.reasoningEffort === undefined || actual.reasoningEffort === adopted.reasoningEffort)) {
        return { ...state, entry: { ...state.entry, used: actual } }
      }
    }
    if (event.type === 'system3/skill-decision') return { ...state, skillMessageId: event.data.injectionMessageId ?? null, skill: { requestId: event.data.requestId,
      turn: event.data.turn, step: event.data.step, outcome: event.data.outcome,
      selected: event.data.selected ?? null, injected: false, elapsedMs: event.data.elapsedMs } }
    if (event.type === 'user/message' && event.data.source.kind === 'skill-invocation' && event.data.id === state.skillMessageId
      && state.skill?.selected === event.data.source.name && state.currentTurn === state.skill.turn
      && state.currentStep === state.skill.step) return { ...state, skill: { ...state.skill, injected: true } }
    return state
  },
} satisfies ProjectionDefinition<'system3Runtime', System3RuntimeState>
