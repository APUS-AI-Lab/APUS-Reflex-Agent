/** Replayable Client-safe System3 facts, correlated with committed input and the effective request header. */
import { z, type ZodType } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { assistantStreamFirstTokenTime, isVisibleChunk, type AssistantStreamRecord, type MessageId } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { System3RuntimeView } from './types.ts'
import type {} from './entry-routing.ts'
import type {} from './skill-selection.ts'
import type {} from './delegation.ts'
import type {} from './delegation-progress.ts'
import type {} from './process-supervision.ts'
import type {} from './reflex-supervision.ts'
import type {} from './reflex-recovery.ts'
import type {} from '@deepseek-ai/dsh-compaction/reflex-context-projection'
import type {} from './task-frame.ts'
import type {} from '@deepseek-ai/dsh-subagent'

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
const entrySchema = z.object({ requestId, phase: z.enum(['deciding', 'decided']), outcome: z.string().nullable(),
  suggested: selection.nullable(), adopted: selection.nullable(), used: selection.nullable(),
  elapsedMs: z.number().nullable(), turn: z.number().nullable(),
  avoided: z.array(z.object({ label: z.string(), reason: z.string() })),
  route: z.object({ id: z.string(), label: z.string().nullable(), retained: z.boolean(),
    delegation: z.object({ candidateId: z.string(), tool: z.string(), injected: z.boolean(), called: z.boolean() })
      .nullable() }).nullable(),
})
/** A task goal keeps only the identity it has: the starting message or the DSH goal. */
const taskGoal = z.object({ text: z.string(), messageId: z.string().optional(), goalId: z.string().optional() })
  .transform(({ text, messageId, goalId }) => ({ text, ...messageId === undefined ? {} : { messageId },
    ...goalId === undefined ? {} : { goalId } }))
const viewSchema = z.object({
  reflex: z.object({
    observing: z.boolean(),
    recovery: z.object({ state: z.string(), reason: z.string(), runId: z.string() }).optional(),
    supervision: z.object({ state: z.string(), action: z.string(), evidenceCount: z.number(), runId: z.string() }).nullable(),
    context: z.object({ revision: z.number(), action: z.enum(['remove', 'restore']), targetsCount: z.number() }).nullable(),
    timeline: z.array(z.object({ kind: z.enum(['supervision', 'recovery', 'context', 'evidence']), at: z.number(),
      state: z.string().nullable(), action: z.string().nullable(), count: z.number().nullable() })),
  }).optional(),
  entry: entrySchema.nullable(),
  history: z.array(entrySchema),
  skill: z.object({ requestId: requestId.nullable(), turn: z.number(), step: z.number(), outcome: z.string(),
    selected: z.string().nullable(), injected: z.boolean(), elapsedMs: z.number() }).nullable(),
  subagentRun: z.object({ runId: z.string(), provider: z.string(), state: z.string(), startedAt: z.number(), elapsedMs: z.number(),
    completed: z.record(z.string(), z.number()), current: z.string().nullable(), lastStepAt: z.number().nullable(),
    note: z.string().nullable(), alert: z.object({ kind: z.string(), elapsedMs: z.number() }).nullable(),
    steerable: z.boolean(), steers: z.array(z.object({ text: z.string(), atMs: z.number() })) }).nullable(),
  notices: z.array(z.object({ rule: z.string(), subject: z.string().nullable(), count: z.number(), advised: z.boolean() })),
  taskFrame: z.object({ goal: taskGoal, items: z.array(z.object({ messageId: z.string(), text: z.string() })) }).nullable(),
  interjection: z.object({ messageId: z.string() }).nullable(),
})
const stateSchema: ZodType<System3RuntimeState> = z.object({ entry: viewSchema.shape.entry, history: viewSchema.shape.history,
  skill: viewSchema.shape.skill, reflex: viewSchema.shape.reflex,
  subagentRun: viewSchema.shape.subagentRun, notices: viewSchema.shape.notices, taskFrame: viewSchema.shape.taskFrame,
  interjection: viewSchema.shape.interjection,
  header: selection.nullable(), currentTurn: z.number().nullable(), currentStep: z.number().nullable(),
  entryTurn: z.number().nullable(), startRequestId: requestId.nullable(),
  skillMessageId: z.string().transform(value => brandString<MessageId>(value)).nullable(),
  imageInSession: z.boolean(), route: z.object({ requestId, selection }).nullable() })

/** Most recent accepted mid-run inputs kept per run for display. */
const STEERS_KEPT = 3
/** Most recent supervision findings kept per turn for display. */
const NOTICES_KEPT = 5
/** Most recent earlier entry decisions kept so their turns keep a route line. */
const HISTORY_KEPT = 100

