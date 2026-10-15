import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import LlmRuntime, { createUserMessage, isAgentLoopRequest, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import ContinuumTasks, { TaskJournal, taskBindingProjection } from '../src/tasks.ts'
import type { ContinuumTaskConfig } from '../src/tasks.ts'
import * as taskSource from '../src/task-source.ts'
import ContinuumTaskGuard from '../src/task-guard.ts'
import type { TaskPage } from '../src/task-pages.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function locations() {
  const root = await mkdtemp(join(tmpdir(), 'continuum-task-service-'))
  roots.push(root)
  const workspace = join(await realpath(root), 'workspace')
  await mkdir(workspace)
  return { root, workspace }
}

async function runtime(root: string, workspace: string, script?: ConstructorParameters<typeof MockAdapter>[0], taskId = 'release-task',
  overrides: Partial<ContinuumTaskConfig> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'business-sessions'), compression: 'none' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: true })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ContinuumTaskGuard)
  const adapter = new MockAdapter(script ?? Array.from({ length: 10 }, () => textResponse('ack')))
  ctx.llm.registerAdapter(['recording'], adapter)
  const config: ContinuumTaskConfig = { root: join(root, 'task-authority'), workspace,
    domainId: 'test-domain', principalId: 'test-owner', taskId, maxContextBytes: 2048, maxPageBytes: 2048, ...overrides }
  const fiber = await ctx.plugin(ContinuumTasks, config)
  const create = (id: string, cwd = workspace) => ctx.agentLoop.create(SessionId(id), { provider: 'recording', model: 'recording' }, { cwd })
  return { ctx, adapter, fiber, config, create }
}

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const append = (agent: Agent, text: string) => agent.session.append('user/message', user(text), { surfaceOp: 'append' })
const requestText = (adapter: MockAdapter) => adapter.requests.flatMap(request => request.messages
  .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))).join('\n')

async function close(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(ctx), 1)
}

it('compacts an already summarized span and continues the main loop with exact task inputs', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace, [textResponse('ack'),
    textResponse('First checkpoint detail. '.repeat(100)), textResponse('Second checkpoint.'), textResponse('continued')])
  await h.ctx.plugin(TokenMeter)
  await h.ctx.plugin(BasicCompactionEngine, { auto: false })
  const agent = await h.create('compaction')
  const originalText = `Keep {{literal}} exactly. ${'Full original requirement. '.repeat(600)}TAIL  \r\n`
  const original = user(originalText)
  agent.followup(original)
  await agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  const signal = new AbortController().signal
  expect(await h.ctx.compaction.compactNow(agent, signal)).not.toBeNull()
  expect(await h.ctx.compaction.compactNow(agent, signal)).not.toBeNull()
  expect(h.adapter.requests).toHaveLength(3)
  const secondSummary = h.adapter.requests[2]!
  expect(isAgentLoopRequest(secondSummary)).toBe(false)
  expect(secondSummary.messages.some(message => message.id === original.id)).toBe(false)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')).toHaveLength(2)
  agent.followup(user('Continue after repeated compaction.'))
  await agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(4)
  expect(isAgentLoopRequest(h.adapter.requests[3]!)).toBe(true)
  expect((await h.ctx.continuumTasks.snapshot(agent))?.entries[0]?.text).toBe(originalText)
})

