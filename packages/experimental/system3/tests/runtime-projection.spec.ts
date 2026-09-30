import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { createAssistantMessage, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { afterEach, expect, it } from 'vitest'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const selected = { provider: 'fixture', model: 'same-model' }
async function setup() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Projections)
  ctx.sessionProjections.register(system3RuntimeProjection)
  const session = Session.create(SessionId('runtime-projection'))
  const view = () => ctx.sessionProjections.stateOf(session, 'system3Runtime')
  const decide = (id: string) => {
    const requestId = brandString<SessionRequestId>(id)
    session.append('system3/entry-decision', { version: 1, requestId, request: null, baseline: selected,
      candidateIds: ['same'], dataClasses: ['public'], routeId: 'jev', executionDomain: 'local', outcome: 'selected', selected, elapsedMs: 1 })
    return requestId
  }
  const begin = (id: string) => {
    const requestId = brandString<SessionRequestId>(id)
    session.append('system3/entry-start', { requestId })
    decide(id)
    session.append('model/automatic-selection', { requestId, baseline: selected, selection: selected })
    return requestId
  }
  const input = (requestId: SessionRequestId, turn: number) => {
    session.append('step/start', { turn, step: 0 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'input' }], source: { kind: 'user', rpcId: requestId } }), { surfaceOp: 'append' })
  }
  const output = (turn: number) => session.append('assistant/message', { turn, step: 0,
    message: createAssistantMessage({ content: [{ type: 'text', text: 'output' }], source: selected }), stream: [] }, { surfaceOp: 'append' })
  return { ctx, session, begin, decide, input, output, view }
}

it('keeps adoption separate from actual use until output in the exact input turn', async () => {
  const h = await setup(); const id = h.begin('first')
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' })
  h.input(id, 1)
  expect(h.view()?.entry).toMatchObject({ adopted: selected, used: null })
  h.output(2)
  expect(h.view()?.entry?.used).toBeNull()
  h.output(1)
  expect(h.view()?.entry?.used).toEqual(selected)
})

it('confirms a second identical-model input without another request header', async () => {
  const h = await setup(); const first = h.begin('first')
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' })
  h.input(first, 1); h.output(1)
  h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const second = h.begin('second'); h.input(second, 2)
  expect(h.view()?.entry?.used).toBeNull()
  h.output(2)
  expect(h.view()?.entry).toMatchObject({ requestId: second, used: selected })
  expect(h.session.snapshotEvents().filter(event => event.type === 'request/header')).toHaveLength(1)
})

it('does not attribute a later unrelated turn to an adopted but cancelled input', async () => {
  const h = await setup(); h.begin('cancelled')
  h.session.append('step/start', { turn: 1, step: 0 })
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' })
  h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  h.input(brandString<SessionRequestId>('unrelated'), 2); h.output(2)
  expect(h.view()?.entry?.used).toBeNull()
})

it('requires actual streamed records before an assistant attempt confirms use', async () => {
  const h = await setup(); const id = h.begin('first')
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' }); h.input(id, 1)
  h.session.append('assistant/attempt', { turn: 1, step: 0, stream: [] })
  expect(h.view()?.entry?.used).toBeNull()
  h.session.append('assistant/attempt', { turn: 1, step: 0, stream: [{ type: 'text-chunks', time0: 1, index: 0, dt: [0], texts: ['partial'] }] })
  expect(h.view()?.entry?.used).toEqual(selected)
})

it('restores the same wire facts without leaking effective headers or making model calls', async () => {
  const h = await setup(); const id = h.begin('first')
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' }); h.input(id, 1); h.output(1)
  const restored = Session.fromRestore(h.session.id, h.session.snapshotEvents(), h.session.header, SessionLogOffset(0), 'shared-frozen')
  const state = h.ctx.sessionProjections.stateOf(restored, 'system3Runtime')!
  expect(system3RuntimeProjection.wire.view(state)).toEqual({ entry: h.view()?.entry, skill: null })
  expect(Object.keys(system3RuntimeProjection.wire.view(state))).toEqual(['entry', 'skill'])
})


it('does not treat a non-model assistant source in incoming log JSON as request use', async () => {
  const h = await setup(); const id = h.begin('first')
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' }); h.input(id, 1)
  // JSON supplies a foreign persisted message; the fold must not borrow the cached header for its source.
  h.session.append('assistant/message', (JSON.parse('{"turn":1,"step":0,"message":{"id":"foreign-message","role":"assistant","source":{"kind":"user"},"content":[{"type":"text","text":"foreign"}]},"stream":[]}') as Extract<SessionEvent, { type: 'assistant/message' }>['data']), { surfaceOp: 'append' })
  expect(h.view()?.entry?.used).toBeNull()
})


