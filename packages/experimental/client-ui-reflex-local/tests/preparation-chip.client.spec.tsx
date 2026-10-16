// @vitest-environment jsdom
/** The dock chip appears only while preparation needs attention and offers that state's actions. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import { afterEach, expect, it, vi } from 'vitest'
import { PreparationChip, type PreparationChipProps } from '../src/client/PreparationChip.tsx'
import type { ReflexReadiness } from '../src/client/readiness.ts'
import { zh } from '../src/client/locales.ts'
import { FAST, Q4, Q8, SIZES, snapshotOf } from './snapshot-fixture.client.ts'

afterEach(cleanup)

function fixture(snapshot: ReflexSnapshot | null, connected = true) {
  const state = createSnapshotStore<ReflexReadiness>({ snapshot, connected, error: null })
  const dismissed = createSnapshotStore(false)
  const command = () => vi.fn(async () => {})
  const props = { sessionId: 's1', t: makeTranslate(zh), useReflexReadiness: bindSnapshotSelector(state), prepare: vi.fn(async () => {}),
    useReflexSlowChipDismissed: bindSnapshotSelector(dismissed), dismissSlowChip: vi.fn(() => { act(() => { dismissed.set(true) }) }),
    pause: command(), cancel: command(), enable: command(), openDetails: vi.fn(), reportFailure: vi.fn() } as PreparationChipProps
  const view = render(<PreparationChip {...props} />)
  return { ...props, view, publish(next: ReflexSnapshot) { act(() => { state.set({ snapshot: next, connected: true, error: null }) }) } }
}
const openMenu = (name: string) => { fireEvent.click(screen.getByRole('button', { name })) }
const row = (name: string) => screen.getByRole<HTMLButtonElement>('menuitem', { name })
const downloading = snapshotOf({ phase: 'downloading', variant: Q8, completedBytes: 1.7e9, totalBytes: SIZES.q8_0, source: 'https://huggingface.co' })

it.each([
  ['before the first snapshot', null],
  ['an unsupported device', snapshotOf({ phase: 'unsupported' }, { device: { supported: false, reason: 'platform' } })],
  ['checking', snapshotOf({ phase: 'checking' })],
  ['nothing downloaded', snapshotOf({ phase: 'absent' })],
  ['a failure', snapshotOf({ phase: 'failed', failure: { kind: 'runner', message: 'exit' } })],
  ['a fast ready engine', snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST })],
  ['a slow engine already on', snapshotOf({ phase: 'ready', variant: Q8, selfTest: { ...FAST, slow: true } }, { enabled: true })],
])('leaves the dock empty for %s', (_name, snapshot) => {
  const b = fixture(snapshot)
  expect(b.view.container.innerHTML).toBe('')
})

it('shows download progress and pauses, cancels, or opens the details from its menu', async () => {
  const b = fixture(downloading)
  openMenu('正在准备本机判断 37%')
  fireEvent.click(row(zh.pause))
  expect(b.pause).toHaveBeenCalledOnce()
  await waitFor(() => { expect(screen.queryByRole('menuitem')).toBeNull() })
  openMenu('正在准备本机判断 37%')
  fireEvent.click(row(zh.cancel))
  expect(screen.getByText('取消并删除已下载的 1.7 GB？')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['confirm.cancel.keep'] }))
  expect(b.cancel).not.toHaveBeenCalled()
  openMenu('正在准备本机判断 37%')
  fireEvent.click(row(zh.cancel))
  fireEvent.click(screen.getByRole('button', { name: zh['confirm.cancel.confirm'] }))
  expect(b.cancel).toHaveBeenCalledOnce()
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  openMenu('正在准备本机判断 37%')
  fireEvent.click(row(zh['chip.details']))
  expect(b.openDetails).toHaveBeenCalledOnce()
})

it('resumes a paused download with its variant and reports a rejected command', async () => {
  const b = fixture(snapshotOf({ phase: 'paused', variant: Q4, completedBytes: 1, totalBytes: 2 }))
  vi.mocked(b.prepare).mockRejectedValueOnce(new Error('offline'))
  openMenu(zh['chip.paused'])
  fireEvent.click(row(zh.resume))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q4 })
  await waitFor(() => { expect(b.reportFailure).toHaveBeenCalledWith(new Error('offline')) })
})

it('cancels a paused download with no bytes yet without asking', () => {
  const b = fixture(snapshotOf({ phase: 'paused', variant: Q4, completedBytes: 0, totalBytes: 2 }))
  openMenu(zh['chip.paused'])
  fireEvent.click(row(zh.cancel))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(b.cancel).toHaveBeenCalledOnce()
})

it.each(['verifying', 'testing'] as const)('shows %s with only the details action', (phase) => {
  const b = fixture(snapshotOf({ phase, variant: Q8 }))
  openMenu(zh['chip.checking'])
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([zh['chip.details']])
  expect(screen.queryByRole('menuitem', { name: zh['chip.notNow'] })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh['chip.checking'] }))
  expect(screen.queryByRole('menuitem')).toBeNull()
  expect(b.openDetails).not.toHaveBeenCalled()
})

it('offers enabling a slow Mac anyway and disables Host commands while disconnected', () => {
  const b = fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: { ...FAST, slow: true } }), false)
  openMenu(zh['chip.slow'])
  expect(row(zh.enableAnyway).disabled).toBe(true)
  expect(row(zh['chip.details']).disabled).toBe(false)
  b.publish(snapshotOf({ phase: 'ready', variant: Q8, selfTest: { ...FAST, slow: true } }))
  fireEvent.click(row(zh.enableAnyway))
  expect(b.enable).toHaveBeenCalledOnce()
})

it('hides the slow-Mac chip for the page after Not now without a Host command', () => {
  const b = fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: { ...FAST, slow: true } }))
  openMenu(zh['chip.slow'])
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([zh.enableAnyway, zh['chip.notNow'], zh['chip.details']])
  fireEvent.click(row(zh['chip.notNow']))
  expect(b.dismissSlowChip).toHaveBeenCalledOnce()
  expect(b.enable).not.toHaveBeenCalled()
  expect(b.view.container.innerHTML).toBe('')
  b.publish(snapshotOf({ phase: 'downloading', variant: Q8, completedBytes: 1, totalBytes: 2, source: 'https://huggingface.co' }))
  expect(screen.getByRole('button', { name: '正在准备本机判断 50%' })).toBeTruthy()
})

it('names both models while another model prepares in the background', () => {
  fixture(snapshotOf({ phase: 'downloading', variant: { model: '9b', quant: 'q8_0' }, completedBytes: 3.6e9, totalBytes: SIZES.nineQ8,
    source: 'https://huggingface.co' }, { active: Q8 }))
  expect(screen.getByRole('button', { name: '正在准备 9B · Q8_0 37% · 当前仍用 4B · Q8_0 判断' })).toBeTruthy()
})

it('keeps the plain label while the active model itself downloads', () => {
  fixture(snapshotOf({ phase: 'downloading', variant: Q8, completedBytes: 1, totalBytes: 2, source: 'https://huggingface.co' }, { active: Q8 }))
  expect(screen.getByRole('button', { name: '正在准备本机判断 50%' })).toBeTruthy()
})