it('restores every old and long input into a distinct Session and pages exact text after a cold restart', async () => {
  const { root, workspace } = await locations()
  const a = await runtime(root, workspace)
  const owner = await a.create('A')
  const inputs = ['  Keep {{literal}} verbatim.  ', ...Array.from({ length: 15 }, (_, index) => `Requirement ${index}: value-${index}`),
    `Long requirement ${'original text '.repeat(900)}TAIL-原文🪶\r\n  `]
  for (const text of inputs) append(owner, text)
  const seeded = await a.ctx.continuumTasks.snapshot(owner)
  expect(seeded?.entries.map(entry => entry.text)).toEqual(inputs)
  await close(a.ctx)

  const b = await runtime(root, workspace, [toolCallResponse('read-task', 'read_continuum_task', {}), textResponse('ack')])
  const resumed = await b.create('B')
  expect(resumed.session.id).not.toBe(owner.session.id)
  expect((await b.ctx.continuumTasks.snapshot(resumed))?.entries).toEqual(seeded?.entries)
  const recovered = new Map<string, string>()
  let options = {}
  for (let pages = 0; ; pages++) {
    expect(pages).toBeLessThan(100)
    const raw = await b.ctx.continuumTasks.read(resumed, options)
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(2048)
    const page = JSON.parse(raw) as TaskPage
    for (const entry of page.entries) recovered.set(entry.id, `${recovered.get(entry.id) ?? ''}${entry.text}`)
    if (page.next === null) { expect(page.pending).toBe(false); break }
    expect(page.pending).toBe(true)
    options = { entryIndex: page.next.entryIndex, textOffset: page.next.textOffset, expectedRevision: page.next.revision }
  }
  expect([...recovered.values()]).toEqual(inputs)
  resumed.followup(user('继续'))
  await resumed.whenIdle()
  expect(b.adapter.requests).toHaveLength(2)
  expect(requestText(b.adapter)).toContain('{{literal}}')
  expect(resumed.session.snapshotEvents().some(event => event.type === 'tool/call' && event.data.name === 'read_continuum_task')).toBe(true)
  expect(resumed.session.snapshotEvents().some(event => event.type === 'continuum/task-binding')).toBe(true)
  expect(resumed.session.snapshotEvents().some(event => event.type === 'tool/result')).toBe(true)
  const business = await b.ctx.sessionPersistence.list()
  expect(business.map(record => record.header.id).sort()).toEqual([SessionId('A'), SessionId('B')])
})

it('denies another workspace before model dispatch without poisoning an authorized Session', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const other = join(root, 'other')
  await mkdir(other)
  const denied = await h.create('outside', other)
  denied.followup(user('Read the saved task.'))
  await denied.whenIdle()
  expect(h.adapter.requests).toHaveLength(0)
  await expect(h.ctx.continuumTasks.snapshot(denied)).rejects.toThrow(/authorized task workspace|not acknowledged/)
  const allowed = await h.create('inside')
  allowed.followup(user('The authorized task must still work.'))
  await allowed.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  expect((await h.ctx.continuumTasks.snapshot(allowed))?.entries.map(entry => entry.text)).toEqual(['The authorized task must still work.'])
})

it('blocks a bound Session after explicit correction and gives a fresh Session only active requirements', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const a = await h.create('A')
  append(a, 'Shipping code: OLD-CODE-13')
  const initial = await h.ctx.continuumTasks.snapshot(a)
  const predecessor = initial!.entries[0]!.id
  const b = await h.create('B')
  b.followup(user('Continue shipping.'))
  await b.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  const correctedSource = append(a, 'Shipping code: NEW-CODE-47')
  const before = await h.ctx.continuumTasks.snapshot(a)
  await h.ctx.continuumTasks.supersede(a, { requestId: 'correct-shipping', expectedRevision: before!.revision,
    predecessor, source: { sessionId: a.session.id, eventSeq: correctedSource.seq, blockIndex: 0 } })
  b.followup(user('Continue after the correction.'))
  await b.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  await expect(h.ctx.continuumTasks.read(b)).rejects.toThrow(/retired|fresh Session/)
  const c = await h.create('C')
  c.followup(user('Continue current shipping.'))
  await c.whenIdle()
  expect(h.adapter.requests).toHaveLength(2)
  const latest = h.adapter.requests.at(-1)!.messages.flatMap(message => message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
  expect(latest).toContain('NEW-CODE-47')
  expect(latest).not.toContain('OLD-CODE-13')
  const snapshot = await h.ctx.continuumTasks.snapshot(c)
  expect(snapshot?.entries.find(entry => entry.id === predecessor)).toMatchObject({ status: 'superseded', text: 'Shipping code: OLD-CODE-13' })
})

it('keeps two host-bound tasks separate inside the same durable domain', async () => {
  const { root, workspace } = await locations()
  const one = await runtime(root, workspace)
  const a = await one.create('A')
  append(a, 'Task one secret reference: FIRST-TASK')
  await one.ctx.continuumTasks.snapshot(a)
  await close(one.ctx)
  const two = await runtime(root, workspace, undefined, 'another-task')
  const b = await two.create('B')
  expect(await two.ctx.continuumTasks.snapshot(b)).toBeUndefined()
  b.followup(user('Task two reference: SECOND-TASK'))
  await b.whenIdle()
  expect((await two.ctx.continuumTasks.snapshot(b))?.entries.map(entry => entry.text)).toEqual(['Task two reference: SECOND-TASK'])
  expect(requestText(two.adapter)).not.toContain('FIRST-TASK')
})