it("confirms only the receipt's exact Skill message and restores its branded identity", async () => {
  const h = await setup()
  const injection = createUserMessage({ content: [{ type: 'text', text: 'Instructions.' }], source: { kind: 'skill-invocation', name: 'csv', form: 'instructions' } })
  h.session.append('system3/skill-decision', { version: 1, requestId: null, turn: 1, step: 0, request: null,
    candidateNames: ['csv'], selected: 'csv', injectionMessageId: injection.id, outcome: 'selected', elapsedMs: 1 })
  h.session.append('step/start', { turn: 1, step: 0 })
  h.session.append('user/message', createUserMessage({ content: [], source: injection.source }), { surfaceOp: 'append' })
  expect(h.view()?.skill?.injected).toBe(false)
  h.session.append('user/message', injection, { surfaceOp: 'append' })
  expect(h.view()?.skill?.injected).toBe(true)
  const decoded = system3RuntimeProjection.stateSchema.parse(h.view())
  expect(decoded.skillMessageId).toBe(injection.id)
})

it('rejects stale entry receipts and validates effort-bearing wire values', async () => {
  const h = await setup(); const first = h.begin('first'); const second = h.begin('second')
  h.session.append('system3/entry-decision', { version: 1, requestId: first, request: null, baseline: selected,
    candidateIds: [], dataClasses: ['public'], routeId: 'jev', executionDomain: 'local', outcome: 'cancelled', elapsedMs: 1 })
  expect(h.view()?.entry?.requestId).toBe(second)
  h.session.append('request/header', { header: { config: { ...selected, reasoningEffort: ReasoningEffortId('high') } }, reason: 'initial' })
  h.input(second, 2); h.output(2)
  h.session.append('step/end', { turn: 2, step: 0 })
  const wire = system3RuntimeProjection.wire.view(h.view()!)
  expect(system3RuntimeProjection.wire.viewSchema.parse(wire).entry?.used).toMatchObject({ reasoningEffort: 'high' })
})

it('reads legacy recommendation receipts with no entry-start and never guesses actual use', async () => {
  const h = await setup()
  h.session.append('system3/entry-decision', { version: 1, requestId: brandString<SessionRequestId>('legacy'), request: null,
    baseline: selected, candidateIds: [], dataClasses: ['public'], routeId: 'jev', executionDomain: 'local', outcome: 'abstain', elapsedMs: 1 })
  expect(h.view()?.entry).toMatchObject({ suggested: null, adopted: null, used: null })
})


it('requires exact reasoning effort when the adopted route declared one', async () => {
  const h = await setup(); const id = h.begin('effort')
  h.session.append('model/automatic-selection', { requestId: id, baseline: selected,
    selection: { ...selected, reasoningEffort: 'high' } })
  h.session.append('request/header', { header: { config: { ...selected, reasoningEffort: ReasoningEffortId('low') } }, reason: 'initial' })
  h.input(id, 1); h.output(1)
  expect(h.view()?.entry?.used).toBeNull()
  h.session.append('request/header', { header: { config: { ...selected, reasoningEffort: ReasoningEffortId('high') } }, reason: 'change' })
  h.output(1)
  expect(h.view()?.entry?.used).toMatchObject({ reasoningEffort: 'high' })
})


it('replays consecutive legacy decisions without carrying the preceding input adoption or response', async () => {
  const h = await setup(); const first = h.decide('legacy-first')
  h.session.append('model/automatic-selection', { requestId: first, baseline: selected, selection: selected })
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' })
  h.input(first, 1); h.output(1)
  expect(h.view()?.entry).toMatchObject({ requestId: first, adopted: selected, used: selected })
  h.decide('legacy-first')
  expect(h.view()?.entry).toMatchObject({ requestId: first, adopted: selected, used: selected })
  h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const second = h.decide('legacy-second')
  expect(h.view()?.entry).toMatchObject({ requestId: second, suggested: selected, adopted: null, used: null })
  expect(h.view()?.entryTurn).toBeNull()
  h.session.append('model/automatic-selection', { requestId: second, baseline: selected, selection: selected })
  h.output(1)
  expect(h.view()?.entry?.used).toBeNull()
  h.input(second, 2); h.output(2)
  expect(h.view()?.entry).toMatchObject({ requestId: second, adopted: selected, used: selected })
  const restored = Session.fromRestore(h.session.id, h.session.snapshotEvents(), h.session.header, SessionLogOffset(0), 'shared-frozen')
  expect(h.ctx.sessionProjections.stateOf(restored, 'system3Runtime')).toEqual(h.view())
  expect(h.view()?.startRequestId).toBeNull()
})

it('rejects late legacy receipts once a modern entry-start identifies the pending input', async () => {
  const h = await setup(); const old = h.decide('legacy-old')
  const current = brandString<SessionRequestId>('modern-current')
  h.session.append('system3/entry-start', { requestId: current })
  h.decide('legacy-old')
  expect(h.view()?.entry).toMatchObject({ requestId: current, phase: 'deciding', adopted: null, used: null })
  h.decide('modern-current')
  h.session.append('model/automatic-selection', { requestId: old, baseline: selected, selection: selected })
  expect(h.view()?.entry).toMatchObject({ requestId: current, phase: 'decided', adopted: null, used: null })
  expect(h.view()?.startRequestId).toBe(current)
})
