import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import ContinuumTaskGuard from '../src/task-guard.ts'
import ContinuumTasks, { type ContinuumTaskConfig } from '../src/task-service.ts'
import { MemoryDomainId, MemoryPrincipalId, MemoryTaskId } from '../src/task-types.ts'
import type { TaskBinding } from '../src/task-binding.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function location() {
  const root = await mkdtemp(join(tmpdir(), 'apus-task-guard-'))
  roots.push(root)
  const workspace = join(await realpath(root), 'workspace')
  await mkdir(workspace)
  return { root, workspace }
}

async function runtime(root: string, workspace: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'business'), compression: 'none' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: true })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const guard = await ctx.plugin(ContinuumTaskGuard)
  const adapter = new MockAdapter(Array.from({ length: 8 }, () => textResponse('ack')))
  ctx.llm.registerAdapter(['recording'], adapter)
  const config: ContinuumTaskConfig = { root: join(root, 'domain'), workspace,
    domainId: 'domain', principalId: 'owner', taskId: 'task', maxContextBytes: 2048, maxPageBytes: 2048 }
  const create = (id: string) => ctx.agentLoop.create(SessionId(id), { provider: 'recording', model: 'recording' }, { cwd: workspace })
  const stream = async (sessionId?: ReturnType<typeof SessionId>) => {
    for await (const _chunk of ctx.llm.stream({ provider: 'recording', model: 'recording', messages: [],
      ...sessionId === undefined ? {} : { sessionId } })) { /* Drain the public model stream. */ }
  }
  return { ctx, adapter, guard, config, create, stream }
}

function binding(workspace: string): TaskBinding {
  return { domainId: MemoryDomainId('domain'), principalId: MemoryPrincipalId('owner'), taskId: MemoryTaskId('task'), workspace,
    retirementDigest: createHash('sha256').update('[]').digest('hex') }
}

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

it('leaves ordinary and standalone requests unchanged while refusing bound requests without an authority', async () => {
  const { root, workspace } = await location()
  const h = await runtime(root, workspace)
  const plain = await h.create('plain')
  await h.stream()
  await h.stream(SessionId('unknown'))
  await h.stream(plain.session.id)
  expect(h.adapter.requests).toHaveLength(3)
  plain.session.append('continuum/task-binding', binding(workspace))
  await expect(h.stream(plain.session.id)).rejects.toThrow('requires its configured Continuum task authority')
  expect(h.adapter.requests).toHaveLength(3)
})

it('refuses baseline-profile cold resume of a task-bound Session without loading the optional authority', async () => {
  const { root, workspace } = await location()
  const first = await runtime(root, workspace)
  await first.ctx.plugin(ContinuumTasks, first.config)
  const a = await first.create('bound-cold-session')
  a.followup(user('A saved requirement that must retain its authority.'))
  await a.whenIdle()
  expect(first.adapter.requests).toHaveLength(1)
  await first.ctx.sessions.flush(a.session)
  await first.ctx.fiber.dispose()

  const cold = await runtime(root, workspace)
  const resumed = await cold.ctx.agentLoop.resume(cold.ctx, {
    resumeSessionId: a.session.id, agentOptions: { provider: 'recording', model: 'recording' },
  })
  resumed.agent.followup(user('Continue from the previous history.'))
  await resumed.agent.whenIdle()
  expect(cold.adapter.requests).toHaveLength(0)
  await expect(cold.stream(resumed.agent.session.id)).rejects.toThrow('requires its configured Continuum task authority')
})

it('keeps the guard after task-service unload and refuses both direct and loop requests', async () => {
  const { root, workspace } = await location()
  const h = await runtime(root, workspace)
  const tasks = await h.ctx.plugin(ContinuumTasks, h.config)
  const a = await h.create('unloaded-session')
  a.followup(user('Bound before removing the task plugin.'))
  await a.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  await tasks.dispose()
  expect(h.ctx.get('continuumTaskGuard')).toBeDefined()
  await expect(h.stream(a.session.id)).rejects.toThrow('requires its configured Continuum task authority')
  a.followup(user('Do not bypass the removed authority.'))
  await a.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
})

it.each(['domainId', 'principalId', 'taskId', 'workspace'] as const)('refuses a present authority with mismatched %s', async (key) => {
  const { root, workspace } = await location()
  const h = await runtime(root, workspace)
  await h.ctx.plugin(ContinuumTasks, h.config)
  const a = await h.create('foreign-binding')
  const original = binding(workspace)
  const value = key === 'domainId' ? MemoryDomainId('foreign') : key === 'principalId' ? MemoryPrincipalId('foreign')
    : key === 'taskId' ? MemoryTaskId('foreign') : '/foreign'
  a.session.append('continuum/task-binding', { ...original, [key]: value })
  await expect(h.stream(a.session.id)).rejects.toThrow('different task authority')
  expect(h.adapter.requests).toHaveLength(0)
})

it('refuses an unready authority and does not treat service presence as authorization', async () => {
  const { root, workspace } = await location()
  const h = await runtime(root, workspace)
  const a = await h.create('unready-authority')
  a.session.append('continuum/task-binding', binding(workspace))
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  class DelayedTasks extends ContinuumTasks {
    protected override async [Service.init](): Promise<void> {
      entered.resolve(undefined)
      await release.promise
      await super[Service.init]()
    }
  }
  const mounting = h.ctx.plugin(DelayedTasks, h.config)
  await entered.promise
  try {
    await expect(h.stream(a.session.id)).rejects.toThrow(/authority|not ready/)
    expect(h.adapter.requests).toHaveLength(0)
  } finally {
    release.resolve(undefined)
    await mounting
  }
})

it('requires authority ownership of the exact live Session and validates the retirement set', async () => {
  const { root, workspace } = await location()
  const h = await runtime(root, workspace)
  const existing = await h.create('created-before-authority')
  existing.session.append('continuum/task-binding', binding(workspace))
  await h.ctx.plugin(ContinuumTasks, h.config)
  await expect(h.stream(existing.session.id)).rejects.toThrow('does not own this live Session')
  const retired = await h.create('retired-context')
  retired.session.append('continuum/task-binding', { ...binding(workspace), retirementDigest: 'f'.repeat(64) })
  await expect(h.stream(retired.session.id)).rejects.toThrow('requirements were retired')
  const valid = await h.create('current-context')
  valid.session.append('continuum/task-binding', binding(workspace))
  await h.stream(valid.session.id)
  expect(h.adapter.requests).toHaveLength(1)
})

it('releases its projection registration and stream listener when its owning profile stops', async () => {
  const { root, workspace } = await location()
  const h = await runtime(root, workspace)
  const a = await h.create('guard-lifecycle')
  a.session.append('continuum/task-binding', binding(workspace))
  await expect(h.stream(a.session.id)).rejects.toThrow('requires its configured Continuum task authority')
  await h.guard.dispose()
  expect(h.ctx.get('continuumTaskGuard')).toBeUndefined()
  await h.stream(a.session.id)
  expect(h.adapter.requests).toHaveLength(1)
})
