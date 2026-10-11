// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { DelegationRun, routeNotice, System3Feedback, type System3FeedbackProps } from '../src/client/System3Dock.tsx'
import { System3TurnHead } from '../src/client/TurnHead.tsx'
import { System3ComposerDelegation } from '../src/client/ComposerDelegation.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('shows confirmed native continuation without claiming verified task completion', () => {
  render(<System3Feedback {...inputs({ running: true, facts: { subagentRun: null, ...EMPTY,
    history: [], entry: null, skill: null, reflex: { observing: true, timeline: [], supervision: null, context: null,
      recovery: { state: 'continued', reason: 'native-inactivity-budget', runId: 'run' } },
  } })} />)
  expect(screen.getByText('Reflex 执行恢复 · 已开始继续执行，结果待验证')).toBeTruthy()
  expect(screen.getByText('达到原生执行无活动预算')).toBeTruthy()
  expect(screen.queryByText('已观察到执行改善')).toBeNull()
})
const noStop = async (): Promise<void> => {}
const noSteer = async (): Promise<void> => {}
const model = { provider: 'fidoo', model: 'generation', reasoningEffort: 'low' }
/** Runtime facts this suite does not exercise. */
const EMPTY = { notices: [], taskFrame: null, interjection: null } as const
function inputs(overrides: Partial<System3FeedbackProps> = {}): System3FeedbackProps {
  return { facts: { subagentRun: null, ...EMPTY, history: [], entry: null, skill: null }, selection: { mode: 'auto', lastUsed: null, next: null, automatic: false },
    pending: false, pendingRequestId: null, running: false, opening: false, failed: false, available: true,
    onAutomatic: vi.fn(async () => {}), onStop: vi.fn(async () => {}), onSteer: vi.fn(async () => {}),
    t: makeTranslate(zh, commonZh), ...overrides }
}
it('acknowledges a local submission before a decision arrives', () => {
  render(<System3Feedback {...inputs({ pending: true })} />)
  expect(screen.getByRole('status').textContent).toBe('已接收，正在准备')
  expect(screen.queryByText('模型已响应')).toBeNull()
})
it('keeps suggested and adopted routes distinct from actual model use', () => {
  const props = inputs({ running: true, facts: { subagentRun: null, ...EMPTY, history: [], skill: null, entry: {
    requestId: brandString<SessionRequestId>('request'), phase: 'decided', outcome: 'selected',
    suggested: model, adopted: model, used: null, elapsedMs: 29, turn: null, avoided: [], route: null,
  } } })
  const { rerender } = render(<System3Feedback {...props} />)
  expect(screen.getByRole('status').textContent).toBe('正在执行')
  expect(screen.getByText('实际响应模型').nextSibling?.textContent).toBe('尚无记录')
  rerender(<System3Feedback {...props} facts={{ ...props.facts!, entry: { ...props.facts!.entry!, used: model } }} />)
  expect(screen.getByRole('status').textContent).toBe('正在执行')
  expect(screen.getByText('实际响应模型').nextSibling?.textContent).toContain('generation')
})
it('does not call an ended or cancelled turn a verified success', () => {
  render(<System3Feedback {...inputs({ failed: true })} />)
  expect(screen.getByRole('status').textContent).toBe('执行未完成')
  expect(screen.queryByText('已完成')).toBeNull()
})
it('requires a durable injection fact before displaying a Skill as injected', () => {
  const props = inputs({ facts: { subagentRun: null, ...EMPTY, history: [], entry: null, skill: { requestId: null, turn: 1, step: 0,
    outcome: 'selected', selected: 'csv-reconciliation', injected: false, elapsedMs: 20 } } })
  const { rerender } = render(<System3Feedback {...props} />)
  expect(screen.getByText('csv-reconciliation · 已选择，尚未注入')).toBeTruthy()
  rerender(<System3Feedback {...props}
    facts={{ subagentRun: null, ...EMPTY, history: [], entry: null, skill: { ...props.facts!.skill!, injected: true } }} />)
  expect(screen.getByText('csv-reconciliation · 已注入')).toBeTruthy()
})
it('deduplicates the actual automatic-mode action and waits for projected mode', async () => {
  const request = Promise.withResolvers<undefined>()
  const onAutomatic = vi.fn(() => request.promise)
  render(<System3Feedback {...inputs({ selection: { mode: 'fixed', lastUsed: model, next: model, automatic: false }, onAutomatic })} />)
  const button = screen.getByRole('button', { name: '恢复自动' })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  expect(onAutomatic).toHaveBeenCalledTimes(1)
  expect(screen.getByText('固定模型')).toBeTruthy()
  await act(async () => { request.resolve(undefined); await request.promise })
  expect(screen.getByText('固定模型')).toBeTruthy()
})
it('shows mutation failure without pretending automatic mode was restored', async () => {
  render(<System3Feedback {...inputs({ selection: { mode: 'fixed', lastUsed: model, next: model, automatic: false },
    onAutomatic: () => Promise.reject(new Error('network')) })} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '恢复自动' })) })
  expect(screen.getByRole('alert').textContent).toBe('切换失败，请重试')
  expect(screen.getByText('固定模型')).toBeTruthy()
})
it('does not expose root model mutation for an addressed subagent', () => {
  render(<System3Feedback {...inputs({ selection: { mode: 'fixed', lastUsed: model, next: model, automatic: false }, available: false })} />)
  expect(screen.queryByRole('button', { name: '恢复自动' })).toBeNull()
})

