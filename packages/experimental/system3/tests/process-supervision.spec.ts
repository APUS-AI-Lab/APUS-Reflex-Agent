import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type ResolvedSubagentStartRequest, type SubagentResult } from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { installSystem3ProcessSupervision, supervisionAdvice, type System3ProcessSupervisionConfig } from '../src/process-supervision.ts'
import { system3RuntimeProjection } from '../src/runtime-projection.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const CONFIG: System3ProcessSupervisionConfig = {
  mode: 'advise', repeatedError: 2, failedAttempts: 3, stalledSteps: 6, delegateFailures: 2,
  editTools: ['edit'], delegationTools: ['delegate'], shellTools: ['bash'], progressTools: ['search'],
  verifyPattern: '\\b(npm|pnpm) test\\b', failurePattern: '\\b[1-9][0-9]* failed\\b|No module named|No such file or directory|exit code:? [1-9]',
}

/** Shell results keyed by command: an exit code, or an exit code with output; unknown commands succeed with exit code 0. */
type Shell = Readonly<Record<string, number | { readonly exitCode: number; readonly output: string }>>

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], config: Partial<System3ProcessSupervisionConfig> = {},
  shell: Shell = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime, {})
  ctx.sessionProjections.register(system3RuntimeProjection)
  installSystem3ProcessSupervision(ctx, { ...CONFIG, ...config })
  const adapter = new MockAdapter(script)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  let runs = 0
  ctx.tools.register(defineTool({
    name: 'bash', description: 'Run a command.', parameters: { command: { type: 'string', required: true } },
    output: { schema: { type: 'object', properties: { exitCode: { type: 'integer', required: true }, output: { type: 'string', required: true } }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: `${value.output}\nexit ${String(value.exitCode)}` }] },
    execute: (args) => {
      const planned = shell[args.command] ?? 0
      runs += 1
      return Promise.resolve(typeof planned === 'number' ? { exitCode: planned, output: `run ${String(runs)}: ${args.command}` } : planned)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'list', description: 'List names.', parameters: {},
    output: { schema: { type: 'array', items: { type: 'string' } }, render: (_args, value) => [{ type: 'text', text: value.join('\n') }] },
    execute: () => Promise.resolve(['a', 'b']),
  }))
  ctx.tools.register(defineTool({
    name: 'probe', description: 'Report a status.', parameters: {},
    output: { schema: { type: 'object', properties: { exitCode: { type: 'string', required: true } }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.exitCode }] },
    execute: () => Promise.resolve({ exitCode: 'unknown' }),
  }))
  for (const name of ['edit', 'delegate', 'read', 'search']) {
    ctx.tools.register(defineTool({
      name, description: `${name} tool.`, parameters: { fail: { type: 'boolean' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: args => args.fail === true ? Promise.reject(new Error(`${name} failed`)) : Promise.resolve(`${name} ok`),
    }))
  }
  const agent = await ctx.agentLoop.create(SessionId('supervised'), { provider: 'mock', model: 'mock' })
  const ask = async (text: string): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const notices = () => agent.session.snapshotEvents().filter(event => event.type === 'system3/process-notice').map(event => event.data)
  const advised = (request: GenerateOptions | undefined): string[] => (request?.messages ?? [])
    .filter(message => message.role === 'user' && message.source?.kind === 'system3-supervision')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
  return { ctx, agent, adapter, ask, notices, advised }
}

const bash = (id: string, command: string) => toolCallResponse(id, 'bash', { command })
const call = (id: string, name: string, fail = false) => toolCallResponse(id, name, fail ? { fail } : {})

it('advises once per repeated failure and per failure count, and shows the turn findings', async () => {
  const h = await setup([bash('c1', 'npm test'), bash('c2', 'npm test'), bash('c3', 'npm test'), textResponse('stuck')], {}, { 'npm test': 1 })
  await h.ask('fix the tests')
  expect(h.notices()).toEqual([
    { version: 1, rule: 'repeated-error', subject: 'bash', count: 2, advised: true },
    { version: 1, rule: 'failed-attempts', count: 3, advised: true },
  ])
  expect(h.advised(h.adapter.requests[1])).toEqual([])
  expect(h.advised(h.adapter.requests[2])).toEqual([supervisionAdvice('repeated-error', 'bash', 2)])
  expect(h.advised(h.adapter.requests[3])).toEqual([supervisionAdvice('repeated-error', 'bash', 2), supervisionAdvice('failed-attempts', undefined, 3)])
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.notices).toEqual([
    { rule: 'repeated-error', subject: 'bash', count: 2, advised: true },
    { rule: 'failed-attempts', subject: null, count: 3, advised: true },
  ])
})

