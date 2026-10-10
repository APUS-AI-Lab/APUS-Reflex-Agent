import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { markAgentLoopRequest, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { reflexContextMessageProjection, projectReflexText } from '@deepseek-ai/dsh-compaction/reflex-context-projection'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import type {} from '../src/reflex-context-state.ts'
import { installSystem3TaskFrame } from '../src/task-frame.ts'
import { installReflexContext, validateReflexContextConfig, type ReflexContextConfig } from '../src/reflex-context.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const config: ReflexContextConfig = { mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 1000,
  sessionDataClasses: ['public'], maxRequestChars: 4000, maxCandidates: 16, maxFragmentChars: 1000, protectRecentMessages: 1,
  maxRestoredChars: 5000, maxSearchResults: 5 }
async function setup(overrides: Partial<ReflexContextConfig> = {}, options: { effort?: 'low' | 'high' } = { effort: 'low' }) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jev, { endpoint: 'http://localhost:1', model: 'test' })
  new TokenMeter(ctx)
  const registrations = vi.spyOn(ctx.sessionProjections, 'register')
  const owner = await ctx.plugin({ name: 'reflex-context-test-owner', inject: ['sessions', 'sessionProjections', 'tools', 'tokenMeter', 'jev'], apply(scope) {
    installReflexContext(scope, { ...config, ...overrides }, { policy: { mode: 'local-only' }, options: { routeId: 'reflex', executionDomain: 'local', ...options }, dataClasses: ['public'] })
  } })
  const registration = registrations.mock.results[0]
  registrations.mockRestore()
  if (registration?.type !== 'return') throw new Error('Memory projection registration missing')
  const unregisterProjection = registration.value
  const agent = await ctx.agentLoop.create(SessionId('reflex-test'), { provider: 'test', model: 'test' })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async request => ({ kind: 'ok', spec: ctx.jev.resolve(request),
    response: { model: 'test', answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: 'noul' as const, noul: 0.99 }])) } }))
  const append = (text: string) => agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
  const step = (messages: UserMessage[] = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'current task' }] })]) => agentEvents(ctx, agent).waterfall('agent/pre-step', { messages, turn: 1, step: 0, signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages }))
  return { ctx, agent, decide, append, step, owner, unregisterProjection }
}
it('removes selected historical user lines, keeps recent input, and reconstructs the same request after resume', async () => {
  const h = await setup()
  h.append('old unrelated text that is obsolete and not relevant at all\r\nmore obsolete text with enough characters to reduce context')
  h.append('current constraint')
  await h.step()
  const messages = h.agent.session.deriveMessages()
  expect(JSON.stringify(messages)).not.toContain('old unrelated text')
  expect(JSON.stringify(messages)).toContain('current constraint')
  expect(h.agent.session.snapshotEvents().find(event => event.type === 'user/message')?.data).toMatchObject({ content: [{ text: 'old unrelated text that is obsolete and not relevant at all\r\nmore obsolete text with enough characters to reduce context' }] })
  const restored = Session.create(h.agent.session.id, h.agent.session.snapshotEvents(),
    undefined, undefined, [reflexContextMessageProjection])
  expect(restored.deriveMessages()).toEqual(messages)
  await h.step()
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('old unrelated text')
})
it('retains structured content and assistant tool-call messages', async () => {
  const h = await setup()
  h.append('```json\n{"keep":true}\n```')
  h.agent.session.append('assistant/message', { turn: 1, step: 0, stream: [], message: createAssistantMessage({ source: { provider: 'test', model: 'test' }, content: [{ type: 'text', text: 'ordinary old answer about an entirely unrelated topic from yesterday' }] }) }, { surfaceOp: 'append' })
  h.append('latest')
  await h.step()
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('keep')
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('ordinary old answer about an entirely unrelated topic from yesterday')
})
it('discards a judgement if a new input arrives during it', async () => {
  const h = await setup()
  h.append('historical text long enough for omission to reduce the model context')
  h.append('latest')
  h.decide.mockImplementationOnce(async (request) => {
    h.append('new constraint during decision')
    return { kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test', answers: { f0: { type: 'noul', noul: 1 } } } }
  })
  await h.step()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
})
it('keeps uncertain or unavailable decisions', async () => {
  const h = await setup()
  h.append('historical text long enough for omission to reduce the model context')
  h.append('latest')
  h.decide.mockImplementationOnce(async request => ({ kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test', answers: { f0: { type: 'noul', noul: 0.5 } } } }))
  await h.step()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
})
it('validates original offsets and Unicode boundaries', () => {
  expect(() => projectReflexText('a😀b', [{ start: 2, end: 3, firstLine: 1, lastLine: 1 }])).toThrow()
  expect(() => projectReflexText('a\nb', [{ start: 2, end: 3, firstLine: 1, lastLine: 1 }])).toThrow()
  expect(projectReflexText('中文\r\n尾行', [{ start: 0, end: 4, firstLine: 1, lastLine: 1 }])).toContain('尾行')
})

it('rebuilds the memory index from durable events rather than retaining a process-local cache', async () => {
  const h = await setup()
  h.append('obsolete travel notes about a Kyoto hotel named Sakura House and its breakfast')
  h.append('current requirement')
  await h.step()
  const restored = Session.create(h.agent.session.id, h.agent.session.snapshotEvents(),
    undefined, undefined, [reflexContextMessageProjection])
  const fresh = await setup()
  const state = fresh.ctx.sessionProjections.stateOf(restored, 'reflexContext')
  if (state === undefined) throw new Error('Memory index missing after restore')
  expect(state.blocks.some(block => block.original.includes('Sakura House') && block.hidden.length > 0)).toBe(true)
})

it('rejects changed original content and out-of-bounds persisted selections atomically', async () => {
  const h = await setup()
  const event = h.append('source text that must not be confused with another version of the same line')
  h.append('recent')
  const target = { seq: event.seq, block: 0, original: 'different text', tokenDelta: -1,
    hidden: [{ start: 0, end: 20, firstLine: 1, lastLine: 1 }] }
  const before = h.agent.session.deriveMessages()
  expect(() => h.agent.session.append('reflex/context-projection', { version: 1, revision: 2,
    action: 'remove', targets: [target] })).toThrow('original text mismatch')
  expect(h.agent.session.deriveMessages()).toEqual(before)
  expect(() => h.agent.session.append('reflex/context-projection', { version: 1, revision: 2,
    action: 'remove', targets: [{ ...target, original: event.data.content[0]?.type === 'text' ? event.data.content[0].text : '',
      hidden: [{ start: 0, end: 10000, firstLine: 1, lastLine: 1 }] }] })).toThrow('Invalid Reflex original-text range')
})

it('searches and restores archived text after compaction shadows its original node', async () => {
  const h = await setup()
  const original = h.append('old travel memory: the Kyoto hotel was Sakura House and breakfast was matcha pancakes')
  h.append('current task')
  await h.step()
  h.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'compacted summary' }] }),
    { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
  const search = await h.ctx.tools.execute({ callId: ToolCallId('memory-search'), name: 'reflex_memory', arguments: { query: 'Kyoto' },
    agent: h.agent, signal: new AbortController().signal })
  expect(JSON.stringify(search)).toContain('Sakura House')
  const restored = await h.ctx.tools.execute({ callId: ToolCallId('memory-restore'), name: 'reflex_memory',
    arguments: { reference: `${original.seq}:0` }, agent: h.agent, signal: new AbortController().signal })
  expect(restored.isError).toBe(false)
  expect(JSON.stringify(restored)).toContain('Sakura House')
  const other = await setup()
  const foreign = await other.ctx.tools.execute({ callId: ToolCallId('memory-foreign'), name: 'reflex_memory',
    arguments: { reference: `${original.seq}:0` }, agent: other.agent, signal: new AbortController().signal })
  expect(JSON.stringify(foreign)).not.toContain('Sakura House')
})

it('does not apply stale removals when a new human input enters the inbox during review', async () => {
  const h = await setup()
  h.append('historical information that will become relevant to a newly queued human task')
  h.append('current task')
  h.decide.mockImplementationOnce(async (request) => {
    h.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0,
      inserted: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep the historical information.' }] })] })
    return { kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test', answers: { f0: { type: 'noul', noul: 1 } } } }
  })
  await h.step()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
})

it('retains historical text and records provider transport failure', async () => {
  const h = await setup()
  h.append('historical information that remains visible when the decision provider fails')
  h.append('current task')
  h.decide.mockImplementationOnce(async request => ({ kind: 'unknown', spec: h.ctx.jev.resolve(request),
    failure: { code: 'transport', message: 'offline' } }))
  await h.step()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
  expect(h.agent.session.snapshotEvents().findLast(event => event.type === 'system3/judgement')?.data.reason).toBe('transport')
})

it('does not repeatedly inject an already visible archived fragment and can recover it after a later compaction', async () => {
  const h = await setup()
  const original = h.append('archived travel fact: Sakura House served matcha pancakes for breakfast in Kyoto')
  h.append('current task')
  await h.step()
  const compact = (seq: typeof original.seq) => h.agent.session.append('user/message',
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'summary without old travel details' }] }),
    { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  compact(original.seq)
  const first = await h.step()
  if (first.kind !== 'enter') throw new Error('Expected admitted context')
  const recovered = first.messages.find(message => message.source.kind === 'reflex-memory')
  if (recovered === undefined) throw new Error('Expected archive recovery')
  const node = h.agent.session.append('user/message', recovered, { surfaceOp: 'append' })
  const repeated = await h.step()
  expect(repeated.kind === 'enter' ? repeated.messages.filter(message => message.source.kind === 'reflex-memory') : []).toEqual([])
  compact(node.seq)
  h.append('New question: recall the Kyoto breakfast.')
  const later = await h.step()
  expect(later.kind === 'enter' && later.messages.some(message => message.source.kind === 'reflex-memory')).toBe(true)
})

