/** Real Goal round-driver and System3 entry; only external delegated execution is replaced. */
import { createServer } from 'node:http'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { defineTool } from '@deepseek-ai/dsh-tools'
import System3 from '@deepseek-ai/dsh-experimental-system3'

export const name = 'snapshot-goal-entry-routing-producer'
export const inject = ['goals', 'subagents', 'tools', 'sessionProjections']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Shipped SDK services. */
export async function apply(ctx) {
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const query = JSON.parse(body)
    if (query.state.objective !== 'Use Codex to verify GOAL_DELEGATION_OK before answering.') {
      response.writeHead(400).end('unexpected Goal decision')
      return
    }
    if (!query.questions.route.criteria.codex.includes('不论任务大小')) throw new Error('Missing explicit-selection priority')
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'goal-snapshot', answers: {
      route: { type: 'choice', choice: 'codex', confidence: 1, probabilities: { codex: 1, abstain: 0 } },
    } }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  ctx.effect(() => () => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Goal fixture has no port')
  await ctx.plugin(Jev, { endpoint: `http://127.0.0.1:${address.port}`, model: 'goal-snapshot' })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const append = agent.session.append
    agent.session.append = function (type, data, ...options) {
      return append.call(this, type, type === 'system3/judgement' ? { ...data, elapsedMs: 0 } : data, ...options)
    }
    try { return await next() } finally { agent.session.append = append }
  })
  let executions = 0
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false,
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    async start(request) {
      if (!JSON.stringify(request.prompt).includes('Use Codex to verify GOAL_DELEGATION_OK')) throw new Error('Goal objective was not forwarded')
      executions += 1
      return { id: 'snapshot-goal-codex', localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'GOAL_DELEGATION_OK: independent verification passed.' }], stopReason: 'completed' }),
        async dispose() {} }
    },
  }))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'subagent_codex', description: 'Delegate verification to the fixture external Codex provider.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { throw new Error('Goal must use direct subagent admission before the model') },
  })))
  await ctx.plugin(System3, { jevExecutionDomain: 'local', entryRouting: {
    candidates: [{ id: 'codex', label: 'Codex', description: 'Default for large engineering tasks; routine verification otherwise stays with the current model.', executionDomain: 'local', dataClasses: ['workspace'],
      delegate: { provider: 'codex', tool: 'subagent_codex' }, explicitPatterns: ['codex'] }],
    sessionDataClasses: ['workspace'], minConfidence: 0.8, maxInputBytes: 10000, deadlineMs: 2000,
  } })
  let created = false
  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (!created) {
      created = true
      ctx.goals.create(agent, { objective: 'Use Codex to verify GOAL_DELEGATION_OK before answering.' })
      return
    }
    const goal = ctx.goals.get(agent)
    if (goal?.phase !== 'active' || executions !== 1) throw new Error('Goal delegated execution did not finish exactly once')
    ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
  })
  let requests = 0
  ctx.on('llm/stream', async function* (options, next) {
    if (options.purpose === undefined) {
      requests += 1
      if (requests === 2 && (executions !== 1 || !JSON.stringify(options.messages).includes('GOAL_DELEGATION_OK: independent verification passed.'))) {
        throw new Error('Goal model request preceded delegated execution or lost its attributed result')
      }
    }
    yield* next()
  })
}