it('counts a command list that exits 0 after a failed command as a failure, as a real model ran it', async () => {
  // Recorded from local acceptance: the model appended an exit-code echo, so the bash tool reported exit 0.
  const command = 'cat /nonexistent/system3-check.txt; echo "[exit code: $?]"'
  const output = '[exit code: 1]\n[stderr]\ncat: /nonexistent/system3-check.txt: No such file or directory\n'
  const h = await setup([bash('c1', command), bash('c2', command), bash('c3', command), textResponse('still missing')], {},
    { [command]: { exitCode: 0, output } })
  await h.ask('read the file')
  expect(h.notices()).toEqual([
    { version: 1, rule: 'repeated-error', subject: 'bash', count: 2, advised: true },
    { version: 1, rule: 'failed-attempts', count: 3, advised: true },
  ])
})

it('keeps judging single commands by exit code and successful command lists as successes', async () => {
  const h = await setup([bash('a', 'grep -n missing notes.txt | head -3'), bash('b', 'ls; pwd'), bash('c', 'echo "No such file or directory"'),
    textResponse('done')], { failedAttempts: 1, stalledSteps: 9 },
  { 'grep -n missing notes.txt | head -3': { exitCode: 0, output: '3: missing values are skipped' },
    'ls; pwd': { exitCode: 0, output: 'notes.txt\n/work' },
    'echo "No such file or directory"': { exitCode: 0, output: 'No such file or directory' } })
  await h.ask('look around')
  expect(h.notices()).toEqual([])
})

it('accepts a piped check as evidence only when its output shows no failure', async () => {
  const h = await setup([call('e1', 'edit'), bash('v1', 'pnpm test 2>&1 | tail -5'), textResponse('done'),
    bash('v2', 'npm test 2>&1 | tail -5'), textResponse('verified')], {},
  { 'pnpm test 2>&1 | tail -5': { exitCode: 0, output: '/usr/bin/python3: No module named pytest' },
    'npm test 2>&1 | tail -5': { exitCode: 0, output: '8 passed in 0.01s' } })
  await h.ask('change the parser')
  expect(h.notices()).toEqual([{ version: 1, rule: 'missing-evidence', count: 1, advised: true }])
  expect(h.adapter.requests).toHaveLength(5)
})

it('counts a successful progress tool, such as a search, as progress', async () => {
  const h = await setup([call('r1', 'read'), call('s1', 'search'), call('r2', 'read'), call('r3', 'read'), textResponse('found')],
    { stalledSteps: 3 })
  await h.ask('research it')
  expect(h.notices()).toEqual([])
})

it('accepts six parallel information reads without a stall notice or extra model turn', async () => {
  const reads = Array.from({ length: 6 }, (_unused, index) =>
    call(`read-${String(index)}`, 'read').filter(chunk => chunk.type !== 'finish')
      .map(chunk => 'index' in chunk ? { ...chunk, index } : chunk)).flat()
  const h = await setup([reads, textResponse('reconciled')], { progressTools: ['search', 'read'] })
  await h.ask('Read six sources in parallel and reconcile the amounts without modifying files.')
  expect(h.notices()).toEqual([])
  expect(h.adapter.requests).toHaveLength(2)
  expect(h.adapter.requests.flatMap(h.advised)).toEqual([])
})

it('asks for verification once after changes, and accepts a passing check as evidence', async () => {
  const h = await setup([call('e1', 'edit'), textResponse('done'), bash('v1', 'pnpm test'), textResponse('verified'),
    call('e2', 'edit'), textResponse('done'), textResponse('cannot verify')])
  await h.ask('change the parser')
  expect(h.notices()).toEqual([{ version: 1, rule: 'missing-evidence', count: 1, advised: true }])
  expect(h.advised(h.adapter.requests[2])).toEqual([supervisionAdvice('missing-evidence', undefined, 1)])
  expect(h.adapter.requests).toHaveLength(4)
  await h.ask('change it again')
  expect(h.notices()).toHaveLength(2)
  expect(h.adapter.requests).toHaveLength(7)
  // A new turn clears the previous turn's findings from the view before its own finding arrives.
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.notices).toEqual([
    { rule: 'missing-evidence', subject: null, count: 1, advised: true }])
})

it('records without advising in observe mode, counts stalled tool calls, and ignores failed changes', async () => {
  const h = await setup([call('r1', 'read'), call('d1', 'delegate', true), call('e1', 'edit'), textResponse('done')],
    { mode: 'observe', stalledSteps: 2, failedAttempts: 5 })
  await h.ask('look around')
  expect(h.notices()).toEqual([
    { version: 1, rule: 'no-progress', count: 2, advised: false },
    { version: 1, rule: 'missing-evidence', count: 1, advised: false },
  ])
  expect(h.adapter.requests.flatMap(h.advised)).toEqual([])
  expect(h.adapter.requests).toHaveLength(4)
})

