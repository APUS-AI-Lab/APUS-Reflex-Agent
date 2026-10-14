import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ShellExecRequest } from '@deepseek-ai/dsh-shell'
import { afterEach, expect, it, vi } from 'vitest'
import Jev, { type JevRequest } from '../../apus-dsh-jev-plugin/src/index.ts'
import System3 from '../src/index.ts'
import { discoveryCommand, mentionedPaths, parseWorkspaceFacts, prefetchCandidates, prefetchText, searchTerms, shellWord,
  system3PrefetchDecision, validateSystem3Prefetch, type System3PrefetchConfig } from '../src/prefetch.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

const CONFIG: System3PrefetchConfig = { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 2000, sessionDataClasses: ['workspace'],
  maxItemBytes: 200, maxTotalBytes: 400, maxSourceFiles: 30, maxSearchTerms: 3, commandTimeoutMs: 1000 }
const noul = (value: number) => ({ type: 'noul' as const, noul: value })

it('quotes shell words and keeps only relative paths the input names', () => {
  expect(shellWord('it\'s')).toBe('\'it\'\\\'\'s\'')
  expect(mentionedPaths('Read src/orders.ts and README.md, not /etc/passwd or ../secret.txt; version 3.7.2 is fine.'))
    .toEqual(['src/orders.ts', 'README.md'])
  expect(searchTerms('How many items can one order have at most? Check MAX_ITEMS please.', 2)).toEqual(['MAX_ITEMS', 'items'])
})

it('turns discovery output into workspace facts and candidates in model order', () => {
  expect(discoveryCommand(['src/a.ts'])).toContain('if [ -f \'src/a.ts\' ]')
  const facts = parseWorkspaceFacts('git=1\nfiles=  5\nreadme=README.md\nmanifest=package.json\nmentioned=src/a.ts\n')
  expect(facts).toEqual({ git: true, trackedFiles: 5, readme: 'README.md', manifest: 'package.json', mentioned: ['src/a.ts'] })
  const ids = prefetchCandidates('Where is orderTotal used in src/a.ts?', facts, CONFIG).map(candidate => candidate.id)
  expect(ids).toEqual(['changes', 'files', 'readme', 'manifest', 'file:src/a.ts', 'search', 'sources'])
  expect(prefetchCandidates('hi', { git: false, trackedFiles: 0, mentioned: [] }, CONFIG)).toEqual([])
  expect(prefetchCandidates('hi', { ...facts, trackedFiles: 31 }, CONFIG).map(candidate => candidate.id)).not.toContain('sources')
})

it('asks one question per candidate and prefetches when any is needed', () => {
  const candidates = prefetchCandidates('hi', { git: true, trackedFiles: 99, mentioned: [] }, CONFIG)
  const input = { input: 'What changed?', candidates }
  expect(Object.keys(system3PrefetchDecision.questions(input))).toEqual(['p0', 'p1'])
  expect(system3PrefetchDecision.questions(input).p0?.instructions).toContain('用户输入：「What changed?」')
  const decide = (answers: Record<string, ReturnType<typeof noul>>) =>
    system3PrefetchDecision.decide({ model: 'jev', answers }, { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 1 }, input)
  expect(decide({ p0: noul(0.9), p1: noul(0.1) })).toBe('prefetch')
  expect(decide({ p0: noul(0.1), p1: noul(0.2) })).toBe('none')
  expect(decide({ p0: noul(0.4), p1: noul(0.1) })).toBe('unsure')
})

it('renders outputs within the item and total limits and names what it leaves out', () => {
  const candidate = (id: string) => ({ id, description: id, label: `cat ${id}`, command: '' })
  const rendered = prefetchText([{ candidate: candidate('a'), output: 'x'.repeat(250) }, { candidate: candidate('b'), output: '' },
    { candidate: candidate('c'), output: 'y'.repeat(150) }], CONFIG)
  expect(rendered?.items).toEqual(['a', 'b'])
  expect(rendered?.text).toContain('[输出超过 200 字节，已截断]')
  expect(rendered?.text).toContain('$ cat b\n[无输出]')
  expect(rendered?.text).toContain('[超过总大小上限未附上：cat c]')
  expect(prefetchText([], CONFIG)).toBeUndefined()
})

it('rejects configurations that cannot work', () => {
  expect(() => { validateSystem3Prefetch({ ...CONFIG, maxTotalBytes: 0 }) }).toThrow('prefetch maxTotalBytes must be a positive integer')
  expect(() => { validateSystem3Prefetch({ ...CONFIG, yes: 0.2 }) }).toThrow('thresholds must satisfy 0 <= no < yes <= 1')
})

