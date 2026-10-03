/** Deterministic process supervision: stall rules and acceptance-evidence checks over the live agent loop. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SubagentActivityInfo, SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import { delegatingAgent } from './delegation-progress.ts'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Thresholds and tool classes the supervision rules use; deployment-owned. */
export interface System3ProcessSupervisionConfig {
  /** `observe` records notices only; `advise` also tells the main model what to do next. */
  readonly mode: 'observe' | 'advise'
  /** Occurrences of the same tool failure in one turn that raise `repeated-error`. */
  readonly repeatedError: number
  /** Failed tool calls in one turn that raise `failed-attempts`. */
  readonly failedAttempts: number
  /** Consecutive calls without an edit, delegation, or passing verification that raise `no-progress`. */
  readonly stalledSteps: number
  /** Failed commands inside one delegated run that raise `delegate-failures`. */
  readonly delegateFailures: number
  /** Tools whose successful call changes files. */
  readonly editTools: readonly string[]
  /** Delegation tools whose successful call hands back delegated changes. */
  readonly delegationTools: readonly string[]
  /** Shell tools whose command text and exit code are inspected. */
  readonly shellTools: readonly string[]
  /** Case-insensitive regular expression for verification commands, such as tests or builds. */
  readonly verifyPattern: string
}

/** Which rule a notice reports. */
export type System3ProcessRule = 'repeated-error' | 'failed-attempts' | 'no-progress' | 'missing-evidence' | 'delegate-failures'

/** One supervision finding recorded in the Session of the supervised Agent. */
export interface System3ProcessNotice {
  readonly version: 1
  readonly rule: System3ProcessRule
  /** Tool or delegate provider the finding concerns, when one applies. */
  readonly subject?: string
  /** The count that reached the threshold. */
  readonly count: number
  /** Whether the main model was told what to do next. */
  readonly advised: boolean
}

/** Model-visible advice attributed to System3 process supervision. */
export interface System3SupervisionSource {
  readonly kind: 'system3-supervision'
  readonly rule: System3ProcessRule
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A process supervision rule fired for this Session's Agent; not model-visible by itself. */
    'system3/process-notice': System3ProcessNotice
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Advice System3 process supervision gave the main model after a rule fired.
     * Readers preserve the content without this producer.
     * @persistenceAttribution
     */
    'system3-supervision': System3SupervisionSource
  }
}

/** A single `|` between commands; `||` is not a pipe. */
const PIPE = /(?<!\|)\|(?!\|)/u

interface TurnState {
  readonly failures: Map<string, number>
  failed: number
  streak: number
  modified: boolean
  verified: boolean
  nudged: boolean
  readonly fired: Set<string>
}

/**
 * Render the advice the main model receives when a rule fires.
 * @param rule - The rule that fired.
 * @param subject - The tool the finding concerns, when one applies.
 * @param count - The count that reached the threshold.
 * @returns Model-visible advice text.
 */
export function supervisionAdvice(rule: Exclude<System3ProcessRule, 'delegate-failures'>, subject: string | undefined, count: number): string {
  switch (rule) {
    case 'repeated-error':
      return `[System3 过程监督] \`${subject ?? ''}\` 已经第 ${String(count)} 次以同样的错误失败。不要再原样重试：先分析原因换一种做法，或向用户说明情况并请求确认。`
    case 'failed-attempts':
      return `[System3 过程监督] 本轮已有 ${String(count)} 次工具调用失败。请暂停重试，向用户简要说明遇到的问题，并请用户确认下一步。`
    case 'no-progress':
      return `[System3 过程监督] 最近 ${String(count)} 步没有产生新的修改或通过的验证。请重新评估方法、换一种策略，或向用户说明卡在哪里。`
    case 'missing-evidence':
      return '[System3 过程监督] 本轮修改了文件或完成了委派，但还没有运行通过的测试或构建来验证。请先运行项目的验证命令，再向用户报告结果；如果无法验证，请明确说明原因。'
  }
}

/** The shell exit code a successful result reports, when the result carries one. */
function exitCodeOf(result: Readonly<ToolExecutionResult>): number | null {
  const value = result.isError ? undefined : result.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const code = value.exitCode
  return typeof code === 'number' ? code : null
}

/** First line of a result's text with digits folded, so retries of one failure share a key. */
function failureDigest(result: Readonly<ToolExecutionResult>): string {
  const text = result.content.find(block => block.type === 'text')
  const line = text?.type === 'text' ? text.text.trim().replace(/\n[\s\S]*/u, '') : ''
  return line.slice(0, 120).replace(/\d+/g, '#')
}

function commandOf(exec: ToolExecution): string {
  const args = exec.arguments
  return typeof args === 'object' && args !== null && 'command' in args && typeof args.command === 'string' ? args.command : ''
}

/**
 * Supervise every Agent loop on this context with deterministic rules and record each finding.
 * @param ctx - Plugin context; listeners are disposed with it.
 * @param config - Thresholds, tool classes, and whether to advise the main model.
 */
