/** Durable model-selection intent and request-use projection. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type {
  ModelSelection,
  ModelSelectionProjection,
  ModelSelectionProjectionState,
} from './types.ts'

const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
}) as unknown as z.ZodType<ModelSelection>

const modelSelectionProjectionStateSchema = z.object({
  lastUsed: modelSelectionSchema.nullable(),
  pending: modelSelectionSchema.nullable(),
  explicit: modelSelectionSchema.nullable(),
  automaticBaseline: modelSelectionSchema.nullable(),
  automatic: modelSelectionSchema.nullable(),
  automaticInUse: z.boolean(),
}) as z.ZodType<ModelSelectionProjectionState>

const modelSelectionProjectionSchema = z.object({
  lastUsed: modelSelectionSchema.nullable(),
  next: modelSelectionSchema.nullable(),
}) as z.ZodType<ModelSelectionProjection>

/**
 * Advance durable model-selection state by one Session event.
 * @param state - selection state before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced selection state.
 */
function applyModelSelectionProjection(
  state: ModelSelectionProjectionState,
  event: SessionEvent,
): ModelSelectionProjectionState {
  if (event.type === 'model/selection') {
    return sameSelection(state.pending, event.data) && sameSelection(state.explicit, event.data)
      ? state
      : { ...state, pending: event.data, explicit: event.data, automatic: null, automaticInUse: false }
  }
  if (event.type === 'model/automatic-selection') {
    return { ...state, automaticBaseline: event.data.baseline, automatic: event.data.selection, automaticInUse: false }
  }
  if (event.type === 'turn/end' && state.automatic !== null) return { ...state, automatic: null, automaticInUse: false }
  if (event.type !== 'request/header') return state
  const lastUsed: ModelSelection = {
    provider: event.data.header.config.provider,
    model: event.data.header.config.model,
    ...(event.data.header.config.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(event.data.header.config.reasoningEffort) }),
  }
  const pending = sameSelection(state.pending, lastUsed) ? null : state.pending
  const automaticInUse = state.automatic !== null && sameSelection(state.automatic, lastUsed)
  return sameSelection(state.lastUsed, lastUsed) && pending === state.pending && automaticInUse === state.automaticInUse
    ? state
    : { ...state, lastUsed, pending, automaticInUse }
}

const modelSelectionProjection = {
  key: 'modelSelection',
  stateSchema: modelSelectionProjectionStateSchema,
  init: () => ({ lastUsed: null, pending: null, explicit: null, automaticBaseline: null, automatic: null, automaticInUse: false }),
  apply: applyModelSelectionProjection,
  wire: {
    viewSchema: modelSelectionProjectionSchema,
    view: state => ({
      lastUsed: state.lastUsed,
      next: state.pending ?? state.explicit ?? (state.automaticInUse ? state.automatic : null) ?? state.automaticBaseline ?? state.lastUsed,
    }),
  },
  stateVersion: 4,
} satisfies ProjectionDefinition<'modelSelection', ModelSelectionProjectionState>

function sameSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || (left !== null && right !== null
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort)
}

/**
 * Register the durable model-selection projection when the registry is present.
 * @param ctx - Session Controller context.
 */
export function installModelSelectionProjection(ctx: Context): void {
  ctx.sessionProjections.register(modelSelectionProjection)
}
