// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { System3RuntimeView, System3SkillView } from '@deepseek-ai/dsh-experimental-system3/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { System3Feedback } from '../src/client/System3Dock.tsx'
import { System3TurnHead } from '../src/client/TurnHead.tsx'
import { reflexJudgmentText } from '../src/client/reflex-judgment.ts'
import { zh, en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, commonZh)
const requestId = brandString<SessionRequestId>('current-input')
const skill: System3SkillView = { requestId, turn: 1, step: 0, outcome: 'no-candidates', selected: null,
  injected: false, elapsedMs: 480.2, intent: 'conversation' }
const facts = (value: System3SkillView): System3RuntimeView => ({ entry: null, history: [], skill: value,
  notices: [], taskFrame: null, interjection: null, subagentRun: null })

it.each([
  ['conversation', '日常交流'], ['retrieval', '建议检索历史记忆'], ['research', '需要查找资料'],
  ['creation', '内容创作'], ['action', '需要执行操作'], ['uncertain', '意图尚不明确，由主模型进一步判断'],
] as const)('shows the actual %s judgment without claiming execution', (intent, label) => {
  expect(reflexJudgmentText({ ...skill, intent }, t)).toBe(`Reflex · ${label} · 480 毫秒`)
})

it('distinguishes selecting and loading a Skill from completing its task', () => {
  const chosen = { ...skill, outcome: 'selected', selected: '照片整理' }
  expect(reflexJudgmentText(chosen, t)).toBe('Reflex · 已选择「照片整理」Skill · 480 毫秒')
  expect(reflexJudgmentText({ ...chosen, injected: true }, t)).toBe('Reflex · 已加载「照片整理」Skill · 480 毫秒')
})

it.each(['timeout', 'missing-credential', 'provider-unavailable', 'input-too-large', 'http'])('does not fabricate a result for %s', (outcome) => {
  const { intent: _intent, ...withoutIntent } = skill
  const label = reflexJudgmentText({ ...withoutIntent, outcome }, t)
  expect(label).toBeDefined()
  expect(label).not.toContain('日常交流')
  expect(label).not.toContain('480')
})

it('does not fabricate a result for missing or cancelled observations', () => {
  const { intent: _intent, ...withoutIntent } = skill
  expect(reflexJudgmentText(undefined, t)).toBeUndefined()
  expect(reflexJudgmentText(null, t)).toBeUndefined()
  expect(reflexJudgmentText({ ...withoutIntent, outcome: 'cancelled' }, t)).toBeUndefined()
})

it('keeps English feedback in the locale dictionary', () => {
  expect(reflexJudgmentText(skill, makeTranslate(en, commonZh))).toBe('Reflex · Conversation · 480 ms')
})

it('displays the judgment above its own answer and hides it from another turn', () => {
  const { rerender, container } = render(<System3TurnHead turn={{ turn: 1 } as never} useProjection={() => facts(skill)} t={t} />)
  expect(screen.getByText('Reflex · 日常交流 · 480 毫秒')).toBeTruthy()
  rerender(<System3TurnHead turn={{ turn: 2 } as never} useProjection={() => facts(skill)} t={t} />)
  expect(container.textContent).toBe('')
})

it('announces the real judgment outside the disclosure and replaces it for a new input', () => {
  const props = { facts: facts(skill), selection: null, running: true, pending: false, pendingRequestId: null,
    opening: false, failed: false, available: true, onAutomatic: async () => {}, onStop: async () => {}, onSteer: async () => {}, t }
  const { rerender } = render(<System3Feedback {...props} />)
  const status = screen.getByRole('status')
  expect(status.textContent).toBe('Reflex · 日常交流 · 480 毫秒')
  expect(status.closest('details')).toBeNull()
  rerender(<System3Feedback {...props} pending pendingRequestId={brandString<SessionRequestId>('next-input')} />)
  expect(screen.getByRole('status').textContent).toBe('已接收，正在准备')
  expect(screen.queryByText('Reflex · 日常交流 · 480 毫秒')).toBeNull()
  rerender(<System3Feedback {...props} pending pendingRequestId={requestId} />)
  expect(screen.getByRole('status').textContent).toBe('Reflex · 日常交流 · 480 毫秒')
})
