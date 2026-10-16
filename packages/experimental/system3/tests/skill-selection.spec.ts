import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Skills from '@deepseek-ai/dsh-skill'
import { afterEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import System3 from '../src/index.ts'
import { installSystem3SkillSelection, prefilterSkills, type System3SkillSelectionConfig } from '../src/skill-selection.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function setup(options: {
  name?: string
  maxCandidates?: number
  maxContentBytes?: number
  deadlineMs?: number
  modelInvocable?: boolean
  networkJev?: boolean
  maxInputBytes?: number
  unconfiguredJev?: boolean
  missingCredential?: boolean
  jevEffort?: 'low' | 'high'
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Skills)
  const name = options.name ?? 'csv-reconciliation'
  ctx.effect(() => ctx.skills.register({ name, description: 'Reconcile public CSV rows and report discrepancies.',
    source: 'runtime', content: 'Read every CSV row and independently verify aggregate totals.',
    invocation: { modelInvocable: options.modelInvocable ?? true, userInvocable: true } }))
  await ctx.plugin(Jev, options.unconfiguredJev ? {} : { endpoint: 'http://localhost:1', model: 'jev-test',
    ...options.missingCredential ? { apiKeyEnv: 'APUS_SKILL_TEST_UNSET_CREDENTIAL' } : {} })
  const decide = vi.spyOn(ctx.jev, 'decide').mockImplementation(async query => ({ kind: 'ok', spec: ctx.jev.resolve(query),
    response: { model: 'jev-test', answers: { intent: { type: 'choice', choice: 'action', confidence: 1, probabilities: { action: 1 } }, skill: { type: 'choice', choice: 'skill-0', confidence: 1,
      probabilities: { 'skill-0': 1, abstain: 0 } } } } }))
  const adapter = new MockAdapter([textResponse('verified')])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const effort = options.jevEffort === undefined ? {} : { jevEffort: options.jevEffort }
  const system3 = await ctx.plugin(System3, { jevExecutionDomain: options.networkJev ? 'network' : 'local', ...effort, skillSelection: {
    sessionDataClasses: ['public'], minConfidence: 0.8, maxInputBytes: options.maxInputBytes ?? 8000,
    maxContentBytes: options.maxContentBytes ?? 8000, maxCandidates: options.maxCandidates ?? 12, deadlineMs: options.deadlineMs ?? 500 } })
  const agent = await ctx.agentLoop.create(SessionId('skill-selection'), { provider: 'mock', model: 'mock' })
  const message = createUserMessage({ content: [{ type: 'text', text: 'Reconcile the CSV rows.' }], source: { kind: 'user' } })
  return { ctx, agent, message, decide, adapter, system3, dispatch: agentEvents(ctx, agent) }
}

it('selects and commits real registry instructions before the actual generation output', async () => {
  const h = await setup()
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  const events = h.agent.session.snapshotEvents()
  const receiptIndex = events.findIndex(event => event.type === 'system3/skill-decision' && event.data.outcome === 'selected')
  const injectionIndex = events.findIndex(event => event.type === 'user/message' && event.data.source.kind === 'skill-invocation')
  const outputIndex = events.findIndex(event => event.type === 'assistant/message')
  expect(receiptIndex).toBeGreaterThan(-1)
  expect(injectionIndex).toBeGreaterThan(receiptIndex)
  expect(outputIndex).toBeGreaterThan(injectionIndex)
  expect(h.agent.session.deriveMessages().some(message => message.content.some(part => part.type === 'text'
    && part.text.includes('Read every CSV row and independently verify aggregate totals.')))).toBe(true)
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ selected: 'csv-reconciliation', injected: true })
  expect(h.decide).toHaveBeenCalledTimes(1)
})

it.each(['withdraw', 'rewrite'] as const)('uses only downstream surviving user input after %s', async (operation) => {
  const h = await setup()
  const replacement = createUserMessage({ content: [{ type: 'text', text: 'Only this replacement may reach Jev.' }], source: { kind: 'user' } })
  const messages = operation === 'withdraw' ? [] : [replacement]
  const result = await h.dispatch.waterfall('agent/pre-step', { messages: [h.message], turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter', messages }))
  if (operation === 'withdraw') {
    expect(result).toEqual({ kind: 'enter', messages: [] })
    expect(h.decide).not.toHaveBeenCalled()
  } else {
    expect(h.decide.mock.calls[0]?.[0].state).toEqual({ input: 'Only this replacement may reach Jev.' })
  }
})

it('keeps a downstream rejected step rejected without Jev or Skill injection', async () => {
  const h = await setup()
  const result = await h.dispatch.waterfall('agent/pre-step', { messages: [h.message], turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'reject' }))
  expect(result).toEqual({ kind: 'reject' })
  expect(h.decide).not.toHaveBeenCalled()
})

it('uses stable choice ids when a legitimate Skill is named abstain', async () => {
  const h = await setup({ name: 'abstain' })
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.decide.mock.calls[0]?.[0].questions.skill).toMatchObject({ criteria: { 'skill-0': 'abstain: Reconcile public CSV rows and report discrepancies.', abstain: 'No clearly applicable skill.' } })
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ selected: 'abstain', injected: true })
})