it('announces active decision and retains ended-turn evidence without claiming verification', () => {
  const props = inputs({ pending: true, facts: { subagentRun: null, ...EMPTY, history: [], skill: null, entry: {
    requestId: brandString<SessionRequestId>('active'), phase: 'deciding', outcome: null,
    suggested: null, adopted: null, used: null, elapsedMs: null, turn: null, avoided: [], route: null,
  } } })
  const { rerender } = render(<System3Feedback {...props} />)
  expect(screen.getByRole('status').textContent).toBe('正在选择处理方式')
  rerender(<System3Feedback {...props} pending={false} running />)
  expect(screen.getByRole('status').textContent).toBe('正在执行')
  rerender(<System3Feedback {...props} pending={false} facts={{ subagentRun: null, ...EMPTY, history: [], skill: null, entry: {
    ...props.facts!.entry!, used: { provider: 'fidoo', model: 'generation' }, phase: 'decided',
  } }} />)
  expect(screen.getByRole('status').textContent).toBe('本轮已结束')
  expect(screen.getByText('实际响应模型').nextSibling?.textContent).toBe('fidoo / generation')
})

it('uses live execution state when a fixed-model turn follows an unanswered automatic turn', () => {
  render(<System3Feedback {...inputs({ running: true,
    selection: { mode: 'fixed', lastUsed: model, next: model, automatic: false },
    facts: { subagentRun: null, ...EMPTY, history: [], skill: null, entry: { requestId: brandString<SessionRequestId>('previous'), phase: 'decided',
      outcome: 'selected', suggested: model, adopted: model, used: null, elapsedMs: 10, turn: null, avoided: [], route: null } },
  })} />)
  expect(screen.getByRole('status').textContent).toBe('正在执行')
  expect(screen.getByText('实际响应模型').nextSibling?.textContent).toBe('尚无记录')
  expect(screen.queryByText('已选择，等待模型响应')).toBeNull()
})
it('names the route, a continued route, or the fallback model, and nothing while deciding or for an earlier input', () => {
  const t = makeTranslate(zh, commonZh)
  const entry = { requestId: brandString<SessionRequestId>('routed'), phase: 'decided' as const, outcome: 'selected',
    suggested: model, adopted: model, used: null, elapsedMs: 480, turn: 2,
    avoided: [], route: { id: 'expert', label: '复杂专业任务 · GPT-5.6 Sol', retained: false, delegation: null } }
  expect(routeNotice(entry, null, t)).toBe('已判断：复杂专业任务 · GPT-5.6 Sol')
  expect(routeNotice({ ...entry, route: { ...entry.route, label: null, retained: true } }, null, t)).toBe('延续上一轮：fidoo / generation · low')
  expect(routeNotice({ ...entry, avoided: [{ label: 'Flash', reason: 'slow-output' }, { label: 'Pro', reason: 'errors' }] }, null, t))
    .toBe('已判断：复杂专业任务 · GPT-5.6 Sol · 已避开较慢的线路：Flash、Pro')
  expect(routeNotice({ ...entry, phase: 'deciding' }, null, t)).toBeNull()
  expect(routeNotice({ ...entry, suggested: null, route: { ...entry.route, label: null } }, null, t)).toBe('已判断：fidoo / generation · low')
  expect(routeNotice(entry, brandString<SessionRequestId>('newer'), t)).toBeNull()
  expect(routeNotice(entry, brandString<SessionRequestId>('routed'), t)).toBe('已判断：复杂专业任务 · GPT-5.6 Sol')
  const unrouted = { ...entry, route: null }
  expect(routeNotice({ ...unrouted, outcome: 'timeout' }, null, t)).toBe('判断超时，先由 fidoo / generation · low 回答')
  expect(routeNotice({ ...unrouted, outcome: 'transport' }, null, t)).toBe('暂时无法判断，先由 fidoo / generation · low 回答')
  expect(routeNotice({ ...unrouted, outcome: 'abstain' }, null, t)).toBeNull()
  expect(routeNotice({ ...unrouted, outcome: 'timeout', adopted: null }, null, t)).toBeNull()
  expect(routeNotice(null, null, t)).toBeNull()
})
it('shows the route line only in the Turn header of the Turn that carried the input', () => {
  const t = makeTranslate(zh, commonZh)
  const entry = { requestId: brandString<SessionRequestId>('routed'), phase: 'decided' as const, outcome: 'selected',
    suggested: model, adopted: model, used: null, elapsedMs: 480, turn: 2,
    avoided: [], route: { id: 'expert', label: 'Expert', retained: false, delegation: null } }
  const facts = { entry, skill: null, subagentRun: null, ...EMPTY, history: [] }
  const useProjection = (() => facts) as never
  const { rerender, container } = render(<System3TurnHead turn={{ turn: 2 } as never} useProjection={useProjection} t={t} />)
  expect(container.textContent).toBe('已判断：Expert')
  rerender(<System3TurnHead turn={{ turn: 1 } as never} useProjection={useProjection} t={t} />)
  expect(container.textContent).toBe('')
  rerender(<System3TurnHead turn={{ turn: 2 } as never} useProjection={(() => ({ ...facts, entry: { ...entry, route: null, outcome: 'abstain' } }))} t={t} />)
  expect(container.textContent).toBe('')
})
it('keeps the route line on earlier Turns after later inputs are routed', () => {
  const t = makeTranslate(zh, commonZh)
  const earlier = { requestId: brandString<SessionRequestId>('one'), phase: 'decided' as const, outcome: 'selected',
    suggested: model, adopted: model, used: model, elapsedMs: 300, turn: 1,
    avoided: [], route: { id: 'fast', label: 'Flash', retained: false, delegation: null } }
  const latest = { ...earlier, requestId: brandString<SessionRequestId>('two'), turn: 2, route: { ...earlier.route, id: 'pro', label: 'Pro' } }
  const useProjection = (() => ({ entry: latest, history: [earlier], skill: null, subagentRun: null, ...EMPTY })) as never
  const { rerender, container } = render(<System3TurnHead turn={{ turn: 1 } as never} useProjection={useProjection} t={t} />)
  expect(container.textContent).toBe('已判断：Flash')
  rerender(<System3TurnHead turn={{ turn: 2 } as never} useProjection={useProjection} t={t} />)
  expect(container.textContent).toBe('已判断：Pro')
  rerender(<System3TurnHead turn={{ turn: 3 } as never} useProjection={useProjection} t={t} />)
  expect(container.textContent).toBe('')
  rerender(<System3TurnHead turn={{ turn: 1 } as never} useProjection={() => undefined} t={t} />)
  expect(container.textContent).toBe('')
})
it('names the delegate beside the model selector only while the running turn is handed off', () => {
  const t = makeTranslate(zh, commonZh)
  const delegation = { candidateId: 'codex', tool: 'subagent_codex', injected: true, called: false }
  const entry = { requestId: brandString<SessionRequestId>('d'), phase: 'decided' as const, outcome: 'selected',
    suggested: null, adopted: null, used: null, elapsedMs: 5, turn: 1, avoided: [], route: { id: 'codex', label: 'Codex', retained: false, delegation } }
  const run = { runId: 'r', provider: 'codex', state: 'running', startedAt: 0, elapsedMs: 1000, completed: {}, current: null,
    lastStepAt: null, note: null, alert: null, steerable: true, steers: [] }
  const session = (running: boolean) => ((select: (s: { running: boolean }) => boolean) => select({ running })) as never
  const view = (facts: object | undefined, running = true) => render(<System3ComposerDelegation
    useProjection={() => facts as never} useSession={session(running)} t={t} />)
  const base = { entry, history: [], skill: null, notices: [], taskFrame: null, interjection: null }
  expect(view({ ...base, subagentRun: null }).container.textContent).toBe('正在交给子任务')
  cleanup()
  expect(view({ ...base, subagentRun: run }).container.textContent).toBe('已交给 codex')
  cleanup()
  expect(view({ ...base, subagentRun: { ...run, state: 'completed' } }).container.textContent).toBe('正在交给子任务')
  cleanup()
  const called = { ...entry, route: { ...entry.route, delegation: { ...delegation, called: true } } }
  expect(view({ ...base, entry: called, subagentRun: { ...run, state: 'completed' } }).container.textContent).toBe('')
  cleanup()
  expect(view({ ...base, entry: called, subagentRun: run }).container.textContent).toBe('已交给 codex')
  cleanup()
  const notInjected = { ...entry, route: { ...entry.route, delegation: { ...delegation, injected: false } } }
  const undelegated = { ...entry, route: { ...entry.route, delegation: null } }
  for (const facts of [{ ...base, subagentRun: run, entry: notInjected }, { ...base, subagentRun: null, entry: undelegated },
    { ...base, entry: null, subagentRun: null }, undefined]) {
    expect(view(facts).container.textContent).toBe('')
    cleanup()
  }
  expect(view({ ...base, subagentRun: run }, false).container.textContent).toBe('')
})
it('shows each delegation stage separately: suggested, instruction injected, tool called', () => {
  const delegation = { candidateId: 'codex', tool: 'subagent_codex', injected: false, called: false }
  const entry = { requestId: brandString<SessionRequestId>('delegate'), phase: 'decided' as const, outcome: 'selected',
    suggested: null, adopted: null, used: null, elapsedMs: 480, turn: null, avoided: [], route: { id: 'codex', label: '工程任务 · 委派 Codex', retained: false, delegation } }
  const { rerender } = render(<System3Feedback
    {...inputs({ running: true, facts: { subagentRun: null, ...EMPTY, history: [], skill: null, entry } })} />)
  expect(screen.getByText('委派').nextSibling?.textContent).toBe('已建议，等待注入指令')
  expect(screen.getByText('建议模型').nextSibling?.textContent).toBe('工程任务 · 委派 Codex')
  const stage = (injected: boolean, called: boolean) => inputs({ running: true,
    facts: { subagentRun: null, ...EMPTY, history: [], skill: null,
      entry: { ...entry, route: { ...entry.route, delegation: { ...delegation, injected, called } } } } })
  rerender(<System3Feedback {...stage(true, false)} />)
  expect(screen.getByText('委派').nextSibling?.textContent).toBe('已注入指令，等待调用 subagent_codex')
  expect(screen.getByText('正在准备委派')).toBeTruthy()
  rerender(<System3Feedback {...stage(true, true)} />)
  expect(screen.getByText('委派').nextSibling?.textContent).toBe('已调用 subagent_codex')
  expect(screen.getByText('正在准备委派')).toBeTruthy()
})
it('names the delegation tool when the delegation route has no label', () => {
  render(<System3Feedback {...inputs({ facts: { subagentRun: null, ...EMPTY, history: [], skill: null, entry: { requestId: brandString<SessionRequestId>('d'), phase: 'decided', outcome: 'selected',
    suggested: null, adopted: null, used: null, elapsedMs: 1, turn: null,
    avoided: [], route: { id: 'codex', label: null, retained: false, delegation: { candidateId: 'codex', tool: 'subagent_codex', injected: false, called: false } } } } })} />)
  expect(screen.getByText('建议模型').nextSibling?.textContent).toBe('subagent_codex')
})
it('shows a running delegation with live elapsed time, step counts, and the step in progress, then its outcome', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(10_000)
    const run = { runId: 'run-1', provider: 'codex', state: 'running', startedAt: 4_000, elapsedMs: 3_000,
      completed: { command: 3, 'file-change': 2, custom: 1, reasoning: 0 }, current: 'command', lastStepAt: 5_000, note: null, alert: null, steerable: false, steers: [] }
    const t = makeTranslate(zh, commonZh)
    const { rerender } = render(<DelegationRun onStop={noStop} onSteer={noSteer} run={run} turnRunning t={t} />)
    expect(screen.getByRole('status').textContent).toBe('codex 运行中6 秒命令 3 · 改文件 2 · 其他 1当前：命令')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(screen.getByText('8 秒')).toBeTruthy()
    rerender(<DelegationRun onStop={noStop} onSteer={noSteer} run={{ ...run, state: 'completed', elapsedMs: 98_400, current: null }} turnRunning t={t} />)
    expect(screen.getByRole('status').textContent).toBe('codex 已完成，正在复核结果1 分 38 秒命令 3 · 改文件 2 · 其他 1')
    rerender(<DelegationRun onStop={noStop} onSteer={noSteer} run={{ ...run, state: 'completed', elapsedMs: 98_400, current: null }} turnRunning={false} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('codex 已完成1 分 38 秒命令 3 · 改文件 2 · 其他 1')
    rerender(<DelegationRun onStop={noStop} onSteer={noSteer} run={{ ...run, completed: {}, current: null }} turnRunning t={t} />)
    expect(screen.getByRole('status').textContent).toBe('codex 正在启动8 秒')
    rerender(<DelegationRun onStop={noStop} onSteer={noSteer} run={{ ...run, state: 'aborted', elapsedMs: 1_000, completed: {} }} turnRunning={false} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('codex 已中止1 秒')
    rerender(<DelegationRun onStop={noStop} onSteer={noSteer} run={{ ...run, state: 'error', elapsedMs: 1_000, completed: { 'web-search': 1, tool: 1, message: 1, reasoning: 1 } }} turnRunning={false} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('codex 未完成1 秒搜索 1 · 工具 1 · 消息 1 · 推理 1')
  } finally {
    vi.useRealTimers()
  }
})

it('renders the delegated run inside the dock when the projection carries one', () => {
  render(<System3Feedback {...inputs({ facts: { entry: null, skill: null, subagentRun: { runId: 'r', provider: 'codex', state: 'completed',
    startedAt: 0, elapsedMs: 5_000, completed: {}, current: null, lastStepAt: null, note: null, alert: null,
    steerable: false, steers: [] }, ...EMPTY, history: [] } })} />)
  expect(screen.getByText('codex 已完成')).toBeTruthy()
})
it('lists the turn supervision findings and says when the model was asked to change course', () => {
  const notices = [
    { rule: 'repeated-error', subject: 'bash', count: 2, advised: true },
    { rule: 'missing-evidence', subject: null, count: 1, advised: false },
    { rule: 'future-rule', subject: null, count: 1, advised: false },
  ]
  render(<System3Feedback {...inputs({ facts: { entry: null, skill: null, subagentRun: null, history: [], ...EMPTY,
    notices } })} />)
  expect(screen.getByText('bash 已连续 2 次以同样的错误失败 · 已提醒模型调整做法')).toBeTruthy()
  expect(screen.getByText('已修改文件，但还没有运行通过的测试或构建')).toBeTruthy()
  expect(screen.getByText('过程监督提示')).toBeTruthy()
})
it('shows the kept requirements as one line that opens to the task and each requirement verbatim', () => {
  const goal = { messageId: 'm1', text: '加一个汇总命令' }
  const { rerender } = render(<System3Feedback {...inputs({ facts: { entry: null, skill: null, subagentRun: null, history: [], notices: [],
    interjection: null, taskFrame: { goal, items: [] } } })} />)
  expect(screen.queryByText(/任务卡/u)).toBeNull()
  rerender(<System3Feedback {...inputs({ facts: { entry: null, skill: null, subagentRun: null, history: [], notices: [],
    interjection: null, taskFrame: { goal, items: [{ messageId: 'm2', text: '别动 README.md' }, { messageId: 'm3', text: '测试必须全部通过' }] } } })} />)
  expect(screen.getByText('任务卡 · 已记下 2 条要求')).toBeTruthy()
  expect(screen.getByText('任务：加一个汇总命令')).toBeTruthy()
  expect(screen.getByText('· 别动 README.md')).toBeTruthy()
  expect(screen.getByText('· 测试必须全部通过')).toBeTruthy()
})
it('says when a queued requirement was moved into the current step', () => {
  render(<System3Feedback {...inputs({ running: true, facts: { entry: null, skill: null, subagentRun: null, history: [], notices: [],
    taskFrame: null, interjection: { messageId: 'm2' } } })} />)
  expect(screen.getByText('已把你刚才补充的要求插入正在进行的这一轮')).toBeTruthy()
})
it('reads a continued route as the suggestion in the details', () => {
  render(<System3Feedback {...inputs({ facts: { subagentRun: null, ...EMPTY, history: [], skill: null, entry: { requestId: brandString<SessionRequestId>('c'), phase: 'decided',
    outcome: 'abstain', suggested: null, adopted: model, used: null, elapsedMs: 1, turn: 3,
    avoided: [], route: { id: 'expert', label: 'Expert', retained: true, delegation: null } } } })} />)
  expect(screen.getByText('建议模型').nextSibling?.textContent).toBe('延续上一轮')
})
it('shows the latest note and an attention alert that can be dismissed until the next alert or stopped', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(200_000)
    const t = makeTranslate(zh, commonZh)
    const onStop = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const run = { runId: 'run-1', provider: 'codex', state: 'running', startedAt: 0, elapsedMs: 180_000, completed: { command: 2 },
      current: null, lastStepAt: 90_000, note: 'Checking the parser before editing.', alert: { kind: 'stalled', elapsedMs: 180_000 },
      steerable: false, steers: [] }
    const { rerender } = render(<DelegationRun run={run} turnRunning onStop={onStop} onSteer={noSteer} t={t} />)
    expect(screen.getByText('最近说明：Checking the parser before editing.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('codex 已 1 分 50 秒 没有新进展')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('停止失败，请重试')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => { await Promise.resolve() })
    expect(onStop).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '继续等待' }))
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<DelegationRun run={{ ...run, alert: { kind: 'overtime', elapsedMs: 360_000 } }} turnRunning onStop={onStop} onSteer={noSteer} t={t} />)
    expect(screen.getByRole('alert').textContent).toContain('codex 已运行 6 分 0 秒，超出预期')
    rerender(<DelegationRun run={{ ...run, lastStepAt: null, alert: { kind: 'starting', elapsedMs: 120_000 } }} turnRunning onStop={onStop} onSteer={noSteer} t={t} />)
    expect(screen.getByRole('alert').textContent).toContain('codex 启动已超过 3 分 20 秒')
    rerender(<DelegationRun run={{ ...run, state: 'completed' }} turnRunning={false} onStop={onStop} onSteer={noSteer} t={t} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/最近说明/)).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})
