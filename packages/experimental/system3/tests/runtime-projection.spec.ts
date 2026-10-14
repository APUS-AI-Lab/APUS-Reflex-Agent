import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ReasoningEffortId, ToolCallId, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { afterEach, expect, it } from 'vitest'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
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
  expect(system3RuntimeProjection.wire.view(state))
    .toEqual({ entry: h.view()?.entry, history: [], skill: null, subagentRun: null, notices: [], taskFrame: null, interjection: null,
      memory: [], recall: null })
  expect(Object.keys(system3RuntimeProjection.wire.view(state))).toEqual(['entry', 'history', 'skill', 'subagentRun', 'notices', 'taskFrame', 'interjection', 'memory', 'recall'])
})

it('keeps scored memory items with their checkpoint across checkpoints, oldest first', async () => {
  const h = await setup()
  const item = (seq: number, text: string) => ({ seq, messageId: `m${String(seq)}` as never, text, probability: 0.9 })
  h.session.append('system3/memory-score', { version: 1, checkpoint: 20, scanned: 3, items: [item(4, '别动 README.md')] })
  h.session.append('system3/memory-score', { version: 1, checkpoint: 40, scanned: 2, items: [] })
  h.session.append('system3/memory-score', { version: 1, checkpoint: 60, scanned: 1, items: [item(44, '端口改成 8443')] })
  expect(h.view()?.memory).toEqual([
    { checkpoint: 20, seq: 4, messageId: 'm4', text: '别动 README.md', probability: 0.9 },
    { checkpoint: 60, seq: 44, messageId: 'm44', text: '端口改成 8443', probability: 0.9 },
  ])
})

it('moves the person\'s text inputs a compaction shadows into the archive with that checkpoint, verbatim and complete', async () => {
  const h = await setup()
  const say = (text: string, kind: 'user' | 'runtime-context' = 'user') =>
    h.session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind } as never }), { surfaceOp: 'append' }).seq
  const long = '金额阈值 100 美元。'.repeat(100)
  const first = say(long)
  say('当前时间', 'runtime-context')
  const second = say('部署在 us-east-1')
  const live = say('继续')
  const checkpoint = h.session.append('compaction/summary', { compactionId: CompactionId('c1'), summary: [{ type: 'text', text: 's' }],
    shadowedRange: { start: first, end: second }, shadowedSeqs: [first, second], shadowedTokenCount: 10, provider: 'p', model: 'm' }).seq
  const state = h.view()
  expect(state?.archive.map(entry => [entry.seq, entry.checkpoint, entry.text])).toEqual([[first, checkpoint, long],
    [second, checkpoint, '部署在 us-east-1']])
  expect(state?.inputs.map(entry => entry.seq)).toEqual([live])
  expect(Object.keys(system3RuntimeProjection.wire.view(state!))).not.toContain('archive')
})

it('replaces the recall with the latest recorded one and clears it with an empty recall', async () => {
  const h = await setup()
  expect(h.view()?.recall).toBeNull()
  const item = { checkpoint: 20, seq: 4, messageId: 'm4' as never, text: '别动 README.md', probability: 0.88 }
  h.session.append('system3/memory-recall', { version: 1, messageId: 'q1' as never, scanned: 2, items: [item] })
  expect(h.view()?.recall).toEqual({ messageId: 'q1', items: [{ checkpoint: 20, seq: 4, messageId: 'm4', text: '别动 README.md', probability: 0.88 }] })
  h.session.append('system3/memory-recall', { version: 1, messageId: 'q2' as never, scanned: 2, items: [] })
  expect(h.view()?.recall).toEqual({ messageId: 'q2', items: [] })
})

it('shows a delivered interjection until its turn ends', async () => {
  const h = await setup()
  h.session.append('system3/interjection', { version: 1, messageId: 'kept' as never, decision: 'keep', delivered: false })
  expect(h.view()?.interjection).toBeNull()
  h.session.append('system3/interjection', { version: 1, messageId: 'm2' as never, decision: 'steer', delivered: true })
  expect(h.view()?.interjection).toEqual({ messageId: 'm2' })
  h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect(h.view()?.interjection).toBeNull()
})