it('records mixed removal and restoration separately with current revisions and prices', async () => {
  const h = await setup()
  const original = h.append('old Kyoto travel information that should be recoverable after a topic change')
  h.append('first task')
  await h.step()
  const unrelated = h.append('obsolete financial conversation details that are no longer needed for the Kyoto task')
  h.append('new travel task')
  const before = h.agent.session.deriveMessages().reduce((sum, message) => sum + h.ctx.tokenMeter.estimateMessage(message), 0)
  const offset = h.agent.session.snapshotEvents().length
  await h.step()
  const events = h.agent.session.snapshotEvents().slice(offset).filter(event => event.type === 'reflex/context-projection')
  expect(events.map(event => event.data.action)).toEqual(['remove', 'restore'])
  expect(events[1]!.data.revision).toBe(events[0]!.data.revision + 1)
  const state = h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexContext')
  if (state === undefined) throw new Error('Memory index missing')
  expect(state.blocks.find(block => block.seq === original.seq)?.restoredFor).toBe('new travel task')
  expect(state.blocks.find(block => block.seq === unrelated.seq)?.restoredFor).toBe(null)
  const after = h.agent.session.deriveMessages().reduce((sum, message) => sum + h.ctx.tokenMeter.estimateMessage(message), 0)
  expect(events.flatMap(event => event.data.targets).reduce((sum, target) => sum + target.tokenDelta, 0)).toBe(after - before)
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('old Kyoto travel information')
  expect(JSON.stringify(h.agent.session.deriveMessages())).not.toContain('obsolete financial conversation')
})

