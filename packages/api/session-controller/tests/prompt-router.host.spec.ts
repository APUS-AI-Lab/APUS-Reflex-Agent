import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId, Session, interruptedTurnClosers } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionCommandController } from '../src/commands.ts'
import { ApiSessionAgentController } from '../src/agent.ts'
import { installModelSelectionProjection } from '../src/model-selection-projection.ts'
import { SessionPromptRouting } from '../src/prompt-router.ts'
import type { SessionRequestId } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const baseline = { provider: 'fixture', model: 'default' }
const selected = { provider: 'fixture', model: 'specialist' }
class Adapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  firstTool = false
  override async listModels(provider: string) {
    return Promise.all(['default', 'specialist', 'manual'].map(model => this.resolveModel(provider, model)))
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } }
  }
  override async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    if (this.firstTool && this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('route-tool'), name: 'unknown-fixture', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
async function harness(install = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(TypertRegistry)
  installModelSelectionProjection(ctx)
  ctx.provide('agentDefaultModel', { currentSelection: () => baseline, saveSelection: async () => {} } as never)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SessionId('routing'), baseline)
  const agents = new ApiSessionAgentController(ctx)
  if (install) agents.selectionFor(agent)
  const routing = new SessionPromptRouting(ctx, agents)
  const message = createUserMessage({ content: [{ type: 'text', text: 'solve it' }], source: { kind: 'user' } })
  const request = { agent, requestId: 'route-request' as SessionRequestId, message, baseline }
  const admit = async (_signal?: AbortSignal, select?: () => void) => {
    agent.followup(message)
    select?.()
    return { accepted: true as const }
  }
  return { ctx, agent, agents, routing, request, admit, adapter }
}
it('applies routing only to the admitted turn and restores the next turn baseline', async () => {
  const h = await harness()
  h.routing.register({ route: async () => selected })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(h.adapter.requests[0]?.model).toBe('specialist')
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'next' }], source: { kind: 'user' } }))
  await h.agent.whenIdle()
  expect(h.adapter.requests[1]?.model).toBe('default')
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'model/selection')).toBe(false)
})
it('cancellation settles admission without waiting for an uncooperative router or queuing input', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>()
  const late = Promise.withResolvers<typeof selected>()
  h.routing.register({ route: async () => { entered.resolve(undefined); return late.promise } })
  const admission = h.routing.admit(h.request, h.admit)
  const rejected = expect(admission).rejects.toBeDefined()
  await entered.promise
  h.agent.cancel({ kind: 'user' })
  await rejected
  late.resolve(selected)
  await h.agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(0)
  expect(h.agent.inbox.nextTurn).toHaveLength(0)
})
it('unloading a router cancels pending admission and allows a replacement registration', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>()
  const dispose = h.routing.register({ route: async () => { entered.resolve(undefined); return new Promise(() => {}) } })
  expect(() => h.routing.register({ route: async () => selected })).toThrow(/already/)
  const admission = h.routing.admit(h.request, h.admit)
  const rejected = expect(admission).rejects.toBeDefined()
  await entered.promise
  dispose()
  await rejected
  expect(() => h.routing.register({ route: async () => undefined })).not.toThrow()
  expect(h.adapter.requests).toHaveLength(0)
})
it('preserves explicit model selection and skips the router', async () => {
  const h = await harness()
  h.agents.selectForNextRequest(h.agent, selected)
  const route = vi.fn(async () => baseline)
  h.routing.register({ route })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(route).not.toHaveBeenCalled()
  expect(h.adapter.requests[0]?.model).toBe('specialist')
})
it('restores the recorded baseline on a fresh controller after an interrupted automatic turn', async () => {
  const h = await harness(false)
  h.agent.session.append('model/automatic-selection', { requestId: h.request.requestId, selection: selected, baseline })
  h.agent.session.append('request/header', { header: { config: selected }, reason: 'initial' })
  const fresh = h.agents
  expect(fresh.selectionFor(h.agent).current).toEqual(baseline)
  expect(fresh.hasExplicitSelection(h.agent)).toBe(false)
})
it('keeps a later manual choice when the automatic turn releases its selection', async () => {
  const h = await harness()
  const release = h.agents.installAutomaticSelection(h.agent, selected, baseline, h.request.requestId)
  const manual = { provider: 'fixture', model: 'manual' }
  h.agents.selectForNextRequest(h.agent, manual)
  release()
  expect(h.agents.selectionFor(h.agent).current).toEqual(manual)
})
it('does not apply a late route to input arriving during the decision', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>()
  const late = Promise.withResolvers<typeof selected>()
  h.routing.register({ route: async () => { entered.resolve(undefined); return late.promise } })
  const admission = h.routing.admit(h.request, h.admit)
  await entered.promise
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'earlier competing input' }], source: { kind: 'user' } }))
  late.resolve(selected)
  await admission
  await h.agent.whenIdle()
  expect(h.adapter.requests.map(request => request.model)).toEqual(['default', 'default'])
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'model/automatic-selection')).toBe(false)
})
it('does not record an automatic selection when original admission fails', async () => {
  const h = await harness()
  h.routing.register({ route: async () => selected })
  await expect(h.routing.admit(h.request, async () => { throw new Error('admission failed') })).rejects.toThrow('admission failed')
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'model/automatic-selection')).toBe(false)
  expect(h.agents.selectionFor(h.agent).current).toEqual(baseline)
})
it('reports the baseline as the next route after an automatic turn ends', async () => {
  const h = await harness()
  h.routing.register({ route: async () => selected })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.snapshot(h.agent.session).values.modelSelection).toEqual({ mode: 'auto', lastUsed: selected, next: baseline })
})

