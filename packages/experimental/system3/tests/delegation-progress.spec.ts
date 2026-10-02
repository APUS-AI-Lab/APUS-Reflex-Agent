import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type ResolvedSubagentStartRequest, type SubagentResult } from '@deepseek-ai/dsh-subagent'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installSystem3DelegationProgress } from '../src/delegation-progress.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const contexts: Context[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(intervalMs = 3000) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime, {})
  ctx.sessionProjections.register(system3RuntimeProjection)
  installSystem3DelegationProgress(ctx, { intervalMs })
  const settled = Promise.withResolvers<SubagentResult>()
  let report: ResolvedSubagentStartRequest['reportActivity'] = () => {}
  ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    async start(request) {
      report = request.reportActivity
      return { id: SessionId('codex-child'), localAgent: undefined, result: settled.promise, async dispose() {} }
    },
  })
  const parent = await ctx.agentLoop.create(SessionId('delegating-parent'), { provider: 'mock', model: 'mock' })
  const snapshots = () => parent.session.snapshotEvents().filter(event => event.type === 'system3/delegation-progress').map(event => event.data)
  const start = async () => await ctx.subagents.start('codex', { prompt: [{ type: 'text', text: 'task' }], parent, signal: new AbortController().signal })
  return { ctx, parent, settled, report: (...args: Parameters<typeof report>) => { report(...args) }, snapshots, start }
}

it('writes the start at once, throttles running snapshots, and writes the end with the stop reason', async () => {
  const h = await setup()
  const run = await h.start()
  expect(h.snapshots()).toEqual([expect.objectContaining({ version: 1, provider: 'codex', state: 'running', elapsedMs: 0, completed: {}, current: null })])
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
  h.ctx.emit('subagent/start', { runId: 'unscoped' as never, provider: 'codex', id: SessionId('x'), local: false })
  expect(h.snapshots()).toEqual([])
})
