/**
 * C09A: minimal native dispatch facts recorded at the real `llm/stream` seam.
 *
 * Every actual loop-built model dispatch appends one `llm/dispatch` record
 * (session, exact committed prefix end, turn/step) and, once the attempt
 * settles, one `llm/dispatch-settled` record naming that dispatch and the
 * assistant settlement event. Neither record copies messages or tools.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { currentSessionMessageProjections } from '@deepseek-ai/dsh-session-format-catalog/message-projections'
import { imageOffloadProjection } from '@deepseek-ai/dsh-compaction-image-offload/projection'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { buildRequestView, installRequestDispatchRecorder, RequestViewError, RequestViewUnsupportedError } from '../src/request-view.ts'

const storageDirs: string[] = []

afterEach(async () => {
  await Promise.all(storageDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object, text?: string): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  const chunks: StreamChunk[] = []
  let index = 0
  if (text !== undefined) {
    chunks.push(
      { type: 'block-start', index, blockType: 'text' },
      { type: 'text-delta', index, text },
      { type: 'block-end', index, block: { type: 'text', text } },
    )
    index += 1
  }
  chunks.push(
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id: callId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index, id: callId, name, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[])

/** Model-provider stand-in only: records each dispatched request and replays a script. */
class RecordingAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('RecordingAdapter: script exhausted')
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) yield chunk
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

async function makeHarness(adapter: LlmAdapter) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-request-view-'))
  storageDirs.push(dir)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: dir })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function sessionEvents(session: { snapshotEvents: () => readonly SessionEvent[] }): readonly SessionEvent[] {
  return session.snapshotEvents()
}