it('asks one Skill question per group of an oversized catalog in the same request and keeps the most confident choice', async () => {
  const h = await setup({ maxCandidates: 1 })
  h.ctx.effect(() => h.ctx.skills.register({ name: 'another-skill', description: 'Another task.', source: 'runtime', content: 'Other instructions.' }))
  h.decide.mockImplementation(async query => ({ kind: 'ok', spec: h.ctx.jev.resolve(query), response: { model: 'jev-test', answers: {
    intent: { type: 'choice', choice: 'action', confidence: 1, probabilities: { action: 1 } },
    skill: { type: 'choice', choice: 'skill-0', confidence: 0.6, probabilities: { 'skill-0': 0.6, abstain: 0.4 } },
    skill2: { type: 'choice', choice: 'skill-1', confidence: 0.9, probabilities: { 'skill-1': 0.9, abstain: 0.1 } } } } }))
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.decide).toHaveBeenCalledTimes(1)
  const questions = h.decide.mock.calls[0]?.[0].questions ?? {}
  expect(Object.keys(questions)).toEqual(['intent', 'skill', 'skill2'])
  expect(Object.keys(questions.skill?.criteria ?? {})).toEqual(['skill-0', 'abstain'])
  expect(questions.skill2?.criteria).toEqual({ 'skill-1': 'csv-reconciliation: Reconcile public CSV rows and report discrepancies.',
    abstain: 'No clearly applicable skill.' })
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome: 'selected', selected: 'csv-reconciliation', injected: true })
})

it('keeps the more confident of two accepted group choices and sends the configured effort', async () => {
  const h = await setup({ maxCandidates: 1, jevEffort: 'high' })
  h.ctx.effect(() => h.ctx.skills.register({ name: 'another-skill', description: 'Another task.', source: 'runtime', content: 'Other instructions.' }))
  h.decide.mockImplementation(async query => ({ kind: 'ok', spec: h.ctx.jev.resolve(query), response: { model: 'jev-test', answers: {
    intent: { type: 'choice', choice: 'action', confidence: 1, probabilities: { action: 1 } },
    skill: { type: 'choice', choice: 'skill-0', confidence: 0.95, probabilities: { 'skill-0': 0.95, abstain: 0.05 } },
    skill2: { type: 'choice', choice: 'skill-1', confidence: 0.85, probabilities: { 'skill-1': 0.85, abstain: 0.15 } } } } }))
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.decide.mock.calls[0]?.[0]).toMatchObject({ effort: 'high' })
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome: 'selected', selected: 'another-skill' })
})

it('abstains only when every group abstains, and reports low confidence when a group chose below the threshold', async () => {
  const run = async (skill2: { choice: string; confidence: number }) => {
    const h = await setup({ maxCandidates: 1 })
    h.ctx.effect(() => h.ctx.skills.register({ name: 'another-skill', description: 'Another task.', source: 'runtime', content: 'Other instructions.' }))
    h.decide.mockImplementation(async query => ({ kind: 'ok', spec: h.ctx.jev.resolve(query), response: { model: 'jev-test', answers: {
      intent: { type: 'choice', choice: 'action', confidence: 1, probabilities: { action: 1 } },
      skill: { type: 'choice', choice: 'abstain', confidence: 0.9, probabilities: { 'skill-0': 0.1, abstain: 0.9 } },
      skill2: { type: 'choice', ...skill2, probabilities: { [skill2.choice]: skill2.confidence } } } } }))
    h.agent.followup(h.message)
    await h.agent.whenIdle()
    return h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill
  }
  expect(await run({ choice: 'abstain', confidence: 0.8 })).toMatchObject({ outcome: 'abstain', injected: false })
  expect(await run({ choice: 'skill-1', confidence: 0.2 })).toMatchObject({ outcome: 'low-confidence', injected: false })
  expect(await run({ choice: 'skill-0', confidence: 0.9 })).toMatchObject({ outcome: 'invalid-response', injected: false })
})