it('treats a successful delegation as a change and a new person message as a fresh start', async () => {
  const h = await setup([call('d1', 'delegate'), bash('v1', 'npm test'), textResponse('done'),
    call('f1', 'read', true), textResponse('first'), call('f2', 'read', true), textResponse('second')])
  await h.ask('delegate it')
  await h.ask('one')
  await h.ask('two')
  expect(h.notices()).toEqual([])
})

it('reads exit codes only from object results with a numeric code, and fails a rejected shell call', async () => {
  const h = await setup([call('l1', 'list'), call('p1', 'probe'), call('r1', 'read'), call('r2', 'read', true), textResponse('done'), textResponse('hello')],
    { shellTools: ['bash', 'list', 'probe', 'read'], stalledSteps: 4, failedAttempts: 1 })
  await h.ask('inspect')
  await h.ask('just answer')
  expect(h.notices()).toEqual([
    { version: 1, rule: 'failed-attempts', count: 1, advised: true },
    { version: 1, rule: 'no-progress', count: 4, advised: true },
  ])
  h.ctx.emit('subagent/activity', { runId: 'unscoped' as never, provider: 'codex', id: SessionId('x'), kind: 'command', phase: 'completed', outcome: 'failed' })
  expect(h.notices()).toHaveLength(2)
})

/** A minimal top-level execution for listener-level edge cases. */
function exec(agent: Agent | undefined, parent?: string): ToolExecution {
  return { name: 'read', agent, ...parent === undefined ? {} : { parent } } as never
}
const failure: ToolExecutionResult = { content: [], isError: true, error: { message: 'boom' } } as never

it('skips executions without an Agent or with a parent, and keeps a downstream block with its advice', async () => {
  const h = await setup([], { repeatedError: 1 })
  const next = () => Promise.resolve({ kind: 'block' as const, feedback: [{ type: 'text' as const, text: 'denied' }] })
  expect(await h.ctx.waterfall('tools/post-execute', exec(undefined), failure, next)).toEqual(await next())
  expect(await h.ctx.waterfall('tools/post-execute', exec(h.agent, 'outer'), failure, next)).toEqual(await next())
  const decision = await h.ctx.waterfall('tools/post-execute', exec(h.agent), failure, next)
  expect(decision).toMatchObject({ kind: 'block', feedback: [{ type: 'text', text: 'denied' }] })
  expect(decision.additionalContexts?.map(message => message.source)).toEqual([{ kind: 'system3-supervision', rule: 'repeated-error' }])
  expect(h.notices()).toEqual([{ version: 1, rule: 'repeated-error', subject: 'read', count: 1, advised: true }])
})

it('records repeated command failures inside a delegated run once', async () => {
  const h = await setup([])
  const settled = Promise.withResolvers<SubagentResult>()
  let report: ResolvedSubagentStartRequest['reportActivity'] = () => {}
  h.ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start(request) {
      report = request.reportActivity
      return Promise.resolve({ id: SessionId('codex-child'), localAgent: undefined, result: settled.promise, async dispose() {} })
    },
  })
  const run = await h.ctx.subagents.start('codex', { prompt: [{ type: 'text', text: 'task' }], parent: h.agent, signal: new AbortController().signal })
  report({ kind: 'command', phase: 'completed' })
  for (let index = 0; index < 3; index++) report({ kind: 'command', phase: 'completed', outcome: 'failed' })
  expect(h.notices()).toEqual([{ version: 1, rule: 'delegate-failures', subject: 'codex', count: 2, advised: false }])
  settled.resolve({ output: [], stopReason: 'completed' })
  await run.result
})

it('rejects invalid thresholds and patterns at load', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  expect(() => { installSystem3ProcessSupervision(ctx, { ...CONFIG, stalledSteps: 0 }) }).toThrow('processSupervision stalledSteps must be a positive integer')
  expect(() => { installSystem3ProcessSupervision(ctx, { ...CONFIG, verifyPattern: '(' }) }).toThrow('processSupervision verifyPattern is not a valid regular expression: (')
  expect(() => { installSystem3ProcessSupervision(ctx, { ...CONFIG, failurePattern: '[' }) }).toThrow('processSupervision failurePattern is not a valid regular expression: [')
})

it('words each advice for the main model', () => {
  expect(supervisionAdvice('no-progress', undefined, 6)).toBe('[System3 过程监督] 最近 6 次工具调用没有成功的修改、委派、验证或信息读取。请重新评估方法、换一种策略，或向用户说明卡在哪里。')
  expect(supervisionAdvice('repeated-error', undefined, 2)).toContain('`` 已经第 2 次')
})
