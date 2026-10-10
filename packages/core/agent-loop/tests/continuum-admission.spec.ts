/**
 * Continuum P0 feasibility: existing loop seams admit logged recall and expose
 * the complete routed request to a test-only budget guard. The external model
 * is scripted; these cases establish neither memory quality nor exact token
 * limits. Session event commitment is tested without a persistence backend.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, isAgentLoopRequest, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, GenerateOptions, LlmResolvedModelInfo, Message, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { RequestContext, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter, { type TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'continuum-p0': { kind: 'continuum-p0' } & ContextFormed
  }
}

const RECALL = 'Recorded requirement: preserve the original invoice amount, 731.25.'
const HEADROOM = 32
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Scripted external model with an adapter-owned capacity and output default. */
class CapacityAdapter extends MockAdapter {
  constructor(readonly capacity: number) {
    super(Array.from({ length: 3 }, () => textResponse('done')), undefined, 64)
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { ...await super.resolveModel(provider, model), context: { contextWindow: this.capacity } }
  }
}

interface Harness {
  ctx: Context
  agent: Agent
  large: CapacityAdapter
  small: CapacityAdapter
  events: SessionEvent[]
}

interface ObservedRequest {
  request: GenerateOptions
  context: RequestContext
  measurement: TokenMeasurement
  events: SessionEvent[]
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {
    personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false,
  })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const large = new CapacityAdapter(4096)
  const small = new CapacityAdapter(256)
  ctx.effect(() => ctx.llm.registerAdapter(['large'], large))
  ctx.effect(() => ctx.llm.registerAdapter(['small'], small))
  const events: SessionEvent[] = []
  ctx.on('session/event', (_session, event) => { events.push(structuredClone(event)) })
  const agent = await ctx.agentLoop.create(SessionId('continuum-p0'), { provider: 'large', model: 'model' })
  return { ctx, agent, large, small, events }
}

function recallMessage(): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text: RECALL }], source: { kind: 'continuum-p0' } })
}

/** Test-only consumer using the same-step accepted-message extension point. */
function installRecall(ctx: Context, load: () => Promise<UserMessage>, enabled = true): () => void {
  return ctx.on('agent/pre-step', async ({ signal }, next) => {
    const decision = await next()
    if (!enabled || decision.kind === 'reject') return decision
    const recalled = await load()
    signal.throwIfAborted()
    return { ...decision, messages: [...decision.messages, recalled] }
  })
}

/** Observe the logged final request; optionally refuse it before adapter dispatch. */
function observeRequests(h: Harness, rejectOverBudget = false): ObservedRequest[] {
  const observations: ObservedRequest[] = []
  h.ctx.on('llm/stream', (request, next) => {
    if (!isAgentLoopRequest(request)) return next()
    const context = h.agent.session.requestContext()
    if (context === undefined || context.contextWindow === undefined || request.maxTokens === undefined) {
      throw new Error('the P0 adapter must resolve capacity and the output reserve')
    }
    const measurement = h.ctx.tokenMeter.measure(h.agent.session)
    observations.push({ request, context, measurement, events: structuredClone(h.events) })
    if (rejectOverBudget && measurement.totalTokens + request.maxTokens + HEADROOM > context.contextWindow) {
      throw new LlmError('P0 estimated request budget exceeded before adapter dispatch', 'P0_REQUEST_BUDGET_EXCEEDED')
    }
    return next()
  })
  return observations
}

