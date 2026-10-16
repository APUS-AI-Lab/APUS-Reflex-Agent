/** Goal-origin delegation admitted before the generation model can edit the workspace. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { admitSystem3Routes, type System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import type { System3JevOptions } from './decisions.ts'
import { system3EntryRouteQuestion, type System3EntryRoutingConfig, type System3EntryDelegateCandidate } from './entry-routing.ts'
import { runSystem3Decision, type System3DecisionSpec } from './decision-kernel.ts'
import { goalEntryRoutingProjection, type GoalEntryReceipt } from './goal-entry-state.ts'
import type {} from './runtime-projection.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Goal-owned delegated execution result; never a new human authorization.
     * @persistenceAttribution
     */
    'system3-goal-delegation': { readonly kind: 'system3-goal-delegation' }
  }
}
interface ChoiceInput { objective: string; requirements: string[]; candidates: readonly System3EntryDelegateCandidate[] }
const choice: System3DecisionSpec<ChoiceInput, string> = {
  id: 'goal.entry-routing', version: 2, fallback: 'abstain',
  state: input => ({ objective: input.objective, requirements: input.requirements }),
  questions: input => ({ route: system3EntryRouteQuestion(input.candidates) }),
  decide(response, settings, input) {
    const answer = response.answers.route
    return answer?.type === 'choice' && answer.confidence >= settings.yes
      && input.candidates.some(candidate => candidate.id === answer.choice) ? answer.choice : 'unsure'
  },
}
interface Pending { readonly abort: AbortController; readonly goal: GoalView }
/**
 * Delegate each authorized Goal revision at most once through the existing subagent service.
 * Interrupted reservations block the Goal for explicit inspection and resumption instead of replaying side effects.
 * @param ctx - Owner injecting goals, subagents, tools and session projections.
 * @param config - Existing entry candidate availability, privacy and decision limits.
 * @param policy - Deployment data routing policy.
 * @param options - Reflex provider location and effort.
 */