it('narrows a catalog beyond every group by shared words and CJK character pairs, then fills in catalog order', () => {
  const catalog = [{ name: 'cron-schedule', description: 'Write cron expressions.' }, { name: 'sql-style', description: 'Write SQL queries.' },
    { name: 'release-notes', description: '撰写版本发布说明。' }, { name: 'sql-review', description: 'Review SQL queries for style.' }]
  expect(prefilterSkills('Review this SQL query style', catalog, 2).map(skill => skill.name)).toEqual(['sql-style', 'sql-review'])
  expect(prefilterSkills('帮我写发布说明', catalog, 2).map(skill => skill.name)).toEqual(['cron-schedule', 'release-notes'])
  expect(prefilterSkills('Say hello to the team', catalog, 2).map(skill => skill.name)).toEqual(['cron-schedule', 'sql-style'])
  expect(prefilterSkills('anything', catalog, 4)).toEqual(catalog)
})

it('never truncates an oversized Skill body into the generation request', async () => {
  const h = await setup({ maxContentBytes: 1 })
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome: 'content-too-large', selected: null, injected: false })
})

it('settles a Skill deadline and ignores a provider that later resolves', async () => {
  const h = await setup({ deadlineMs: 10 })
  const late = Promise.withResolvers<Awaited<ReturnType<typeof h.ctx.jev.decide>>>()
  h.decide.mockImplementation(() => late.promise)
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome: 'timeout', injected: false })
  late.resolve({ kind: 'unknown', spec: h.ctx.jev.resolve(h.decide.mock.calls[0]![0]), failure: { code: 'transport', message: 'late result' } })
  await Promise.resolve()
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/skill-decision')).toHaveLength(1)
})


it('rejects Skill timer overflow at plugin configuration instead of expiring after one millisecond', async () => {
  await expect(setup({ deadlineMs: 2 ** 31 })).rejects.toThrow('invalid config')
})


it('does not send input to a denied network Jev or load model-disabled Skills', async () => {
  for (const options of [{ networkJev: true }, { modelInvocable: false }]) {
    const h = await setup(options)
    h.agent.followup(h.message)
    await h.agent.whenIdle()
    expect(h.decide).toHaveBeenCalledTimes(options.networkJev ? 0 : 1)
    expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill?.injected).toBe(false)
  }
})

it('admits a provider declaring local execution in local-only mode and pins the request to it', async () => {
  const h = await setup({ networkJev: true })
  const info = { id: 'reflex-local', model: 'local', endpoint: 'http://127.0.0.1:2', executionDomain: 'local' as const }
  h.ctx.effect(() => h.ctx.jev.register({ info, decide: async () => { throw new Error('the decide spy answers') } }))
  vi.spyOn(h.ctx.jev, 'providerInfo').mockReturnValue(info)
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.decide).toHaveBeenCalledTimes(1)
  expect(h.decide.mock.calls[0]?.[0]).toMatchObject({ providerId: 'reflex-local', model: 'local' })
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill?.injected).toBe(true)
})

it.each(['abstain', 'low-confidence'] as const)('keeps native input without injection for %s', async (outcome) => {
  const h = await setup()
  h.decide.mockImplementation(async query => ({ kind: 'ok', spec: h.ctx.jev.resolve(query), response: {
    model: 'jev-test', answers: { skill: { type: 'choice', choice: outcome === 'abstain' ? 'abstain' : 'skill-0',
      confidence: outcome === 'abstain' ? 1 : 0.1, probabilities: { 'skill-0': 0.1, abstain: 0.9 } } } } }))
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome, injected: false, selected: null })
})

it('cancels an uncooperative pending Skill decision without committing instructions or output', async () => {
  const h = await setup()
  const entered = Promise.withResolvers<undefined>()
  h.decide.mockImplementation(() => { entered.resolve(undefined); return new Promise(() => {}) })
  h.agent.followup(h.message); await entered.promise
  h.agent.cancel({ kind: 'user' }); await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome: 'cancelled', injected: false })
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(0)
})

it('removing the selector settles its pending decision and preserves native generation', async () => {
  const h = await setup()
  const entered = Promise.withResolvers<undefined>()
  h.decide.mockImplementation(() => { entered.resolve(undefined); return new Promise(() => {}) })
  h.agent.followup(h.message); await entered.promise
  await h.system3.dispose(); await h.agent.whenIdle()
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-invocation')).toHaveLength(0)
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
})


