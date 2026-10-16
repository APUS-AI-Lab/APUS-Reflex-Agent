// @vitest-environment jsdom
/** The memory preference renders as a settings row whose copy follows availability, failure, and writability. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { ContinuumRow, type ContinuumRowProps, type ContinuumSettingsState } from '../src/client/ContinuumRow.tsx'
import { zh } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)

it('shows the description and writes the switch, then explains failure, read-only, and unavailable states', () => {
  const state = createSnapshotStore<ContinuumSettingsState>({ available: true, writable: true, enabled: false, busy: false, failed: false })
  const setEnabled = vi.fn(async () => {})
  const unused = (): never => { throw new Error('ContinuumRow does not consume global hooks') }
  const globals: GlobalStandardProps = { usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
    useSessionRetainInfo: unused, useResource: unused, useWorkspaces: unused }
  const props: ContinuumRowProps = { ...globals, t: makeTranslate(zh), setEnabled, useContinuumSettings: bindSnapshotSelector(state) }
  render(<ContinuumRow {...props} />)
  expect(screen.getByText(zh.description)).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: zh.title }))
  expect(setEnabled).toHaveBeenCalledWith(true)
  act(() => { state.set({ ...state.getSnapshot(), failed: true, writable: false }) })
  expect(screen.getByText(zh.error)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe(zh.readOnly)
  act(() => { state.set({ ...state.getSnapshot(), available: false }) })
  expect(screen.getByText(zh.unavailable)).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('switch', { name: zh.title }).hasAttribute('disabled')).toBe(true)
})
