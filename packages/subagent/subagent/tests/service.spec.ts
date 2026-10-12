import { describe, expect, expectTypeOf, it, onTestFinished, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Context } from '@deepseek-ai/cordis'
import { type Agent } from '@deepseek-ai/dsh-agent'

import { HarnessError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import SubagentRuntime, {
  SUBAGENT_ACTIVITY_NOTE_MAX_CHARS,
  SUBAGENT_STEER_MAX_CHARS,
  foldSubagentDescriptor,
  snapshotSubagentDescriptor,
  SUBAGENT_DESCRIPTOR_VERSION,
  SubagentError,
  assertSubagentMaxDepth,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentResult,
  type SubagentRun,
  type SubagentRunEndInfo,
  type SubagentRunInfo,
  type SubagentStartRequest,
  type SubagentNativeThreadId, type SubagentEvidenceTurnId, type SubagentRecoveryId,
} from '@deepseek-ai/dsh-subagent'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

function fakeParent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

const ALL_CAPS: SubagentCapabilities = { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
const NO_CAPS: SubagentCapabilities = { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }

function baseRequest(overrides: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'do a thing' }],
    parent: fakeParent(),
    signal: new AbortController().signal,
    ...overrides,
  }
}

class StubProvider implements SubagentProvider {
  readonly inheritsParentContext = false
  startCount = 0
  lastRequest: ResolvedSubagentStartRequest | undefined

  constructor(
    readonly name: string,
    readonly capabilities: SubagentCapabilities = ALL_CAPS,
    private readonly outcome: SubagentResult = {
      output: [{ type: 'text', text: 'ok' }],
      stopReason: 'completed',
    },
  ) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.startCount += 1
    this.lastRequest = request
    return {
      id: SessionId(`child:${this.name}:${request.parent.id}`),
      localAgent: undefined,
      result: Promise.resolve(this.outcome),
      async dispose() {},
    }
  }
}

async function service(): Promise<{ ctx: Context; subagents: SubagentRuntime }> {
  const ctx = new Context()
  // The registry is a required injection of SubagentRuntime (its projection
  // units register in the constructor).
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  return { ctx, subagents: ctx.subagents }
}