export function installSystem3ProcessSupervision(ctx: Context, config: System3ProcessSupervisionConfig): void {
  const limits = { repeatedError: config.repeatedError, failedAttempts: config.failedAttempts,
    stalledSteps: config.stalledSteps, delegateFailures: config.delegateFailures }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`processSupervision ${key} must be a positive integer`)
  }
  let verify: RegExp
  try {
    verify = new RegExp(config.verifyPattern, 'iu')
  } catch (error) {
    throw new Error(`processSupervision verifyPattern is not a valid regular expression: ${config.verifyPattern}`, { cause: error })
  }
  const advise = config.mode === 'advise'
  const turns = new WeakMap<Agent, TurnState>()
  const runs = new Map<string, number>()
  const stateOf = (agent: Agent): TurnState => {
    let state = turns.get(agent)
    if (state === undefined) {
      state = { failures: new Map(), failed: 0, streak: 0, modified: false, verified: false, nudged: false, fired: new Set() }
      turns.set(agent, state)
    }
    return state
  }
  const record = (agent: Agent, rule: System3ProcessRule, count: number, subject?: string, advised = false): void => {
    agent.session.append('system3/process-notice', {
      version: 1, rule, count, advised, ...subject === undefined ? {} : { subject } })
  }
  const advice = (rule: Exclude<System3ProcessRule, 'delegate-failures'>, subject: string | undefined, count: number): UserMessage =>
    createUserMessage({ content: [{ type: 'text', text: supervisionAdvice(rule, subject, count) }], source: { kind: 'system3-supervision', rule } })

  // Each rule fires once per turn and key, so one finding produces one notice.
  const observe = (exec: ToolExecution, result: Readonly<ToolExecutionResult>): UserMessage[] => {
    const agent = exec.agent
    if (agent === undefined || exec.parent !== undefined) return []
    const state = stateOf(agent)
    const shell = config.shellTools.includes(exec.name)
    const exit = shell ? exitCodeOf(result) : null
    const failed = result.isError || (exit !== null && exit !== 0)
    const found: UserMessage[] = []
    const fire = (rule: Exclude<System3ProcessRule, 'delegate-failures'>, count: number, subject?: string): void => {
      const key = `${rule}:${subject ?? ''}`
      if (state.fired.has(key)) return
      state.fired.add(key)
      record(agent, rule, count, subject, advise)
      if (advise) found.push(advice(rule, subject, count))
    }
    if (failed) {
      const key = `${exec.name}\u0000${result.isError ? result.error.info?.code ?? '' : `exit ${String(exit)}`}\u0000${failureDigest(result)}`
      const repeats = (state.failures.get(key) ?? 0) + 1
      state.failures.set(key, repeats)
      if (repeats >= config.repeatedError) fire('repeated-error', repeats, exec.name)
      state.failed += 1
      if (state.failed >= config.failedAttempts) fire('failed-attempts', state.failed)
    }
    const edited = !failed && config.editTools.includes(exec.name)
    const delegated = !failed && config.delegationTools.includes(exec.name)
    // A piped command reports the exit code of its last stage, so it cannot prove that a check passed.
    const command = commandOf(exec)
    const verified = !failed && shell && verify.test(command) && !PIPE.test(command)
    if (edited || delegated) { state.modified = true; state.verified = false }
    if (verified) state.verified = true
    if (edited || delegated || verified) state.streak = 0
    else {
      state.streak += 1
      if (state.streak >= config.stalledSteps) fire('no-progress', state.streak)
    }
    return found
  }

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const found = observe(exec, result)
    const downstream = await next()
    if (found.length === 0) return downstream
    const additionalContexts = [...found, ...downstream.additionalContexts ?? []]
    return downstream.kind === 'block'
      ? { kind: 'block', feedback: downstream.feedback, additionalContexts }
      : { ...downstream, additionalContexts }
  })

  // Before the turn closes, changes without a passing verification earn one reminder; the state then resets.
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const state = turns.get(agent)
    if (state === undefined) return
    if (state.modified && !state.verified && !state.nudged) {
      state.nudged = true
      record(agent, 'missing-evidence', 1, undefined, advise)
      if (advise) { agent.steer(advice('missing-evidence', undefined, 1)); return }
    }
    turns.delete(agent)
  })

  // A person's new message starts fresh supervision; System3's own advice does not.
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (messages.some(message => message.source.kind === 'user')) turns.delete(agent)
    return next()
  })

  ctx.on('subagent/activity', function (info: SubagentActivityInfo) {
    if (info.outcome !== 'failed') return
    const agent = delegatingAgent(this)
    if (agent === undefined) return
    const count = (runs.get(info.runId) ?? 0) + 1
    runs.set(info.runId, count)
    if (count === config.delegateFailures) record(agent, 'delegate-failures', count, info.provider)
  })
  ctx.on('subagent/end', (info: SubagentRunEndInfo) => { runs.delete(info.runId) })
  ctx.effect(() => () => { runs.clear() }, 'system3.processSupervision()')
}