it('shows the latest task frame', async () => {
  const h = await setup()
  const goal = { messageId: 'm1' as never, text: '加一个汇总命令' }
  h.session.append('system3/task-frame', { version: 1, goal, items: [] })
  h.session.append('system3/task-frame', { version: 1, goal, items: [{ messageId: 'm2' as never, text: '别动 README.md' }] })
  expect(h.view()?.taskFrame).toEqual({ goal, items: [{ messageId: 'm2', text: '别动 README.md' }] })
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


const protocolOnlyAttempts: { label: string; stream: AssistantStreamRecord[] }[] = [
  { label: 'local adapter error', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'ERROR', message: 'local failure' } } } }] },
  { label: 'local adapter abort', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'local cancellation' } } } }] },
  { label: 'usage only', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 3 } } }] },
  { label: 'text block placeholder', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'block-start', index: 0, blockType: 'text' } }] },
  { label: 'image block placeholder', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'block-start', index: 0, blockType: 'image' } }] },
  { label: 'empty compact text', stream: [{ type: 'text-chunks', time0: 1, index: 0, dt: [], texts: [''] }] },
  { label: 'empty compact reasoning', stream: [{ type: 'reasoning-chunks', time0: 1, index: 0, dt: [], texts: [''] }] },
  { label: 'empty compact tool arguments', stream: [{ type: 'tool-call-chunks', time0: 1, index: 0,
    dt: [], id: ToolCallId('empty-tool'), args: [''] }] },
  { label: 'empty raw text', stream: [{ type: 'chunk', time: 1, chunk: { type: 'text-delta', index: 0, text: '' } }] },
  { label: 'empty completed text', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '' } } }] },
]
it.each(protocolOnlyAttempts)('does not confirm actual response from $label', async ({ stream }) => {
  const h = await setup(); const id = h.begin('protocol-only')
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' }); h.input(id, 1)
  h.session.append('assistant/attempt', { turn: 1, step: 0, stream })
  expect(h.view()?.entry).toMatchObject({ adopted: selected, used: null })
  const restored = Session.fromRestore(h.session.id, h.session.snapshotEvents(), h.session.header, SessionLogOffset(0), 'shared-frozen')
  expect(h.ctx.sessionProjections.stateOf(restored, 'system3Runtime')?.entry?.used).toBeNull()
})

const responseAttempts: { label: string; stream: AssistantStreamRecord[] }[] = [
  { label: 'partial text before a later error', stream: [
    { type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['partial response'] },
    { type: 'chunk', time: 2, chunk: { type: 'finish', reason: { kind: 'error',
      failure: { code: 'ERROR', message: 'connection lost after content' } } } },
  ] },
  { label: 'reasoning content', stream: [{ type: 'reasoning-chunks', time0: 1, index: 0, dt: [], texts: ['reasoning fragment'] }] },
  { label: 'tool-call name', stream: [{ type: 'tool-call-chunks', time0: 1, index: 0, dt: [],
    id: ToolCallId('tool-response'), name: 'read', args: [''] }] },
  { label: 'complete text without deltas', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'complete response' } } }] },
  { label: 'complete tool call without deltas', stream: [{ type: 'chunk', time: 1,
    chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('completed-tool'),
      name: 'read', arguments: '{}' } } }] },
]
it.each(responseAttempts)('confirms actual response from $label without claiming task completion', async ({ stream }) => {
  const h = await setup(); const id = h.begin('content-response')
  h.session.append('request/header', { header: { config: selected }, reason: 'initial' }); h.input(id, 1)
  h.session.append('assistant/attempt', { turn: 1, step: 0, stream })
  expect(h.view()?.entry?.used).toEqual(selected)
})


it('clears preceding Skill injection facts when the next decision proposes no instructions', async () => {
  const h = await setup()
  const injection = createUserMessage({ content: [{ type: 'text', text: 'Instructions.' }],
    source: { kind: 'skill-invocation', name: 'csv', form: 'instructions' } })
  h.session.append('system3/skill-decision', { version: 1, requestId: null, turn: 1, step: 0, request: null,
    candidateNames: ['csv'], selected: 'csv', injectionMessageId: injection.id, outcome: 'selected', elapsedMs: 1 })
  h.session.append('step/start', { turn: 1, step: 0 })
  h.session.append('user/message', injection, { surfaceOp: 'append' })
  expect(h.view()?.skill?.injected).toBe(true)
  h.session.append('system3/skill-decision', { version: 1, requestId: null, turn: 2, step: 0, request: null,
    candidateNames: [], outcome: 'timeout', elapsedMs: 8 })
  expect(h.view()?.skill).toMatchObject({ turn: 2, outcome: 'timeout', selected: null, injected: false })
  expect(h.view()?.skillMessageId).toBeNull()
  h.session.append('step/start', { turn: 2, step: 0 })
  h.session.append('user/message', injection, { surfaceOp: 'append' })
  expect(h.view()?.skill?.injected).toBe(false)
})