it('rejects invalid deployment budgets before registering context behavior', () => {
  expect(() => { validateReflexContextConfig({ ...config, maxCandidates: 0 }) }).toThrow('positive integer')
  expect(() => { validateReflexContextConfig({ ...config, maxRequestChars: 6001 }) }).toThrow('bounds')
  expect(() => { validateReflexContextConfig({ ...config, maxCandidates: 17 }) }).toThrow('bounds')
  expect(() => { validateReflexContextConfig({ ...config, maxFragmentChars: 2049 }) }).toThrow('bounds')
})

it('keeps context when disabled, empty, or larger than the admission budget', async () => {
  const off = await setup({ mode: 'off' })
  off.append('historical material that would otherwise be removed by the positive decision')
  off.append('latest')
  await off.step()
  expect(off.decide).not.toHaveBeenCalled()
  const empty = await setup()
  empty.append('latest')
  await empty.step()
  expect(empty.decide).not.toHaveBeenCalled()
  const budget = await setup({ maxRequestChars: 5 })
  budget.append('old material')
  await budget.step()
  expect(budget.decide).not.toHaveBeenCalled()
  const candidateBudget = await setup({ maxRequestChars: 150 })
  candidateBudget.append('a very long historical fragment which cannot fit within this review request budget')
  candidateBudget.append('latest')
  await candidateBudget.step()
  expect(candidateBudget.decide).not.toHaveBeenCalled()
})

it('splits long Unicode lines and retains empty or uneconomical fragments', async () => {
  const h = await setup({ maxFragmentChars: 32 })
  h.append('旅行😀'.repeat(24))
  h.append('')
  h.append('x')
  h.append('latest')
  await h.step()
  const event = h.agent.session.snapshotEvents().find(event => event.type === 'reflex/context-projection')
  expect(event?.data.targets[0]?.hidden.length).toBeGreaterThan(1)
  for (const range of event?.data.targets[0]?.hidden ?? []) expect(range.end - range.start).toBeLessThanOrEqual(32)
  expect(h.agent.session.deriveMessages().some(message => message.content.some(block => block.type === 'text' && block.text === 'x'))).toBe(true)
})

it('keeps task-frame constraints even when the semantic response would remove them', async () => {
  const h = await setup()
  const protectedMessage = h.append('Use Decimal for all currency calculations and never modify the original CSV files')
  h.append('Never modify the original CSV files')
  h.append('historical unrelated details that are now obsolete and safe to omit')
  h.append('latest')
  h.agent.session.append('system3/task-frame', { version: 1, goal: { messageId: protectedMessage.data.id, text: '' },
    items: [{ messageId: protectedMessage.data.id, text: 'Use Decimal for all currency calculations and never modify the original CSV files' }] })
  await h.step()
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('Use Decimal')
  expect(JSON.stringify(h.agent.session.deriveMessages())).not.toContain('historical unrelated details')
})

it('restores active memory through the model tool and enforces recovery budgets', async () => {
  const h = await setup()
  const original = h.append('archived travel details that can be restored through a stable memory reference')
  h.append('current task')
  await h.step()
  const result = await h.ctx.tools.execute({ callId: ToolCallId('active-memory'), name: 'reflex_memory',
    arguments: { reference: `${original.seq}:0` }, agent: h.agent, signal: new AbortController().signal })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('archived travel details')
  expect(h.ctx.tools.get('reflex_memory')?.presentCall?.({})).toEqual({ card: 'generic', title: 'Reflex memory', kind: 'other' })
  const tiny = await setup({ maxRestoredChars: 1 })
  const large = tiny.append('archived information whose recovery would exceed the very small configured budget')
  tiny.append('latest')
  await tiny.step()
  await tiny.step()
  expect(JSON.stringify(tiny.agent.session.deriveMessages())).not.toContain('archived information')
  const refused = await tiny.ctx.tools.execute({ callId: ToolCallId('budget-memory'), name: 'reflex_memory',
    arguments: { reference: `${large.seq}:0` }, agent: tiny.agent, signal: new AbortController().signal })
  expect(JSON.stringify(refused)).toContain('Restore exceeds the configured character budget')
})

