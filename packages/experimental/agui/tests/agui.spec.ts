import { agentEvents } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { CUSTOM_APPROVAL, personaFrom } from '../src/index.ts'
import { type AguiHarness, makeAguiHarness } from './harness.ts'

let harness: AguiHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

const types = (events: { type: string }[]): string[] => events.map(event => event.type)

describe('AG-UI bridge', () => {
  it('refuses requests without the bearer token', async () => {
    harness = await makeAguiHarness([])
    expect((await harness.request('/threads', { token: 'wrong' })).status).toBe(401)
    expect((await harness.request('/nowhere')).status).toBe(404)
  })

  it('streams one turn as AG-UI events and keeps the thread for the next run', async () => {
    harness = await makeAguiHarness([textResponse('hello'), textResponse('again')])
    const first = await harness.run('thread-1', 'hi', 'run-1')
    expect(types(first)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      ...Array.from('hello', () => 'TEXT_MESSAGE_CONTENT'),
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ])
    expect(first[0]).toMatchObject({ threadId: 'thread-1', runId: 'run-1' })
    expect(first.filter(event => event.type === 'TEXT_MESSAGE_CONTENT').map(event => event.delta).join('')).toBe('hello')
    expect(first.at(-1)).toMatchObject({ outcome: { type: 'success' } })

    const second = await harness.run('thread-1', 'more', 'run-2')
    expect(types(second).at(-1)).toBe('RUN_FINISHED')
    // The same durable Session carried both turns.
    expect(harness.adapter.requests).toHaveLength(2)
    const history = await (await harness.request('/threads/thread-1/messages')).json() as { messages: { role: string; content?: string }[] }
    expect(history.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'hi'], ['assistant', 'hello'], ['user', 'more'], ['assistant', 'again'],
    ])
  })

  it('lists threads with titles and rejects a run without a user message', async () => {
    harness = await makeAguiHarness([textResponse('ok')])
    await harness.run('thread-a', 'first')
    const created = await harness.request('/threads', { method: 'POST', body: JSON.stringify({ id: 'thread-b' }) })
    expect(created.status, await created.clone().text()).toBe(201)
    const listed = await (await harness.request('/threads')).json() as { threads: { id: string; archived: boolean; live: boolean }[] }
    expect(listed.threads.map(thread => thread.id).sort()).toEqual(['thread-a', 'thread-b'])
    expect(listed.threads.every(thread => !thread.archived && thread.live)).toBe(true)
    const empty = await harness.request('/run', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-c', runId: 'r', messages: [] }),
    })
    expect(empty.status).toBe(400)
  })

  it('surfaces tool calls and their results', async () => {
    harness = await makeAguiHarness([toolCallResponse('call-1', 'missing_tool', { a: 1 }), textResponse('done')])
    const events = await harness.run('thread-tools', 'use a tool')
    expect(types(events)).toContain('TOOL_CALL_START')
    expect(types(events)).toContain('TOOL_CALL_END')
    expect(types(events)).toContain('TOOL_CALL_RESULT')
    const start = events.find(event => event.type === 'TOOL_CALL_START')
    expect(start).toMatchObject({ toolCallId: 'call-1', toolCallName: 'missing_tool' })
    expect(events.filter(event => event.type === 'TOOL_CALL_ARGS').map(event => event.delta).join('')).toBe('{"a":1}')
    expect(types(events).at(-1)).toBe('RUN_FINISHED')
  })

  it('routes an approval raised during a run to the client and back', async () => {
    harness = await makeAguiHarness([{ hangAfter: [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'x' }] }])
    const stream = await harness.openRun('thread-approve', 'do something risky')
    let mid = await stream.next()
    while (mid !== undefined && mid.type !== 'TEXT_MESSAGE_CONTENT') mid = await stream.next()
    expect(mid, JSON.stringify(stream.events)).toBeDefined()
    const agent = harness.ctx.agents.get(SessionId('thread-approve'))!
    const outcome = agentEvents(harness.ctx, agent).waterfall(
      'approval/request',
      { toolName: 'bash', callId: ToolCallId('call-9'), reason: 'writes files' },
      () => Promise.resolve('unavailable' as const),
    )
    let custom = await stream.next()
    while (custom !== undefined && custom.type !== 'CUSTOM') custom = await stream.next()
    expect(custom).toMatchObject({ name: CUSTOM_APPROVAL, value: { toolName: 'bash', callId: 'call-9', reason: 'writes files' } })
    const id = (custom!.value as { id: string }).id
    expect((await harness.request(`/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision: 'allow' }) })).status).toBe(204)
    await expect(outcome).resolves.toBe('allowed-once')
    expect((await harness.request(`/approvals/${id}`, { method: 'POST', body: '{}' })).status).toBe(404)

    // A second run on a busy thread is refused; aborting the client cancels the turn.
    const busy = await harness.request('/run', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-approve', runId: 'r2', messages: [{ role: 'user', content: 'again' }] }),
    })
    expect(busy.status).toBe(409)
    stream.abort()
    await stream.done
    await agent.whenIdle()
    expect(agent.status).toBe('idle')
  })

  it('speaks as the persona the client sends instead of the harness', async () => {
    harness = await makeAguiHarness([textResponse('hi'), textResponse('hi again'), textResponse('plain')])
    const systemOf = (index: number): string => {
      const first = harness!.adapter.requests[index]?.messages[0]
      return first?.role === 'system' ? JSON.stringify(first) : ''
    }
    await harness.run('thread-persona', 'who are you', 'p1', { persona: { name: 'Nova', tone: 'concise' } })
    expect(systemOf(0)).toContain('You are Nova, the person\'s private agent in xDAN System3 Personal Agent.')
    expect(systemOf(0)).toContain('Be brief and direct')
    expect(systemOf(0)).not.toContain('DeepSeek Harness')
    expect(systemOf(0)).toContain('Do not volunteer internal details')
    // A later run with a new persona applies to the same Agent's next step.
    await harness.run('thread-persona', 'again', 'p2', { persona: { name: 'Iris', tone: 'warm' } })
    expect(systemOf(1)).toContain('You are Iris')
    // A thread without a persona uses the Personal Agent default, never the harness identity.
    await harness.run('thread-default', 'hello', 'p3')
    expect(systemOf(2)).toContain('You are Muse')
    expect(personaFrom({ name: ' ', tone: 'warm' })).toBeUndefined()
    expect(personaFrom({ name: 'X', tone: 'loud' })).toBeUndefined()
  })
})
