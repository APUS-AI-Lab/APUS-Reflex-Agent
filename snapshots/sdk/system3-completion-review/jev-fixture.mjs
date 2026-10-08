/** Local Jev HTTP fixture for real Goal tools and the production completion-review plugin. */
import { createServer } from 'node:http'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import System3 from '@deepseek-ai/dsh-experimental-system3'

export const name = 'snapshot-system3-completion-review-fixture'
export const inject = ['goals', 'systemPrompt']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - Shipped SDK runtime services.
 * @param {{ staleObjective?: string }} config - Optional goal edit while the first review awaits HTTP.
 */
export async function apply(ctx, config = {}) {
  const evidence = []
  let reviewingAgent
  const server = createServer(async (request, response) => {
    try {
      let body = ''
      for await (const chunk of request) body += chunk
      const query = JSON.parse(body)
      if (request.url !== '/v1/systemone' || query.model !== 'jev-snapshot'
        || query.questions.goal?.type !== 'noul' || Object.keys(query.questions).length !== 1
        || typeof query.state.evidence !== 'string' || query.state.evidence.includes('update_goal')) {
        response.writeHead(400).end('unexpected completion-review request')
        return
      }
      const digest = query.state.evidence
      evidence.push(digest)
      if (config.staleObjective !== undefined && evidence.length === 1) {
        if (reviewingAgent === undefined) throw new Error('Completion review has no owning Agent')
        const goal = ctx.goals.get(reviewingAgent)
        if (goal === undefined) throw new Error('Completion review has no current Goal')
        ctx.goals.edit(reviewingAgent, { id: goal.id, revision: goal.revision }, { objective: config.staleObjective })
      }
      const met = digest.includes('read: completion-evidence.txt') && digest.includes('COMPLETION_EVIDENCE_OK')
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        model: 'jev-snapshot', answers: { goal: { type: 'noul', noul: met ? 0.9 : 0.1 } },
        usage: { input_tokens: 12, output_tokens: 1 },
      }))
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  ctx.effect(() => () => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Jev fixture has no TCP port')
  await ctx.plugin(Jev, { endpoint: `http://127.0.0.1:${address.port}`, model: 'jev-snapshot' })
  ctx.on('tools/pre-execute', async ({ agent }, next) => {
    if (agent === undefined) return next()
    reviewingAgent = agent
    const append = agent.session.append
    // Pin elapsed accounting around the real review listener, leaving its request, answer, and denial intact.
    agent.session.append = function (type, data, ...options) {
      return append.call(this, type, type === 'system3/judgement' ? { ...data, elapsedMs: 0 } : data, ...options)
    }
    try { return await next() } finally { agent.session.append = append }
  })
  await ctx.plugin(System3, {
    jevExecutionDomain: 'local', jevRouteId: 'snapshot-jev',
    taskFrame: { mode: 'active', yes: 0.8, no: 0.2, deadlineMs: 2000,
      sessionDataClasses: ['public'], maxItems: 4, maxMessageChars: 600 },
    completionReview: { mode: 'active', yes: 0.8, no: 0.2, deadlineMs: 2000,
      sessionDataClasses: ['public'], maxRefusals: 2, evidenceCalls: 20, resultChars: 300 },
  })
  if (ctx.get('system3') === undefined) throw new Error('System3 completion-review fixture service did not mount')
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const goal = ctx.goals.get(agent)
    if (evidence.length !== 2 || evidence[0].includes('read: completion-evidence.txt')
      || !evidence[1].includes('COMPLETION_EVIDENCE_OK') || goal?.phase !== 'complete'
      || config.staleObjective !== undefined && (goal.objective !== config.staleObjective || goal.revision !== 3)) {
      throw new Error('Real Goal completion did not require and consume read-tool evidence')
    }
  })
}