it('routes through the actual prompt command and serializes later manual selection', async () => {
  const h = await harness()
  h.ctx.provide('attachments', { admitPromptContent: async (content: UserMessage['content']) => content } as never)
  h.ctx.provide('fileUploads', { bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }) } as never)
  const command = new SessionCommandController(h.ctx, h.agents, '/workspace', h.routing)
  const entered = Promise.withResolvers<undefined>()
  const late = Promise.withResolvers<typeof selected>()
  h.routing.register({ route: async () => { entered.resolve(undefined); return late.promise } })
  const admitted = command.prompt({ sessionId: h.agent.id, requestId: h.request.requestId,
    content: [{ type: 'text', text: 'actual input' }], mode: 'queue' })
  await entered.promise
  const manual = command.selectModel({ sessionId: h.agent.id, provider: 'fixture', model: 'manual' })
  late.resolve(selected)
  await admitted
  await manual
  await h.agent.whenIdle()
  expect(h.adapter.requests[0]?.model).toBe('specialist')
  expect(h.agents.selectionFor(h.agent).current.model).toBe('manual')
  const input = h.agent.session.snapshotEvents().find(event => event.type === 'user/message')
  expect(input?.data).toMatchObject({ content: [{ type: 'text', text: 'actual input' }], source: { rpcId: h.request.requestId } })
})

