// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { System3Feedback, type System3FeedbackProps } from '../src/client/System3Dock.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const model = { provider: 'fidoo', model: 'generation', reasoningEffort: 'low' }
function inputs(overrides: Partial<System3FeedbackProps> = {}): System3FeedbackProps {
  return { facts: { entry: null, skill: null }, selection: { mode: 'auto', lastUsed: null, next: null },
    pending: false, running: false, opening: false, failed: false, available: true,
    onAutomatic: vi.fn(async () => {}), t: makeTranslate(zh, commonZh), ...overrides }
}
it('acknowledges a local submission before a decision arrives', () => {
  render(<System3Feedback {...inputs({ pending: true })} />)
  expect(screen.getByRole('status').textContent).toBe('已接收，正在准备')
  expect(screen.queryByText('模型已响应')).toBeNull()
})
it('keeps suggested and adopted routes distinct from actual model use', () => {
  const props = inputs({ running: true, facts: { skill: null, entry: {
    requestId: brandString<SessionRequestId>('request'), phase: 'decided', outcome: 'selected',
    suggested: model, adopted: model, used: null, elapsedMs: 29, route: null,
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
  const props = inputs({ facts: { entry: null, skill: { requestId: null, turn: 1, step: 0,
    outcome: 'selected', selected: 'csv-reconciliation', injected: false, elapsedMs: 20 } } })
  const { rerender } = render(<System3Feedback {...props} />)
  expect(screen.getByText('csv-reconciliation · 已选择，尚未注入')).toBeTruthy()
  rerender(<System3Feedback {...props} facts={{ entry: null, skill: { ...props.facts!.skill!, injected: true } }} />)
  expect(screen.getByText('csv-reconciliation · 已注入')).toBeTruthy()
})
it('deduplicates the actual automatic-mode action and waits for projected mode', async () => {
  const request = Promise.withResolvers<undefined>()
  const onAutomatic = vi.fn(() => request.promise)
  render(<System3Feedback {...inputs({ selection: { mode: 'fixed', lastUsed: model, next: model }, onAutomatic })} />)
  const button = screen.getByRole('button', { name: '恢复自动' })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  expect(onAutomatic).toHaveBeenCalledTimes(1)
  expect(screen.getByText('固定模型')).toBeTruthy()
  await act(async () => { request.resolve(undefined); await request.promise })
  expect(screen.getByText('固定模型')).toBeTruthy()
})
it('shows mutation failure without pretending automatic mode was restored', async () => {
  render(<System3Feedback {...inputs({ selection: { mode: 'fixed', lastUsed: model, next: model },
    onAutomatic: () => Promise.reject(new Error('network')) })} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '恢复自动' })) })
  expect(screen.getByRole('alert').textContent).toBe('切换失败，请重试')
  expect(screen.getByText('固定模型')).toBeTruthy()
})
it('does not expose root model mutation for an addressed subagent', () => {
  render(<System3Feedback {...inputs({ selection: { mode: 'fixed', lastUsed: model, next: model }, available: false })} />)
  expect(screen.queryByRole('button', { name: '恢复自动' })).toBeNull()
})

it('announces active decision and retains ended-turn evidence without claiming verification', () => {
  const props = inputs({ pending: true, facts: { skill: null, entry: {
    requestId: brandString<SessionRequestId>('active'), phase: 'deciding', outcome: null,
    suggested: null, adopted: null, used: null, elapsedMs: null, route: null,
  } } })
  const { rerender } = render(<System3Feedback {...props} />)
  expect(screen.getByRole('status').textContent).toBe('正在选择处理方式')
  rerender(<System3Feedback {...props} pending={false} running />)
  expect(screen.getByRole('status').textContent).toBe('正在执行')
  rerender(<System3Feedback {...props} pending={false} facts={{ skill: null, entry: {
    ...props.facts!.entry!, used: { provider: 'fidoo', model: 'generation' }, phase: 'decided',
  } }} />)
  expect(screen.getByRole('status').textContent).toBe('本轮已结束')
  expect(screen.getByText('实际响应模型').nextSibling?.textContent).toBe('fidoo / generation')
})

it('uses live execution state when a fixed-model turn follows an unanswered automatic turn', () => {
  render(<System3Feedback {...inputs({ running: true,
    selection: { mode: 'fixed', lastUsed: model, next: model },
    facts: { skill: null, entry: { requestId: brandString<SessionRequestId>('previous'), phase: 'decided',
      outcome: 'selected', suggested: model, adopted: model, used: null, elapsedMs: 10, route: null } },
  })} />)
  expect(screen.getByRole('status').textContent).toBe('正在执行')
  expect(screen.getByText('实际响应模型').nextSibling?.textContent).toBe('尚无记录')
  expect(screen.queryByText('已选择，等待模型响应')).toBeNull()
})
it('announces the chosen route as soon as the decision is recorded, before the model answers', () => {
  const entry = { requestId: brandString<SessionRequestId>('routed'), phase: 'decided' as const, outcome: 'selected',
    suggested: model, adopted: model, used: null, elapsedMs: 480, route: { id: 'expert', label: '复杂专业任务 · GPT-5.6 Sol', retained: false } }
  const { rerender } = render(<System3Feedback {...inputs({ pending: true, facts: { skill: null, entry } })} />)
  expect(screen.getByText('已判断：复杂专业任务 · GPT-5.6 Sol')).toBeTruthy()
  rerender(<System3Feedback {...inputs({ running: true, facts: { skill: null,
    entry: { ...entry, outcome: 'abstain', suggested: null, route: { id: 'expert', label: null, retained: true } } } })} />)
  expect(screen.getByText('延续上一轮：fidoo / generation · low')).toBeTruthy()
  expect(screen.getByText('建议模型').nextSibling?.textContent).toBe('延续上一轮')
  rerender(<System3Feedback {...inputs({ facts: { skill: null, entry: { ...entry, phase: 'deciding', route: null } } })} />)
  expect(screen.queryByText(/已判断/)).toBeNull()
})