it('opens a steer form from the card or the alert, keeps the text after a failed send, and lists accepted inputs', async () => {
  const t = makeTranslate(zh, commonZh)
  const onSteer = vi.fn<(runId: string, text: string) => Promise<void>>().mockRejectedValueOnce(new Error('ended')).mockResolvedValue(undefined)
  const run = { runId: 'run-1', provider: 'codex', state: 'running', startedAt: Date.now(), elapsedMs: 0, completed: {}, current: null,
    lastStepAt: null, note: null, alert: { kind: 'overtime', elapsedMs: 360_000 }, steerable: true, steers: [{ text: '先让测试通过', atMs: 380_000 }] }
  const { rerender } = render(<DelegationRun run={run} turnRunning onStop={noStop} onSteer={onSteer} t={t} />)
  expect(screen.getByText('已补充（6 分 20 秒）：先让测试通过')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: '补充说明' })[0]!)
  expect(screen.queryAllByRole('button', { name: '补充说明' })).toHaveLength(0)
  const input = screen.getByRole('textbox', { name: '补充说明' })
  const send = screen.getByRole('button', { name: '发送' })
  expect((send as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(input, { target: { value: '  不用改 README  ' } })
  fireEvent.submit(send.closest('form')!)
  await act(async () => { await Promise.resolve() })
  expect(onSteer).toHaveBeenLastCalledWith('run-1', '不用改 README')
  expect(screen.getByText('没有送达，任务可能已结束')).toBeTruthy()
  expect((input as HTMLInputElement).value).toBe('  不用改 README  ')
  fireEvent.click(send)
  await act(async () => { await Promise.resolve() })
  expect(onSteer).toHaveBeenCalledTimes(2)
  expect((input as HTMLInputElement).value).toBe('')
  expect(screen.queryByText('没有送达，任务可能已结束')).toBeNull()
  fireEvent.submit(send.closest('form')!)
  expect(onSteer).toHaveBeenCalledTimes(2)
  rerender(<DelegationRun run={{ ...run, state: 'completed', steerable: false, alert: null }} turnRunning={false} onStop={noStop} onSteer={onSteer} t={t} />)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText('已补充（6 分 20 秒）：先让测试通过')).toBeTruthy()
})
it('opens the steer form from the card when no alert is shown', () => {
  const t = makeTranslate(zh, commonZh)
  const run = { runId: 'run-1', provider: 'codex', state: 'running', startedAt: Date.now(), elapsedMs: 0, completed: {}, current: null,
    lastStepAt: null, note: null, alert: null, steerable: true, steers: [] }
  render(<DelegationRun run={run} turnRunning onStop={noStop} onSteer={noSteer} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '补充说明' }))
  expect(screen.getByRole('textbox', { name: '补充说明' })).toBeTruthy()
})
it('distinguishes accepted Reflex guidance from observed improvement and shows recoverable context', () => {
  const { rerender } = render(<System3Feedback {...inputs({ facts: { subagentRun: null, ...EMPTY, history: [], entry: null, skill: null,
    reflex: { observing: true, timeline: [{ kind: 'supervision', at: 1, state: 'accepted', action: 'diagnose', count: 3 }], supervision: { state: 'accepted', action: 'diagnose', evidenceCount: 3, runId: 'run-1' }, context: { revision: 1, action: 'remove', targetsCount: 2 } },
  } })} />)
  expect(screen.getByText('Reflex 监督 · Codex 已接收，尚待观察效果')).toBeTruthy()
  expect(screen.queryByText(/已观察到执行改善/)).toBeNull()
  expect(screen.getByText('Reflex 已移出 2 个上下文片段，可按需恢复')).toBeTruthy()
  rerender(<System3Feedback {...inputs({ facts: { subagentRun: null, ...EMPTY, history: [], entry: null, skill: null,
    reflex: { observing: false, timeline: [{ kind: 'supervision', at: 1, state: 'improved', action: 'diagnose', count: 5 }], supervision: { state: 'improved', action: 'diagnose', evidenceCount: 5, runId: 'run-1' }, context: { revision: 2, action: 'restore', targetsCount: 1 } },
  } })} />)
  expect(screen.getByText('Reflex 监督 · 已观察到执行改善')).toBeTruthy()
  expect(screen.getByText('Reflex 已恢复 1 个上下文片段')).toBeTruthy()
})