it('retains acknowledged input when generation is cancelled and releases task tool and journal on unload', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace, ['hang'])
  const agent = await h.create('cancelled')
  agent.followup(user('Retain this original input through cancellation.'))
  await expect.poll(() => h.adapter.requests.length).toBe(1)
  agent.cancel({ kind: 'user' })
  await agent.whenIdle()
  expect((await h.ctx.continuumTasks.snapshot(agent))?.entries[0]?.text).toBe('Retain this original input through cancellation.')
  expect(h.ctx.tools.get('read_continuum_task')).toBeDefined()
  await h.fiber.dispose()
  expect(h.ctx.tools.get('read_continuum_task')).toBeUndefined()
  expect(h.ctx.get('continuumTasks')).toBeUndefined()
  const replacement = await h.ctx.plugin(ContinuumTasks, h.config)
  const next = await h.create('after-unload')
  expect((await h.ctx.continuumTasks.snapshot(next))?.entries[0]?.text).toBe('Retain this original input through cancellation.')
  await replacement.dispose()
})

it.each(['another-session', 'unclaimed-current-input'] as const)('refuses a prepared request when %s adds requirements', async (kind) => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const a = await h.create('A')
  append(a, 'Initial task requirement.')
  await h.ctx.continuumTasks.snapshot(a)
  const b = await h.create('B')
  let changed = false
  h.ctx.on('llm/stream', async function * (options, next) {
    if (options.sessionId === b.session.id && !changed) {
      changed = true
      const target = kind === 'another-session' ? a : b
      append(target, 'LATE-REQUIREMENT must be observed.')
      await h.ctx.continuumTasks.snapshot(target)
    }
    yield * next()
  }, { prepend: true })
  b.followup(user('Continue the task.'))
  await b.whenIdle()
  expect(changed).toBe(true)
  expect(h.adapter.requests).toHaveLength(0)
  b.followup(user('Read current requirements and continue.'))
  await b.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  expect(requestText(h.adapter)).toContain('LATE-REQUIREMENT')
})

it('refuses a restored Session bound to another task before reading or admitting new task input', async () => {
  const { root, workspace } = await locations()
  const first = await runtime(root, workspace)
  const a = await first.create('original-task-session')
  a.followup(user('Only task one may use ORIGINAL-TASK-SECRET.'))
  await a.whenIdle()
  expect(first.adapter.requests).toHaveLength(1)
  await first.ctx.sessions.flush(a.session)
  await close(first.ctx)

  const second = await runtime(root, workspace, undefined, 'different-task')
  const { agent: restored } = await second.ctx.agentLoop.resume(second.ctx, {
    resumeSessionId: a.session.id, agentOptions: { provider: 'recording', model: 'recording' },
  })
  await expect(second.ctx.continuumTasks.snapshot(restored)).rejects.toThrow('different task authority')
  await expect(second.ctx.continuumTasks.read(restored)).rejects.toThrow('different task authority')
  restored.followup(user('This input must not be admitted to the different task.'))
  await restored.whenIdle()
  expect(second.adapter.requests).toHaveLength(0)
  const b = await second.create('different-task-session')
  expect(await second.ctx.continuumTasks.snapshot(b)).toBeUndefined()
  b.followup(user('Task two begins with its own input.'))
  await b.whenIdle()
  expect(second.adapter.requests).toHaveLength(1)
  expect((await second.ctx.continuumTasks.snapshot(b))?.entries.map(entry => entry.text)).toEqual(['Task two begins with its own input.'])
  expect(requestText(second.adapter)).not.toContain('ORIGINAL-TASK-SECRET')
})