it('marks the Session as containing images from a user message or a tool result', async () => {
  const attachment = { attachmentId: brandString<AttachmentId>('image-1'), mediaType: 'image/png' as const, bytes: 4, width: 1, height: 1 }
  const image = { type: 'image' as const, attachment }
  const fromTool = await setup()
  fromTool.session.append('tool/result', { turn: 1, step: 0, message: createToolResultMessage({ callId: ToolCallId('call-1'), content: [{ type: 'text', text: 'plain' }], isError: false }) }, { surfaceOp: 'append' })
  expect(fromTool.view()?.imageInSession).toBe(false)
  fromTool.session.append('tool/result', { turn: 1, step: 0, message: createToolResultMessage({ callId: ToolCallId('call-2'), content: [image], isError: false }) }, { surfaceOp: 'append' })
  expect(fromTool.view()?.imageInSession).toBe(true)
  const fromUser = await setup()
  fromUser.session.append('user/message', createUserMessage({ content: [image], source: { kind: 'user' } }), { surfaceOp: 'append' })
  expect(fromUser.view()?.imageInSession).toBe(true)
})

it('exposes the chosen route with its label and whether it continued the previous route', async () => {
  const h = await setup()
  const first = brandString<SessionRequestId>('chosen')
  h.session.append('system3/entry-start', { requestId: first })
  h.session.append('system3/entry-decision', { version: 1, requestId: first, request: null, baseline: selected, candidateIds: ['deep'],
    dataClasses: ['public'], routeId: 'jev', executionDomain: 'local', outcome: 'selected', selected, candidate: { id: 'deep', label: 'Deep' }, elapsedMs: 1 })
  expect(h.view()?.entry?.route).toEqual({ id: 'deep', label: 'Deep', retained: false, delegation: null })
  const second = brandString<SessionRequestId>('continued')
  h.session.append('system3/entry-start', { requestId: second })
  h.session.append('system3/entry-decision', { version: 1, requestId: second, request: null, baseline: selected, candidateIds: ['deep'],
    dataClasses: ['public'], routeId: 'jev', executionDomain: 'local', outcome: 'abstain', retained: { requestId: first, selection: selected },
    candidate: { id: 'deep' }, elapsedMs: 1 })
  expect(h.view()?.entry?.route).toEqual({ id: 'deep', label: null, retained: true, delegation: null })
  expect(system3RuntimeProjection.wire.viewSchema.parse(system3RuntimeProjection.wire.view(h.view()!)).entry?.route).toEqual({ id: 'deep', label: null, retained: true, delegation: null })
})

it('keeps the latest delegated-run snapshot without its version field', async () => {
  const h = await setup()
  const snapshot = { version: 1 as const, runId: 'run-1', provider: 'codex', state: 'running' as const, startedAt: 1, elapsedMs: 0, completed: {}, current: null }
  h.session.append('system3/delegation-progress', snapshot)
  h.session.append('system3/delegation-progress', { ...snapshot, state: 'completed', elapsedMs: 9, completed: { command: 2 } })
  expect(h.view()?.subagentRun).toEqual({ runId: 'run-1', provider: 'codex', state: 'completed', startedAt: 1, elapsedMs: 9, completed: { command: 2 }, current: null,
    lastStepAt: null, note: null, alert: null, steerable: false, steers: [] })
  expect(system3RuntimeProjection.wire.viewSchema.parse(system3RuntimeProjection.wire.view(h.view()!)).subagentRun?.state).toBe('completed')
})