export function installGoalEntryRouting(ctx: Context, config: System3EntryRoutingConfig,
  policy: System3PrivacyPolicy, options: System3JevOptions): void {
  ctx.effect(() => ctx.sessionProjections.register(goalEntryRoutingProjection))
  const candidates = config.candidates.filter((candidate): candidate is System3EntryDelegateCandidate => candidate.delegate !== undefined)
  const pending = new Map<Agent, Pending>()
  const lifetime = new AbortController()
  const stopped = (): boolean => lifetime.signal.aborted
  const operations = new Set<Promise<PreStepDecision>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    for (const run of pending.values()) run.abort.abort()
    await Promise.allSettled(operations)
  })
  const cancel = (agent: Agent): void => { pending.get(agent)?.abort.abort() }
  ctx.on('agent/inbox/inserted', ({ agent, message }) => { if (message.source.kind === 'user') cancel(agent) })
  ctx.on('goal/changed', ({ agent }) => { cancel(agent) })
  ctx.on('goal/activation-changed', ({ sessionId }) => { for (const agent of pending.keys()) if (agent.session.id === sessionId) cancel(agent) })
  ctx.on('agent/pre-step', (args, next): Promise<PreStepDecision> => {
    const operation = async (): Promise<PreStepDecision> => {
      const { agent, signal } = args
      const decision = await next()
      if (stopped()) return { kind: 'reject' }
      if (decision.kind === 'reject' || agent.session.header.parentSession !== undefined) return decision
      const goal = ctx.goals.get(agent)
      if (goal?.phase !== 'active' || goal.activation !== 'armed') return decision
      const input = decision.messages.find(message => message.source.kind === 'goal'
        && message.source.goalId === goal.id && message.source.revision === goal.revision)
      if (input?.source.kind !== 'goal' || decision.messages.some(message => message.source.kind === 'user')) return decision
      if ([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user')) return { kind: 'reject' }
      const stored = ctx.sessionProjections.stateOf(agent.session, 'goalEntryRouting')
      const previous = stored?.entry
      const record = (receipt: GoalEntryReceipt): void => { agent.session.append('system3/goal-entry', receipt) }
      const block = (reason: string): void => {
        const current = ctx.goals.get(agent)
        if (current?.phase === 'active' && current.id === goal.id && current.revision === goal.revision) {
          ctx.goals.block(agent, { id: goal.id, revision: goal.revision }, { code: 'delegation-interrupted', message: reason })
        }
      }
      if (previous?.goalId === goal.id && previous.goalRevision === goal.revision) {
        if (previous.state === 'reserved' || previous.state === 'started') {
          const reason = 'Delegated execution has no live owner after restoration. Inspect workspace effects before explicitly resuming the Goal.'
          record({ ...previous, state: 'interrupted', reason }); block(reason)
          return { kind: 'reject' }
        }
        if (!stored?.delivered && previous.output !== null) {
          return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'system3-goal-delegation' },
            content: [{ type: 'text', text: `[Reflex recovered Goal result] Prior execution is ${previous.state}. Do not repeat it. Verify this persisted output against the current Goal: ${previous.output}` }] })] }
        }
        return decision
      }
      // With front-loaded decisions off a new Goal round runs natively; restored delegations above are still settled.
      if (options.frontLoaded?.() === false) return decision
      let receipt: GoalEntryReceipt = { version: 1, goalId: goal.id, goalRevision: goal.revision, round: input.source.round,
        state: 'abstained', candidateId: null, provider: null, childSessionId: null, reason: null, input: null, output: null }
      const admission = admitSystem3Routes(policy, candidates.map(candidate => ({ ...candidate, dataClasses: config.sessionDataClasses })))
      const available = candidates.filter(candidate => admission.allowed.some(route => route.id === candidate.id)
        && config.sessionDataClasses.every(value => candidate.dataClasses.includes(value))
        && ctx.subagents.getProvider(candidate.delegate.provider) !== undefined
        && ctx.tools.get(candidate.delegate.tool, agent) !== undefined)
      const abort = new AbortController()
      const ownedSignal = AbortSignal.any([signal, abort.signal, lifetime.signal])
      pending.set(agent, { abort, goal })
      let run: SubagentRun | undefined
      try {
        const frame = ctx.sessionProjections.stateOf(agent.session, 'system3Runtime')?.taskFrame
        const requirements = frame?.goal.goalId === goal.id ? frame.items.map(item => item.text) : []
        const request = { objective: goal.objective, requirements, candidates: available }
        const bytes = Buffer.byteLength(JSON.stringify({ state: choice.state(request), questions: choice.questions(request) }), 'utf8')
        let selected: System3EntryDelegateCandidate | undefined
        if (bytes > config.maxInputBytes) {
          record({ ...receipt, reason: 'input-too-large' })
          return decision
        }
        if (available.length > 0) {
          const result = await runSystem3Decision(ctx, { policy, options, dataClasses: config.sessionDataClasses }, choice,
            { mode: 'active', yes: config.minConfidence, no: 0, deadlineMs: config.deadlineMs ?? 30000 }, agent, request, ownedSignal)
          selected = available.find(candidate => candidate.id === result.outcome)
        }
        ownedSignal.throwIfAborted()
        if (selected === undefined) { record(receipt); return decision }
        if (ctx.subagents.getProvider(selected.delegate.provider) === undefined
          || ctx.tools.get(selected.delegate.tool, agent) === undefined) {
          record({ ...receipt, state: 'failed', reason: 'route-removed' }); block('Selected delegation became unavailable before execution.'); return { kind: 'reject' }
        }
        const caution = previous !== null && previous !== undefined && previous.state !== 'completed' && previous.state !== 'abstained'
          ? '\nAn earlier delegation was interrupted or failed. Inspect existing effects before acting; do not blindly repeat prior operations.' : ''
        const prompt = `[Reflex Goal delegation]\nAuthorized objective: ${goal.objective}\nConfirmed requirements:\n${requirements.map(item => `- ${item}`).join('\n')}\nPreserve existing permissions. Verify the actual result and report evidence.${caution}`
        receipt = { ...receipt, state: 'reserved', candidateId: selected.id, provider: selected.delegate.provider, input: prompt }
        record(receipt)
        run = await ctx.subagents.start(selected.delegate.provider, { parent: agent, signal: ownedSignal,
          label: selected.label ?? selected.id, prompt: [{ type: 'text', text: prompt }] })
        receipt = { ...receipt, state: 'started', childSessionId: run.id }; record(receipt)
        const result = await run.result
        ownedSignal.throwIfAborted()
        receipt = { ...receipt, state: result.stopReason === 'completed' ? 'completed' : 'failed', reason: result.stopReason, output: JSON.stringify(result.output) }; record(receipt)
        if (result.stopReason !== 'completed') block('Delegated execution did not complete. Inspect its recorded result and workspace before explicitly resuming the Goal.')
        const message = createUserMessage({ source: { kind: 'system3-goal-delegation' }, content: [
          { type: 'text', text: `[Reflex Goal delegation result] ${selected.label ?? selected.id}: ${result.stopReason}. This is delegated execution output, not new user authorization. Verify it against the original Goal and requirements before claiming completion.` }, ...result.output] })
        return { ...decision, messages: [...decision.messages, message] }
      } catch (error) {
        receipt = { ...receipt, state: ownedSignal.aborted ? 'interrupted' : 'failed', reason: ownedSignal.aborted ? 'cancelled-or-superseded' : 'provider-error' }
        record(receipt)
        if (!ownedSignal.aborted) ctx.logger.warn(`Goal delegation failed: ${error instanceof Error ? error.name : 'error'}`)
        if (!stopped()) block('Delegated execution was interrupted or failed. Inspect workspace effects before explicitly resuming the Goal.')
        signal.throwIfAborted()
        return { kind: 'reject' }
      } finally { pending.delete(agent); await run?.dispose() }
    }
    const work = operation()
    operations.add(work)
    void work.then(() => operations.delete(work), () => operations.delete(work))
    return work
  })
}