describe('llm/stream dispatch facts', () => {
  it('records one minimal dispatch reference per model call without copying request content', async () => {
    const adapter = new RecordingAdapter([textResponse('one'), textResponse('two')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('dispatch-minimal'), { provider: 'mock', model: 'mock' })
      send(agent, 'first request body marker')
      await waitForIdle(ctx, agent)
      send(agent, 'second request body marker')
      await waitForIdle(ctx, agent)

      const events = sessionEvents(agent.session)
      const dispatches = events.filter(event => event.type === 'llm/dispatch')
      expect(dispatches).toHaveLength(2)
      const first = dispatches[0]
      if (first?.type !== 'llm/dispatch') throw new Error('expected llm/dispatch')
      expect(first.data.sessionId).toBe('dispatch-minimal')
      expect(first.data.turn).toBe(1)
      expect(first.data.step).toBe(1)
      // The last committed event the request was built from, before the assistant settlement.
      expect(first.data.prefixEnd).toBeTypeOf('number')
      expect(first.data.prefixEnd).toBeLessThan(Number(agent.session.seq))
      const serialized = JSON.stringify(first.data)
      expect(serialized).not.toContain('first request body marker')
      expect(serialized).not.toContain('"messages"')
      expect(serialized).not.toContain('"tools"')
      // Dispatch records are log-only: never model-visible surface nodes.
      expect(agent.session.surface.nodes).not.toContain(first.seq)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('does not change the model request it observes', async () => {
    const adapter = new RecordingAdapter([textResponse('observed')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('dispatch-protected'), { provider: 'mock', model: 'mock' })
      send(agent, 'go')
      await waitForIdle(ctx, agent)

      const request = adapter.requests[0]
      expect(request).toBeDefined()
      expect(request?.messages.at(-1)?.content).toContainEqual({ type: 'text', text: 'go' })
      expect(Object.isFrozen(request)).toBe(true)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('associates each dispatch with its real assistant settlement event', async () => {
    const adapter = new RecordingAdapter([textResponse('settled')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('dispatch-settled'), { provider: 'mock', model: 'mock' })
      send(agent, 'go')
      await waitForIdle(ctx, agent)

      const events = sessionEvents(agent.session)
      const dispatch = events.find(event => event.type === 'llm/dispatch')
      const settled = events.find(event => event.type === 'llm/dispatch-settled')
      if (dispatch?.type !== 'llm/dispatch' || settled?.type !== 'llm/dispatch-settled') {
        throw new Error('expected dispatch and settlement records')
      }
      expect(settled.data.dispatchSeq).toBe(dispatch.seq)
      expect(settled.data.sessionId).toBe('dispatch-settled')
      const settlement = events[settled.data.settlementSeq]
      expect(settlement?.type).toBe('assistant/message')
      expect(settlement?.type === 'assistant/message' && settlement.data.turn).toBe(1)
      expect(settlement?.type === 'assistant/message' && settlement.data.step).toBe(1)
      // The settlement record follows the settlement event it names.
      expect(settled.seq).toBeGreaterThan(settled.data.settlementSeq)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('records one dispatch per retry while keeping the same turn and step', async () => {
    const adapter = new RecordingAdapter([
      () => { throw new Error('transient failure') },
      textResponse('recovered'),
    ])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('dispatch-retry'), { provider: 'mock', model: 'mock' })
      let retried = false
      ctx.on('agent/request-error', () => {
        if (retried) return
        retried = true
        return Promise.resolve({ kind: 'retry' as const })
      })
      send(agent, 'go')
      await waitForIdle(ctx, agent)

      const events = sessionEvents(agent.session)
      const dispatches = events.filter(event => event.type === 'llm/dispatch')
      expect(dispatches).toHaveLength(2)
      expect(dispatches.map(event => event.type === 'llm/dispatch' && [event.data.turn, event.data.step]))
        .toEqual([[1, 1], [1, 1]])
      const first = dispatches[0]
      const second = dispatches[1]
      if (first?.type !== 'llm/dispatch' || second?.type !== 'llm/dispatch') throw new Error('expected llm/dispatch')
      // The failed attempt's settlement precedes the second dispatch.
      expect(Number(second.data.prefixEnd)).toBeGreaterThan(Number(first.data.prefixEnd))
      const settlements = events.filter(event => event.type === 'llm/dispatch-settled')
      expect(settlements).toHaveLength(2)
      const settledSeqs = settlements.map(event => event.type === 'llm/dispatch-settled' && event.data.settlementSeq)
      expect(events[settledSeqs[0] as number]?.type).toBe('assistant/attempt')
      expect(events[settledSeqs[1] as number]?.type).toBe('assistant/message')
      expect(settlements.map(event => event.type === 'llm/dispatch-settled' && event.data.dispatchSeq))
        .toEqual([first.seq, second.seq])
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('does not record a dispatch for hand-built calls', async () => {
    const adapter = new RecordingAdapter([textResponse('hand built')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const session = ctx.sessions.create(SessionId('hand-built'))
      const request: GenerateOptions = {
        provider: 'mock',
        model: 'mock',
        messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
        sessionId: session.id,
      }
      for await (const _chunk of ctx.llm.stream(request)) { /* drain */ }
      expect(sessionEvents(session).filter(event =>
        event.type === 'llm/dispatch' || event.type === 'llm/dispatch-settled')).toHaveLength(0)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('records dispatches only while the recorder is installed', async () => {
    const adapter = new RecordingAdapter([textResponse('one'), textResponse('two')])
    const ctx = await makeHarness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('dispatch-toggle'), { provider: 'mock', model: 'mock' })
      send(agent, 'before')
      await waitForIdle(ctx, agent)
      expect(sessionEvents(agent.session).filter(event => event.type === 'llm/dispatch')).toHaveLength(0)

      const dispose = installRequestDispatchRecorder(ctx)
      send(agent, 'during')
      await waitForIdle(ctx, agent)
      expect(sessionEvents(agent.session).filter(event => event.type === 'llm/dispatch')).toHaveLength(1)
      dispose()

      send(agent, 'after')
      await waitForIdle(ctx, agent)
      expect(sessionEvents(agent.session).filter(event => event.type === 'llm/dispatch')).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('records dispatches on an independent session without sharing state', async () => {
    const adapter = new RecordingAdapter([textResponse('one'), textResponse('two')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const first = await ctx.agents.create({
        sessionId: SessionId('dispatch-isolated-a'),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      send(first.agent, 'first')
      await waitForIdle(ctx, first.agent)
      await first.dispose()

      const second = await ctx.agents.create({
        sessionId: SessionId('dispatch-isolated-b'),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      send(second.agent, 'second')
      await waitForIdle(ctx, second.agent)
      const dispatches = dispatchesOf(second.agent.session)
      expect(dispatches).toHaveLength(1)
      expect(dispatches[0]?.type === 'llm/dispatch' && dispatches[0].data.sessionId).toBe('dispatch-isolated-b')
      await second.dispose()
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps working with a tool-call step that dispatches twice', async () => {    const adapter = new RecordingAdapter([
    toolCallResponse('c1', 'echo', { text: 'one' }),
    textResponse('done'),
  ])
  const ctx = await makeHarness(adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'echo',
    description: 'echo back',
    parameters: { text: { type: 'string' } },
    execute(args) {
      return Promise.resolve([{ type: 'text', text: `echo: ${String(args.text)}` }])
    },
  }))
  const dispose = installRequestDispatchRecorder(ctx)
  try {
    const agent = await ctx.agentLoop.create(SessionId('dispatch-tools'), { provider: 'mock', model: 'mock' })
    send(agent, 'go')
    await waitForIdle(ctx, agent)
    const dispatches = sessionEvents(agent.session).filter(event => event.type === 'llm/dispatch')
    expect(dispatches).toHaveLength(2)
    expect(dispatches.map(event => event.type === 'llm/dispatch' && [event.data.turn, event.data.step]))
      .toEqual([[1, 1], [1, 2]])
  } finally {
    dispose()
    await ctx.fiber.dispose()
  }
  })
})

/** Every recorded dispatch of one session, in commit order. */
function dispatchesOf(session: { snapshotEvents: () => readonly SessionEvent[] }) {
  return session.snapshotEvents().flatMap(event => event.type === 'llm/dispatch' ? [event] : [])
}

function registerEcho(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'echo',
    description: 'echo back',
    parameters: { text: { type: 'string' } },
    execute(args) {
      return Promise.resolve([{ type: 'text', text: `echo: ${String(args.text)}` }])
    },
  }))
}

describe('buildRequestView', () => {
  it('rebuilds messages, tools, and tool history byte-equal to the controlled adapter capture', async () => {
    const adapter = new RecordingAdapter([
      toolCallResponse('c1', 'echo', { text: 'one' }, 'calling'),
      textResponse('done'),
    ])
    const ctx = await makeHarness(adapter)
    registerEcho(ctx)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('view-exact'), { provider: 'mock', model: 'mock' })
      send(agent, 'go')
      await waitForIdle(ctx, agent)

      const dispatches = dispatchesOf(agent.session)
      expect(dispatches).toHaveLength(2)
      for (const [index, dispatch] of dispatches.entries()) {
        if (dispatch.type !== 'llm/dispatch') throw new Error('expected llm/dispatch')
        const view = await buildRequestView(ctx, {
          sessionId: SessionId('view-exact'),
          dispatchSeq: dispatch.seq,
          projections: currentSessionMessageProjections,
        })
        const request = adapter.requests[index]!
        expect(view.dispatchSeq).toBe(dispatch.seq)
        expect(view.prefixEnd).toBe(dispatch.data.prefixEnd)
        expect(view.turn).toBe(dispatch.data.turn)
        expect(view.step).toBe(dispatch.data.step)
        // Verbatim equality with the provider-side capture of the real request.
        expect(view.messages).toEqual(request.messages)
        expect(view.tools).toEqual(request.tools)
        expect(view.toolHistory).toEqual(request.toolHistory)
        expect(view.header.config).toEqual({
          provider: request.provider,
          model: request.model,
          ...request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort },
          ...request.temperature === undefined ? {} : { temperature: request.temperature },
          ...request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens },
          ...request.stop === undefined ? {} : { stop: request.stop },
        })
      }
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('rebuilds each dispatch from its own prefix after compaction and a header change', async () => {
    const adapter = new RecordingAdapter([textResponse('one'), textResponse('after change')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('view-compaction'), { provider: 'mock', model: 'mock' })
      send(agent, 'first')
      await waitForIdle(ctx, agent)

      const nodes = agent.session.surface.nodes
      agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: '[summary]' }],
        source: { kind: 'user' },
      }), {
        surfaceOp: { op: 'replace', startSeq: nodes[1]!, endSeq: nodes[2]! },
        sourceEventSeqs: [nodes[1]!, nodes[2]!],
      })
      ctx.on('agent/request', async (_payload, next) => ({ ...await next(), maxTokens: 1_024 }))
      send(agent, 'second')
      await waitForIdle(ctx, agent)

      const dispatches = dispatchesOf(agent.session)
      expect(dispatches).toHaveLength(2)
      const views = await Promise.all(dispatches.map(dispatch => buildRequestView(ctx, {
        sessionId: SessionId('view-compaction'),
        dispatchSeq: dispatch.seq,
      })))
      expect(views[0]?.messages).toEqual(adapter.requests[0]!.messages)
      expect(views[1]?.messages).toEqual(adapter.requests[1]!.messages)
      expect(views[1]?.messages.some(message => message.content.some(block =>
        block.type === 'text' && block.text === '[summary]'))).toBe(true)
      expect(views[1]?.header.config.maxTokens).toBe(1_024)
      expect(views[0]?.header.config.maxTokens).toBeUndefined()
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('rebuilds a dispatch whose session was disposed from durable storage', async () => {
    const adapter = new RecordingAdapter([textResponse('durable')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const handle = await ctx.agents.create({
        sessionId: SessionId('view-cold'),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      send(handle.agent, 'cold read')
      await waitForIdle(ctx, handle.agent)
      const dispatch = dispatchesOf(handle.agent.session)[0]
      if (dispatch?.type !== 'llm/dispatch') throw new Error('expected llm/dispatch')
      const request = adapter.requests[0]!
      const settlement = handle.agent.session.snapshotEvents()
        .flatMap(event => event.type === 'llm/dispatch-settled' ? [event.data.settlementSeq] : [])[0]
      await ctx.sessions.flush(handle.agent.session)
      await handle.dispose()
      expect(ctx.sessions.get(SessionId('view-cold'))).toBeUndefined()

      const view = await buildRequestView(ctx, {
        sessionId: SessionId('view-cold'),
        dispatchSeq: dispatch.seq,
        projections: currentSessionMessageProjections,
      })
      expect(view.messages).toEqual(request.messages)
      expect(view.header.config.model).toBe('mock')
      expect(view.dispatchSeq).toBe(dispatch.seq)
      expect(view.settlementSeq).toBe(settlement)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('refuses an unknown session and an unknown dispatch', async () => {
    const adapter = new RecordingAdapter([textResponse('one')])
    const ctx = await makeHarness(adapter)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('view-errors'), { provider: 'mock', model: 'mock' })
      send(agent, 'go')
      await waitForIdle(ctx, agent)
      const dispatch = dispatchesOf(agent.session)[0]
      if (dispatch?.type !== 'llm/dispatch') throw new Error('expected llm/dispatch')

      const missingSession = await buildRequestView(ctx, {
        sessionId: SessionId('missing-session'),
        dispatchSeq: dispatch.seq,
      }).then(() => undefined, (error: unknown) => error)
      expect(missingSession).toBeInstanceOf(RequestViewError)
      expect(missingSession).toMatchObject({ code: 'SESSION_NOT_FOUND' })

      const missingDispatch = await buildRequestView(ctx, {
        sessionId: SessionId('view-errors'),
        dispatchSeq: SessionSeq(Number(dispatch.seq) + 100_000),
      }).then(() => undefined, (error: unknown) => error)
      expect(missingDispatch).toBeInstanceOf(RequestViewError)
      expect(missingDispatch).toMatchObject({ code: 'DISPATCH_NOT_FOUND' })
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('refuses a prefix that needs a message projection the caller did not supply', async () => {
    const adapter = new RecordingAdapter([textResponse('one')])
    const ctx = await makeHarness(adapter)
    // Appending an image/offload event requires the live store to interpret it.
    ctx.sessions.registerMessageProjection(imageOffloadProjection)
    const dispose = installRequestDispatchRecorder(ctx)
    try {
      const agent = await ctx.agentLoop.create(SessionId('view-projection'), { provider: 'mock', model: 'mock' })
      send(agent, 'go')
      await waitForIdle(ctx, agent)
      // Log a durable image offload over an image the message actually carries,
      // then a dispatch whose prefix contains it.
      const session = agent.session
      const imageMessage = session.append('user/message', createUserMessage({
        content: [{
          type: 'image',
          attachment: {
            attachmentId: 'sha256:request-view',
            mediaType: 'image/png',
            bytes: 1,
            width: 1,
            height: 1,
          },
        }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('image/offload', { targets: [{ seq: imageMessage.seq, imageIndexes: [0] }] })
      const prefixEnd = SessionSeq(Number(session.seq) - 1)
      const dispatch = session.append('llm/dispatch', {
        sessionId: session.id,
        prefixEnd,
        turn: 1,
        step: 1,
      })

      const unsupported = await buildRequestView(ctx, {
        sessionId: SessionId('view-projection'),
        dispatchSeq: dispatch.seq,
        projections: [],
      }).then(() => undefined, (error: unknown) => error)
      expect(unsupported).toBeInstanceOf(RequestViewUnsupportedError)
      expect((unsupported as Error).message).toMatch(/image\/offload/)

      // The installed projection set rebuilds the exact offloaded message.
      const view = await buildRequestView(ctx, {
        sessionId: SessionId('view-projection'),
        dispatchSeq: dispatch.seq,
        projections: currentSessionMessageProjections,
      })
      const offloaded = view.messages.at(-1)
      expect(offloaded?.content[0]).toMatchObject({ type: 'image', offloaded: true })
      expect(view.projectionTypes).toContain('image/offload')
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })
})
