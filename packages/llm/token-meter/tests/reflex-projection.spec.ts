import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { reflexContextMessageProjection, projectReflexText } from '@deepseek-ai/dsh-compaction/reflex-context-projection'
import TokenMeter from '../src/index.ts'
import { estimateMessage } from '../src/estimate.ts'
import { repriceReflexNodes } from '../src/reflex-projection.ts'
import { foldSurfaceProjection } from '../src/surface-projection.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

it('prices the actual projected request and restores all three token views', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  ctx.sessions.registerMessageProjection(reflexContextMessageProjection)
  const session = ctx.sessions.create()
  const text = 'Historical irrelevant text. '.repeat(100) + '\nKeep this requirement.'
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const seq = session.append('user/message', message, { surfaceOp: 'append' }).seq
  session.append('assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 2000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } }] })
  const before = ctx.tokenMeter.measure(session).surfaceTokens
  const hidden = [{ start: 0, end: text.indexOf('\n') + 1, firstLine: 1, lastLine: 1 }]
  const projected = { ...message, content: [{ type: 'text' as const, text: projectReflexText(text, hidden) }] }
  const tokenDelta = estimateMessage(projected) - estimateMessage(message)
  expect(tokenDelta).toBeLessThan(0)
  const removal = session.append('reflex/context-projection', { version: 1, revision: 0, action: 'remove',
    targets: [{ seq, block: 0, original: text, hidden, tokenDelta }] })
  expect(foldSurfaceProjection({ start: seq, end: seq, tokens: before }, removal)).toEqual({ deltaTokens: tokenDelta, claim: undefined })
  expect(ctx.sessionProjections.snapshot(session).values.contextPressure)
    .toMatchObject({ pressureTokens: 2000, projectedTokens: 2000 + tokenDelta })
  expect(session.deriveMessages()[0]?.content).toEqual(projected.content)
  expect(ctx.tokenMeter.measure(session).surfaceTokens).toBe(estimateMessage(projected))
  expect(ctx.sessionProjections.snapshot(session).values.contextBreakdown?.messageTokens).toBe(estimateMessage(projected))
  session.append('reflex/context-projection', { version: 1, revision: 1, action: 'restore',
    targets: [{ seq, block: 0, original: text, hidden: [], tokenDelta: -tokenDelta }] })
  expect(ctx.tokenMeter.measure(session).surfaceTokens).toBe(before)
  expect(ctx.sessionProjections.snapshot(session).values.contextBreakdown?.messageTokens).toBe(before)
  expect(session.deriveMessages()[0]?.content).toEqual(message.content)
  expect(ctx.sessionProjections.snapshot(session).values.contextPressure).toMatchObject({ pressureTokens: 2000, projectedTokens: 2000 })
  const nodes = [{ seq, heuristicTokens: before }]
  expect(() => repriceReflexNodes(nodes, { ...removal, data: { ...removal.data, targets: [{ ...removal.data.targets[0]!, seq: SessionSeq(999999) }] } })).toThrow('not retained')
  expect(() => repriceReflexNodes(nodes, { ...removal, data: { ...removal.data, targets: [{ ...removal.data.targets[0]!, tokenDelta: -before - 1 }] } })).toThrow('invalid token price')
  expect(() => repriceReflexNodes(nodes, { ...removal, data: { ...removal.data,
    targets: [{ ...removal.data.targets[0]!, tokenDelta: Number.MAX_SAFE_INTEGER + 1 }] } })).toThrow('safe integer')
  expect(nodes).toEqual([{ seq, heuristicTokens: before }])
})

it('preserves provider anchors through omission, checkpoint restore and recovery after compaction', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  ctx.sessions.registerMessageProjection(reflexContextMessageProjection)
  const session = ctx.sessions.create()
  const text = 'Archived details. '.repeat(100) + '\nCurrent constraint.'
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const seq = session.append('user/message', message, { surfaceOp: 'append' }).seq
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: { config: { provider: 'mock', model: 'mock' } }, reason: 'initial' })
  session.append('assistant/message', { turn: 1, step: 1, stream: [],
    message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }),
    usage: { inputTokens: 2000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  const before = ctx.tokenMeter.measure(session)
  expect(before.baseline.kind).toBe('usage')
  const hidden = [{ start: 0, end: text.indexOf('\n') + 1, firstLine: 1, lastLine: 1 }]
  const projected = { ...message, content: [{ type: 'text' as const, text: projectReflexText(text, hidden) }] }
  const tokenDelta = estimateMessage(projected) - estimateMessage(message)
  session.append('reflex/context-projection', { version: 1, revision: 0, action: 'remove',
    targets: [{ seq, block: 0, original: text, hidden, tokenDelta }] })
  expect(ctx.tokenMeter.measure(session)).toMatchObject({ baseline: before.baseline,
    surfaceDeltaTokens: before.surfaceDeltaTokens + tokenDelta, totalTokens: before.totalTokens + tokenDelta })
  const checkpoint = structuredClone(ctx.sessionProjections.checkpoint(session))
  const offset = session.seq
  session.append('reflex/context-projection', { version: 1, revision: 1, action: 'restore',
    targets: [{ seq, block: 0, original: text, hidden: [], tokenDelta: -tokenDelta }] })
  expect(ctx.tokenMeter.measure(session)).toMatchObject({ baseline: before.baseline, totalTokens: before.totalTokens })
  session.append('reflex/context-projection', { version: 1, revision: 2, action: 'remove',
    targets: [{ seq, block: 0, original: text, hidden, tokenDelta }] })
  session.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq],
    shadowedTokenCount: estimateMessage(projected) })
  const summary = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Summary' }] })
  session.append('user/message', summary, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  const recovered = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: text.slice(0, hidden[0]!.end) }] })
  session.append('user/message', recovered, { surfaceOp: 'append' })
  const expectedDelta = estimateMessage(summary) + estimateMessage(recovered) - estimateMessage(message)
  const measured = ctx.tokenMeter.measure(session)
  expect(measured).toMatchObject({ baseline: before.baseline, totalTokens: before.totalTokens + expectedDelta })
  const values = ctx.sessionProjections.snapshot(session).values
  expect(values.contextBreakdown?.messageTokens).toBe(measured.surfaceTokens)
  expect(values.contextPressure?.projectedTokens).toBe(measured.totalTokens)
  const replayed = ctx.sessionProjections.restore(checkpoint, session.snapshotEvents().slice(offset),
    SessionLogOffset(offset), session.header, session.inheritedEventCount)
  expect(replayed.snapshot.values).toEqual(values)
  const restored = Session.fromRestore(session.id, session.snapshotEvents(), session.header, SessionLogOffset(0), 'shared-frozen',
    [reflexContextMessageProjection])
  expect(ctx.tokenMeter.measure(restored)).toMatchObject({ baseline: measured.baseline,
    surfaceTokens: measured.surfaceTokens, surfaceDeltaTokens: measured.surfaceDeltaTokens,
    totalTokens: measured.totalTokens, nodes: measured.nodes })
})
