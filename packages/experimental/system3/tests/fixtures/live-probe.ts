/** Explicit live-verification plugin loaded only by a test overlay. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '../../src/index.ts'

export const name = 'system3-live-probe'
export const inject = ['system3', 'sessions']

/**
 * Record a bounded public Jev request in the launched Agent Session.
 * @param ctx - Test composition context.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', async ({ agent }) => {
    const receipt = await ctx.system3.shadowDecision(agent.session, {
      dataClasses: ['public'],
      supervisor: {
        currentGoalRevision: 'live-smoke:1',
        advice: { action: 'continue', goalRevision: 'live-smoke:1', evidenceRefs: [] },
        requiredChecks: [], availableEvidenceRefs: [], budgetRemaining: 1,
      },
    })
    await ctx.sessions.flush(agent.session)
    console.log(JSON.stringify({
      probe: 'system3-jev', sessionId: agent.session.id, outcome: receipt.outcome.kind,
      model: receipt.outcome.kind === 'ok' ? receipt.outcome.response.model : receipt.requestedModel,
      advice: receipt.advice, baseline: receipt.baseline.action, elapsedMs: receipt.elapsedMs,
      replayable: ctx.system3.lastDecision(agent.session)?.id === receipt.id,
    }))
    if (receipt.outcome.kind !== 'ok') throw new Error(`Jev live verification failed: ${receipt.outcome.code}`)
  })
}