it('rejects unsafe selector limits and empty classification at direct registration', () => {
  const ctx = new Context()
  contexts.push(ctx)
  const config: System3SkillSelectionConfig = { sessionDataClasses: ['public'], minConfidence: 0.8,
    maxInputBytes: 8000, maxContentBytes: 8000, maxCandidates: 12, deadlineMs: 100 }
  const register = (update: Partial<System3SkillSelectionConfig>) =>{  installSystem3SkillSelection(ctx, { ...config, ...update },
    { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' }) }
  for (const key of ['maxInputBytes', 'maxContentBytes', 'maxCandidates', 'deadlineMs'] as const) {
    expect(() =>{  register({ [key]: 0 }) }).toThrow('positive safe integer')
    expect(() =>{  register({ [key]: 1.5 }) }).toThrow('positive safe integer')
  }
  expect(() =>{  register({ deadlineMs: 2 ** 31 }) }).toThrow('timer range')
  for (const update of [
    { maxCandidates: 255 }, { minConfidence: NaN }, { minConfidence: -1 },
    { minConfidence: 2 }, { sessionDataClasses: [] },
  ]) {
    expect(() =>{  register(update) }).toThrow('requires classified data')
  }
})

it('skips explicit slash invocations and unsupported non-text input', async () => {
  const h = await setup()
  for (const text of ['/csv-reconciliation do the task']) {
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    const result = await h.dispatch.waterfall('agent/pre-step', { messages: [message], turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter', messages: [message] }))
    expect(result).toEqual({ kind: 'enter', messages: [message] })
  }
  expect(h.decide).not.toHaveBeenCalled()
})

it('skips incomplete discovery and a full resolved request exceeding its byte budget', async () => {
  const incomplete = await setup()
  vi.spyOn(incomplete.ctx.skills, 'snapshot').mockResolvedValue({ skills: [], complete: false })
  incomplete.agent.followup(incomplete.message)
  await incomplete.agent.whenIdle()
  expect(incomplete.decide).toHaveBeenCalledTimes(1)
  expect(incomplete.decide.mock.calls[0]?.[0].questions.skill).toBeUndefined()
  expect(incomplete.ctx.sessionProjections.stateOf(incomplete.agent.session, 'system3Runtime')?.skill?.outcome).toBe('incomplete-catalog')
  const oversized = await setup({ maxInputBytes: 1 })
  oversized.agent.followup(oversized.message)
  await oversized.agent.whenIdle()
  expect(oversized.decide).not.toHaveBeenCalled()
  expect(oversized.ctx.sessionProjections.stateOf(oversized.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome: 'input-too-large', injected: false })
})

it.each(['unknown', 'missing-answer', 'wrong-answer', 'invalid-choice'] as const)('keeps native input for %s', async (resultKind) => {
  const h = await setup()
  h.decide.mockImplementation(async query => resultKind === 'unknown'
    ? { kind: 'unknown', spec: h.ctx.jev.resolve(query), failure: { code: 'transport', message: 'external provider failed' } }
    : { kind: 'ok', spec: h.ctx.jev.resolve(query), response: { model: 'jev-test', answers: resultKind === 'missing-answer' ? {}
      : resultKind === 'wrong-answer' ? { skill: { type: 'noul', noul: 0.5 } }
        : { skill: { type: 'choice', choice: 'not-a-candidate', confidence: 1, probabilities: { 'not-a-candidate': 1 } } } } })
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill?.injected).toBe(false)
})

it.each(['missing', 'disabled', 'provider', 'description', 'source'] as const)('refuses a Skill whose loaded metadata changed: %s', async (change) => {
  const h = await setup()
  const skill = await h.ctx.skills.get('csv-reconciliation')
  if (skill === undefined) throw new Error('fixture Skill missing')
  vi.spyOn(h.ctx.skills, 'get').mockResolvedValue(change === 'missing' ? undefined : { ...skill,
    ...change === 'disabled' ? { invocation: { modelInvocable: false, userInvocable: true } } : {},
    ...change === 'provider' ? { provider: 'changed' } : {},
    ...change === 'description' ? { description: 'Another task.' } : {},
    ...change === 'source' ? { source: 'changed' } : {},
  })
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ outcome: 'stale-skill', injected: false })
})

it('propagates unexpected catalog errors instead of injecting partial instructions', async () => {
  const h = await setup()
  vi.spyOn(h.ctx.skills, 'snapshot').mockRejectedValue(new Error('invalid provider catalog'))
  await expect(h.dispatch.waterfall('agent/pre-step', { messages: [h.message], turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter', messages: [h.message] }))).rejects.toThrow('invalid provider catalog')
})


it('leaves unsupported input untouched before service discovery or external decisions', async () => {
  const h = await setup()
  const message = createUserMessage({ content: [{ type: 'reasoning', text: 'Unsupported user content.' }], source: { kind: 'user' } })
  const result = await h.dispatch.waterfall('agent/pre-step', { messages: [message], turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter', messages: [message] }))
  expect(result).toEqual({ kind: 'enter', messages: [message] })
  expect(h.decide).not.toHaveBeenCalled()
})

it('preserves native input when either optional Skill or Jev service is unavailable', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('selector-unavailable'), { provider: 'mock', model: 'mock' })
  installSystem3SkillSelection(ctx, { sessionDataClasses: ['public'], minConfidence: 0.8,
    maxInputBytes: 8000, maxContentBytes: 8000, maxCandidates: 12, deadlineMs: 100 },
  { mode: 'local-only' }, { routeId: 'jev', executionDomain: 'local', effort: 'low' })
  const message = createUserMessage({ content: [{ type: 'text', text: 'ordinary input' }], source: { kind: 'user' } })
  for (const withSkills of [false, true]) {
    if (withSkills) await ctx.plugin(Skills)
    const result = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [message], turn: 1, step: 0,
      signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages: [message] }))
    expect(result).toEqual({ kind: 'enter', messages: [message] })
    expect(agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ outcome: 'provider-unavailable', request: null })
  }
})


it.each([
  { unconfiguredJev: true, expected: 'provider-unavailable' },
  { missingCredential: true, expected: 'missing-credential' },
])('continues native generation when Reflex is unavailable: $expected', async (options) => {
  const h = await setup(options)
  h.decide.mockRestore()
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({
    outcome: options.expected, injected: false,
  })
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(true)
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-invocation')).toHaveLength(0)
})

it('reports Skill installation independently of routing, supervision and memory, and clears it on unload', async () => {
  const h = await setup()
  expect(h.ctx.jev.readStatus().capabilities).toEqual([
    { id: 'entryRouting', implemented: true, enabled: false },
    { id: 'codexSupervision', implemented: true, enabled: false, semanticSupervision: { enabled: false } },
    { id: 'contextMemory', implemented: true, enabled: false },
    { id: 'skillSelection', implemented: true, enabled: true },
  ])
  await h.system3.dispose()
  expect(h.ctx.jev.readStatus().capabilities.every(capability => !capability.implemented && !capability.enabled)).toBe(true)
})


it('classifies ordinary conversation without any applicable Skills or instruction injection', async () => {
  const h = await setup({ modelInvocable: false })
  h.decide.mockImplementation(async query => ({ kind: 'ok', spec: h.ctx.jev.resolve(query), response: {
    model: 'jev-test', answers: { intent: { type: 'choice', choice: 'conversation', confidence: 1, probabilities: { conversation: 1 } } },
  } }))
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(Object.keys(h.decide.mock.calls[0]?.[0].questions ?? {})).toEqual(['intent'])
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({
    intent: 'conversation', outcome: 'no-candidates', injected: false,
  })
})

it('starts the step without waiting for an intent-only judgement and records the intent when it arrives', async () => {
  const h = await setup({ modelInvocable: false })
  const answer = Promise.withResolvers<undefined>()
  h.decide.mockImplementation(async (query) => {
    await answer.promise
    return { kind: 'ok', spec: h.ctx.jev.resolve(query), response: { model: 'jev-test',
      answers: { intent: { type: 'choice', choice: 'conversation', confidence: 1, probabilities: { conversation: 1 } } } } }
  })
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.adapter.requests).toHaveLength(1)
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'system3/skill-decision')).toBe(false)
  answer.resolve(undefined)
  await vi.waitFor(() => {
    expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill).toMatchObject({ intent: 'conversation', outcome: 'no-candidates' })
  })
})

it.each(['untrusted-free-text', 'low-confidence'] as const)('never publishes unsupported or unreliable input labels: %s', async (kind) => {
  const h = await setup({ modelInvocable: false })
  h.decide.mockImplementation(async query => ({ kind: 'ok', spec: h.ctx.jev.resolve(query), response: {
    model: 'jev-test', answers: { intent: { type: 'choice', choice: kind === 'low-confidence' ? 'action' : 'I executed your command',
      confidence: kind === 'low-confidence' ? 0.1 : 1, probabilities: {} } },
  } }))
  h.agent.followup(h.message)
  await h.agent.whenIdle()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'system3Runtime')?.skill?.intent).toBeUndefined()
  expect(h.agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(true)
})
