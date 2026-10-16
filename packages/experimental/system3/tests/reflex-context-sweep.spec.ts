import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectReflexText, reflexContextMessageProjection } from '@deepseek-ai/dsh-compaction/reflex-context-projection'
import type {} from '@deepseek-ai/dsh-compaction'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import type {} from '../src/reflex-context-state.ts'
import { installReflexContext, validateReflexContextConfig, type ReflexContextConfig } from '../src/reflex-context.ts'
import { sweepDecision, sweepPassages, type ReflexContextSweepConfig } from '../src/reflex-context-sweep.ts'
import { isGuardedFragment, reflexNoiseKind } from '../src/reflex-context-noise.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const sweep: ReflexContextSweepConfig = { mode: 'active', yes: 0.9, no: 0.05, deadlineMs: 1000, fragmentChars: 80, maxFragments: 50, fragmentsPerRequest: 5, concurrency: 2 }
const config: ReflexContextConfig = { mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 1000, sessionDataClasses: ['public'], maxRequestChars: 4000,
  maxCandidates: 16, maxFragmentChars: 1000, protectRecentMessages: 1, maxRestoredChars: 5000, maxSearchResults: 5, compactionSweep: sweep }

const INSTALL = 'Collecting requests==2.31.0\n  Downloading requests-2.31.0-py3-none-any.whl (62 kB)\nInstalling collected packages: requests\nSuccessfully installed requests-2.31.0\n'
const UNRELATED = 'Weather in Lisbon: sunny, 23 degrees, light wind from the north-west.\n'
const NEEDED = 'src/parse.py:18: return dateutil.parser.parse(text, fuzzy=True)\n'
const FAILURE = 'tests/test_parse.py:41: Failed: DID NOT RAISE ValueError\n'

async function setup(overrides: Partial<ReflexContextSweepConfig> | false = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'test' })
  new TokenMeter(ctx)
  await ctx.plugin({ name: 'reflex-sweep-test-owner', inject: ['sessions', 'sessionProjections', 'tools', 'tokenMeter', 'jev'], apply(scope) {
    installReflexContext(scope, { ...config, compactionSweep: overrides === false ? false : { ...sweep, ...overrides } },
      { policy: { mode: 'local-only' }, options: { routeId: 'reflex', executionDomain: 'local' }, dataClasses: ['public'] })
  } })
  const agent = await ctx.agentLoop.create(SessionId('reflex-sweep'), { provider: 'test', model: 'test' })
  // Every question about the unrelated passage answers a confident no; everything else a confident yes.
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async request => ({ kind: 'ok', spec: ctx.jev.resolve(request),
    response: { model: 'test', answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) =>
      [key, { type: 'noul' as const, noul: question.instructions?.includes('Lisbon') === true ? 0.01 : 0.99 }])) } }))
  const user = (text: string) => agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
  const toolCall = (name: string, text: string) => {
    const callId = ToolCallId(`call-${agent.session.surface.nodes.length}`)
    agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: callId, name, arguments: '{"command":"run"}' }] }) }, { surfaceOp: 'append' })
    agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text }] }) }, { surfaceOp: 'append' })
  }
  const prepare = (signal = new AbortController().signal) => ctx.parallel('compaction/prepare', agent, signal)
  const visible = () => JSON.stringify(agent.session.deriveMessages())
  return { ctx, agent, decide, user, toolCall, prepare, visible }
}

