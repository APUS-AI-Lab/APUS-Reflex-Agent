/**
 * Task frame: the person's goal and later requirements, kept verbatim and shown to the main model
 * as runtime context so they stay in view for the whole task.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { JevResponse } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import type { System3DataClass } from '@deepseek-ai/dsh-experimental-system3-policy'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { GoalChangeMeta } from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SubagentLiveRunId } from '@deepseek-ai/dsh-subagent'
import type {} from './types.ts'
import { choiceVerdict, noulVerdict, runSystem3Decision, validateSystem3DecisionSettings, type System3DecisionContext,
  type System3DecisionSettings, type System3DecisionSpec } from './decision-kernel.ts'
import type { System3JevOptions } from './decisions.ts'
import type { System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'

/** Mode, thresholds, and size limits of the task frame; deployment-owned. */
export interface System3TaskFrameConfig extends System3DecisionSettings {
  /** Data classes of Session text sent to Jev, checked against the privacy policy. */
  readonly sessionDataClasses: readonly System3DataClass[]
  /** Most recent requirements kept in the frame. */
  readonly maxItems: number
  /** Messages longer than this many characters are neither judged nor kept. */
  readonly maxMessageChars: number
  /**
   * Judge a message as soon as it is queued behind a running turn: `active` moves a requirement, acceptance criterion, or
   * correction of the current task into that turn through the Session controller's queue `steer` action, and also sends its
   * text to a running delegated run that accepts input; `shadow` records the decision only. Omit to leave queued messages for
   * the next turn. Moving needs an `active` task frame.
   */
  readonly interjection?: 'shadow' | 'active'
}

/** A message queued behind a running turn, judged for whether it belongs in that turn. */
export interface System3Interjection {
  readonly version: 1
  readonly messageId: MessageId
  /** `steer` for a requirement, acceptance criterion, or correction of the current task; otherwise `keep`. */
  readonly decision: 'steer' | 'keep'
  /** Whether the message moved into the running turn; false in shadow mode or once the turn no longer accepted it. */
  readonly delivered: boolean
  /** Provider of the running delegated run that also received the text, when one accepted it. */
  readonly forwardedTo?: string
}

/** One message of the person, verbatim. */
export interface System3TaskMessage {
  readonly messageId: MessageId
  readonly text: string
}

/** What set the current task, verbatim: exactly one of `messageId` and `goalId` is present. */
export interface System3TaskGoal {
  readonly text: string
  /** The person's message that started the task. */
  readonly messageId?: MessageId
  /** The DSH goal whose objective is the task. */
  readonly goalId?: GoalId
}

/** The current task frame, recorded whole each time it changes. */
export interface System3TaskFrame {
  readonly version: 1
  /** The DSH goal's objective when a goal set the task, otherwise the message that started it. */
  readonly goal: System3TaskGoal
  /** Later messages judged to be requirements, acceptance criteria, or corrections, oldest first. */
  readonly items: readonly System3TaskMessage[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** The task frame changed; the main model sees it through the `system3:task-frame` runtime context. */
    'system3/task-frame': System3TaskFrame
    /** A queued message was judged and possibly moved into the running turn; the move itself is the inbox steer. */
    'system3/interjection': System3Interjection
  }
}

/** A message is kept when any of these questions is answered yes. */
const KEEP = ['requirement', 'acceptance', 'correction'] as const

/** What the decision judges: the current task and the new message. */
interface FrameInput {
  readonly goal: string
  readonly message: string
}

type FrameOutcome = 'new-task' | 'add' | 'none'

/** Both texts are quoted in every question; Jev related them poorly when they were only referenced in the state. */
const note = (input: FrameInput): string => `用户正在让 AI 完成的任务是：「${input.goal}」。用户刚刚又发来一条消息：「${input.message}」。`

/**
 * The task-frame decision: one request with a choice and five yes/no questions about the new message.
 * The requirement wording follows the hand-off pack, whose labelled set it passed.
 */