it.each([false, true])('holds correction behind an admitted stream; disabled lease negative control: %s', async (disabledLease) => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const a = await h.create('A')
  append(a, 'Old requirement to retire.')
  const original = await h.ctx.continuumTasks.snapshot(a)
  const source = append(a, 'New replacement requirement.')
  const before = await h.ctx.continuumTasks.snapshot(a)
  const b = await h.create('B')
  const service = h.ctx.continuumTasks
  const claim: unknown = Reflect.get(service, 'claimAuthority')
  if (disabledLease) Reflect.set(service, 'claimAuthority', () => Promise.resolve(() => undefined))
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  h.ctx.on('llm/stream', async function * (options, next) {
    if (options.sessionId === b.session.id) {
      entered.resolve(undefined)
      await release.promise
    }
    yield * next()
  })
  b.followup(user('Continue the current task.'))
  await entered.promise
  let sourceChecked = false
  const read = taskSource.readTaskSource
  vi.spyOn(taskSource, 'readTaskSource').mockImplementation(async (...args) => {
    const result = await read(...args)
    sourceChecked = true
    return result
  })
  const commit = vi.spyOn(TaskJournal.prototype, 'commit')
  let settled = false
  const correction = h.ctx.continuumTasks.supersede(a, {
    requestId: 'leased-correction', expectedRevision: before!.revision + 1, predecessor: original!.entries[0]!.id,
    source: { sessionId: a.session.id, eventSeq: source.seq, blockIndex: 0 },
  }).finally(() => { settled = true })
  void correction.catch(() => undefined)
  try {
    await expect.poll(() => sourceChecked, { timeout: 10_000 }).toBe(true)
    await setImmediate()
    if (disabledLease) await expect.poll(() => settled, { timeout: 10_000 }).toBe(true)
    expect(settled).toBe(disabledLease)
    expect(commit.mock.calls.some(([request]) => request.requestId === 'leased-correction')).toBe(disabledLease)
    expect(h.adapter.requests).toHaveLength(0)
  } finally {
    Reflect.set(service, 'claimAuthority', claim)
    release.resolve(undefined)
  }
  await b.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  await expect(correction).resolves.toMatchObject({ requestId: 'leased-correction', revision: before!.revision + 2 })
  expect(settled).toBe(true)
  b.followup(user('This request must not reuse retired context.'))
  await b.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
})

it.each(['root', 'workspace'] as const)('rejects a relative %s before opening a task journal', async (key) => {
  const { root, workspace } = await locations()
  await expect(runtime(root, workspace, undefined, 'release-task', { [key]: 'relative/path' }))
    .rejects.toThrow('task root and workspace must be absolute')
})

it('releases failed identity initialization so the original principal can reopen the domain', async () => {
  const { root, workspace } = await locations()
  const first = await runtime(root, workspace)
  const a = await first.create('A')
  append(a, 'Original principal input.')
  await first.ctx.continuumTasks.snapshot(a)
  await close(first.ctx)
  await expect(runtime(root, workspace, undefined, 'release-task', { principalId: 'different-owner' })).rejects.toThrow(/identity/)
  const valid = await runtime(root, workspace)
  const b = await valid.create('B')
  expect((await valid.ctx.continuumTasks.snapshot(b))?.entries[0]?.text).toBe('Original principal input.')
})

it('leaves unowned Session events and non-text input outside task text admission', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const unowned = h.ctx.sessions.create(SessionId('unowned'))
  unowned.append('user/message', user('Unowned event.'), { surfaceOp: 'append' })
  const owned = await h.ctx.agents.create({ sessionId: SessionId('A'),
    agentOptions: { provider: 'recording', model: 'recording' }, meta: { cwd: workspace } })
  const a = owned.agent
  a.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'reasoning', text: 'Not a plain text block.' }] }), { surfaceOp: 'append' })
  expect(await h.ctx.continuumTasks.snapshot(a)).toBeUndefined()
  await expect(h.ctx.continuumTasks.read(a)).rejects.toThrow('no saved inputs')
  expect((await h.ctx.systemPrompt.assemble()).contexts.some(context => context.name === 'continuum:task')).toBe(false)
  await owned.dispose()
  await expect(h.ctx.continuumTasks.snapshot(a)).rejects.toThrow('authorized task workspace')
})

it('keeps a delegated child prompt out of task requirements so the parent revision stays current', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const parent = await h.create('A')
  parent.followup(user('Human task requirement.'))
  await parent.whenIdle()
  const before = await h.ctx.continuumTasks.snapshot(parent)
  const child = await h.ctx.agents.create({ sessionId: SessionId('A-child'),
    agentOptions: { provider: 'recording', model: 'recording' },
    meta: { cwd: workspace, parentSession: parent.session.id, origin: 'subagent', delegationDepth: 1 } })
  child.agent.followup(user('Parent model delegation prompt.'))
  await child.agent.whenIdle()
  const after = await h.ctx.continuumTasks.snapshot(parent)
  expect(after?.revision).toBe(before?.revision)
  expect(after?.entries.map(entry => entry.text)).toEqual(['Human task requirement.'])
  expect(child.agent.session.snapshotEvents().filter(event => event.type === 'turn/end'))
    .toMatchObject([{ data: { reason: { kind: 'completed' } } }])
  expect(h.adapter.requests).toHaveLength(2)
  await child.dispose()
})