describe('compaction sweep', () => {
  it('hides certain noise and passages every question rejects, keeping needed, guarded, and recent output', async () => {
    const h = await setup()
    h.user('Fix the failing parse_date test.')
    h.toolCall('bash', INSTALL + UNRELATED + NEEDED + FAILURE)
    h.toolCall('bash', 'latest output stays visible: Weather in Lisbon')
    await h.prepare()
    const visible = h.visible()
    expect(visible).not.toContain('Successfully installed')
    expect(visible).not.toContain('light wind')
    expect(visible).toContain('fuzzy=True')
    expect(visible).toContain('DID NOT RAISE')
    expect(visible).toContain('latest output stays visible')
    expect(visible).toContain('[Reflex omitted]')
    // Guarded passages are never asked; the request quotes the producing tool call.
    const questions = h.decide.mock.calls.flatMap(([request]) => Object.values(request.questions).map(question => question.instructions ?? ''))
    expect(questions.some(text => text.includes('DID NOT RAISE'))).toBe(false)
    expect(questions.every(text => text.includes('bash {"command":"run"}'))).toBe(true)
    const restored = Session.create(h.agent.session.id, h.agent.session.snapshotEvents(), undefined, undefined,
      [reflexContextMessageProjection])
    expect(restored.deriveMessages()).toEqual(h.agent.session.deriveMessages())
    const judgements = h.agent.session.snapshotEvents().filter(event => event.type === 'system3/judgement')
    expect(judgements.map(event => event.data.decision)).toEqual(expect.arrayContaining(['reflex.context-sweep']))
  })

  it('judges each passage once, ignores assistant text, and appends nothing when hiding would not shrink the request', async () => {
    const h = await setup()
    h.user('Fix the failing parse_date test.')
    h.agent.session.append('assistant/message', { turn: 1, step: 0, stream: [], message: createAssistantMessage({ source: { provider: 'test', model: 'test' },
      content: [{ type: 'text', text: 'Let me look at the logs.' }] }) }, { surfaceOp: 'append' })
    h.toolCall('bash', UNRELATED)
    h.toolCall('bash', 'recent')
    await h.prepare()
    const projections = () => h.agent.session.snapshotEvents().filter(event => event.type === 'reflex/context-projection').length
    expect(projections()).toBe(1)
    h.decide.mockClear()
    await h.prepare()
    expect(h.decide).not.toHaveBeenCalled()
    expect(projections()).toBe(1)
    const short = await setup()
    short.toolCall('bash', 'Pushed\n')
    short.toolCall('bash', 'recent')
    await short.prepare()
    expect(short.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
  })

  it('hides only certain noise without a current task', async () => {
    const h = await setup()
    h.toolCall('bash', INSTALL + UNRELATED)
    h.toolCall('bash', 'recent')
    await h.prepare()
    expect(h.visible()).not.toContain('Successfully installed')
    expect(h.visible()).toContain('light wind')
    expect(h.decide).not.toHaveBeenCalled()
  })

  it('keeps the newest copy of repeated output', async () => {
    const h = await setup()
    h.user('task')
    const repeated = 'same output line from a long build summary that repeats every time the command runs\n'
    h.toolCall('bash', repeated)
    h.toolCall('bash', repeated)
    h.toolCall('bash', 'recent')
    await h.prepare()
    const tools = h.agent.session.deriveMessages().filter(message => message.role === 'tool').map(message => JSON.stringify(message.content))
    expect(tools[0]).not.toContain('same output line')
    expect(tools[1]).toContain('same output line')
  })

  it.each([
    ['Reflex switched off', async (h: Awaited<ReturnType<typeof setup>>) => { vi.spyOn(h.ctx.jev, 'isEnabled').mockReturnValue(false) }],
    ['shadow mode', async () => undefined],
  ])('changes nothing while %s', async (name, arrange) => {
    const h = await setup(name === 'shadow mode' ? { mode: 'shadow' } : {})
    await arrange(h)
    h.user('Fix the failing parse_date test.')
    h.toolCall('bash', INSTALL + UNRELATED)
    h.toolCall('bash', 'recent')
    await h.prepare()
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
  })

  it('leaves the surface unchanged when the surface moves during judgement or the provider fails', async () => {
    const h = await setup()
    h.user('Fix the failing parse_date test.')
    h.toolCall('bash', UNRELATED)
    h.toolCall('bash', 'recent')
    h.decide.mockImplementationOnce(async (request) => {
      h.user('new input during the sweep')
      return { kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test', answers: {} } }
    })
    await h.prepare()
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
    const warn = vi.spyOn(h.ctx.logger, 'warn')
    h.decide.mockRejectedValueOnce(new Error('gateway down'))
    await h.prepare()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reflex context sweep failed'))
    expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
  })

  it('propagates compaction cancellation', async () => {
    const h = await setup()
    h.user('task')
    h.toolCall('bash', UNRELATED)
    h.toolCall('bash', 'recent')
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    const failure: unknown = await h.prepare(abort.signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([new Error('cancelled')])
  })

  it('installs no listener without a sweep configuration', async () => {
    const h = await setup(false)
    h.user('task')
    h.toolCall('bash', INSTALL)
    h.toolCall('bash', 'recent')
    await h.prepare()
    expect(h.visible()).toContain('Successfully installed')
  })
})

describe('sweep building blocks', () => {
  it('splits text into whole-line passages and code-point chunks of over-long lines', () => {
    const text = 'aaaa\nbbbb\ncccc\n' + 'x'.repeat(9) + '😀\nend\n' + 'y'.repeat(12)
    const ranges = sweepPassages(text, 10)
    expect(ranges.map(range => text.slice(range.start, range.end))).toEqual(['aaaa\nbbbb\n', 'cccc\n', 'xxxxxxxxx', '😀\n', 'end\n', 'yyyyyyyyyy', 'yy'])
    for (const range of ranges) expect(() => projectReflexText(text, [range])).not.toThrow()
    expect(sweepPassages('', 10)).toEqual([])
  })

  it('classifies certain noise and guarded text', () => {
    const seen = new Set<string>()
    expect(reflexNoiseKind(INSTALL, seen)).toBe('progress')
    expect(reflexNoiseKind(INSTALL, seen)).toBe('duplicate')
    expect(reflexNoiseKind(`data:image/png;base64,${'A'.repeat(120)}`, seen)).toBe('image')
    expect(reflexNoiseKind('首页 | 新闻 | 登录 | 注册\n本网站使用 Cookie 改善体验', seen)).toBe('frame')
    expect(reflexNoiseKind(NEEDED, seen)).toBeUndefined()
    expect(isGuardedFragment(FAILURE)).toBe(true)
    expect(isGuardedFragment('妈妈对青霉素过敏')).toBe(true)
    expect(isGuardedFragment(UNRELATED)).toBe(false)
  })

  it('removes a passage only when all three answers are at or below no', () => {
    const fragment = { text: 't', tool: 'bash' } as Parameters<typeof sweepDecision.questions>[0]['fragments'][number]
    const input = { task: 'x'.repeat(600), fragments: [fragment, fragment] }
    const questions = sweepDecision.questions(input)
    expect(Object.keys(questions)).toEqual(['f0l', 'f0r', 'f0u', 'f1l', 'f1r', 'f1u'])
    expect(questions['f0l']?.instructions).toContain('…')
    const answers = { f0l: 0.05, f0r: 0.01, f0u: 0, f1l: 0.01, f1r: 0.2, f1u: 0 }
    const response = { model: 'm', answers: Object.fromEntries(Object.entries(answers).map(([key, noul]) => [key, { type: 'noul' as const, noul }])) }
    expect(sweepDecision.decide(response, sweep, input)).toBe('[0]')
    expect(sweepDecision.state(input)).toEqual({})
  })

  it('rejects invalid sweep budgets', () => {
    expect(() => { validateReflexContextConfig({ ...config, compactionSweep: { ...sweep, fragmentsPerRequest: 6 } }) }).toThrow('16-question')
    expect(() => { validateReflexContextConfig({ ...config, compactionSweep: { ...sweep, concurrency: 0 } }) }).toThrow('concurrency')
  })
})
