/** Real Goal routing and recovery services with external Reflex and native Codex execution replaced. */
import { createServer } from 'node:http'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import System3 from '@deepseek-ai/dsh-experimental-system3'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'snapshot-reflex-native-recovery-producer'
export const inject = ['goals', 'subagents', 'tools', 'sessionProjections']

const objective = 'Use Codex to verify NATIVE_RECOVERY_OK without repeating uncertain side effects.'
const output = 'NATIVE_RECOVERY_OK: same-thread continuation consumed autonomous input; independent verification passed.'
const threadId = 'snapshot-native-thread'
const originalTurnId = 'snapshot-native-turn-1'
const continuedTurnId = 'snapshot-native-turn-2'
const recoveryId = '00000000-0000-4000-8000-000000000007'

/** @param {import('@deepseek-ai/cordis').Context} ctx - Shipped SDK services. */
export async function apply(ctx) {
  const now = Date.now
  let fixtureTime = 10000
  Date.now = () => fixtureTime
  ctx.effect(() => () => { Date.now = now })
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const query = JSON.parse(body)
    const recovery = query.questions.recover?.type === 'noul'
    if (query.state.objective !== objective || (!recovery && query.questions.route?.type !== 'choice')) {
      response.writeHead(400).end('unexpected recovery fixture decision')
      return
    }
    if (recovery && (query.state.consecutiveRetries !== 3 || query.state.retryBudget !== 3 || query.state.runningSideEffects !== 0)) {
      response.writeHead(400).end('recovery input lost measured budgets')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'reflex-snapshot', answers: recovery
      ? { recover: { type: 'noul', noul: 1 } }
      : { route: { type: 'choice', choice: 'codex', confidence: 1, probabilities: { codex: 1, abstain: 0 } } } }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  ctx.effect(() => () => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Recovery fixture has no port')
  await ctx.plugin(Jev, { endpoint: `http://127.0.0.1:${address.port}`, model: 'reflex-snapshot' })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const append = agent.session.append
    // Normalize generated recovery identity; request and provider observation values remain exact.
    agent.session.append = function (type, data, ...options) {
      if (type === 'system3/judgement') data = { ...data, elapsedMs: 0 }
      if (type === 'system3/reflex-recovery' || type === 'subagent/supervision-recovery') {
        data = { ...data, id: recoveryId }
      }
      return append.call(this, type, data, ...options)
    }
    try { return await next() } finally { agent.session.append = append }
  })
  let executions = 0
  let consumed
  let finish
  let nativeTurnId = originalTurnId
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false,
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    async start(request) {
      if (!JSON.stringify(request.prompt).includes(objective)) throw new Error('Goal objective was not forwarded')
      executions += 1
      fixtureTime = 20000
      const lastActivityAt = Date.now()
      const result = new Promise(resolve => { finish = resolve })
      return { id: 'snapshot-native-codex', localAgent: undefined, result,
        recoveryState: () => ({ threadId, turnId: nativeTurnId, lastActivityAt, retryCount: 3, waiting: false, activeSideEffects: 0 }),
        async recover(recovery, signal) {
          signal.throwIfAborted()
          if (recovery.expectedTurnId !== originalTurnId || nativeTurnId !== originalTurnId) throw new Error('Wrong native turn')
          if (recovery.continuation() === undefined) throw new Error('Recovery lost authority before interruption')
          // External provider fixture confirms the matching interrupted terminal before accepting a new turn.
          await Promise.resolve()
          consumed = recovery.continuation()
          if (!JSON.stringify(consumed).includes('[Reflex 自动监督 / reflex-supervision]')) throw new Error('Recovery input lost attribution')
          if (!JSON.stringify(consumed).includes(objective)) throw new Error('Recovery input lost Goal')
          nativeTurnId = continuedTurnId
          return { state: 'continued', threadId, previousTurnId: originalTurnId, turnId: continuedTurnId }
        },
        async dispose() { finish({ output: [], stopReason: 'aborted' }) },
      }
    },
  }))
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'system3/reflex-recovery' && event.data.state === 'continued') {
      if (consumed === undefined || nativeTurnId !== continuedTurnId) throw new Error('Receipt preceded native input consumption')
      finish({ output: [{ type: 'text', text: output }], stopReason: 'completed' })
    }
  })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'subagent_codex', description: 'Delegate verification to the fixture external Codex provider.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { throw new Error('Goal must use direct subagent admission before the model') },
  })))
  await ctx.plugin(System3, { jevExecutionDomain: 'local', jevRouteId: 'reflex-snapshot', entryRouting: {
    candidates: [{ id: 'codex', label: 'Codex', description: 'Code verification', executionDomain: 'local', dataClasses: ['workspace'],
      delegate: { provider: 'codex', tool: 'subagent_codex' }, explicitPatterns: ['codex'] }],
    sessionDataClasses: ['workspace'], minConfidence: 0.8, maxInputBytes: 10000, deadlineMs: 2000,
  }, reflexSupervision: {
    mode: 'active', yes: 0.8, no: 0.2, deadlineMs: 2000, sessionDataClasses: ['public'], intervalMs: 10,
    stallMs: 10000, repeatedFailures: 3, evidenceLimit: 16, cooldownMs: 10, maxInterventions: 1, feedbackMs: 10,
    recovery: { nativeSilenceMs: 10000, retryLimit: 3, interruptGraceMs: 1000, cooldownMs: 10, maxRecoveries: 1, reassessmentMs: 1000 },
  } })
  let created = false
  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (!created) { created = true; ctx.goals.create(agent, { objective }); return }
    const goal = ctx.goals.get(agent)
    if (goal?.phase !== 'active' || executions !== 1 || consumed === undefined) throw new Error('Goal recovery did not finish exactly once')
    ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
  })
  let requests = 0
  ctx.on('llm/stream', async function* (options, next) {
    if (options.purpose === undefined) {
      requests += 1
      if (requests === 2 && (nativeTurnId !== continuedTurnId || !JSON.stringify(options.messages).includes(output))) {
        throw new Error('Goal model request preceded recovery or lost the persisted result')
      }
    }
    yield* next()
  })
}