it('provider removal during a tool batch keeps the admitted route for its remaining steps', async () => {
  const h = await harness()
  h.adapter.firstTool = true
  const dispose = h.routing.register({ route: async () => selected })
  h.agent.ctx.on('session/event', (_session, event) => {
    if (event.type === 'tool/call') dispose()
  })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(h.adapter.requests.map(request => request.model)).toEqual(['specialist', 'specialist'])
  expect(h.agents.selectionFor(h.agent).current).toEqual(baseline)
})
it('never submits a text prompt cancelled during attachment admission', async () => {
  const h = await harness()
  const admitting = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<UserMessage['content']>()
  h.ctx.provide('attachments', { admitPromptContent: async () => { admitting.resolve(undefined); return release.promise } } as never)
  h.ctx.provide('fileUploads', { bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }) } as never)
  const command = new SessionCommandController(h.ctx, h.agents, '/workspace', h.routing)
  h.routing.register({ route: async () => selected })
  const promise = command.prompt({ sessionId: h.agent.id, requestId: h.request.requestId,
    content: [{ type: 'text', text: 'cancel during admission' }], mode: 'queue' })
  const rejected = expect(promise).rejects.toBeDefined()
  await admitting.promise
  command.cancel({ sessionId: h.agent.id })
  release.resolve([{ type: 'text', text: 'cancel during admission' }])
  await rejected
  await h.agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(0)
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'model/automatic-selection')).toBe(false)
})
it('serializes concurrent command submissions without sharing the first input route', async () => {
  const h = await harness()
  h.ctx.provide('attachments', { admitPromptContent: async (content: UserMessage['content']) => content } as never)
  h.ctx.provide('fileUploads', { bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }) } as never)
  const command = new SessionCommandController(h.ctx, h.agents, '/workspace', h.routing)
  const seen: string[] = []
  h.routing.register({ route: async ({ message }) => {
    seen.push(message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''))
    return selected
  } })
  await Promise.all(['first', 'second'].map(text => command.prompt({
    sessionId: h.agent.id, requestId: text as SessionRequestId,
    content: [{ type: 'text', text }], mode: 'queue',
  })))
  await h.agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(2)
  expect(h.adapter.requests[0]?.model).toBe('specialist')
  // A still-running first turn queues the second input using the restored baseline.
  expect(seen).toEqual(['first'])
  expect(h.adapter.requests[1]?.model).toBe('default')
})
it('keeps the existing Session route when the global default differs and routing abstains', async () => {
  const h = await harness()
  h.agent.session.append('request/header', { header: { config: selected }, reason: 'initial' })
  const route = vi.fn(async (_request: import('../src/prompt-router.ts').SessionPromptRouteRequest) => undefined)
  h.routing.register({ route })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(route.mock.calls[0]?.[0]).toMatchObject({ baseline: selected })
  expect(h.adapter.requests[0]?.model).toBe('specialist')
})
it('queues ordinary input without Jev while another owner holds maintenance', async () => {
  const h = await harness()
  const release = Promise.withResolvers<undefined>()
  const maintenance = h.agent.runMaintenance(() => release.promise)
  const route = vi.fn(async () => selected)
  h.routing.register({ route })
  try {
    await h.routing.admit(h.request, h.admit)
    expect(route).not.toHaveBeenCalled()
    expect(h.agent.inbox.nextTurn).toHaveLength(1)
  } finally {
    release.resolve(undefined)
    await maintenance
    await h.agent.whenIdle()
  }
  expect(h.adapter.requests[0]?.model).toBe('default')
})
it('projects the baseline before automatic admission has opened a turn', async () => {
  const h = await harness(false)
  h.agent.session.append('model/automatic-selection', { requestId: h.request.requestId, selection: selected, baseline })
  expect(h.ctx.sessionProjections.snapshot(h.agent.session).values.modelSelection?.next).toEqual(baseline)
  expect(h.agents.selectionFor(h.agent).current).toEqual(baseline)
})
it('projects the baseline after native recovery closes an interrupted automatic request', async () => {
  const h = await harness(false)
  h.agent.session.append('model/automatic-selection', { requestId: h.request.requestId, selection: selected, baseline })
  h.agent.session.append('turn/start', { turn: 1 })
  h.agent.session.append('step/start', { turn: 1, step: 1 })
  h.agent.session.append('request/header', { header: { config: selected }, reason: 'initial' })
  expect(h.ctx.sessionProjections.snapshot(h.agent.session).values.modelSelection?.next).toEqual(selected)
  const original = h.agent.session.snapshotEvents()
  const recovered = Session.create(SessionId('recovered-route'), [...original, ...interruptedTurnClosers(original)])
  expect(h.ctx.sessionProjections.snapshot(recovered).values.modelSelection?.next).toEqual(baseline)
})
it('does not turn an asynchronous routing failure into ordinary admission', async () => {
  const h = await harness()
  const failure = new Error(`agent "${h.agent.id}" already has active work`)
  h.routing.register({ route: async () => { throw failure } })
  await expect(h.routing.admit(h.request, h.admit)).rejects.toBe(failure)
  expect(h.agent.inbox.nextTurn).toHaveLength(0)
  expect(h.adapter.requests).toHaveLength(0)
})

it('keeps competing input on baseline when it arrives during model validation', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const resolveModel = h.adapter.resolveModel.bind(h.adapter)
  vi.spyOn(h.adapter, 'resolveModel').mockImplementation(async (provider, model) => {
    entered.resolve(undefined)
    await release.promise
    return resolveModel(provider, model)
  })
  h.routing.register({ route: async () => selected })
  const admission = h.routing.admit(h.request, h.admit)
  await entered.promise
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'competing validation input' }], source: { kind: 'user' } }))
  release.resolve(undefined)
  await admission
  await h.agent.whenIdle()
  expect(h.adapter.requests.map(request => request.model)).toEqual(['default', 'default'])
})
it('keeps competing input on baseline when it arrives during attachment admission', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  h.routing.register({ route: async () => selected })
  const admission = h.routing.admit(h.request, async (signal, select) => {
    entered.resolve(undefined)
    await release.promise
    signal?.throwIfAborted()
    return h.admit(signal, select)
  })
  await entered.promise
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'competing attachment input' }], source: { kind: 'user' } }))
  release.resolve(undefined)
  await admission
  await h.agent.whenIdle()
  expect(h.adapter.requests.map(request => request.model)).toEqual(['default', 'default'])
})
it('preserves an adapter-supported automatic reasoning effort in the actual request', async () => {
  const h = await harness()
  h.routing.register({ route: async () => ({ ...selected, reasoningEffort: ReasoningEffortId('high') }) })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(h.adapter.requests[0]).toMatchObject({ model: 'specialist', reasoningEffort: 'high' })
})
it('propagates maintenance infrastructure failures instead of admitting input', async () => {
  const h = await harness()
  const failure = new Error('maintenance unavailable')
  vi.spyOn(h.agent, 'runMaintenance').mockImplementation(() => { throw failure })
  h.routing.register({ route: async () => selected })
  await expect(h.routing.admit(h.request, h.admit)).rejects.toBe(failure)
  expect(h.agent.inbox.nextTurn).toHaveLength(0)
})
it('native lifecycle disposal aborts pending routing before Agent unregistration', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>()
  h.routing.register({ route: async () => { entered.resolve(undefined); return new Promise(() => {}) } })
  const admission = h.routing.admit(h.request, h.admit)
  const rejected = expect(admission).rejects.toBeDefined()
  await entered.promise
  await h.ctx.fiber.dispose()
  await rejected
  expect(h.adapter.requests).toHaveLength(0)
})