it('rejects duplicate, hidden, and protected original targets before altering context', async () => {
  const h = await setup()
  const system = h.agent.session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('protected instruction') }, { surfaceOp: 'append' })
  const original = h.append('a historical original fragment that can be selected for omission')
  const target = { seq: original.seq, block: 0, original: 'a historical original fragment that can be selected for omission', tokenDelta: -1,
    hidden: [{ start: 0, end: 20, firstLine: 1, lastLine: 1 }] }
  const project = (targets: typeof target[]) => h.agent.session.append('reflex/context-projection', { version: 1, revision: 1, action: 'remove', targets })
  expect(() => project([target, target])).toThrow('Invalid Reflex target')
  expect(() => project([{ ...target, seq: system.seq, original: 'protected instruction' }])).toThrow('protected message roles')
  h.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'summary' }] }),
    { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
  expect(() => project([target])).toThrow('Invalid Reflex target')
})

it('projects multiple tool-result blocks without changing their call identity or assistant pairing', async () => {
  const h = await setup()
  h.agent.session.append('reflex/context-cache-anchor', { version: 1, throughSeq: SessionSeq(0) })
  const callId = ToolCallId('paired-tool')
  const assistant = createAssistantMessage({ source: { provider: 'test', model: 'test' },
    content: [{ type: 'tool-call', id: callId, name: 'test_tool', arguments: '{}' }] })
  h.agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: assistant }, { surfaceOp: 'append' })
  const tool = createToolResultMessage({ callId, isError: false, content: [
    { type: 'text', text: 'obsolete verbose diagnostic detail from an earlier solved attempt' },
    { type: 'text', text: 'another obsolete diagnostic block from the same successful tool call' },
  ] })
  h.agent.session.append('tool/result', { turn: 1, step: 1, message: tool }, { surfaceOp: 'append' })
  h.append('latest')
  await h.step()
  const messages = h.agent.session.deriveMessages()
  expect(messages.find(message => message.id === assistant.id)).toEqual(assistant)
  expect(messages.find(message => message.id === tool.id)).toMatchObject({ role: 'tool', toolCallId: callId, isError: false,
    content: [{ type: 'text', text: '\n[Reflex omitted]\n' }, { type: 'text', text: '\n[Reflex omitted]\n' }] })
})

it('uses the retained task when a continuation has no new user text and skips zero-token savings', async () => {
  const h = await setup()
  h.append('x'.repeat(19))
  h.append('current task')
  await h.step([])
  expect(h.decide).toHaveBeenCalledOnce()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
  const result = await h.ctx.tools.execute({ callId: ToolCallId('unscoped-memory'), name: 'reflex_memory',
    arguments: {}, signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result)).toContain('requires a calling session')
})

it('keeps an incoming image attached while reviewing historical text against the retained task', async () => {
  const h = await setup()
  h.append('historical text that is now unrelated to the current image question and safe to omit')
  h.append('Describe the next image')
  const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: {
    attachmentId: brandString<AttachmentId>('reflex-context-image'), mediaType: 'image/png', bytes: 4, width: 1, height: 1,
  } }] })
  const result = await h.step([input])
  expect(result.kind === 'enter' && result.messages.includes(input)).toBe(true)
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(true)
})

it('preserves admitted input when its plugin is unloaded while another pre-step listener waits', async () => {
  const h = await setup()
  h.append('historical information eligible for removal before the plugin is unloaded')
  h.append('latest')
  let resume = () => {}
  let entered = () => {}
  const held = new Promise<void>((resolve) => { resume = resolve })
  const waiting = new Promise<void>((resolve) => { entered = resolve })
  h.ctx.on('agent/pre-step', async (_event, next) => {
    entered()
    await held
    return next()
  })
  const pending = h.step()
  await waiting
  await h.owner.dispose()
  resume()
  expect((await pending).kind).toBe('enter')
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.ctx.tools.get('reflex_memory')).toBeUndefined()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexContext')).toBeUndefined()
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('historical information eligible')
})

it('rejects a restored checkpoint whose original message reference is absent from the current context', async () => {
  const h = await setup()
  h.append('historical text selected for omission after a durable checkpoint is restored')
  h.append('latest')
  const state = h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexContext')
  if (state === undefined) throw new Error('Expected installed memory projection')
  const checkpoint = h.ctx.sessionProjections.checkpoint(h.agent.session)
  const row = checkpoint.reflexContext
  if (row === undefined) throw new Error('Expected persisted memory checkpoint')
  checkpoint.reflexContext = { ...row, val: { ...state,
    blocks: state.blocks.map(block => ({ ...block, messageId: 'missing-durable-message-reference' })),
  } }
  const seed = h.agent.session.snapshotEvents()
  await h.owner.dispose()
  const resumed = await h.ctx.agents.create({ sessionId: SessionId('reflex-invalid-checkpoint'), seed,
    agentOptions: { provider: 'test', model: 'test' },
    setup: async (_scope, agent) => {
      installReflexContext(h.ctx, config, { policy: { mode: 'local-only' },
        options: { routeId: 'reflex', executionDomain: 'local', effort: 'low' }, dataClasses: ['public'] })
      h.ctx.sessionProjections.hydrate(agent.session, checkpoint, agent.session.snapshotEvents(), SessionLogOffset(0))
    },
  })
  const agent = resumed.agent
  const messages = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'current task' }] })]
  await expect(agentEvents(h.ctx, agent).waterfall('agent/pre-step', { messages, turn: 1, step: 1,
    signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages })))
    .rejects.toThrow('Reflex target has no current message')
  expect(agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(false)
})

