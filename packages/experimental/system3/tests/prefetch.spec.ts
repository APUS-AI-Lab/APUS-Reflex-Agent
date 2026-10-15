import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ShellExecRequest } from '@deepseek-ai/dsh-shell'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type {} from '@deepseek-ai/dsh-fs'
import { afterEach, expect, it, vi } from 'vitest'
import Jev, { type JevRequest } from '../../apus-dsh-jev-plugin/src/index.ts'
import System3 from '../src/index.ts'
import { discoveryCommand, hitFiles, mentionedPaths, parseWorkspaceFacts, prefetchCandidates, prefetchText, searchTerms, shellWord,
  withFileReads,
  system3PrefetchDecision, validateSystem3Prefetch, type System3PrefetchConfig } from '../src/prefetch.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

const CONFIG: System3PrefetchConfig = { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 2000, sessionDataClasses: ['workspace'],
  maxItemBytes: 200, maxTotalBytes: 400, maxSourceFiles: 30, maxSearchTerms: 3, maxHitFiles: 2, commandTimeoutMs: 1000 }
const noul = (value: number) => ({ type: 'noul' as const, noul: value })

it('quotes shell words and keeps only relative paths the input names', () => {
  expect(shellWord('it\'s')).toBe('\'it\'\\\'\'s\'')
  expect(mentionedPaths('Read src/orders.ts and README.md, not /etc/passwd or ../secret.txt; version 3.7.2 is fine.'))
    .toEqual(['src/orders.ts', 'README.md'])
  expect(searchTerms('How many items can one order have at most? Check MAX_ITEMS please.', 3)).toEqual(['MAX_ITEMS', 'order', 'item'])
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

it('offers a folder that is not a Git repository its file list, search and files, and finds Chinese words', () => {
  expect(searchTerms('九月我在餐饮上一共花了多少钱？', 4)).toEqual(['九月', '餐饮'])
  expect(searchTerms('我的护照什么时候过期？', 4)).toEqual(['护照', '过期'])
  const folder = prefetchCandidates('九月我在餐饮上一共花了多少钱？', { git: false, trackedFiles: 9, mentioned: [] }, CONFIG)
  expect(folder.map(candidate => candidate.id)).toEqual(['files', 'search', 'sources'])
  expect(folder.every(candidate => !candidate.command.includes('git '))).toBe(true)
  expect(folder.find(candidate => candidate.id === 'search')?.command).toContain('-e \'餐饮\'')
  expect(parseWorkspaceFacts('files=  9\n')).toEqual({ git: false, trackedFiles: 9, mentioned: [] })
  expect(discoveryCommand([])).toContain('else echo files=$(find . -mindepth 1')
})

it('offers the files with the most search hits for a complete read, and the listed files for a small folder', () => {
  expect(hitFiles('src/a.ts:1:orders\nsrc/b.ts:2:orders\nsrc/b.ts:9:orders\nsrc/c.ts:4:listOrders(DEFAULT_SIZE)\nREADME.md:3:default orders\nnot a hit\n',
    ['default', 'orders'], 2, new Set(['README.md']))).toEqual([{ path: 'src/c.ts', terms: ['default', 'orders'] },
    { path: 'src/b.ts', terms: ['orders'] }])
  expect(searchTerms('Customers should now get refunds; update the tests', 4)).toEqual(['Customer', 'refund', 'test'])
  const base = prefetchCandidates('Where is orderTotal used?', { git: true, trackedFiles: 3, readme: 'README.md', mentioned: [] }, CONFIG)
  const full = withFileReads(base, 'README.md\nsrc/a.ts\nsrc/b.ts\n', 'src/b.ts:4:orderTotal\nREADME.md:1:orderTotal\n', ['orderTotal'], CONFIG)
  expect(full.find(candidate => candidate.id === 'sources')?.files).toEqual(['README.md', 'src/a.ts', 'src/b.ts'])
  expect(full.find(candidate => candidate.id === 'readme')).toMatchObject({ files: ['README.md'],
    description: '项目说明文件 README.md（其中包含 orderTotal）' })
  expect(full.filter(candidate => candidate.id.startsWith('hit:')).map(candidate => [candidate.files, candidate.description]))
    .toEqual([[['src/b.ts'], '文件 src/b.ts 的完整内容（其中包含 orderTotal）']])
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

it('renders outputs within the item and total limits, names what it leaves out, and records reads of whole files only', () => {
  const candidate = (id: string) => ({ id, description: id, label: `cat ${id}`, command: '' })
  const observed: string[] = []
  const part = (label: string, text: string) => ({ label, text, observe: () => { observed.push(label) } })
  const rendered = prefetchText([{ candidate: candidate('a'), parts: [part('cat a', 'x'.repeat(250))] },
    { candidate: candidate('b'), parts: [part('cat b', '')] }, { candidate: candidate('c'), parts: [part('cat c', 'y'.repeat(150))] }], CONFIG)
  expect(rendered?.items).toEqual(['a', 'b'])
  for (const observe of rendered?.observe ?? []) observe()
  expect(observed).toEqual(['cat b'])
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
  shell = true, reflexEnabled = true, workspace = '/workspace') {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (workspace !== '/workspace') await ctx.plugin(LocalFileSystem, { cwd: workspace })
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
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'jev-test', enabled: reflexEnabled })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async request => ({ kind: 'ok', spec: ctx.jev.resolve(request),
    response: { model: 'jev-test', answers: answers(request) } }))
  const adapter = new MockAdapter([textResponse('Above 2500 EUR.'), textResponse('Above 2500 EUR.')])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  await ctx.plugin(System3, { privacyMode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'],
    jevExecutionDomain: 'network', prefetch: { ...CONFIG, ...config, sessionDataClasses: ['workspace'] } })
  const agent = await ctx.agentLoop.create(SessionId('prefetch'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
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

it('reads offered files through the filesystem and records a read for the asking Agent only of a file shown whole', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prefetch-fs-'))
  try {
    writeFileSync(join(root, 'README.md'), 'Orders above 2500 EUR need approval.\n')
    const h = await setup(readmeOnly, {}, true, true, root)
    const observed: Array<{ kind: string; actor: object | undefined }> = []
    h.ctx.on('fs/observed', (_target, observation, actor) => { observed.push({ kind: observation.kind, actor }) })
    await h.say('Above which amount does an order need approval?')
    expect(h.shown(h.adapter.requests[0])).toContain('$ cat README.md\nOrders above 2500 EUR need approval.')
    expect(observed).toEqual([{ kind: 'present', actor: { agent: h.agent } }])

    writeFileSync(join(root, 'README.md'), 'z'.repeat(300))
    observed.length = 0
    await h.say('Above which amount does an order need approval?')
    expect(h.shown(h.adapter.requests[1])).toContain('[输出超过 200 字节，已截断]')
    expect(observed).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('leaves the step unchanged when nothing is needed, in shadow mode, without a shell, with Reflex turned off, and on a Jev failure', async () => {
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

  const off = await setup(readmeOnly, {}, true, false)
  await off.say('Above which amount does an order need approval?')
  expect(off.shown(off.adapter.requests[0])).toBe('')
  expect(off.adapter.requests).toHaveLength(1)
  expect(off.agent.session.snapshotEvents().find(event => event.type === 'system3/judgement')?.data)
    .toMatchObject({ decision: 'prefetch', reason: 'provider-unavailable', applied: false, request: null })

  const failing = await setup(readmeOnly)
  failing.decide.mockResolvedValue({ kind: 'unknown', failure: { code: 'transport', message: 'down' } } as never)
  await failing.say('Above which amount does an order need approval?')
  expect(failing.shown(failing.adapter.requests[0])).toBe('')
})