export const system3TaskFrameDecision: System3DecisionSpec<FrameInput, FrameOutcome> = {
  id: 'task.frame',
  version: 2,
  state: input => ({ task: input.goal, message: input.message }),
  questions: input => ({
    intent: { type: 'choice', instructions: `${note(input)}这条消息属于哪一类？`, criteria: {
      continue: '继续推进这个任务：补充或限制要求（包括不许改哪些文件、文件放在哪里、不许做什么）、修改、纠正、撤销、确认、催促，或回答 AI 的问题',
      side: '顺便提出一个知识问题、请 AI 解释，或者闲聊、感谢、道别、结束对话，不改变这个任务',
      switch: '要 AI 放下这个任务，去做一件与它无关的新工作，例如写一封邮件、查天气、整理周报、改另一个项目',
      unclear: '无法判断',
    } },
    request: { type: 'noul', instructions: `${note(input)}判断这条消息是否在请 AI 去做某件具体的事，不论 AI 能否做到，例如写、改、查、整理、订票、操作设备。道别、感谢、确认、知识提问、评价都不算。`,
      criteria: { true: '要求 AI 做一项具体工作', false: '没有要求具体工作' } },
    requirement: { type: 'noul', instructions: `${note(input)}判断这条新消息是否给当前任务定下了之后仍然有效的工作要求或约束，例如命名规范、不许改动的文件或目录、必须使用或禁止使用的工具和依赖、文件放置约定、输出格式或语言、安全规定。闲聊、提问、感谢、评价、单纯的“继续”都不算。`,
      criteria: { true: '是仍然有效的工作要求或约束', false: '不是' } },
    acceptance: { type: 'noul', instructions: `${note(input)}判断这条新消息是否说明了当前任务怎样才算完成，例如必须通过的测试或检查、必须达到的结果、数值或性能指标、交付前要满足的条件。`,
      criteria: { true: '说明了完成标准', false: '没有说明完成标准' } },
    interrupt: { type: 'noul', instructions: `${note(input)}判断这条新消息是否让 AI 停下、先别做或改做它正在进行的某个操作，例如“先别跑全量测试”“等等，别提交”。`,
      criteria: { true: '让 AI 停下或改做正在进行的操作', false: '没有' } },
    correction: { type: 'noul', instructions: `${note(input)}判断这条新消息是否在纠正 AI 之前的做法、理解或结果，例如指出做错了、要求改回或撤销、要求换一种做法。`,
      criteria: { true: '是在纠正 AI', false: '不是纠正' } },
  }),
  decide(response, settings) {
    const verdict = verdictOf(response, settings)
    const intent = choiceVerdict(response.answers.intent, settings)
    // A new task asks for concrete work; a correction refers to what the AI already did for the current one.
    if (intent === 'switch' && verdict('request') === 'yes' && verdict('correction') !== 'yes') return 'new-task'
    // Stopping an action in progress is a requirement only while the person continues the task; a farewell also says stop.
    const interrupts = intent === 'continue' && verdict('interrupt') === 'yes'
    if (interrupts || KEEP.some(key => verdict(key) === 'yes')) return 'add'
    return intent !== undefined && intent !== 'unclear' && KEEP.every(key => verdict(key) === 'no') ? 'none' : 'unsure'
  },
  fallback: 'none',
}

function verdictOf(response: JevResponse, settings: Pick<System3DecisionSettings, 'yes' | 'no'>) {
  return (key: string): 'yes' | 'no' | 'unsure' => {
    const answer = response.answers[key]
    return answer?.type === 'noul' ? noulVerdict(answer.noul, settings) : 'unsure'
  }
}

/**
 * Render the frame as the main model sees it.
 * @param frame - The current task frame.
 * @returns Model-visible text, or an empty string when the frame holds no requirement.
 */
export function taskFrameText(frame: Pick<System3TaskFrame, 'goal' | 'items'> | null | undefined): string {
  if (frame == null || frame.items.length === 0) return ''
  return ['[System3 任务卡] 用户在当前任务中提出了以下要求（均为原话）。在整个任务中遵守它们，宣布完成前逐条核对：',
    `任务：${frame.goal.text}`, ...frame.items.map(item => `- ${item.text}`)].join('\n')
}

/** Text of a person's message when it is plain text within the size limit. */
function personText(message: UserMessage, limit: number): string | undefined {
  if (message.source.kind !== 'user') return undefined
  const blocks = message.content.filter(block => block.type === 'text')
  if (blocks.length !== message.content.length) return undefined
  const text = blocks.map(block => block.text).join('\n').trim()
  return text === '' || text.length > limit ? undefined : text
}

