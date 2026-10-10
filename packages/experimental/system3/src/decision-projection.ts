/** Latest System3 receipt projection for live and restored Sessions. */
import { z, type ZodType } from 'zod'
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { validateJevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type { JevQuestion } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { System3DecisionId, System3DecisionReceipt, System3DecisionOutcome } from './decisions.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest committed Jev shadow receipt; null before the first decision. */
    lastSystem3Decision: System3DecisionReceipt | null
  }
}

const action = z.enum(['continue', 'retry', 'escalate', 'candidate_done', 'unknown'])
const supervised = z.enum(['continue', 'retry', 'escalate', 'done'])
const probabilities = z.record(z.string(), z.number().min(0).max(1))
const answer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities, confidence: z.number().min(0).max(1) }),
  z.object({ type: z.literal('score'), score: z.number(), legend: z.record(z.string(), z.string()), probabilities,
    confidence: z.number().min(0).max(1) }),
  z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }),
])
const receiptSchema: ZodType<System3DecisionReceipt | null> = z.object({
  version: z.literal(1), id: z.string().transform(value => brandString<System3DecisionId>(value)), mode: z.literal('shadow'),
  request: z.object({
    state: z.custom<JsonValue>(isJsonValue), model: z.string().optional(), effort: z.enum(['low', 'high']).optional(),
    questions: z.record(z.string(), z.discriminatedUnion('type', [
      z.object({ type: z.literal('choice'), instructions: z.string().optional(), criteria: z.record(z.string(), z.string()) }),
      z.object({ type: z.literal('score'), instructions: z.string().optional(), criteria: z.array(z.string()) }),
      z.object({ type: z.literal('noul'), instructions: z.string().optional(),
        criteria: z.object({ true: z.string(), false: z.string() }).optional() }),
    ])),
  }).transform(({ model, effort, questions, state }) => validateJevRequest({
    state, questions: Object.fromEntries(Object.entries(questions).map<[string, JevQuestion]>(([id, question]) => {
      const { instructions, ...required } = question
      const normalized = { ...required, ...instructions === undefined ? {} : { instructions } }
      if (normalized.type === 'noul') {
        const { criteria, ...noul } = normalized
        return [id, { ...noul, ...criteria === undefined ? {} : { criteria } }]
      }
      return [id, normalized]
    })),
    ...model === undefined ? {} : { model }, ...effort === undefined ? {} : { effort },
  })),
  stateDigest: z.string(), evidenceRefs: z.array(z.string()), goalRevision: z.string(),
  dataClasses: z.array(z.enum(['public', 'workspace', 'sensitive', 'secret'])), routeId: z.string(),
  executionDomain: z.enum(['local', 'network']), providerId: z.string().optional(), requestedModel: z.string().optional(),
  effort: z.enum(['low', 'high']).optional(), turn: z.number().optional(), step: z.number().optional(), elapsedMs: z.number(),
  baseline: z.object({
    action: supervised, accepted: z.boolean(),
    reason: z.enum(['accepted', 'stale-goal', 'missing-evidence', 'failed-checks', 'unknown-checks', 'budget-exhausted', 'invalid-advice']),
    missingChecks: z.array(z.string()), missingEvidenceRefs: z.array(z.string()),
  }),
  advice: action,
  comparison: z.object({ modelAction: action, baselineAction: supervised, agrees: z.boolean(),
    divergence: z.enum(['none', 'model-premature-done', 'model-understops', 'model-unsafe']) }),
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ok'), response: z.object({ model: z.string(), answers: z.record(z.string(), answer),
      usage: z.record(z.string(), z.number()).optional() }) }),
    z.object({ kind: z.literal('unknown'), code: z.enum(['missing-credential', 'timeout', 'rate-limited', 'http',
      'invalid-response', 'transport', 'privacy-denied', 'provider-unavailable', 'cancelled']), status: z.number().optional() }),
  ]),
}).transform(({ providerId, requestedModel, effort, turn, step, outcome, ...required }): System3DecisionReceipt => {
  let normalizedOutcome: System3DecisionOutcome
  if (outcome.kind === 'ok') {
    const { usage, ...response } = outcome.response
    normalizedOutcome = { kind: 'ok', response: { ...response, ...usage === undefined ? {} : { usage } } }
  } else {
    const { status, ...failure } = outcome
    normalizedOutcome = { ...failure, ...status === undefined ? {} : { status } }
  }
  return {
    ...required, outcome: normalizedOutcome, ...effort === undefined ? {} : { effort },
    ...providerId === undefined ? {} : { providerId }, ...requestedModel === undefined ? {} : { requestedModel },
    ...turn === undefined ? {} : { turn }, ...step === undefined ? {} : { step },
  }
}).nullable()

/** Host-only latest receipt fold; unrelated events retain the same state reference. */
export const system3DecisionProjection: ProjectionDefinition<'lastSystem3Decision'> = {
  key: 'lastSystem3Decision', stateSchema: receiptSchema, stateVersion: 2, init: () => null,
  apply: (state, event) => event.type === 'system3/decision' ? event.data : state,
}