function textOf(messages: readonly Message[]): string[] {
  return messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('Continuum P0 native admission seams', () => {
  it('includes same-step recall only after the pending input batch reaches the log', async () => {
    const h = await harness()
    const pending: TokenMeasurement[] = []
    h.ctx.on('agent/pre-step', async ({ agent }, next) => {
      pending.push(h.ctx.tokenMeter.measure(agent.session))
      const decision = await next()
      pending.push(h.ctx.tokenMeter.measure(agent.session))
      return decision
    })
    const recalled = recallMessage()
    installRecall(h.ctx, () => Promise.resolve(recalled))
    const observed = observeRequests(h)

    await send(h.agent, 'What amount must we preserve?')

    expect(h.large.requests).toHaveLength(1)
    expect(textOf(h.large.requests[0]!.messages)).toEqual(['What amount must we preserve?', RECALL])
    expect(pending).toHaveLength(2)
    expect(pending[0]).toEqual(pending[1])
    expect(pending[0]!.nodes).toEqual([])
    expect(observed).toHaveLength(1)
    const current = observed[0]!
    const committedInputs = current.events.filter(event => event.type === 'user/message')
    expect(committedInputs.map(event => event.data.id)).toContain(recalled.id)
    expect(current.measurement.totalTokens).toBeGreaterThan(pending[0]!.totalTokens)
    for (const event of committedInputs) {
      expect(current.measurement.nodes.find(node => node.seq === event.seq)?.tokens).toBeGreaterThan(0)
    }
    expect(current.measurement.logRevision).toBe(current.events.length)
  })

  it.each(['large', 'small'] as const)('uses the prepared %s route to allow or reject the complete logged request', async (provider) => {
    const h = await harness()
    installRecall(h.ctx, () => Promise.resolve(recallMessage()))
    h.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider }))
    const observed = observeRequests(h, true)
    const input = 'x'.repeat(4096)

    await send(h.agent, input)

    expect(observed).toHaveLength(1)
    const final = observed[0]!
    expect(final.request).toMatchObject({ provider, model: 'model', maxTokens: 64 })
    expect(final.context).toMatchObject({ provider, model: 'model', contextWindow: h[provider].capacity })
    expect(textOf(final.request.messages)).toEqual([input, RECALL])
    expect(h.events.filter(event => event.type === 'user/message')).toHaveLength(2)
    expect(h.agent.session.requestHeader()?.config.provider).toBe(provider)
    expect(h.small.requests).toHaveLength(0)
    if (provider === 'large') {
      expect(h.large.requests).toHaveLength(1)
      expect(final.measurement.totalTokens + 64 + HEADROOM).toBeLessThanOrEqual(h.large.capacity)
    } else {
      expect(h.large.requests).toHaveLength(0)
      expect(final.measurement.totalTokens + 64 + HEADROOM).toBeGreaterThan(h.small.capacity)
      expect(h.events.find(event => event.type === 'turn/end')).toMatchObject({
        data: { reason: { kind: 'error', error: { code: 'P0_REQUEST_BUDGET_EXCEEDED' } } },
      })
      // This late guard prevents dispatch; it cannot undo the committed input batch.
      expect(h.agent.session.deriveMessages()).toEqual(final.request.messages)
    }
  })

  it('reconstructs the complete dispatched messages and route from detached event records', async () => {
    const h = await harness()
    installRecall(h.ctx, () => Promise.resolve(recallMessage()))
    const observed = observeRequests(h)

    await send(h.agent, 'Read the recorded invoice requirement.')

    expect(observed).toHaveLength(1)
    const final = observed[0]!
    expect(final.events.map(event => event.seq)).toEqual(final.events.map((_event, index) => index))
    const replay = Session.create(h.agent.session.id, final.events)
    expect(replay.deriveMessages()).toEqual(h.large.requests[0]!.messages)
    expect(replay.requestHeader()?.config).toMatchObject({
      provider: final.request.provider, model: final.request.model, maxTokens: final.request.maxTokens,
    })
    expect(replay.requestContext()).toEqual(final.context)
    expect(textOf(replay.deriveMessages())).toContain(RECALL)
  })

  it('counts the system prompt and tool schema as well as new input and recall before dispatch', async () => {
    const h = await harness()
    const system = 'Use verified invoice facts. '.repeat(12).trim()
    h.ctx.effect(() => h.ctx.systemPrompt.section({ name: 'continuum-p0-policy', order: 0, text: system }))
    h.ctx.effect(() => h.ctx.tools.register(defineContentToolFixture({
      name: 'lookup_invoice',
      description: 'Read the original invoice record. '.repeat(32),
      parameters: { invoiceId: { type: 'string' } },
      execute: async () => [{ type: 'text', text: 'unused' }],
    })))
    installRecall(h.ctx, () => Promise.resolve(recallMessage()))
    h.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider: 'small' }))
    const observed = observeRequests(h, true)

    await send(h.agent, 'Check the invoice.')

    expect(observed).toHaveLength(1)
    const final = observed[0]!
    expect(textOf(final.request.messages)).toEqual([system, 'Check the invoice.', RECALL])
    expect(final.request.tools).toEqual([expect.objectContaining({ name: 'lookup_invoice' })])
    const systemEvent = final.events.find(event => event.type === 'system/message')
    expect(systemEvent).toBeDefined()
    expect(final.measurement.nodes.find(node => node.seq === systemEvent!.seq)?.tokens).toBeGreaterThan(0)
    const inputEvents = final.events.filter(event => event.type === 'user/message')
    expect(inputEvents).toHaveLength(2)
    for (const event of inputEvents) {
      expect(final.measurement.nodes.find(node => node.seq === event.seq)?.tokens).toBeGreaterThan(0)
    }

    const header = h.agent.session.requestHeader()!
    const withoutTools = h.ctx.tokenMeter.measure(h.agent.session, { ...header, tools: [] })
    expect(withoutTools.surfaceTokens).toBe(final.measurement.surfaceTokens)
    expect(withoutTools.totalTokens).toBeLessThan(final.measurement.totalTokens)
    expect(withoutTools.totalTokens + 64 + HEADROOM).toBeLessThanOrEqual(h.small.capacity)
    expect(final.measurement.totalTokens + 64 + HEADROOM).toBeGreaterThan(h.small.capacity)
    expect(h.large.requests).toHaveLength(0)
    expect(h.small.requests).toHaveLength(0)
    expect(h.events.find(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error', error: { code: 'P0_REQUEST_BUDGET_EXCEEDED' } } },
    })
  })

  it('leaves ordinary input unchanged and does not load recall while the test consumer is off', async () => {
    const h = await harness()
    let loads = 0
    installRecall(h.ctx, () => {
      loads += 1
      return Promise.resolve(recallMessage())
    }, false)

    await send(h.agent, 'Continue without memory.')

    expect(loads).toBe(0)
    expect(h.large.requests).toHaveLength(1)
    expect(textOf(h.large.requests[0]!.messages)).toEqual(['Continue without memory.'])
    expect(h.events.filter(event => event.type === 'user/message').map(event => event.data.source.kind)).toEqual(['user'])
  })

  it('removes recall when its listener is disposed', async () => {
    const h = await harness()
    let loads = 0
    const dispose = installRecall(h.ctx, () => {
      loads += 1
      return Promise.resolve(recallMessage())
    })
    dispose()

    await send(h.agent, 'Continue after unloading recall.')

    expect(loads).toBe(0)
    expect(h.large.requests).toHaveLength(1)
    expect(textOf(h.large.requests[0]!.messages)).toEqual(['Continue after unloading recall.'])
  })

  it('does not admit a late asynchronous recall after the turn is cancelled', async () => {
    const h = await harness()
    const entered = Promise.withResolvers<undefined>()
    const result = Promise.withResolvers<UserMessage>()
    installRecall(h.ctx, () => {
      entered.resolve(undefined)
      return result.promise
    })
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Recall before answering.' }], source: { kind: 'user' } }))
    try {
      await entered.promise
      expect(h.events.some(event => event.type === 'user/message')).toBe(false)
      h.agent.cancel({ kind: 'user' })
      result.resolve(recallMessage())
      await h.agent.whenIdle()

      expect(h.large.requests).toHaveLength(0)
      expect(h.small.requests).toHaveLength(0)
      expect(h.events.filter(event => event.type === 'user/message' || event.type === 'request/header')).toEqual([])
      expect(h.events.find(event => event.type === 'turn/end')).toMatchObject({
        data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
      })
    } finally {
      h.agent.cancel({ kind: 'user' })
      result.resolve(recallMessage())
      await h.agent.whenIdle()
    }
  })
})