it('reports an unconfirmed supervision delivery without claiming no decision or verified improvement', () => {
  render(<System3Feedback {...inputs({ facts: { subagentRun: null, ...EMPTY, history: [], entry: null, skill: null,
    reflex: { observing: false, timeline: [], supervision: { state: 'unknown', action: 'diagnose', evidenceCount: 3, runId: 'run-1' }, context: null },
  } })} />)
  expect(screen.getByText('Reflex 监督 · 建议送达尚未确认，未重复发送')).toBeTruthy()
  expect(screen.queryByText(/本次无法判断|已观察到执行改善/)).toBeNull()
})

it('explains every durable Reflex timeline kind, recovery reason, and unknown status', () => {
  render(<System3Feedback {...inputs({ facts: { subagentRun: null, ...EMPTY, history: [], entry: null, skill: null,
    reflex: {
      observing: true,
      recovery: { state: 'future-recovery', reason: 'retry-budget', runId: 'run-1' },
      supervision: { state: 'future-supervision', action: 'future-action', evidenceCount: 4, runId: 'run-1' },
      context: { revision: 3, action: 'restore', targetsCount: 1 },
      timeline: [
        { kind: 'supervision', at: 1, state: null, action: null, count: 1 },
        { kind: 'recovery', at: 2, state: 'future-recovery', action: null, count: null },
        { kind: 'recovery', at: 3, state: null, action: null, count: null },
        { kind: 'context', at: 4, state: null, action: 'remove', count: 2 },
        { kind: 'context', at: 5, state: null, action: 'restore', count: null },
        { kind: 'evidence', at: 6, state: null, action: null, count: null },
      ],
    },
  } })} />)
  expect(screen.getByText('Reflex 正在观察 Codex 执行；只有收到执行证据后才会更新判断')).toBeTruthy()
  expect(screen.getByText('Reflex 执行恢复 · 状态已更新')).toBeTruthy()
  expect(screen.getByText('达到连续重试上限')).toBeTruthy()
  expect(screen.getByText('Reflex 监督 · 状态已更新')).toBeTruthy()
  expect(screen.getByText('Reflex 已恢复 1 个上下文片段')).toBeTruthy()
  expect(screen.getByText('Reflex 执行时间线 · 6 条')).toBeTruthy()
  expect(screen.getByText('监督：状态已更新 · 状态已更新')).toBeTruthy()
  expect(screen.getAllByText('恢复：未能确认恢复，未重复启动')).toHaveLength(2)
  expect(screen.getByText('上下文：移出 2 段')).toBeTruthy()
  expect(screen.getByText('上下文：恢复 0 段')).toBeTruthy()
  expect(screen.getByText('收到执行证据')).toBeTruthy()
})