/** Content deltas and completed content blocks prove response; protocol-only records do not. */
function hasResponseContent(stream: readonly AssistantStreamRecord[]): boolean {
  return assistantStreamFirstTokenTime(stream) !== undefined
    || stream.some(record => record.type === 'chunk' && record.chunk.type === 'block-end'
      && (record.chunk.block.type === 'tool-call' || isVisibleChunk(record.chunk)))
}

/** Fold advice and adoption; confirm request use from output or a streamed attempt in the exact input turn. */
export const system3RuntimeProjection = {
  key: 'system3Runtime', stateVersion: 16, stateSchema,
  init: () => ({ entry: null, history: [], skill: null, subagentRun: null, notices: [], taskFrame: null, interjection: null, header: null,
    currentTurn: null, currentStep: null, entryTurn: null, startRequestId: null, skillMessageId: null, imageInSession: false,
    route: null }),
  wire: { viewSchema, view: state => ({ entry: state.entry, history: state.history, skill: state.skill, subagentRun: state.subagentRun,
    notices: state.notices, taskFrame: state.taskFrame, interjection: state.interjection,
    ...state.reflex === undefined ? {} : { reflex: state.reflex } }) },
  apply(state, event) {
    const timeline = (entry: NonNullable<NonNullable<System3RuntimeState['reflex']>['timeline']>[number]): NonNullable<System3RuntimeState['reflex']>['timeline'] => [
      ...(state.reflex?.timeline ?? []), entry,
    ].slice(-12)
    if (event.type === 'system3/reflex-recovery') {
      const { state: status, reason, runId } = event.data
      return { ...state, reflex: { observing: status === 'intent' || status === 'continued', supervision: state.reflex?.supervision ?? null,
        context: state.reflex?.context ?? null, timeline: timeline({ kind: 'recovery', at: event.time, state: status, action: null, count: null }),
        recovery: { state: status, reason, runId } } }
    }
    if (event.type === 'system3/reflex-supervision') {
      const { state: status, action, evidenceCount, runId } = event.data
      return { ...state, reflex: { observing: state.reflex?.observing ?? true, ...state.reflex, context: state.reflex?.context ?? null,
        timeline: timeline({ kind: 'supervision', at: event.time, state: status, action, count: evidenceCount }),
        supervision: { state: status, action, evidenceCount, runId } } }
    }
    if (event.type === 'system3/reflex-evidence') {
      return { ...state, reflex: { observing: state.reflex?.observing ?? true, ...state.reflex,
        supervision: state.reflex?.supervision ?? null, context: state.reflex?.context ?? null,
        timeline: timeline({ kind: 'evidence', at: event.time, state: null, action: null, count: 1 }) } }
    }
    if (event.type === 'reflex/context-projection') {
      return { ...state, reflex: { observing: state.reflex?.observing ?? true, ...state.reflex,
        supervision: state.reflex?.supervision ?? null,
        timeline: timeline({ kind: 'context', at: event.time, state: null, action: event.data.action, count: event.data.targets.length }),
        context: { revision: event.data.revision, action: event.data.action, targetsCount: event.data.targets.length } } }
    }
    if (event.type === 'user/message' && event.data.source.kind === 'reflex-memory') {
      return { ...state, reflex: { observing: state.reflex?.observing ?? true, ...state.reflex,
        supervision: state.reflex?.supervision ?? null,
        timeline: timeline({ kind: 'context', at: event.time, state: null, action: 'restore', count: event.data.content.filter(block => block.type === 'text').length }),
        context: { revision: event.seq, action: 'restore', targetsCount: event.data.content.filter(block => block.type === 'text').length } } }
    }
    if (event.type === 'user/message' && event.data.source.kind === 'user' && state.reflex !== undefined) {
      state = { ...state, reflex: { ...state.reflex, recovery: undefined, supervision: null, context: null } }
    }
    if (!state.imageInSession && (event.type === 'user/message' || event.type === 'tool/result')) {
      const content = event.type === 'user/message' ? event.data.content : event.data.message.content
      if (content.some(block => block.type === 'image')) state = { ...state, imageInSession: true }
    }
    if (event.type === 'turn/start' && (state.notices.length > 0 || state.interjection !== null)) state = { ...state, notices: [], interjection: null }
    if (event.type === 'system3/interjection') return event.data.delivered ? { ...state, interjection: { messageId: event.data.messageId } } : state
    if (event.type === 'system3/process-notice') {
      const { rule, subject = null, count, advised } = event.data
      return { ...state, notices: [...state.notices, { rule, subject, count, advised }].slice(-NOTICES_KEPT) }
    }
    if (event.type === 'system3/task-frame') return { ...state, taskFrame: { goal: event.data.goal, items: event.data.items } }
    if (event.type === 'step/start') return { ...state, currentTurn: event.data.turn, currentStep: event.data.step }
    if (event.type === 'step/end') return { ...state, currentTurn: null, currentStep: null }
    if (event.type === 'turn/end') return { ...state, currentTurn: null, currentStep: null, interjection: null,
      ...state.reflex === undefined ? {} : { reflex: { ...state.reflex, observing: false } } }
    if (event.type === 'request/header') {
      const config = event.data.header.config
      return { ...state, header: { provider: config.provider, model: config.model,
        ...config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) } } }
    }
    if (event.type === 'system3/entry-start') return { ...state, startRequestId: event.data.requestId, entryTurn: null,
      // The decision being replaced keeps its route line only if its input reached a turn.
      history: state.entry?.turn == null ? state.history : [...state.history, state.entry].slice(-HISTORY_KEPT),
      entry: { requestId: event.data.requestId,
        phase: 'deciding', outcome: null, suggested: null, adopted: null, used: null, elapsedMs: null, turn: null, avoided: [], route: null } }
    if (event.type === 'system3/entry-decision') {
      if (state.startRequestId !== null && state.startRequestId !== event.data.requestId) return state
      const previous = state.entry?.requestId === event.data.requestId ? state.entry : null
      const route = event.data.selected !== undefined
        ? { requestId: event.data.requestId, selection: event.data.selected }
        : event.data.retained ?? null
      return { ...state, route, entryTurn: previous === null ? null : state.entryTurn,
        entry: { requestId: event.data.requestId, phase: 'decided', outcome: event.data.outcome,
          suggested: event.data.selected ?? null, adopted: previous?.adopted ?? null,
          used: previous?.used ?? null, elapsedMs: event.data.elapsedMs, turn: previous?.turn ?? null,
          avoided: (event.data.avoided ?? []).map(value => ({ label: value.label ?? value.id, reason: value.reason })),
          route: event.data.candidate === undefined ? null : { id: event.data.candidate.id,
            label: event.data.candidate.label ?? null, retained: event.data.retained !== undefined,
            delegation: event.data.candidate.delegate === undefined ? null
              : { candidateId: event.data.candidate.id, tool: event.data.candidate.delegate.tool, injected: false, called: false } } } }
    }
    if (event.type === 'model/automatic-selection' && state.entry?.requestId === event.data.requestId) {
      return { ...state, entry: { ...state.entry, adopted: event.data.selection } }
    }
    if (event.type === 'user/message' && event.data.source.kind === 'user' && 'rpcId' in event.data.source
      && state.entry !== null && event.data.source.rpcId === state.entry.requestId && state.currentTurn !== null) {
      return { ...state, entryTurn: state.currentTurn, entry: { ...state.entry, turn: state.currentTurn } }
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
    const delegation = state.entry?.route?.delegation
    if (state.entry?.route && delegation) {
      if (event.type === 'user/message' && event.data.source.kind === 'system3-delegation'
        && event.data.source.requestId === state.entry.requestId) {
        return { ...state, entry: { ...state.entry, route: { ...state.entry.route, delegation: { ...delegation, injected: true } } } }
      }
      if (event.type === 'tool/call' && delegation.injected && !delegation.called && event.data.name === delegation.tool) {
        return { ...state, entry: { ...state.entry, route: { ...state.entry.route, delegation: { ...delegation, called: true } } } }
      }
    }
    if (event.type === 'system3/delegation-progress') {
      const { version: _version, lastStepAt = null, note = null, steerable = false, ...run } = event.data
      const previous = state.subagentRun?.runId === run.runId ? state.subagentRun : null
      // Overtime stays relevant while the run continues; a missing step is answered by the next step.
      const alert = run.state !== 'running' || previous?.alert == null ? null
        : previous.alert.kind === 'overtime' || lastStepAt === previous.lastStepAt ? previous.alert : null
      return { ...state, subagentRun: { ...run, lastStepAt, note, alert, steerable: steerable && run.state === 'running',
        steers: previous?.steers ?? [] }, reflex: { ...state.reflex, observing: run.state === 'running',
        supervision: state.reflex?.supervision ?? null, context: state.reflex?.context ?? null,
        timeline: state.reflex?.timeline ?? [] } }
    }
    if (event.type === 'subagent/steer' && state.subagentRun?.runId === event.data.runId) {
      const steer = { text: event.data.text, atMs: Math.max(0, event.time - state.subagentRun.startedAt) }
      return { ...state, subagentRun: { ...state.subagentRun,
        steers: [...state.subagentRun.steers, steer].slice(-STEERS_KEPT) } }
    }
    if (event.type === 'system3/delegation-alert' && state.subagentRun?.runId === event.data.runId
      && state.subagentRun.state === 'running') {
      return { ...state, subagentRun: { ...state.subagentRun, alert: { kind: event.data.kind, elapsedMs: event.data.elapsedMs } } }
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
