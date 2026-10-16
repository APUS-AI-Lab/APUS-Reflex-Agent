/** SDK projection fixture; API admission and automatic routing remain outside this scenario. */
import { createServer } from 'node:http'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import System3, { createSystem3EntryRouter } from '@deepseek-ai/dsh-experimental-system3'

export const name = 'snapshot-system3-entry-route-producer'
export const inject = ['sessionProjections', 'skills']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Runtime services. */
export async function apply(ctx) {
  let requests = 0
  let entryRequests = 0
  let skillRequests = 0
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const query = JSON.parse(body)
    if (request.url === '/v1/systemone' && query.model === 'jev-snapshot' && query.questions.skill?.type === 'choice' && query.questions.intent?.type === 'choice') {
      const choice = Object.entries(query.questions.skill.criteria).find(([, value]) => value.startsWith('snapshot-response:'))?.[0]
      if (!['Reply with exactly: SDK snapshot OK', 'reply with the smoke text'].includes(query.state.input) || choice === undefined) {
        response.writeHead(400).end('unexpected Skill request')
        return
      }
      skillRequests += 1
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        model: 'jev-snapshot', answers: { intent: {
          type: 'choice', choice: 'conversation', probabilities: Object.fromEntries(Object.keys(query.questions.intent.criteria).map(id => [id, id === 'conversation' ? 1 : 0])), confidence: 1,
        }, skill: {
          type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(query.questions.skill.criteria).map(id => [id, id === choice ? 1 : 0])), confidence: 1,
        }, [choice]: { type: 'noul', noul: 1 } }, usage: { input_tokens: 9, output_tokens: 1 },
      }))
      return
    }
    if (request.url === '/v1/systemone' && query.model === 'jev-snapshot' && query.questions.route?.type === 'choice') {
      if (query.state.input !== 'Choose a model for this fixture input.' || !query.questions.route.criteria.current) {
        response.writeHead(400).end('unexpected entry request')
        return
      }
      entryRequests += 1
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        model: 'jev-snapshot', answers: { route: {
          type: 'choice', choice: 'current', probabilities: { current: 1, abstain: 0 }, confidence: 1,
        } }, usage: { input_tokens: 7 },
      }))
      return
    }
    if (request.url !== '/v1/systemone' || query.model !== 'jev-snapshot'
      || query.state.currentGoalRevision !== 'snapshot-goal-1'
      || query.questions.action.type !== 'choice') {
      response.writeHead(400).end('unexpected Jev request')
      return
    }
    requests += 1
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      model: 'jev-snapshot', answers: { action: {
        type: 'choice', choice: 'candidate_done',
        probabilities: { continue: 0, retry: 0, escalate: 0, candidate_done: 1, unknown: 0 }, confidence: 1,
      } }, usage: { input_tokens: 11 },
    }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  ctx.effect(() => () => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Jev fixture has no TCP port')
  await ctx.plugin(Jev, { endpoint: `http://127.0.0.1:${address.port}`, model: 'jev-snapshot' })
  ctx.effect(() => ctx.skills.register({
    name: 'snapshot-response', source: 'runtime', description: 'Follow an exact public SDK snapshot response request.',
    content: 'Preserve the exact response text requested by the user. Do not add a prefix, explanation, or suffix.',
  }))
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const append = agent.session.append
    // Keep only fixture elapsed accounting stable; the native loop still creates and commits the instruction message.
    agent.session.append = function (type, data, ...options) {
      return append.call(this, type, type === 'system3/skill-decision' ? { ...data, elapsedMs: 0 } : data, ...options)
    }
    try { return await next() } finally { agent.session.append = append }
  })
  await ctx.plugin(System3, { jevExecutionDomain: 'local', jevRouteId: 'snapshot-jev',
    skillSelection: { sessionDataClasses: ['public'], minConfidence: 0.8, maxInputBytes: 16000,
      maxContentBytes: 4096, maxCandidates: 254, deadlineMs: 2000 },
  })
  const system3 = ctx.get('system3')
  if (system3 === undefined) throw new Error('System3 fixture service did not mount')
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    if (agent.session.header.parentSession !== undefined) return
    const skill = ctx.sessionProjections.stateOf(agent.session, 'system3Runtime')?.skill
    const skillReceipt = agent.session.snapshotEvents().find(event => event.type === 'system3/skill-decision')
    const injection = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.id === skillReceipt?.data.injectionMessageId)
    if (skillReceipt?.data.intent !== 'conversation' || skill?.intent !== 'conversation'
      || skillRequests !== 1 || skill?.selected !== 'snapshot-response' || skill.injected !== true
      || injection?.data.source.kind !== 'skill-invocation' || !JSON.stringify(injection.data.content).includes('Preserve the exact response text')) {
      throw new Error('System3 Skill advice did not enter the actual generation request')
    }
    const messages = JSON.stringify(agent.session.deriveMessages())
    const append = agent.session.append
    // Fix only fixture persistence inputs; keep production crypto and clocks intact.
    agent.session.append = function (type, data, ...options) {
      return append.call(this, type, type === 'system3/decision'
        ? { ...data, id: '00000000-0000-4000-8000-000000000003', elapsedMs: 0 } : data, ...options)
    }
    let receipt
    try {
      receipt = await system3.shadowDecision(agent.session, {
        dataClasses: ['workspace'], turn: 1, step: 1,
        supervisor: {
          currentGoalRevision: 'snapshot-goal-1',
          advice: { action: 'candidate_done', goalRevision: 'snapshot-goal-1', evidenceRefs: ['check:snapshot'] },
          requiredChecks: [{ id: 'snapshot-check', status: 'fail', evidenceRefs: ['check:snapshot'] }],
          availableEvidenceRefs: ['check:snapshot'], budgetRemaining: 10,
        },
      }, signal)
    } finally {
      agent.session.append = append
    }
    if (requests !== 1 || receipt.outcome.kind !== 'ok' || receipt.baseline.action !== 'retry'
      || receipt.comparison.divergence !== 'model-premature-done') throw new Error('System3 shadow receipt changed')
    if (JSON.stringify(system3.lastDecision(agent.session)) !== JSON.stringify(receipt)) {
      throw new Error('System3 persisted projection differs from its receipt')
    }
    const assistant = agent.session.deriveMessages().findLast(message => message.role === 'assistant')
    if (assistant?.source?.kind !== 'model') throw new Error('Entry fixture has no model route')
    const baseline = { provider: assistant.source.provider, model: assistant.source.model }
    const router = createSystem3EntryRouter(ctx, {
      candidates: [{ id: 'current', description: 'Use the fixture model.', ...baseline, executionDomain: 'local', dataClasses: ['workspace'] }],
      sessionDataClasses: ['workspace'], minConfidence: 0.8, maxInputBytes: 8192,
    }, { mode: 'local-only' }, { routeId: 'snapshot-jev', executionDomain: 'local', effort: 'low' })
    const requestId = 'snapshot-entry-request'
    const input = { role: 'user', id: 'snapshot-entry-message', content: [{ type: 'text', text: 'Choose a model for this fixture input.' }], source: { kind: 'user' } }
    agent.session.append = function (type, data, ...options) {
      return append.call(this, type, type === 'system3/entry-decision' ? { ...data, elapsedMs: 0 } : data, ...options)
    }
    let selection
    try {
      selection = await router.route({ agent, requestId, message: input, baseline }, signal)
    } finally {
      agent.session.append = append
    }
    if (entryRequests !== 1 || JSON.stringify(selection) !== JSON.stringify(baseline)) throw new Error('Entry recommendation changed')
    // Emit the adoption payload to exercise SDK transport; this fixture does not admit an API prompt.
    agent.session.append('model/automatic-selection', { requestId, baseline, selection })
    if (JSON.stringify(agent.session.deriveMessages()) !== messages) throw new Error('System3 changed model-visible messages')
  })
}
