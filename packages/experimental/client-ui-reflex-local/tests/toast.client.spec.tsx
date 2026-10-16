// @vitest-environment jsdom
/** The frame-wide notice announces local enablement with undo and reports a failed undo. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, expect, it, vi } from 'vitest'
import { EnabledToast, type EnabledToastProps } from '../src/client/EnabledToast.tsx'
import type { ReflexToast } from '../src/client/injected.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

function fixture() {
  const state = createSnapshotStore<ReflexToast | null>(null)
  const dismissToast = vi.fn(() => { state.set(null) }), undoEnable = vi.fn(), undoSwitch = vi.fn()
  const props = { t: makeTranslate(zh), dismissToast, undoEnable, undoSwitch,
    useReflexToast: bindSnapshotSelector(state) } as EnabledToastProps
  render(<EnabledToast {...props} />)
  return { dismissToast, undoEnable, undoSwitch, show(toast: ReflexToast) { act(() => { state.set(toast) }) } }
}

it('renders nothing until a notice is raised, then offers undo', () => {
  const b = fixture()
  expect(screen.queryByRole('alert')).toBeNull()
  b.show({ seq: 1, kind: 'enabled' })
  expect(screen.getByRole('alert').textContent).toContain(zh['toast.enabled'])
  fireEvent.click(screen.getByRole('button', { name: zh['toast.undo'] }))
  expect(b.undoEnable).toHaveBeenCalledOnce()
})

it('reports a failed undo or command and dismisses each notice after its hold', async () => {
  vi.useFakeTimers()
  const b = fixture()
  b.show({ seq: 2, kind: 'undoFailed' })
  expect(screen.getByRole('alert').textContent).toContain(zh['toast.undoFailed'])
  expect(screen.queryByRole('button')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(7000) })
  expect(b.dismissToast).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).toBeNull()
  b.show({ seq: 3, kind: 'actionFailed', message: 'offline' })
  expect(screen.getByRole('alert').textContent).toContain('操作没有完成：offline')
})

it('names the model a background switch moved to and undoes the switch', () => {
  const b = fixture()
  const change = { from: { model: '4b', quant: 'q8_0' }, to: { model: '9b', quant: 'q8_0' }, at: 5 } as const
  b.show({ seq: 4, kind: 'switched', change })
  expect(screen.getByRole('alert').textContent).toContain('已切换到 9B · Q8_0')
  fireEvent.click(screen.getByRole('button', { name: zh['toast.undo'] }))
  expect(b.undoSwitch).toHaveBeenCalledWith(change)
})
