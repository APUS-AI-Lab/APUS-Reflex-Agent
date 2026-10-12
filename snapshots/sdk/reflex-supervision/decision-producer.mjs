/** Production Goal supervision with only external Codex execution and Reflex HTTP replaced. */
import { createServer } from 'node:http'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import System3 from '@deepseek-ai/dsh-experimental-system3'

export const name = 'snapshot-reflex-supervision-producer'
export const inject = ['goals', 'subagents', 'sessionProjections']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Shipped SDK services. */
export async function apply(ctx) {
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const query = JSON.parse(body)
    const feedback = query.questions.improved !== undefined
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'reflex-snapshot', answers: feedback
      ? { improved: { type: 'noul', noul: 1 } }
      : { action: { type: 'choice', choice: 'diagnose', probabilities: Object.fromEntries(Object.keys(query.questions.action.criteria).map(key => [key, key === 'diagnose' ? 1 : 0])), confidence: 1 } } }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  ctx.effect(() => () => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Reflex fixture has no port')
  await ctx.plugin(Jev, { endpoint: `http://127.0.0.1:${address.port}`, model: 'reflex-snapshot' })
  await ctx.plugin(System3, { jevExecutionDomain: 'local', jevRouteId: 'reflex-snapshot', reflexSupervision: {
    mode: 'active', yes: 0.8, no: 0.2, deadlineMs: 2000, sessionDataClasses: ['public'], intervalMs: 10,
    stallMs: 10000, repeatedFailures: 3, evidenceLimit: 16, cooldownMs: 1000, maxInterventions: 1, feedbackMs: 10,
  } })
  let providerRequest
  let finish
  let received
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false,
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    async start(request) {
      providerRequest = request
      const result = new Promise(resolve => { finish = resolve })
      return { id: 'snapshot-external-codex', localAgent: undefined, result, async dispose() {},
        async steer(content) {
          if (!JSON.stringify(content).includes('[Reflex 自动监督 / reflex-supervision]')) throw new Error('Missing supervision attribution')
          received = content
          setTimeout(() => request.reportEvidence({ turnId: 'snapshot-codex-turn', kind: 'command', operation: 'verification', operationDigest: 'verification-command', resultDigest: 'passed-check', outcome: 'succeeded' }), 0)
        } }
    },
  }))
  let owner
  ctx.on('agent/pre-step', (decision, next) => { owner = decision; return next() })
  let ran = false
  ctx.on('llm/stream', async function* (options, next) {
    if (ran || options.purpose !== undefined) { yield* next(); return }
    ran = true
    if (owner === undefined) throw new Error('Supervision fixture has no owning agent')
    const { agent, signal } = owner
    const append = agent.session.append
    // Pin volatile fixture accounting, preserving decisions, evidence, and message contents.
    agent.session.append = function(type, data, ...options) {
      if (type === 'system3/judgement') {
        const state = { ...data.request.state }
        if ('elapsedRunMs' in state) { state.elapsedRunMs = 0; state.elapsedWithoutProgressMs = 0 }
        data = { ...data, elapsedMs: 0, request: { ...data.request, state } }
      }
      if (type === 'system3/reflex-evidence') data = { ...data, observedAt: 10000 }
      if (type === 'system3/reflex-supervision') data = { ...data, id: '00000000-0000-4000-8000-000000000006' }
      return append.call(this, type, data, ...options)
    }
    const goal = ctx.goals.create(agent, { objective: 'Repair the failed verification without changing user requirements.' })
    const run = await ctx.subagents.start('codex', { parent: agent, prompt: [{ type: 'text', text: 'Repair and verify.' }], signal })
    const evidence = { turnId: 'snapshot-codex-turn', kind: 'command', operation: 'verification', operationDigest: 'verification-command', resultDigest: 'failed-check', outcome: 'failed' }
    const improved = new Promise(resolve => {
      const dispose = ctx.on('session/event', (_session, event) => {
        if (event.type === 'system3/reflex-supervision' && event.data.state === 'improved') { dispose(); resolve() }
      })
    })
    try {
      for (let i = 0; i < 3; i++) providerRequest.reportEvidence(evidence)
      let deadline
      try {
        await Promise.race([improved, new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Supervision fixture did not reach verified feedback')), 10000) })])
      } finally { clearTimeout(deadline) }
      if (received === undefined) throw new Error('Codex provider did not consume supervision advice')
      finish({ output: [{ type: 'text', text: 'Verified repair.' }], stopReason: 'completed' })
      const result = await run.result
      if (result.steers !== undefined) throw new Error('Automatic advice was attributed to the user')
      ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
    } finally { await run.dispose(); agent.session.append = append }
    yield* next()
  })
}