it('fails loudly if the public projection registration is disposed before a memory tool call', async () => {
  const h = await setup()
  h.unregisterProjection()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexContext')).toBeUndefined()
  const result = await h.ctx.tools.execute({ callId: ToolCallId('missing-projection'), name: 'reflex_memory',
    arguments: {}, agent: h.agent, signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result)).toContain('Reflex context projection is not installed')
})

it('restores one line and omits another line of the same original block in one review', async () => {
  const h = await setup()
  h.append('earlier Kyoto travel detail that becomes relevant when the topic changes\nobsolete financial detail that becomes irrelevant when the topic changes')
  h.append('latest')
  h.decide.mockImplementationOnce(async request => ({ kind: 'ok', spec: h.ctx.jev.resolve(request),
    response: { model: 'test', answers: { f0: { type: 'noul', noul: 1 }, f1: { type: 'noul', noul: 0 } } } }))
  await h.step()
  expect(JSON.stringify(h.agent.session.deriveMessages())).not.toContain('earlier Kyoto travel detail')
  await h.step()
  const projected = JSON.stringify(h.agent.session.deriveMessages())
  expect(projected).toContain('earlier Kyoto travel detail')
  expect(projected).not.toContain('obsolete financial detail')
  const changes = h.agent.session.snapshotEvents().filter(event => event.type === 'reflex/context-projection')
  expect(changes.map(event => event.data.action)).toEqual(['remove', 'remove', 'restore'])
})