/** Services and policy the task frame needs. */
export interface System3TaskFrameSettings {
  readonly config: System3TaskFrameConfig
  readonly policy: System3PrivacyPolicy
  readonly options: System3JevOptions
}

/**
 * Reject a task-frame configuration that cannot work.
 * @param config - Task-frame settings from deployment configuration.
 */
export function validateSystem3TaskFrame(config: System3TaskFrameConfig): void {
  validateSystem3DecisionSettings('taskFrame', config)
  if (!Number.isSafeInteger(config.maxItems) || config.maxItems < 1) throw new Error('taskFrame maxItems must be a positive integer')
  if (!Number.isSafeInteger(config.maxMessageChars) || config.maxMessageChars < 1) throw new Error('taskFrame maxMessageChars must be a positive integer')
}

/**
 * Keep a task frame for every top-level Agent on this context. Creating a DSH goal starts the frame from its objective, and
 * while that goal is open no message replaces it. Otherwise the first message of a Session starts the frame; each later
 * message is judged after it is claimed, without delaying the step, and its result shapes the frame from the next step on;
 * with `interjection`, a message queued behind a running turn is judged on arrival and may move into that turn.
 * In `shadow` mode only judgements are recorded; the frame stays in memory and the model never sees it.
 * @param ctx - Plugin context with the system prompt; listeners are disposed with it.
 * @param settings - Task-frame settings, privacy policy, and Jev options.
 */
