import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type ResolvedSubagentStartRequest, type SubagentResult, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installSystem3DelegationProgress } from '../src/delegation-progress.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const contexts: Context[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(intervalMs = 3000, monitor?: { overtimeMs: number; stallMs: number; startupMs: number }, steer?: SubagentRun['steer']) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime, {})
  ctx.sessionProjections.register(system3RuntimeProjection)
  installSystem3DelegationProgress(ctx, { intervalMs, ...monitor === undefined ? {} : { monitor } })
  const settled = Promise.withResolvers<SubagentResult>()
  let report: ResolvedSubagentStartRequest['reportActivity'] = () => {}
  ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    async start(request) {
      report = request.reportActivity
      return { id: SessionId('codex-child'), localAgent: undefined, result: settled.promise, async dispose() {}, ...steer === undefined ? {} : { steer } }
    },
  })
  const parent = await ctx.agentLoop.create(SessionId('delegating-parent'), { provider: 'mock', model: 'mock' })
  const snapshots = () => parent.session.snapshotEvents().filter(event => event.type === 'system3/delegation-progress').map(event => event.data)
  const alerts = () => parent.session.snapshotEvents().filter(event => event.type === 'system3/delegation-alert').map(event => event.data)
  const start = async () => await ctx.subagents.start('codex', { prompt: [{ type: 'text', text: 'task' }], parent, signal: new AbortController().signal })
  return { ctx, parent, settled, report: (...args: Parameters<typeof report>) => { report(...args) }, snapshots, alerts, start }
}

it('writes the start at once, throttles running snapshots, and writes the end with the stop reason', async () => {
  const h = await setup()
  const run = await h.start()
  expect(h.snapshots()).toEqual([expect.objectContaining({ version: 1, provider: 'codex', state: 'running', elapsedMs: 0, completed: {}, current: null, steerable: false })])
  h.report({ kind: 'command', phase: 'started' })
  h.report({ kind: 'command', phase: 'completed' })
  h.report({ kind: 'file-change', phase: 'started' })
  expect(h.snapshots()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(3000)
  expect(h.snapshots().at(-1)).toMatchObject({ state: 'running', elapsedMs: 3000, completed: { command: 1 }, current: 'file-change' })
  await vi.advanceTimersByTimeAsync(5000)
  h.report({ kind: 'file-change', phase: 'completed' })
  expect(h.snapshots().at(-1)).toMatchObject({ elapsedMs: 8000, completed: { command: 1, 'file-change': 1 }, current: null })
  h.report({ kind: 'message', phase: 'started' })
  h.settled.resolve({ output: [], stopReason: 'completed' })
  await run.result
  await vi.advanceTimersByTimeAsync(0)
  expect(h.snapshots().at(-1)).toMatchObject({ state: 'completed', current: null, completed: { command: 1, 'file-change': 1 } })
  const count = h.snapshots().length
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.snapshots()).toHaveLength(count)
  expect(h.ctx.sessionProjections.stateOf(h.parent.session, 'system3Runtime')?.subagentRun).toMatchObject({ provider: 'codex', state: 'completed' })
})

it('records a failed run and drops pending snapshots on disposal', async () => {
  const failed = await setup()
  const run = await failed.start()
  failed.settled.reject(new Error('infrastructure'))
  await run.result.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(0)
  expect(failed.snapshots().at(-1)).toMatchObject({ state: 'error' })

  const disposed = await setup()
  await disposed.start()
  await vi.advanceTimersByTimeAsync(100)
  disposed.report({ kind: 'tool', phase: 'completed' })
  const count = disposed.snapshots().length
  await disposed.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(disposed.ctx), 1)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(disposed.snapshots()).toHaveLength(count)
})