it('waits for the admitted task-frame batch before reviewing context and applying a projection', async () => {
  const h = await setup()
  installSystem3TaskFrame(h.ctx, { config: { mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 1000,
    sessionDataClasses: ['public'], maxItems: 4, maxMessageChars: 2000 },
  policy: { mode: 'local-only' }, options: { routeId: 'reflex', executionDomain: 'local', effort: 'low' } })
  await h.ctx.parallel('system3/context-prepare', h.agent, new AbortController().signal)
  const original = 'An obsolete travel diary with enough text to profitably remove from the current finance task'
  h.append(original)
  h.append('latest history')
  h.agent.session.append('system3/task-frame', { version: 1, goal: { text: 'Finance CSV report' }, items: [] })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  h.decide.mockImplementation(async (request) => {
    if (request.questions.intent !== undefined) {
      entered.resolve(undefined)
      await release.promise
      return { kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test', answers: {
        intent: { type: 'choice', choice: 'continue', probabilities: { continue: 1 }, confidence: 1 },
        requirement: { type: 'noul', noul: 1 },
      } } }
    }
    if (request.state === null || typeof request.state !== 'object' || Array.isArray(request.state)) {
      throw new Error('Context review must carry an object state')
    }
    expect(request.state.task).toMatchObject({ currentUserRequests: ['Preserve original CSV and use Decimal'] })
    expect(JSON.stringify(request.state.task)).toContain('Preserve original CSV and use Decimal')
    expect(h.agent.session.snapshotEvents().findLast(event => event.type === 'system3/task-frame')?.data.items)
      .toMatchObject([{ text: 'Preserve original CSV and use Decimal' }])
    return { kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test', answers: { f0: { type: 'noul', noul: 1 } } } }
  })
  const step = h.step([createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Preserve original CSV and use Decimal' }] })])
  await entered.promise
  expect(h.decide).toHaveBeenCalledTimes(1)
  release.resolve(undefined)
  await step
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-projection')).toBe(true)
  expect(JSON.stringify(h.agent.session.deriveMessages())).not.toContain(original)
  await h.ctx.parallel('system3/context-prepare', h.agent, AbortSignal.abort())
})
it('does not review context after unloading during task-frame preparation', async () => {
  const h = await setup()
  h.append('historical information eligible for omission after the task frame finishes')
  h.append('latest')
  const entered = Promise.withResolvers<undefined>()
  installSystem3TaskFrame(h.ctx, { config: { mode: 'active', yes: 0.9, no: 0.1, deadlineMs: 1000,
    sessionDataClasses: ['public'], maxItems: 4, maxMessageChars: 2000 },
  policy: { mode: 'local-only' }, options: { routeId: 'reflex', executionDomain: 'local', effort: 'low' } })
  h.agent.session.append('system3/task-frame', { version: 1, goal: { text: 'Current task' }, items: [] })
  const release = Promise.withResolvers<undefined>()
  h.decide.mockImplementation(async (request) => {
    entered.resolve(undefined)
    await release.promise
    return { kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test', answers: {} } }
  })
  const step = h.step()
  await entered.promise
  await h.owner.dispose()
  await step
  expect(h.decide).toHaveBeenCalledTimes(1)
  release.resolve(undefined)
})

it('freezes real submitted history and only edits the unsubmitted tool tail with the deployed recent-message budget', async () => {
  const h = await setup({ protectRecentMessages: 4 })
  const original = 'An obsolete diagnostic record that is irrelevant to the finance task but can be recovered exactly later'
  h.ctx.effect(() => h.ctx.tools.register(defineTool({
    name: 'cache_test', description: 'Return deterministic diagnostic text.',
    parameters: { index: { type: 'number', description: 'Result index.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, output) => [{ type: 'text', text: output.text }] },
    execute: args => Promise.resolve({ text: args.index === 0 ? original : `Relevant result ${args.index}` }),
    presentCall: () => ({ card: 'generic', title: 'Test', kind: 'other' }),
  })))
  const calls = Array.from({ length: 5 }, (_, index) => ({ type: 'tool-call' as const,
    id: ToolCallId(`cache-${index}`), name: 'cache_test', arguments: JSON.stringify({ index }) }))
  const first = calls.flatMap((block, index) => [
    { type: 'block-start' as const, index, blockType: 'tool-call' as const },
    { type: 'tool-call-delta' as const, index, id: block.id, name: block.name, argumentsDelta: block.arguments },
    { type: 'block-end' as const, index, block },
  ])
  const adapter = new MockAdapter([
    [...first, { type: 'finish', reason: { kind: 'tool-calls' } }],
    () => {
      const state = h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexContext')
      const memory = state?.blocks.find(block => block.hidden.length > 0)
      if (memory === undefined) throw new Error('Expected omitted tool tail')
      const first = toolCallResponse('cache-restore', 'reflex_memory', { reference: `${memory.seq}:0` })
      const second = toolCallResponse('cache-restore-again', 'reflex_memory', { reference: `${memory.seq}:0` })
        .map(chunk => 'index' in chunk ? { ...chunk, index: 1 } : chunk)
      return [...first.slice(0, -1), ...second]
    },
    textResponse('Restored without changing the cached prefix'),
  ])
  h.ctx.effect(() => h.ctx.llm.registerAdapter(['test'], adapter))
  h.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep the original CSV unchanged; inspect the finance task.' }] }))
  await h.agent.whenIdle()
  expect(adapter.requests).toHaveLength(3)
  const [firstRequest, secondRequest, thirdRequest] = adapter.requests
  expect(secondRequest?.messages.slice(0, firstRequest?.messages.length)).toEqual(firstRequest?.messages)
  expect(JSON.stringify(secondRequest?.messages)).not.toContain(original)
  expect(thirdRequest?.messages.slice(0, secondRequest?.messages.length)).toEqual(secondRequest?.messages)
  expect(thirdRequest?.messages.filter(message => message.source?.kind === 'reflex-memory')).toHaveLength(1)
  expect(JSON.stringify(thirdRequest?.messages)).toContain(original)
  const changes = h.agent.session.snapshotEvents().filter(event => event.type === 'reflex/context-projection')
  expect(changes.map(event => event.data.action)).toEqual(['remove'])
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-cache-anchor')).toBe(true)
  const target = changes[0]?.data.targets[0]
  if (target === undefined) throw new Error('Missing tool projection')
  const duplicate = await h.ctx.tools.execute({ callId: ToolCallId('duplicate-restore'), name: 'reflex_memory',
    arguments: { reference: `${target.seq}:${target.block}` }, agent: h.agent, signal: new AbortController().signal })
  expect(JSON.stringify(duplicate)).toContain('already visible')
  const resumed = Session.create(h.agent.session.id, h.agent.session.snapshotEvents(),
    undefined, undefined, [reflexContextMessageProjection])
  expect(h.ctx.sessionProjections.stateOf(resumed, 'reflexContext')?.frozenThrough)
    .toBe(h.ctx.sessionProjections.stateOf(h.agent.session, 'reflexContext')?.frozenThrough)
})
it('conservatively freezes legacy history on resume when no dispatch anchor was recorded', async () => {
  const h = await setup()
  h.append('Legacy request content that must never be rewritten merely because the process restarted')
  h.agent.session.append('request/context', { provider: 'test', model: 'test' })
  h.append('An uncertain tail after the last legacy request has no reliable dispatch receipt')
  h.append('latest')
  await h.step()
  expect(h.decide).not.toHaveBeenCalled()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-cache-anchor')).toBe(true)
})

it('anchors an empty dispatch, skips one-shot requests, and retains anchors across identical retries', async () => {
  const h = await setup()
  const adapter = new MockAdapter([textResponse('one-shot'), textResponse('attempt'), textResponse('retry')])
  h.ctx.effect(() => h.ctx.llm.registerAdapter(['test'], adapter))
  const consume = async (request: Parameters<typeof h.ctx.llm.stream>[0]) => {
    for await (const _chunk of h.ctx.llm.stream(request)) { /* Consume the public stream to completion. */ }
  }
  await consume({ provider: 'test', model: 'test', messages: [] })
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-cache-anchor')).toBe(false)
  const request = markAgentLoopRequest({ provider: 'test', model: 'test', messages: h.agent.session.deriveMessages(), sessionId: h.agent.session.id })
  await consume(request)
  await consume(request)
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'reflex/context-cache-anchor')).toHaveLength(1)
  h.agent.session.append('assistant/attempt', { turn: 1, step: 1, stream: [] })
  const orphan = markAgentLoopRequest({ ...request, sessionId: SessionId('missing-session') })
  await expect(consume(orphan)).rejects.toThrow('requires the request Session')
  h.unregisterProjection()
  await expect(consume(request)).rejects.toThrow('projection is not installed')
})
it('freezes a legacy request with no historical message nodes conservatively', async () => {
  const h = await setup()
  h.agent.session.append('request/context', { provider: 'test', model: 'test' })
  await h.step()
  expect(h.decide).not.toHaveBeenCalled()
})
it('keeps dispatch protection after a real model request is cancelled without a response', async () => {
  const h = await setup()
  const adapter = new MockAdapter(['hang'])
  h.ctx.effect(() => h.ctx.llm.registerAdapter(['test'], adapter))
  h.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
    'This submitted original must remain unchanged after cancellation even though no provider response arrives.' }] }))
  await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
  h.agent.cancel({ kind: 'user' })
  await h.agent.whenIdle()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'reflex/context-cache-anchor')).toBe(true)
  await h.step()
  expect(h.decide).not.toHaveBeenCalled()
  expect(JSON.stringify(h.agent.session.deriveMessages())).toContain('This submitted original must remain unchanged')
})