describe('SubagentRuntime', () => {
  it('releases its catalog projection binding with the service fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(SubagentRuntime)
    const parent = Session.create(SessionId('catalog-parent'))
    parent.append('subagent/catalog', {
      version: 0,
      childId: SessionId('catalog-child'),
      childCreatedAt: 1,
      mode: 'one-shot',
    })
    expect(ctx.sessionProjections.snapshot(parent).values.subagentCatalog).toHaveLength(1)

    await fiber.dispose()

    expect(ctx.sessionProjections.stateOf(parent, 'subagentCatalog')).toBeUndefined()
  })

  it('registers, lists, looks up, starts, and removes providers', async () => {
    const { ctx, subagents } = await service()
    const added: string[] = []
    const removed: string[] = []
    ctx.on('subagent/provider-added', provider => void added.push(provider.name))
    ctx.on('subagent/provider-removed', name => void removed.push(name))
    const provider = new StubProvider('alpha')

    const dispose = subagents.registerProvider(provider)
    expect(subagents.list()).toEqual(['alpha'])
    expect(subagents.getProvider('alpha')).toBe(provider)
    const run = await subagents.start('alpha', baseRequest())
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    expect(provider.startCount).toBe(1)

    dispose()
    expect(added).toEqual(['alpha'])
    expect(removed).toEqual(['alpha'])
    expect(subagents.getProvider('alpha')).toBeUndefined()
  })

  it('rolls registration back when provider-added throws', async () => {
    const { ctx, subagents } = await service()
    ctx.on('subagent/provider-added', () => { throw new Error('added boom') })
    expect(() => { subagents.registerProvider(new StubProvider('alpha')) }).toThrow('added boom')
    expect(subagents.getProvider('alpha')).toBeUndefined()
  })

  it('rejects duplicate and absent provider names with typed errors', async () => {
    const { subagents } = await service()
    subagents.registerProvider(new StubProvider('dup'))
    expect(() => { subagents.registerProvider(new StubProvider('dup')) })
      .toThrow(expect.objectContaining({ code: 'DUPLICATE_PROVIDER' }))
    await expect(subagents.start('missing', baseRequest()))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
  })

  it('resolves the one-shot descriptor and exposes no provider continuation operations', async () => {
    const { subagents } = await service()
    const provider = new StubProvider('one-shot')
    subagents.registerProvider(provider)
    const request = baseRequest()
    await subagents.start('one-shot', request)

    expect(provider.lastRequest).toEqual({
      ...request,
      descriptor: {
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'one-shot',
        provider: 'one-shot',
      },
      reportActivity: expect.any(Function) as ResolvedSubagentStartRequest['reportActivity'],
      reportEvidence: expect.any(Function) as NonNullable<ResolvedSubagentStartRequest['reportEvidence']>,
    })
    expect(provider.lastRequest).not.toBe(request)
    expectTypeOf<Parameters<SubagentRuntime['start']>[1]>().toExtend<SubagentStartRequest>()
    expect('resume' in subagents).toBe(false)
    expect('resume' in provider).toBe(false)
  })

  it('does not expose manager teardown and treats public drains as no-ops when no manager was bound', async () => {
    const { subagents } = await service()
    // Without `ctx.agents` no manager exists, so nothing was ever materialized.
    expect('drainContinuable' in subagents).toBe(false)
    await expect(subagents.drainContinuableDescendants([])).resolves.toBeUndefined()
    await expect(subagents.drainContinuableChildren(fakeParent(), [SessionId('child')])).resolves.toBeUndefined()
  })

  it('treats interrupt as an accepted no-op when no manager was bound', async () => {
    const { subagents } = await service()
    // Without a continuation manager no live Activation can exist, so there is
    // nothing to stop and nothing to authorize against.
    expect(() => { subagents.interrupt(SessionId('child'), {
      kind: 'user',
      parentSessionId: SessionId('parent-1'),
    }) }).not.toThrow()
  })

  it('rejects continuable operations when their runtime services are absent', async () => {
    const { subagents } = await service()
    await expect(subagents.startContinuable({
      provider: 'unused',
      label: 'unused child',
      request: baseRequest(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONTINUATION_UNAVAILABLE' })
    await expect(subagents.sendMessage(
      fakeParent(),
      SessionId('child'),
      [{ type: 'text', text: 'hello' }],
      { signal: new AbortController().signal },
    )).rejects.toMatchObject({ code: 'CONTINUATION_UNAVAILABLE' })
  })

  it.each([
    ['agentOptions', { agentOptions: { model: 'child-model' } }],
    ['outputSchema', { outputSchema: { type: 'object', properties: {} } }],
    ['depthLimit', { maxDepth: 1 }],
    ['toolFilter', { toolFilter: { deny: ['bash'] } }],
    ['persona', { persona: 'reviewer' }],
  ] as const)('rejects unsupported %s before provider startup', async (_capability, override) => {
    const { subagents } = await service()
    const provider = new StubProvider('weak', NO_CAPS)
    subagents.registerProvider(provider)
    await expect(subagents.start('weak', baseRequest(override)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(provider.startCount).toBe(0)
  })

  it('validates depth and schema semantics before provider startup', async () => {
    const { subagents } = await service()
    const provider = new StubProvider('strong')
    subagents.registerProvider(provider)
    await expect(subagents.start('strong', baseRequest({ maxDepth: -1 })))
      .rejects.toThrow('non-negative safe integer')
    await expect(subagents.start('strong', baseRequest({ outputSchema: { type: 'string' } as never })))
      .rejects.toThrow()
    expect(provider.startCount).toBe(0)
    expect(() => { assertSubagentMaxDepth(undefined) }).not.toThrow()
  })

  it('publishes lifecycle only after async provider start and keeps parent scope', async () => {
    const { ctx, subagents } = await service()
    const ready = Promise.withResolvers<SubagentRun>()
    const result = Promise.withResolvers<SubagentResult>()
    subagents.registerProvider({
      name: 'deferred',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      start: () => ready.promise,
    })
    const parent = fakeParent('delegator')
    const events: string[] = []
    const keys: unknown[] = []
    const runIds: string[] = []
    ctx.on('subagent/start', function (info) { events.push('start'); keys.push(carrierKeyOf(this)); runIds.push(info.runId) })
    ctx.on('subagent/end', function (info) { events.push('end'); keys.push(carrierKeyOf(this)); runIds.push(info.runId) })

    const starting = subagents.start('deferred', baseRequest({ parent }))
    await Promise.resolve()
    expect(events).toEqual([])
    ready.resolve({ id: SessionId('child'), localAgent: undefined, result: result.promise, async dispose() {} })
    const run = await starting
    expect(events).toEqual(['start'])
    result.resolve({ output: [{ type: 'text', text: 'answer' }], stopReason: 'completed' })
    await run.result
    await Promise.resolve()
    expect(events).toEqual(['start', 'end'])
    expect(keys).toEqual([parent, parent])
    expect(runIds[0]).toBe(runIds[1])
  })

  it('publishes provider-reported steps only between start and end, carrying categories alone', async () => {
    const { ctx, subagents } = await service()
    const result = Promise.withResolvers<SubagentResult>()
    let report: ResolvedSubagentStartRequest['reportActivity'] | undefined
    subagents.registerProvider({
      name: 'stepping',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      async start(request) {
        report = request.reportActivity
        request.reportActivity({ kind: 'message', phase: 'started' })
        return { id: SessionId('child'), localAgent: undefined, result: result.promise, async dispose() {} }
      },
    })
    const parent = fakeParent('delegator')
    const seen: unknown[] = []
    const keys: unknown[] = []
    let runId: string | undefined
    ctx.on('subagent/start', info => void (runId = info.runId))
    ctx.on('subagent/activity', function (info) { seen.push(info); keys.push(carrierKeyOf(this)) })

    const run = await subagents.start('stepping', baseRequest({ parent }))
    report?.({ kind: 'command', phase: 'started', text: 'rm -rf /' } as never)
    report?.({ kind: 'command', phase: 'completed', outcome: 'failed' })
    result.resolve({ output: [], stopReason: 'completed' })
    await run.result
    report?.({ kind: 'command', phase: 'completed' })

    expect(seen).toEqual([{ runId, provider: 'stepping', id: SessionId('child'), kind: 'command', phase: 'started' },
      { runId, provider: 'stepping', id: SessionId('child'), kind: 'command', phase: 'completed', outcome: 'failed' }])
    expect(keys).toEqual([parent, parent])
  })

  it('publishes a trimmed, bounded note and omits an empty one', async () => {
    const { ctx, subagents } = await service()
    const result = Promise.withResolvers<SubagentResult>()
    let report: ResolvedSubagentStartRequest['reportActivity'] | undefined
    subagents.registerProvider({
      name: 'noting', capabilities: NO_CAPS, inheritsParentContext: false,
      async start(request) {
        report = request.reportActivity
        return { id: SessionId('child'), localAgent: undefined, result: result.promise, async dispose() {} }
      },
    })
    const notes: unknown[] = []
    ctx.on('subagent/activity', info => void notes.push(info.note))
    await subagents.start('noting', baseRequest())
    report?.({ kind: 'message', phase: 'completed', note: '  Reading the parser first.  ' })
    report?.({ kind: 'message', phase: 'completed', note: '   ' })
    report?.({ kind: 'message', phase: 'completed', note: 'x'.repeat(SUBAGENT_ACTIVITY_NOTE_MAX_CHARS + 5) })
    report?.({ kind: 'message', phase: 'completed', note: 'y'.repeat(SUBAGENT_ACTIVITY_NOTE_MAX_CHARS) })
    expect(notes).toEqual(['Reading the parser first.', undefined,
      `${'x'.repeat(SUBAGENT_ACTIVITY_NOTE_MAX_CHARS - 1)}…`, 'y'.repeat(SUBAGENT_ACTIVITY_NOTE_MAX_CHARS)])
    result.resolve({ output: [], stopReason: 'completed' })
  })

  describe('steerByParent', () => {
    function steeringParent(id: string): { agent: Agent; append: ReturnType<typeof vi.fn> } {
      const append = vi.fn()
      return { agent: Object.assign(fakeParent(id), { session: { id: SessionId(id), append } }), append }
    }

    async function steerableRun(steer: SubagentRun['steer'], recovery: Pick<SubagentRun, 'recover' | 'recoveryState'> = {}) {
      const { ctx, subagents } = await service()
      const result = Promise.withResolvers<SubagentResult>()
      subagents.registerProvider({
        name: 'steerable', capabilities: NO_CAPS, inheritsParentContext: false,
        async start() {
          return { id: SessionId('child'), localAgent: undefined, result: result.promise, async dispose() {}, ...steer === undefined ? {} : { steer }, ...recovery }
        },
      })
      const starts: SubagentRunInfo[] = []
      ctx.on('subagent/start', info => void starts.push(info))
      const parent = steeringParent('delegator')
      const run = await subagents.start('steerable', baseRequest({ parent: parent.agent }))
      const runId = starts[0]!.runId
      return { subagents, result, run, runId, starts, parent }
    }

    const signal = (): AbortSignal => new AbortController().signal

    it('publishes independent recovery capability without advertising human steering', async () => {
      const observation = { threadId: brandString<SubagentNativeThreadId>('native-thread'),
        turnId: brandString<SubagentEvidenceTurnId>('native-turn'), lastActivityAt: 1, retryCount: 0, waiting: false, activeSideEffects: 0 }
      const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async () => ({ state: 'continued',
        threadId: observation.threadId, previousTurnId: observation.turnId, turnId: brandString<SubagentEvidenceTurnId>('next-turn') }))
      const h = await steerableRun(undefined, { recover, recoveryState: () => observation })
      expect(h.starts[0]!.steerable).toBe(false)
      expect(h.subagents.recoveryState(h.parent.agent, h.runId)).toEqual(observation)
      await expect(h.subagents.steerByParent({ runId: h.runId, parentSessionId: h.parent.agent.session.id, text: 'human' }, signal())).rejects.toThrow()
      await expect(h.subagents.steerFromSupervisor(h.parent.agent, h.runId, 'supervisor', signal())).rejects.toThrow()
      await expect(h.subagents.recoverFromSupervisor(h.parent.agent, h.runId, {
        id: brandString<SubagentRecoveryId>('independent'), observation, interruptGraceMs: 10,
        text: '[reflex-supervision] reconcile', isCurrent: () => true,
      }, signal())).resolves.toMatchObject({ state: 'continued' })
      expect(recover).toHaveBeenCalledTimes(1)
      h.result.resolve({ output: [], stopReason: 'completed' })
      await h.run.result
    })

    it('isolates native recovery authority and gives admitted human input priority over continuation', async () => {
      const observation = { threadId: brandString<SubagentNativeThreadId>('native-thread'),
        turnId: brandString<SubagentEvidenceTurnId>('native-turn'), lastActivityAt: 1, retryCount: 0, waiting: false, activeSideEffects: 0 }
      const release = Promise.withResolvers<undefined>()
      const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async (request) => {
        expect(request.continuation()).toBeDefined()
        await release.promise
        expect(request.continuation()).toBeUndefined()
        return { state: 'stale', threadId: observation.threadId, previousTurnId: observation.turnId }
      })
      const steer = vi.fn(async () => {})
      const h = await steerableRun(steer, { recover, recoveryState: () => observation })
      const proposal = { id: brandString<SubagentRecoveryId>('recovery-1'), observation, interruptGraceMs: 100,
        text: '[reflex-supervision] reconcile', isCurrent: () => true }
      expect(h.subagents.recoveryState(steeringParent('delegator').agent, h.runId)).toBeUndefined()
      await expect(h.subagents.recoverFromSupervisor(steeringParent('delegator').agent, h.runId, proposal, signal())).rejects.toThrow()
      expect(h.parent.append).not.toHaveBeenCalled()
      const pending = h.subagents.recoverFromSupervisor(h.parent.agent, h.runId, proposal, signal())
      await vi.waitFor(() => { expect(recover).toHaveBeenCalledTimes(1) })
      const human = h.subagents.steerByParent({ runId: h.runId, parentSessionId: SessionId('delegator'), text: 'Preserve invoices.csv' }, signal())
      expect(steer).not.toHaveBeenCalled()
      release.resolve(undefined)
      expect(await pending).toMatchObject({ state: 'stale' })
      await human
      expect(h.parent.append).toHaveBeenCalledTimes(3)
      expect(h.parent.append).toHaveBeenNthCalledWith(3, 'subagent/steer', expect.objectContaining({ text: 'Preserve invoices.csv' }))
      h.result.resolve({ output: [], stopReason: 'completed' })
      await h.run.result
      expect(h.subagents.recoveryState(h.parent.agent, h.runId)).toBeUndefined()
    })

    it('refuses stale recovery before dispatch and records an uncertain transport only once', async () => {
      const observation = { threadId: brandString<SubagentNativeThreadId>('thread'), turnId: brandString<SubagentEvidenceTurnId>('turn'),
        lastActivityAt: 1, retryCount: 0, waiting: false, activeSideEffects: 0 }
      const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async () => { throw new Error('ack lost') })
      const h = await steerableRun(undefined, { recover, recoveryState: () => observation })
      const proposal = { id: brandString<SubagentRecoveryId>('uncertain'), observation, interruptGraceMs: 10,
        text: 'reconcile', isCurrent: () => false }
      expect(await h.subagents.recoverFromSupervisor(h.parent.agent, h.runId, proposal, signal())).toMatchObject({ state: 'stale' })
      expect(h.parent.append).not.toHaveBeenCalled()
      expect(recover).not.toHaveBeenCalled()
      await expect(h.subagents.recoverFromSupervisor(h.parent.agent, h.runId, { ...proposal, isCurrent: () => true }, signal()))
        .rejects.toThrow('ack lost')
      expect(recover).toHaveBeenCalledOnce()
      expect(h.parent.append).toHaveBeenCalledTimes(2)
      expect(h.parent.append).toHaveBeenNthCalledWith(1, 'subagent/supervision-recovery', expect.objectContaining({ state: 'intent' }))
      expect(h.parent.append).toHaveBeenNthCalledWith(2, 'subagent/supervision-recovery', expect.objectContaining({ state: 'unknown' }))
      h.result.resolve({ output: [], stopReason: 'completed' })
      await h.run.result
    })

    it('retains the original recovery activity fingerprint across a queued native control', async () => {
      const gate = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      const observed = { threadId: brandString<SubagentNativeThreadId>('thread'), turnId: brandString<SubagentEvidenceTurnId>('turn'),
        lastActivityAt: 1, retryCount: 3, waiting: false, activeSideEffects: 0 }
      let current = observed
      const recover = vi.fn<NonNullable<SubagentRun['recover']>>(async (request) => {
        expect(request.expectedActivity).toEqual({ lastActivityAt: 1, retryCount: 3 })
        expect(current).toMatchObject({ lastActivityAt: 2, retryCount: 0 })
        return { state: 'stale', threadId: observed.threadId, previousTurnId: observed.turnId }
      })
      const h = await steerableRun(async () => { entered.resolve(undefined); await gate.promise },
        { recover, recoveryState: () => current })
      const occupying = h.subagents.steerFromSupervisor(h.parent.agent, h.runId, 'first', signal(), () => true)
      await entered.promise
      const pending = h.subagents.recoverFromSupervisor(h.parent.agent, h.runId, {
        id: brandString<SubagentRecoveryId>('queued'), observation: observed, interruptGraceMs: 100,
        text: 'reconcile', isCurrent: () => true,
      }, signal())
      expect(recover).not.toHaveBeenCalled()
      current = { ...observed, lastActivityAt: 2, retryCount: 0 }
      gate.resolve(undefined)
      await occupying
      expect(await pending).toMatchObject({ state: 'stale' })
      h.result.resolve({ output: [], stopReason: 'completed' })
      await h.run.result
    })

    it.each(['authority', 'human', 'turn'] as const)('rejects queued supervisor advice after %s changes before dispatch', async (change) => {
      const gate = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      let current = true
      let observation = { threadId: brandString<SubagentNativeThreadId>('thread'),
        turnId: brandString<SubagentEvidenceTurnId>('turn-1'), lastActivityAt: 1, retryCount: 0, waiting: false, activeSideEffects: 0 }
      const steer = vi.fn(async () => { entered.resolve(undefined); await gate.promise })
      const h = await steerableRun(steer, { recoveryState: () => observation })
      const occupying = h.subagents.steerFromSupervisor(h.parent.agent, h.runId, 'first', signal(), () => true)
      await entered.promise
      const old = h.subagents.steerFromSupervisor(h.parent.agent, h.runId, 'obsolete', signal(), () => current)
      const rejected = expect(old).rejects.toThrow('became stale before dispatch')
      let human: Promise<unknown> | undefined
      if (change === 'authority') current = false
      if (change === 'turn') observation = { ...observation, turnId: brandString<SubagentEvidenceTurnId>('turn-2') }
      if (change === 'human') human = h.subagents.steerByParent({ runId: h.runId, parentSessionId: h.parent.agent.session.id, text: 'new human constraint' }, signal())
      gate.resolve(undefined)
      await occupying
      await rejected
      await human
      expect(steer.mock.calls).toHaveLength(change === 'human' ? 2 : 1)
      expect(JSON.stringify(h.parent.append.mock.calls)).not.toContain('obsolete')
      h.result.resolve({ output: [], stopReason: 'completed' })
      await h.run.result
    })

    it('delivers text to the live run and records it in the parent Session after acceptance', async () => {
      const steer = vi.fn(async () => {})
      const { subagents, runId, starts, parent, result, run } = await steerableRun(steer)
      expect(starts[0]!.steerable).toBe(true)
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text: 'use snake_case' }, signal()))
        .resolves.toEqual({ accepted: true })
      expect(steer).toHaveBeenCalledWith([{ type: 'text', text: 'use snake_case' }], expect.any(AbortSignal))
      expect(parent.append).toHaveBeenCalledWith('subagent/steer', { version: 1, runId, provider: 'steerable', text: 'use snake_case' })
      result.resolve({ output: [], stopReason: 'completed' })
      await expect(run.result).resolves.toEqual({ output: [], stopReason: 'completed', steers: ['use snake_case'] })
    })

    it('refuses another parent, an unknown run, and a settled run without recording anything', async () => {
      const steer = vi.fn(async () => {})
      const { subagents, runId, parent, result, run } = await steerableRun(steer)
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('other'), text: 'x' }, signal()))
        .rejects.toMatchObject({ code: 'subagent/not-steerable' })
      await expect(subagents.steerByParent({ runId: 'missing' as typeof runId, parentSessionId: SessionId('delegator'), text: 'x' }, signal()))
        .rejects.toMatchObject({ code: 'subagent/not-steerable' })
      result.resolve({ output: [], stopReason: 'completed' })
      await run.result
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text: 'x' }, signal()))
        .rejects.toMatchObject({ code: 'subagent/not-steerable' })
      expect(steer).not.toHaveBeenCalled()
      expect(parent.append).not.toHaveBeenCalled()
    })

    it('forgets a run whose result rejects', async () => {
      const { subagents, runId, result, run } = await steerableRun(async () => {})
      result.reject(new Error('infrastructure'))
      await run.result.catch(() => undefined)
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text: 'x' }, signal()))
        .rejects.toMatchObject({ code: 'subagent/not-steerable' })
    })

    it('maps a refusal to not-steerable and caller cancellation to cancelled', async () => {
      const controller = new AbortController()
      const steer = vi.fn(async () => { throw new Error('turn ended') })
      const { subagents, runId, parent, result, run } = await steerableRun(steer)
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text: 'x' }, signal()))
        .rejects.toMatchObject({ code: 'subagent/not-steerable' })
      controller.abort()
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text: 'x' }, controller.signal))
        .rejects.toMatchObject({ code: 'gateway/cancelled' })
      expect(parent.append).not.toHaveBeenCalled()
      result.resolve({ output: [], stopReason: 'completed' })
      await expect(run.result).resolves.not.toHaveProperty('steers')
    })

    it('rejects blank and oversized text before reaching the run', async () => {
      const steer = vi.fn(async () => {})
      const { subagents, runId, result } = await steerableRun(steer)
      for (const text of ['   ', 'x'.repeat(SUBAGENT_STEER_MAX_CHARS + 1)]) {
        await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text }, signal()))
          .rejects.toMatchObject({ code: 'gateway/bad-request' })
      }
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text: 'y'.repeat(SUBAGENT_STEER_MAX_CHARS) }, signal()))
        .resolves.toEqual({ accepted: true })
      expect(steer).toHaveBeenCalledTimes(1)
      result.resolve({ output: [], stopReason: 'completed' })
    })

    it('marks a run without input delivery as not steerable', async () => {
      const { subagents, runId, starts, result, run } = await steerableRun(undefined)
      expect(starts[0]!.steerable).toBe(false)
      await expect(subagents.steerByParent({ runId, parentSessionId: SessionId('delegator'), text: 'x' }, signal()))
        .rejects.toMatchObject({ code: 'subagent/not-steerable' })
      result.resolve({ output: [], stopReason: 'completed' })
      await expect(run.result).resolves.toEqual({ output: [], stopReason: 'completed' })
      expect('steer' in run).toBe(false)
    })
  })

  it('publishes evidence only while the run is live and stops activity after rejection', async () => {
    const { ctx, subagents } = await service()
    const result = Promise.withResolvers<SubagentResult>()
    let report: ResolvedSubagentStartRequest['reportActivity'] | undefined
    let evidence: ResolvedSubagentStartRequest['reportEvidence'] | undefined
    subagents.registerProvider({
      name: 'rejecting',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      async start(request) {
        report = request.reportActivity
        evidence = request.reportEvidence
        return { id: SessionId('child'), localAgent: undefined, result: result.promise, async dispose() {} }
      },
    })
    const seen: unknown[] = []
    ctx.on('subagent/activity', info => void seen.push(info))

    const observations: unknown[] = []
    ctx.on('subagent/evidence', info => void observations.push(info))
    const run = await subagents.start('rejecting', baseRequest())
    const fact = { turnId: brandString<SubagentEvidenceTurnId>('turn'), kind: 'command' as const,
      operation: 'verification' as const, operationDigest: 'test', outcome: 'failed' as const }
    evidence?.(fact)
    expect(observations).toHaveLength(1)
    result.reject(new Error('infrastructure'))
    await run.result.catch(() => undefined)
    report?.({ kind: 'tool', phase: 'started' })
    evidence?.(fact)
    expect(observations).toHaveLength(1)

    expect(seen).toEqual([])
  })

  it('mints distinct lifecycle identities when provider and child ids repeat', async () => {
    const { ctx, subagents } = await service()
    subagents.registerProvider(new StubProvider('reused'))
    const runIds: string[] = []
    ctx.on('subagent/start', info => void runIds.push(info.runId))

    const first = await subagents.start('reused', baseRequest())
    const second = await subagents.start('reused', baseRequest())
    await Promise.all([first.result, second.result])

    expect(runIds).toHaveLength(2)
    expect(new Set(runIds).size).toBe(2)
  })

  it('emits no run lifecycle when provider startup rejects', async () => {
    const { ctx, subagents } = await service()
    subagents.registerProvider({
      name: 'failed',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      start: async () => { throw new Error('setup rolled back') },
    })
    const lifecycle = vi.fn()
    ctx.on('subagent/start', lifecycle)
    ctx.on('subagent/end', lifecycle)
    await expect(subagents.start('failed', baseRequest())).rejects.toThrow('setup rolled back')
    expect(lifecycle).not.toHaveBeenCalled()
  })

  it.each([false, true])('handles a rejected local result after catalog failure (disposal fails: %s)', async (failsDisposal) => {
    const { ctx, subagents } = await service()
    onTestFinished(() => ctx.fiber.dispose())
    const parentSession = Session.create(SessionId('catalog-parent'))
    const childSession = Session.create(SessionId('catalog-child'))
    const parent = { id: parentSession.id, session: parentSession } as Agent
    const localAgent = { id: childSession.id, session: childSession, options: {} } as Agent
    const result = Promise.withResolvers<SubagentResult>()
    const cleanupFailure = new Error('dispose also failed')
    const warnings = vi.spyOn(ctx.logger, 'warn')
    const dispose = vi.fn(async () => {
      result.reject(new Error('run infrastructure failed'))
      // Cross Node's unhandled-rejection checkpoint while disposal is pending.
      await new Promise<void>(resolve => setImmediate(resolve))
      if (failsDisposal) throw cleanupFailure
    })
    subagents.registerProvider({
      name: 'catalog-failure',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      start: () => Promise.resolve({
        id: childSession.id,
        localAgent,
        result: result.promise,
        dispose,
      }),
    })
    const catalogFailure = new Error('catalog unavailable')
    const append = vi.spyOn(parentSession, 'append').mockImplementation(() => {
      throw catalogFailure
    })

    await expect(subagents.start('catalog-failure', baseRequest({ parent })))
      .rejects.toBe(catalogFailure)
    expect(append).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(warnings).toHaveBeenCalledTimes(failsDisposal ? 1 : 0)
  })

  it('emits an enriched end event and maps result rejection to error telemetry', async () => {
    const { ctx, subagents } = await service()
    const completed = new StubProvider('completed', NO_CAPS, {
      output: [{ type: 'text', text: 'answer' }],
      stopReason: 'completed',
    })
    subagents.registerProvider(completed)
    const ended = vi.fn()
    ctx.on('subagent/end', ended)
    const run = await subagents.start('completed', baseRequest())
    await run.result
    await Promise.resolve()
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'answer' }],
      stopReason: 'completed',
    }))

    // The lifecycle event omits lastAssistantMessage when output is empty,
    // matching the continuable epoch event.
    const silent = new StubProvider('silent', NO_CAPS, { output: [], stopReason: 'completed' })
    subagents.registerProvider(silent)
    const silentRun = await subagents.start('silent', baseRequest())
    await silentRun.result
    await Promise.resolve()
    const silentEnd = ended.mock.calls.map(call => call[0] as SubagentRunEndInfo).find(info => info.provider === 'silent')
    expect(silentEnd).toBeDefined()
    expect('lastAssistantMessage' in silentEnd!).toBe(false)

    const failure = Promise.withResolvers<SubagentResult>()
    subagents.registerProvider({
      name: 'infra',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      async start() {
        return { id: SessionId('infra-child'), localAgent: undefined, result: failure.promise, async dispose() {} }
      },
    })
    const failedRun = await subagents.start('infra', baseRequest())
    failure.reject(new Error('transport'))
    await expect(failedRun.result).rejects.toThrow('transport')
    await Promise.resolve()
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ provider: 'infra', stopReason: 'error' }))
  })

  it('contains synchronous and asynchronous lifecycle observer failures', async () => {
    const { ctx, subagents } = await service()
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => void warnings.push(String(message))) as typeof ctx.logger.warn
    const heard: string[] = []
    ctx.on('subagent/provider-removed', () => { throw new Error('sync boom') })
    // Runtime listeners may return thenables even though the declaration's observable result is void.
    // oxlint-disable-next-line typescript/no-misused-promises -- exercises rejected-listener containment
    ctx.on('subagent/provider-removed', async () => { throw new Error('async boom') })
    ctx.on('subagent/provider-removed', () => { throw { toString: () => { throw new Error('coercion') } } })
    ctx.on('subagent/provider-removed', name => void heard.push(name))
    const dispose = subagents.registerProvider(new StubProvider('contained'))

    dispose()
    await Promise.resolve()
    expect(heard).toEqual(['contained'])
    expect(warnings.some(message => message.includes('sync boom'))).toBe(true)
    expect(warnings.some(message => message.includes('async boom'))).toBe(true)
    expect(warnings.some(message => message.includes('<unrenderable thrown value>'))).toBe(true)
  })

  it('SubagentError participates in the harness error taxonomy', () => {
    const error = new SubagentError('boom', 'NO_PROVIDER')
    expect(error).toBeInstanceOf(HarnessError)
    expect(error.name).toBe('SubagentError')
    expect(error.code).toBe('NO_PROVIDER')
  })
})

