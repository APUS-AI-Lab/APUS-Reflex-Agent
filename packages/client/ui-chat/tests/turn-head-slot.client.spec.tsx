// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { TurnProcessNodeView } from '../src/client/chat/TurnProcessNodeView.tsx'

afterEach(cleanup)

type Props = ComponentProps<typeof TurnProcessNodeView>

function props(renderSlot: Props['renderSlot'], status: 'open' | 'closed') {
  const turn = { turn: 3, status, start: { time: 1_000 }, ...status === 'closed' ? { end: { time: 3_000, data: { reason: { kind: 'completed' } } } } : {} }
  return {
    node: { data: { turn: 3, messageCount: 1, toolCallCount: 0, subagentCount: 0 }, location: { kind: 'turn', turn } },
    turnProcess: { foldable: false, open: true, hasContent: false, setOpen: () => {} },
    renderSlot,
    t: (key: string) => key,
  } as never as Props
}

it('renders Turn head contributions beside the process label with the Turn location', () => {
  const renderSlot = vi.fn((_name: string, owner: { turn: { turn: number } }) => <span>route for turn {owner.turn.turn}</span>)
  render(<TurnProcessNodeView {...props(renderSlot as never, 'closed')} />)
  expect(renderSlot.mock.calls[0]?.[0]).toBe('conversation.chat.turnHead')
  expect(renderSlot.mock.calls[0]?.[1].turn.turn).toBe(3)
  const header = screen.getByRole('button')
  expect(header.textContent).toContain('route for turn 3')
  expect(header.querySelector('span:last-child')?.textContent).toBe('route for turn 3')
})

it('renders no head container when no entry contributes', () => {
  render(<TurnProcessNodeView {...props((() => null) as never, 'open')} />)
  expect(screen.getByRole('button').children).toHaveLength(1)
})