it('refuses mismatched source readback and keeps the failed Agent from acknowledging later input', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const a = await h.create('A')
  const read = taskSource.readTaskSource
  vi.spyOn(taskSource, 'readTaskSource').mockImplementationOnce(async (...args) => ({ ...await read(...args), text: 'wrong readback' }))
  append(a, 'Original input.')
  await expect(h.ctx.continuumTasks.snapshot(a)).rejects.toThrow('not acknowledged')
  append(a, 'A later input cannot hide the original failure.')
  await expect(h.ctx.continuumTasks.snapshot(a)).rejects.toThrow('not acknowledged')
  const b = await h.create('B')
  expect(await h.ctx.continuumTasks.snapshot(b)).toBeUndefined()
})

it('requires an Agent for tool reads and preserves page arguments and call presentation', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const result = await h.ctx.tools.execute({ name: 'read_continuum_task', callId: ToolCallId('unbound'), arguments: {},
    signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result)).toContain('requires a live Agent')
  const a = await h.create('A')
  append(a, 'Exact original page content.')
  const snapshot = await h.ctx.continuumTasks.snapshot(a)
  const args = { entry_index: 0, text_offset: 1, revision: snapshot!.revision }
  const page = await h.ctx.tools.execute({ name: 'read_continuum_task', callId: ToolCallId('page'), arguments: args,
    agent: a, signal: new AbortController().signal })
  expect(page.isError).toBe(false)
  expect(JSON.stringify(page)).toContain('xact original page content.')
  expect(h.ctx.tools.get('read_continuum_task')?.presentCall?.(args)).toMatchObject({ kind: 'read', rawInput: args })
})

it('rejects a second durable task binding instead of replacing the original identity', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const a = await h.create('A')
  append(a, 'Task input.')
  await h.ctx.continuumTasks.snapshot(a)
  const binding = a.session.snapshotEvents().find(event => event.type === 'continuum/task-binding')!
  expect(binding.type).toBe('continuum/task-binding')
  if (binding.type !== 'continuum/task-binding') throw new Error('missing durable task binding')
  expect(() => taskBindingProjection.apply(binding.data, binding)).toThrow('cannot replace')
})

it('rejects use of an unloaded service and cancels an active stream before releasing its journal', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace, ['hang'])
  const a = await h.create('A')
  a.followup(user('An interrupted stream must release the domain.'))
  await expect.poll(() => h.adapter.requests.length).toBe(1)
  const service = h.ctx.continuumTasks
  await h.fiber.dispose()
  await a.whenIdle()
  await expect(service.snapshot(a)).rejects.toThrow('service is closed')
  const reopened = await h.ctx.plugin(ContinuumTasks, h.config)
  const b = await h.create('B')
  expect((await h.ctx.continuumTasks.snapshot(b))?.entries[0]?.text).toBe('An interrupted stream must release the domain.')
  await reopened.dispose()
})

it('leaves standalone model requests alone and does not invent task input for an empty attached Session', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const a = await h.create('empty')
  for (const sessionId of [undefined, SessionId('not-mounted'), a.session.id]) {
    for await (const _chunk of h.ctx.llm.stream({ provider: 'recording', model: 'recording', messages: [],
      ...sessionId === undefined ? {} : { sessionId } })) { /* Drain the public stream. */ }
  }
  expect(h.adapter.requests).toHaveLength(3)
  expect(await h.ctx.continuumTasks.snapshot(a)).toBeUndefined()
})

it('does not duplicate a source entry when its committed event notification is delivered again', async () => {
  const { root, workspace } = await locations()
  const h = await runtime(root, workspace)
  const a = await h.create('A')
  const event = append(a, 'One durable input, one task entry.')
  const original = await h.ctx.continuumTasks.snapshot(a)
  h.ctx.emit('session/event', a.session, event)
  expect(await h.ctx.continuumTasks.snapshot(a)).toEqual(original)
})
