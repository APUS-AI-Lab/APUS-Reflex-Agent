/** Real System3 consumer with an external Jev HTTP fixture and fixed receipt inputs. */
import { createServer } from 'node:http'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import System3 from '@deepseek-ai/dsh-experimental-system3'

export const name = 'snapshot-system3-shadow-producer'
export const inject = ['sessionProjections']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Runtime services. */
export async function apply(ctx) {
  let requests = 0
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const query = JSON.parse(body)
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
  await ctx.plugin(System3, { jevExecutionDomain: 'local', jevRouteId: 'snapshot-jev' })
  const system3 = ctx.get('system3')
  if (system3 === undefined) throw new Error('System3 fixture service did not mount')
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    if (agent.session.header.parentSession !== undefined) return
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
    if (JSON.stringify(agent.session.deriveMessages()) !== messages) throw new Error('System3 changed model-visible messages')
  })
}