it('keeps the latest three accepted steers of the current run and closes input when the run settles', async () => {
  const h = await setup()
  const startedAt = Date.now()
  const running = { version: 1 as const, runId: 'run-1', provider: 'codex', state: 'running' as const, startedAt, elapsedMs: 0,
    completed: {}, current: null, steerable: true }
  const steer = (text: string, runId = 'run-1') => {
    h.session.append('subagent/steer', { version: 1, runId: SubagentRunId(runId), provider: 'codex', text })
  }
  steer('before any run')
  expect(h.view()?.subagentRun).toBeNull()
  h.session.append('system3/delegation-progress', running)
  expect(h.view()?.subagentRun).toMatchObject({ steerable: true, steers: [] })
  steer('other run', 'run-2')
  for (const text of ['one', 'two', 'three', 'four']) steer(text)
  h.session.append('system3/delegation-progress', { ...running, elapsedMs: 5 })
  const view = h.view()?.subagentRun
  expect(view?.steers.map(entry => entry.text)).toEqual(['two', 'three', 'four'])
  expect(view?.steers.every(entry => entry.atMs >= 0)).toBe(true)
  h.session.append('system3/delegation-progress', { ...running, state: 'completed', elapsedMs: 9 })
  expect(h.view()?.subagentRun).toMatchObject({ steerable: false, steers: [{ text: 'two' }, { text: 'three' }, { text: 'four' }] })
  h.session.append('system3/delegation-progress', { ...running, runId: 'run-2' })
  expect(h.view()?.subagentRun?.steers).toEqual([])
  expect(system3RuntimeProjection.wire.viewSchema.parse(system3RuntimeProjection.wire.view(h.view()!)).subagentRun?.steerable).toBe(true)
})

it('keeps an overtime alert while running, clears a stall alert on the next step, and drops alerts at the end', async () => {
  const h = await setup()
  const running = { version: 1 as const, runId: 'run-1', provider: 'codex', state: 'running' as const, startedAt: 1, elapsedMs: 0,
    completed: {}, current: null, lastStepAt: 5, note: 'Reading.' }
  const alert = (kind: 'overtime' | 'stalled', elapsedMs: number, runId = 'run-1') => {
    h.session.append('system3/delegation-alert', { version: 1, runId, provider: 'codex', kind, elapsedMs, lastStepAt: 5 })
  }
  alert('stalled', 9)
  expect(h.view()?.subagentRun).toBeNull()
  h.session.append('system3/delegation-progress', running)
  alert('stalled', 9, 'other-run')
  expect(h.view()?.subagentRun?.alert).toBeNull()
  alert('stalled', 9)
  expect(h.view()?.subagentRun).toMatchObject({ note: 'Reading.', alert: { kind: 'stalled', elapsedMs: 9 } })
  h.session.append('system3/delegation-progress', { ...running, elapsedMs: 10 })
  expect(h.view()?.subagentRun?.alert).toEqual({ kind: 'stalled', elapsedMs: 9 })
  h.session.append('system3/delegation-progress', { ...running, elapsedMs: 11, lastStepAt: 11 })
  expect(h.view()?.subagentRun?.alert).toBeNull()
  alert('overtime', 12)
  h.session.append('system3/delegation-progress', { ...running, elapsedMs: 13, lastStepAt: 13 })
  expect(h.view()?.subagentRun?.alert).toEqual({ kind: 'overtime', elapsedMs: 12 })
  h.session.append('system3/delegation-progress', { ...running, state: 'completed', elapsedMs: 14 })
  expect(h.view()?.subagentRun?.alert).toBeNull()
  alert('overtime', 15)
  expect(h.view()?.subagentRun?.alert).toBeNull()
})

it('keeps earlier decisions whose input reached a turn, so earlier turns keep their route line', async () => {
  const h = await setup()
  const first = h.begin('first'); h.input(first, 1); h.output(1)
  h.begin('unadmitted')
  const third = h.begin('third'); h.input(third, 2)
  expect(h.view()?.history.map(entry => [entry.requestId, entry.turn])).toEqual([['first', 1]])
  h.begin('fourth')
  expect(h.view()?.history.map(entry => entry.requestId)).toEqual(['first', 'third'])
  for (let turn = 3; turn < 103; turn++) { const id = h.begin(`r${String(turn)}`); h.input(id, turn) }
  h.begin('last')
  expect(h.view()?.history).toHaveLength(100)
  expect(h.view()?.history[0]?.requestId).toBe('r3')
})