/** A read-only workspace served by a fake shell: discovery reports git with a README, and each command echoes its file. */
async function setup(answers: (request: JevRequest) => Record<string, ReturnType<typeof noul>>, config: Partial<System3PrefetchConfig> = {},
  shell = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const commands: ShellExecRequest[] = []
  if (shell) {
    ctx.provide('shell', {
      resolve: (request: ShellExecRequest) => request,
      execute: (spec: ShellExecRequest) => {
        commands.push(spec)
        const text = spec.command.includes('rev-parse') ? 'git=1\nfiles=40\nreadme=README.md\n'
          : spec.command.includes('README.md') ? 'Orders above 2500 EUR need approval.\n' : 'other output\n'
        return Promise.resolve({ result: () => Promise.resolve({ exitCode: 0, signal: null, timedOut: false, aborted: false,
          timeoutMs: 1000,
          stdout: { text, truncated: false }, stderr: { text: '', truncated: false } }) })
      },
    })
  }
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async request => ({ kind: 'ok', spec: ctx.jev.resolve(request),
    response: { model: 'jev-test', answers: answers(request) } }))
  const adapter = new MockAdapter([textResponse('Above 2500 EUR.')])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  await ctx.plugin(System3, { privacyMode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'],
    jevExecutionDomain: 'network', prefetch: { ...CONFIG, ...config, sessionDataClasses: ['workspace'] } })
  const agent = await ctx.agentLoop.create(SessionId('prefetch'), { provider: 'mock', model: 'mock' }, { cwd: '/workspace' })
  const say = async (text: string): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const shown = (request: GenerateOptions | undefined): string => (request?.messages ?? [])
    .filter(message => message.role === 'user' && message.source?.kind === 'system3-prefetch')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
  return { ctx, agent, adapter, decide, commands, say, shown }
}

/** Mark the README candidate needed and everything else not needed. */
const readmeOnly = (request: JevRequest) => Object.fromEntries(Object.entries(request.questions).map(([key, question]) =>
  [key, noul(question.instructions?.includes('README.md') === true ? 0.9 : 0.05)]))

it('runs every candidate in the read-only sandbox and shows the needed outputs to the model in the same step', async () => {
  const h = await setup(readmeOnly)
  await h.say('Above which amount does an order need approval?')
  expect(h.commands.every(command => command.sandboxPolicy?.mode === 'read-only' && command.workdir === '/workspace')).toBe(true)
  expect(h.commands.length).toBeGreaterThan(2)
  const shown = h.shown(h.adapter.requests[0])
  expect(shown).toContain('[System3 预取]')
  expect(shown).toContain('$ cat README.md\nOrders above 2500 EUR need approval.')
  expect(shown).not.toContain('other output')
  const source = h.agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && event.data.source.kind === 'system3-prefetch'
    ? [event.data.source] : [])
  expect(source).toEqual([{ kind: 'system3-prefetch', items: ['readme'] }])
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'system3/judgement' && event.data.decision === 'prefetch')).toBe(true)
})

it('leaves the step unchanged when nothing is needed, in shadow mode, without a shell, and on a Jev failure', async () => {
  const none = await setup(() => ({}))
  none.decide.mockImplementation(async request => ({ kind: 'ok', spec: none.ctx.jev.resolve(request), response: { model: 'jev-test',
    answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, noul(0.01)])) } }))
  await none.say('Say hello.')
  expect(none.shown(none.adapter.requests[0])).toBe('')

  const shadow = await setup(readmeOnly, { mode: 'shadow' })
  await shadow.say('Above which amount does an order need approval?')
  expect(shadow.shown(shadow.adapter.requests[0])).toBe('')
  expect(shadow.agent.session.snapshotEvents().some(event => event.type === 'system3/judgement' && event.data.mode === 'shadow')).toBe(true)

  const shellless = await setup(readmeOnly, {}, false)
  await shellless.say('Above which amount does an order need approval?')
  expect(shellless.decide).not.toHaveBeenCalled()
  expect(shellless.adapter.requests).toHaveLength(1)

  const failing = await setup(readmeOnly)
  failing.decide.mockResolvedValue({ kind: 'unknown', failure: { code: 'transport', message: 'down' } } as never)
  await failing.say('Above which amount does an order need approval?')
  expect(failing.shown(failing.adapter.requests[0])).toBe('')
})
