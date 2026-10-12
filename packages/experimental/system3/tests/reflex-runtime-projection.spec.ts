import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SubagentRunId, SubagentRecoveryId, SubagentNativeThreadId, SubagentEvidenceTurnId } from '@deepseek-ai/dsh-subagent'
import type { System3DecisionId } from '../src/decisions.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

it('retains a confirmed native continuation when memory feedback arrives later', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(system3RuntimeProjection)
  const session = ctx.sessions.create()
  session.append('system3/reflex-recovery', { version: 1, id: brandString<SubagentRecoveryId>('recovery'),
    goalId: GoalId('goal'), goalRevision: 1, humanRevision: 0, runId: brandString<SubagentRunId>('run'),
    reason: 'native-inactivity-budget', state: 'continued', observation: {
      threadId: brandString<SubagentNativeThreadId>('thread'), turnId: brandString<SubagentEvidenceTurnId>('turn'),
      lastActivityAt: 1, retryCount: 0, waiting: false, activeSideEffects: 0,
    } })
  session.append('user/message', createUserMessage({ source: { kind: 'reflex-memory' },
    content: [{ type: 'text', text: 'Keep the original ledger unchanged.' }] }), { surfaceOp: 'append' })
  expect(ctx.sessionProjections.snapshot(session).values.system3Runtime?.reflex).toMatchObject({
    recovery: { state: 'continued', reason: 'native-inactivity-budget', runId: 'run' },
    context: { action: 'restore', targetsCount: 1 },
  })
})

it('keeps accepted delivery distinct from verified improvement in the client view', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(system3RuntimeProjection)
  const session = ctx.sessions.create()
  const data = { version: 1 as const, id: brandString<System3DecisionId>('decision'), goalId: GoalId('goal'),
    goalRevision: 1, runId: brandString<SubagentRunId>('run'), action: 'diagnose' as const, evidenceCount: 3 }
  session.append('system3/reflex-supervision', { ...data, state: 'accepted' })
  expect(ctx.sessionProjections.snapshot(session).values.system3Runtime?.reflex?.supervision?.state).toBe('accepted')
  session.append('system3/reflex-supervision', { ...data, state: 'improved', evidenceCount: 5 })
  expect(ctx.sessionProjections.snapshot(session).values.system3Runtime?.reflex?.supervision).toEqual({
    state: 'improved', action: 'diagnose', evidenceCount: 5, runId: 'run',
  })
  const timeline = ctx.sessionProjections.snapshot(session).values.system3Runtime?.reflex?.timeline
  expect(timeline?.map(item => item.kind)).toEqual(['supervision', 'supervision'])
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'New requirement.' }] }), { surfaceOp: 'append' })
  expect(ctx.sessionProjections.snapshot(session).values.system3Runtime?.reflex?.supervision).toBeNull()
})

it('reports memory restored from a compacted node when its recovery message is committed', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(system3RuntimeProjection)
  const session = ctx.sessions.create()
  const event = session.append('user/message', createUserMessage({ source: { kind: 'reflex-memory' },
    content: [{ type: 'text', text: 'Recovered historical hotel detail.' }] }), { surfaceOp: 'append' })
  expect(ctx.sessionProjections.snapshot(session).values.system3Runtime?.reflex?.context).toEqual({
    revision: event.seq, action: 'restore', targetsCount: 1,
  })
})