export function installSystem3TaskFrame(ctx: Context, settings: System3TaskFrameSettings): void {
  const { config } = settings
  validateSystem3TaskFrame(config)
  const active = config.mode === 'active'
  const shared: System3DecisionContext = { policy: settings.policy, options: settings.options, dataClasses: config.sessionDataClasses }
  const queues = new WeakMap<Agent, Promise<void>>()
  // The latest committed frame per Session, restored once from history and then followed through Session events.
  const frames = new WeakMap<Session, System3TaskFrame | null>()
  const frameOf = (agent: Agent): System3TaskFrame | null => {
    let frame = frames.get(agent.session)
    if (frame === undefined) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      frame = agent.session.snapshotEvents().findLast(event => event.type === 'system3/task-frame')?.data ?? null
      frames.set(agent.session, frame)
    }
    return frame
  }
  // Whether the Session's DSH goal is still open (not complete or cleared), restored once from history like the frame.
  const goals = new WeakMap<Session, boolean>()
  const isOpen = (change: GoalChangeMeta): boolean => change.operation !== 'complete' && change.operation !== 'clear'
  const goalOpen = (agent: Agent): boolean => {
    let open = goals.get(agent.session)
    if (open === undefined) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const last = agent.session.snapshotEvents().findLast(event => event.type === 'goal/change')?.data
      open = last !== undefined && isOpen(last)
      goals.set(agent.session, open)
    }
    return open
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'system3/task-frame') frames.set(session, event.data)
    if (event.type === 'goal/change') goals.set(session, isOpen(event.data))
  })
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'system3.taskFrame()')

  // In shadow mode the frame lives only in memory, so later messages are still judged against the current task.
  const record = (agent: Agent, goal: System3TaskFrame['goal'], items: System3TaskFrame['items']): void => {
    const frame: System3TaskFrame = { version: 1, goal, items }
    if (active) agent.session.append('system3/task-frame', frame)
    frames.set(agent.session, frame)
  }
  const judge = async (agent: Agent, message: System3TaskMessage): Promise<FrameOutcome> => {
    const frame = frameOf(agent)
    if (frame === null) { record(agent, message, []); return 'none' }
    const result = await runSystem3Decision(ctx, shared, system3TaskFrameDecision, config, agent,
      { goal: frame.goal.text, message: message.text }, lifetime.signal)
    // While a DSH goal is open it is the task, so a message cannot replace it.
    if (result.outcome === 'new-task' && !goalOpen(agent)) record(agent, message, [])
    else if (result.outcome === 'add') record(agent, frame.goal, [...frame.items, message].slice(-config.maxItems))
    return result.outcome
  }
  // Messages of one Agent are judged in order, so each judgement sees the frame its predecessor left.
  const enqueue = (agent: Agent, message: System3TaskMessage): Promise<FrameOutcome | undefined> => {
    const settled = (queues.get(agent) ?? Promise.resolve()).then(() => judge(agent, message)).catch((error: unknown) => {
      if (!lifetime.signal.aborted) ctx.logger.warn(`system3 task frame: ${String(error)}`)
      return undefined
    })
    queues.set(agent, settled.then(() => undefined))
    return settled
  }
  // Queued messages judged on arrival; their claim at the next step reuses that judgement instead of asking again.
  const early = new WeakMap<Session, Set<MessageId>>()
  const topLevel = (agent: Agent): boolean => config.mode !== 'off' && (agent.session.header.delegationDepth ?? 0) === 0

  // A DSH goal sets the task: creating one starts a frame from its objective, editing the objective keeps the requirements.
  ctx.on('goal/changed', ({ agent, change }) => {
    if (!topLevel(agent) || change.goal === undefined) return
    const goal = { goalId: change.goal.id, text: change.goal.objective }
    const frame = frameOf(agent)
    if (change.operation === 'create') record(agent, goal, [])
    else if (change.operation === 'edit' && frame !== null && frame.goal.goalId === goal.goalId
      && frame.goal.text !== goal.text) record(agent, goal, frame.items)
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (topLevel(agent)) {
      for (const message of messages) {
        if (early.get(agent.session)?.delete(message.id) === true) continue
        const text = personText(message, config.maxMessageChars)
        if (text !== undefined) void enqueue(agent, { messageId: message.id, text })
      }
    }
    return next()
  })

  // A delegated run works while the turn waits on it, so it gets the moved text now rather than when the turn resumes.
  const forward = async (agent: Agent, text: string): Promise<string | undefined> => {
    const run = ctx.get('sessionProjections')?.stateOf(agent.session, 'system3Runtime')?.subagentRun
    const subagents = ctx.get('subagents')
    if (run?.state !== 'running' || !run.steerable || subagents === undefined) return undefined
    try {
      await subagents.steerByParent({ runId: brandString<SubagentLiveRunId>(run.runId), parentSessionId: agent.session.id, text },
        lifetime.signal)
      return run.provider
    } catch (error) {
      // The run finished or refused input; the main turn still has the message.
      ctx.logger.info(`system3 interjection not forwarded: ${String(error)}`)
      return undefined
    }
  }
  const interject = async (agent: Agent, message: System3TaskMessage, outcome: FrameOutcome | undefined): Promise<void> => {
    if (outcome === undefined) return
    const decision = outcome === 'add' ? 'steer' : 'keep'
    let delivered = false
    const controller = ctx.get('sessionController')
    if (decision === 'steer' && config.interjection === 'active' && controller !== undefined) {
      try {
        await controller.updateQueue({ sessionId: agent.session.id, itemId: message.messageId, action: { kind: 'steer' } })
        delivered = true
      } catch (error) {
        // The turn ended or the person edited or removed the item first; it stays where the person left it.
        ctx.logger.info(`system3 interjection not delivered: ${String(error)}`)
      }
    }
    const forwardedTo = delivered ? await forward(agent, message.text) : undefined
    agent.session.append('system3/interjection', { version: 1, messageId: message.messageId, decision, delivered,
      ...forwardedTo === undefined ? {} : { forwardedTo } })
  }
  if (config.interjection !== undefined) {
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (!topLevel(agent) || agent.status !== 'running' || !agent.inbox.nextTurn.some(queued => queued.id === message.id)) return
      const text = personText(message, config.maxMessageChars)
      if (text === undefined) return
      let ids = early.get(agent.session)
      if (ids === undefined) { ids = new Set(); early.set(agent.session, ids) }
      ids.add(message.id)
      const entry = { messageId: message.id, text }
      void enqueue(agent, entry).then(outcome => interject(agent, entry, outcome))
    })
  }

  if (active) {
    ctx.effect(() => ctx.systemPrompt.context({ name: 'system3:task-frame', order: ctx.systemPrompt.getContextOrder('SYSTEM3_TASK_FRAME'),
      text: ({ agent }) => agent === undefined ? '' : taskFrameText(frameOf(agent)) }), 'system3.taskFrame.context()')
  }
}