it('appends identical archived fragments only once per semantic recovery batch', async () => {
  const h = await setup()
  const text = 'An obsolete shared travel detail: the Kyoto hotel served matcha pancakes for breakfast'
  h.append(text)
  h.append(text)
  const latest = h.append('current task')
  await h.step()
  h.agent.session.append('reflex/context-cache-anchor', { version: 1, throughSeq: latest.seq })
  const decision = await h.step()
  expect(decision.kind === 'enter' && decision.messages.filter(message => message.source.kind === 'reflex-memory')).toHaveLength(1)
})

it('releases pending tool recovery after cancellation, admission, compaction, and a completed step', async () => {
  const h = await setup()
  const original = h.append('Recoverable obsolete travel details: Sakura House served matcha pancakes in Kyoto')
  const latest = h.append('current task')
  await h.step()
  h.agent.session.append('reflex/context-cache-anchor', { version: 1, throughSeq: latest.seq })
  const controller = new AbortController()
  const restore = (id: string, signal = new AbortController().signal) => h.ctx.tools.execute({
    callId: ToolCallId(id), name: 'reflex_memory', arguments: { reference: `${original.seq}:0` }, agent: h.agent, signal,
  })
  const first = await restore('first', controller.signal)
  expect(first.additionalContexts).toHaveLength(1)
  expect((await restore('pending')).additionalContexts).toBeUndefined()
  controller.abort()
  const retried = await restore('cancelled-retry')
  expect(retried.additionalContexts).toHaveLength(1)
  const summary = () => h.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'summary' }] }),
  { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
  summary()
  const compactedRetry = await restore('compacted-retry')
  expect(compactedRetry.additionalContexts).toHaveLength(1)
  h.agent.session.append('step/end', { turn: 1, step: 1 })
  expect((await restore('step-retry')).additionalContexts).toHaveLength(1)
  h.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const turnRetry = await restore('turn-retry')
  expect(turnRetry.additionalContexts).toHaveLength(1)
  const memory = turnRetry.additionalContexts?.[0]
  if (memory === undefined) throw new Error('Missing recovery context')
  h.agent.session.append('user/message', memory, { surfaceOp: 'append' })
  expect(JSON.stringify(await restore('admitted'))).toContain('already visible')
  h.agent.session.append('step/end', { turn: 1, step: 1 })
  h.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
})

it('binds each version-two question to its exact text and original line reference', async () => {
  const h = await setup()
  const original = h.append('obsolete trip: Sakura House served breakfast\n本月有效应收：订单A，金额875.12元。')
  h.append('latest')
  await h.step()
  const request = h.decide.mock.calls[0]?.[0]
  expect(request?.questions.f0?.instructions).toContain(JSON.stringify('obsolete trip: Sakura House served breakfast\n'))
  expect(request?.questions.f1?.instructions).toContain(JSON.stringify('本月有效应收：订单A，金额875.12元。'))
  expect(request?.questions.f0?.instructions).toContain(`event=${original.seq}; block=0; lines=1-1`)
  expect(request?.questions.f1?.instructions).toContain(`event=${original.seq}; block=0; lines=2-2`)
  expect(request?.questions.f1?.instructions).toContain('计算所需事实/数值、验证依据、约束与未解决需求必须保留')
  expect(request?.questions.f1?.instructions).toContain('不把其他片段的结论套用到它')
  expect(request?.questions.f1?.instructions).toContain('不要把“数据不可信”误解为“没有用途”')
  expect(h.agent.session.snapshotEvents().find(event => event.type === 'system3/judgement')?.data).toMatchObject({ decisionVersion: 3 })
})