it('ignores activity for unknown runs and events without a delegating Agent, and rejects invalid intervals', async () => {
  const h = await setup()
  expect(() => { installSystem3DelegationProgress(h.ctx, { intervalMs: 0 }) }).toThrow('intervalMs')
  h.ctx.emit('subagent/activity', { runId: 'unknown' as never, provider: 'codex', id: SessionId('x'), kind: 'tool', phase: 'completed' })
  h.ctx.emit('subagent/end', { runId: 'unknown' as never, provider: 'codex', id: SessionId('x'), local: false, stopReason: 'completed' })
  h.ctx.emit('subagent/start', { runId: 'unscoped' as never, provider: 'codex', id: SessionId('x'), local: false, steerable: false })
  expect(h.snapshots()).toEqual([])
})

it('alerts once for a slow start, once per stall episode, and at every overtime multiple, then stops at the end', async () => {
  const h = await setup(1000, { overtimeMs: 10_000, stallMs: 3_000, startupMs: 4_000 })
  const run = await h.start()
  await vi.advanceTimersByTimeAsync(4_000)
  expect(h.alerts()).toEqual([expect.objectContaining({ version: 1, provider: 'codex', kind: 'starting', elapsedMs: 4_000, lastStepAt: null })])
  await vi.advanceTimersByTimeAsync(2_000)
  h.report({ kind: 'message', phase: 'completed', note: 'Reading the parser.' })
  await vi.advanceTimersByTimeAsync(1_000)
  expect(h.snapshots().at(-1)).toMatchObject({ lastStepAt: 6_000, note: 'Reading the parser.' })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(h.alerts().map(alert => alert.kind)).toEqual(['starting', 'stalled'])
  expect(h.alerts().at(-1)).toMatchObject({ elapsedMs: 9_000, lastStepAt: 6_000 })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(h.alerts().map(alert => alert.kind)).toEqual(['starting', 'stalled', 'overtime'])
  h.report({ kind: 'command', phase: 'started' })
  await vi.advanceTimersByTimeAsync(3_000)
  expect(h.alerts().map(alert => alert.kind)).toEqual(['starting', 'stalled', 'overtime', 'stalled'])
  await vi.advanceTimersByTimeAsync(3_000)
  expect(h.alerts().map(alert => alert.kind)).toEqual(['starting', 'stalled', 'overtime', 'stalled', 'overtime'])
  expect(h.snapshots().at(-1)?.note).toBe('Reading the parser.')
  h.settled.resolve({ output: [], stopReason: 'completed' })
  await run.result
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.alerts()).toHaveLength(5)
})

it('writes no alerts without monitor thresholds and rejects invalid ones', async () => {
  const h = await setup()
  await h.start()
  await vi.advanceTimersByTimeAsync(3_600_000)
  expect(h.alerts()).toEqual([])
  expect(() => { installSystem3DelegationProgress(h.ctx, { intervalMs: 1000, monitor: { overtimeMs: 1, stallMs: 0, startupMs: 1 } }) }).toThrow('stallMs')
})

it('records a person\'s accepted input in the delegating Session and shows it on the run', async () => {
  const delivered: unknown[] = []
  const h = await setup(3000, undefined, async (content) => { delivered.push(content) })
  const run = await h.start()
  const runId = h.snapshots()[0]!.runId
  expect(h.snapshots()[0]).toMatchObject({ steerable: true })
  await expect(h.ctx.subagents.steerByParent({ runId: runId as never, parentSessionId: h.parent.session.id, text: '先让测试通过' },
    new AbortController().signal)).resolves.toEqual({ accepted: true })
  expect(delivered).toEqual([[{ type: 'text', text: '先让测试通过' }]])
  const view = h.ctx.sessionProjections.stateOf(h.parent.session, 'system3Runtime')
  expect(view?.subagentRun).toMatchObject({ runId, steerable: true, steers: [{ text: '先让测试通过' }] })
  h.settled.resolve({ output: [], stopReason: 'completed' })
  await run.result
  await vi.advanceTimersByTimeAsync(0)
  expect(h.ctx.sessionProjections.stateOf(h.parent.session, 'system3Runtime')?.subagentRun).toMatchObject({ steerable: false, steers: [{ text: '先让测试通过' }] })
})