it('releases a fixed model through the command and restores automatic mode from durable history', async () => {
  const h = await harness()
  h.agents.selectForNextRequest(h.agent, selected)
  const command = new SessionCommandController(h.ctx, h.agents, '/workspace', h.routing)
  expect(h.ctx.sessionProjections.snapshot(h.agent.session).values.modelSelection?.mode).toBe('fixed')
  await expect(command.resetModelSelection({ sessionId: h.agent.id })).resolves.toEqual({ selected })
  expect(h.agents.hasExplicitSelection(h.agent)).toBe(false)
  const recovered = Session.create(SessionId('reset-route'), h.agent.session.snapshotEvents())
  expect(h.ctx.sessionProjections.snapshot(recovered).values.modelSelection).toEqual({
    mode: 'auto', lastUsed: null, next: selected,
  })
  const route = vi.fn(async () => baseline)
  h.routing.register({ route })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(route).toHaveBeenCalledOnce()
  expect(h.adapter.requests[0]?.model).toBe('default')
  expect(h.agents.selectionFor(h.agent).current).toEqual(selected)
})

it('keeps automatic-mode reset idempotent during an automatically routed turn', async () => {
  const h = await harness()
  const release = h.agents.installAutomaticSelection(h.agent, selected, baseline, h.request.requestId)
  const command = new SessionCommandController(h.ctx, h.agents, '/workspace', h.routing)
  const seq = h.agent.session.seq
  await expect(command.resetModelSelection({ sessionId: h.agent.id })).resolves.toEqual({ selected: baseline })
  expect(h.agent.session.seq).toBe(seq)
  expect(h.agents.selectionFor(h.agent).current).toEqual(selected)
  release()
  expect(h.agents.selectionFor(h.agent).current).toEqual(baseline)
  const recovered = Session.create(SessionId('idempotent-auto'), h.agent.session.snapshotEvents())
  expect(h.ctx.sessionProjections.snapshot(recovered).values.modelSelection?.next).toEqual(baseline)
})


it('uses only a prepared baseline when the total entry deadline expires', async () => {
  const h = await harness()
  const late = Promise.withResolvers<typeof selected>()
  h.routing.register({ deadlineMs: 10, validateBaseline: () => {}, route: () => late.promise })
  await h.routing.admit(h.request, h.admit)
  await h.agent.whenIdle()
  expect(h.adapter.requests[0]?.model).toBe('default')
  late.resolve(selected)
  await Promise.resolve()
  expect(h.agents.selectionFor(h.agent).current).toEqual(baseline)
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'model/automatic-selection')
    .map(event => event.data.selection.model)).toEqual(['default'])
})

it('rejects before admission if baseline preparation cannot finish within the entry deadline', async () => {
  const h = await harness()
  const route = vi.fn(async () => selected)
  vi.spyOn(h.ctx.llm, 'resolveCallConfig').mockImplementation(() => new Promise(() => {}))
  h.routing.register({ deadlineMs: 10, route })
  await expect(h.routing.admit(h.request, h.admit)).rejects.toThrow('deadline')
  expect(route).not.toHaveBeenCalled()
  expect(h.agent.inbox.nextTurn).toHaveLength(0)
  expect(h.adapter.requests).toHaveLength(0)
})

it('refuses a denied baseline before route I/O or inbox admission', async () => {
  const h = await harness()
  const route = vi.fn(async () => selected)
  h.routing.register({ deadlineMs: 100, validateBaseline: () => { throw new Error('baseline denied') }, route })
  await expect(h.routing.admit(h.request, h.admit)).rejects.toThrow('baseline denied')
  expect(route).not.toHaveBeenCalled()
  expect(h.agent.inbox.nextTurn).toHaveLength(0)
})

it('rejects entry timer values that Node would reduce to one millisecond', async () => {
  const h = await harness()
  expect(() => h.routing.register({ deadlineMs: 2 ** 31, route: async () => undefined })).toThrow('deadlineMs')
})