it('skips only identical successful empty selections and reassesses changed task, candidates, and effective options', async () => {
  const h = await setup({}, {})
  h.decide.mockImplementation(async request => ({ kind: 'ok', spec: h.ctx.jev.resolve(request), response: { model: 'test',
    answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: 'noul', noul: 0 }])) } }))
  h.append('historical text that must remain available after an explicit retain decision')
  h.append('latest')
  await h.step()
  await h.step()
  expect(h.decide).toHaveBeenCalledTimes(1)
  const incoming = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'different task' }] })]
  await h.step(incoming)
  expect(h.decide).toHaveBeenCalledTimes(2)
  h.append('another eligible observation that changes the candidate set')
  h.append('latest again')
  await h.step(incoming)
  expect(h.decide).toHaveBeenCalledTimes(3)
  const resolve = h.ctx.jev.resolve.bind(h.ctx.jev)
  vi.spyOn(h.ctx.jev, 'resolve').mockImplementation(request => ({ ...resolve(request), model: 'changed-model' }))
  await h.step(incoming)
  expect(h.decide).toHaveBeenCalledTimes(4)
  await h.step(incoming)
  expect(h.decide).toHaveBeenCalledTimes(4)
})

it('retries failed decisions and never caches a positive restoration before context admission', async () => {
  const h = await setup()
  const original = h.append('archived travel notes that can be restored later without losing the exact original information')
  const last = h.append('latest')
  h.decide.mockImplementationOnce(async request => ({ kind: 'unknown', spec: h.ctx.jev.resolve(request),
    failure: { code: 'transport', message: 'offline' } }))
  await h.step()
  await h.step()
  expect(h.decide).toHaveBeenCalledTimes(2)
  h.agent.session.append('reflex/context-cache-anchor', { version: 1, throughSeq: last.seq })
  const cancellation = new AbortController()
  const messages = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'current task' }] })]
  const proposed = await agentEvents(h.ctx, h.agent).waterfall('agent/pre-step',
    { messages, turn: 1, step: 0, signal: cancellation.signal }, () => Promise.resolve({ kind: 'enter', messages }))
  cancellation.abort()
  const retried = await h.step()
  expect(h.decide).toHaveBeenCalledTimes(4)
  for (const decision of [proposed, retried]) {
    expect(decision.kind === 'enter' && decision.messages.some(message => message.source.kind === 'reflex-memory')).toBe(true)
  }
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'reflex/context-projection')
    .flatMap(event => event.data.targets).some(target => target.seq === original.seq)).toBe(true)
})

it('separates renewed requests from old exclusions after restoring archived memory into a fresh Host', async () => {
  const h = await setup()
  const travel = '旧旅行记录：旅馆早餐 07:45，集合地点为一楼东侧大厅。'
  h.append(travel)
  h.append('现在处理财务，本次不需要旅行。')
  await h.step()
  h.agent.session.append('system3/task-frame', { version: 1,
    goal: { text: '财务汇总，本次不需要旅行' }, items: [{ text: '原始 CSV 不可修改，金额用 Decimal', messageId: MessageId('prior-finance-constraint') }] })
  const seed = h.agent.session.snapshotEvents()
  await h.ctx.fiber.dispose()
  const fresh = await setup()
  const resumed = await fresh.ctx.agents.create({ sessionId: SessionId('reflex-priority-restarted'), seed,
    agentOptions: { provider: 'test', model: 'test' } })
  const messages = [
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '财务汇总，本次不需要旅行' }] }),
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '请回忆旧旅馆早餐几点、在哪里集合？' }] }),
  ]
  await agentEvents(fresh.ctx, resumed.agent).waterfall('agent/pre-step',
    { messages, turn: 2, step: 0, signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages }))
  const request = fresh.decide.mock.calls[0]?.[0]
  expect(request?.state).toMatchObject({ task: {
    currentUserRequests: ['财务汇总，本次不需要旅行', '请回忆旧旅馆早餐几点、在哪里集合？'], activeGoal: null,
    priorTaskFrameConstraints: ['财务汇总，本次不需要旅行', '原始 CSV 不可修改，金额用 Decimal'],
  } })
  expect(JSON.stringify(request?.state)).toContain(travel)
  expect(JSON.stringify(request?.state)).toContain('"action":"restore"')
  expect(request?.questions.f0?.instructions).toContain('不是永久禁令')
  expect(request?.questions.f0?.instructions).toContain('安全、权限、精度和原文件保护约束仍须保留')
  expect(JSON.stringify(resumed.agent.session.deriveMessages())).toContain('07:45')
})

it('preserves ordered same-batch constraints and excludes paused Goals from current relevance', async () => {
  const h = await setup()
  await h.ctx.plugin(GoalService)
  h.ctx.goals.create(h.agent, { objective: '财务精确核对' })
  h.append('obsolete history long enough to omit safely from current task')
  h.append('current persisted topic')
  const inputs = ['金额用 Decimal，原始 CSV 不可修改', '开始']
    .map(text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
  await h.step(inputs)
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ task: {
    currentUserRequests: ['金额用 Decimal，原始 CSV 不可修改', '开始'], activeGoal: '财务精确核对',
  } })
  const goal = h.ctx.goals.get(h.agent)
  if (goal === undefined) throw new Error('Expected active Goal')
  h.ctx.goals.pause(h.agent, goal)
  h.decide.mockClear()
  await h.step([])
  expect(h.decide.mock.calls[0]?.[0].state).toMatchObject({ task: {
    currentUserRequests: ['current persisted topic'], activeGoal: null,
  } })
})