describe('subagent descriptors', () => {
  const event = (data: unknown): SessionEvent<'subagent/descriptor'> => ({
    type: 'subagent/descriptor',
    data,
  } as unknown as SessionEvent<'subagent/descriptor'>)

  it('omits absent fields, recovers a complete payload, and rejects unsupported versions', () => {
    expect(foldSubagentDescriptor([])).toBeUndefined()
    const minimal = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn' })
    expect(minimal).toEqual({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: 'spawn',
    })
    expect(foldSubagentDescriptor([event(minimal)])).toEqual(minimal)
    expect(snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: 'spawn',
      label: 'child work',
    })).toEqual({ ...minimal, label: 'child work' })
    const complete = {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable' as const,
      provider: 'spawn',
      label: 'complete child',
      agentProvider: 'deepseek',
      agentModel: 'chat',
      agentReasoningEffort: ReasoningEffortId('high'),
      persona: 'reviewer',
      toolFilter: { allow: ['read'], deny: ['bash'] },
    }
    expect(snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: complete.provider,
      label: complete.label,
      agentProvider: complete.agentProvider,
      agentModel: complete.agentModel,
      agentReasoningEffort: complete.agentReasoningEffort,
      persona: complete.persona,
      toolFilter: complete.toolFilter,
    })).toEqual(complete)
    expect(foldSubagentDescriptor([event(complete)])).toEqual(complete)
    expect(foldSubagentDescriptor([
      event({
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'continuable',
        provider: 'spawn',
        label: 'l',
        toolFilter: { allow: ['read'] },
      }),
    ])).toMatchObject({ toolFilter: { allow: ['read'] } })
    expect(foldSubagentDescriptor([
      event({
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'continuable',
        provider: 'spawn',
        label: 'l',
        toolFilter: { deny: ['bash'] },
      }),
    ])).toMatchObject({ toolFilter: { deny: ['bash'] } })
    expect(foldSubagentDescriptor([
      event({ version: SUBAGENT_DESCRIPTOR_VERSION + 1, provider: 'spawn' }),
    ])).toBeUndefined()
    expect(() => snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: 'spawn',
      label: 'bad',
      toolFilter: { deny: [Symbol('not-json')] as unknown as string[] },
    })).toThrow('not losslessly JSON-serializable')
  })

  it.each([
    ['string payload', 'invalid', 'payload must be an object'],
    ['null payload', null, 'payload must be an object'],
    ['array payload', [], 'payload must be an object'],
    ['missing version', { provider: 'spawn' }, 'version must be a number'],
    ['string version', { version: '1', provider: 'spawn' }, 'version must be a number'],
    ['missing mode', { version: SUBAGENT_DESCRIPTOR_VERSION }, 'mode must be "one-shot" or "continuable"'],
    ['invalid mode', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'later' }, 'mode must be "one-shot" or "continuable"'],
    ['unknown one-shot field', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: 'spawn',
      label: 'l',
      persona: 'reviewer',
    }, 'payload has unknown field "persona"'],
    ['invalid one-shot label', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: 'spawn',
      label: 7,
    }, 'label must be a string'],
    ['unknown payload field', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      extra: true,
    }, 'payload has unknown field "extra"'],
    ['missing provider', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable' }, 'provider must be a string'],
    ['missing label', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
    }, 'label must be a string'],
    ['invalid label', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 7,
    }, 'label must be a string'],
    ['invalid provider', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 7,
    }, 'provider must be a string'],
    ['invalid agent provider', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      agentProvider: 7,
    }, 'agentProvider must be a string'],
    ['invalid agent model', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      agentModel: [],
    }, 'agentModel must be a string'],
    ['invalid agent reasoning effort', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      agentReasoningEffort: 7,
    }, 'agentReasoningEffort must be a string'],
    ['invalid persona', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      persona: {},
    }, 'persona must be a string'],
    ['non-object tool filter', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: [],
    }, 'toolFilter must be an object'],
    ['unknown tool-filter field', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: { except: ['bash'] },
    }, 'toolFilter has unknown field "except"'],
    ['empty tool filter', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: {},
    }, 'toolFilter must declare allow and/or deny'],
    ['non-array allow list', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: { allow: 'read' },
    }, 'toolFilter.allow must be an array of strings'],
    ['non-string deny item', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: { deny: [7] },
    }, 'toolFilter.deny must be an array of strings'],
  ])('rejects a malformed persisted descriptor: %s', (_case, data, detail) => {
    expect(() => foldSubagentDescriptor([event(data)])).toThrow(detail)
  })
})
