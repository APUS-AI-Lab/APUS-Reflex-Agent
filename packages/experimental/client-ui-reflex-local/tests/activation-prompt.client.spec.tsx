// @vitest-environment jsdom
/** Switching the bundle on offers the one-click download only when it is the next possible step. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import { afterEach, expect, it, vi } from 'vitest'
import { ActivationPrompt, type ActivationPromptProps } from '../src/client/ActivationPrompt.tsx'
import type { ReflexReadiness } from '../src/client/readiness.ts'
import { zh } from '../src/client/locales.ts'
import { FAST, OPTIONS, Q8, snapshotOf } from './snapshot-fixture.client.ts'
import { sameVariant } from '../src/client/size.ts'

afterEach(cleanup)

function fixture() {
  const state = createSnapshotStore<ReflexReadiness>({ snapshot: null, connected: false, error: null })
  const onDismiss = vi.fn(), onOpenDetails = vi.fn(), prepare = vi.fn(async () => {})
  const props = { packageName: '@deepseek-ai/dsh-experimental-reflex-local-bundle', t: makeTranslate(zh), onDismiss, onOpenDetails,
    prepare, useReflexReadiness: bindSnapshotSelector(state) } as ActivationPromptProps
  render(<ActivationPrompt {...props} />)
  return { onDismiss, onOpenDetails, prepare, publish(snapshot: ReflexSnapshot) {
    act(() => { state.set({ snapshot, connected: true, error: null }) })
  } }
}

it('waits for the Host check, then starts the download in one click and opens the details', async () => {
  const b = fixture()
  expect(screen.queryByText(zh['prompt.title'])).toBeNull()
  b.publish(snapshotOf({ phase: 'checking' }))
  expect(screen.queryByText(zh['prompt.title'])).toBeNull()
  expect(b.onDismiss).not.toHaveBeenCalled()
  b.publish(snapshotOf({ phase: 'absent' }))
  expect(screen.getByText('下载 4.5 GB 后，判断在这台 Mac 上完成；回答仍由你配置的模型生成。下载在后台进行，可以随时暂停')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '下载并启用 · 4.5 GB' }))
  await waitFor(() => { expect(b.onOpenDetails).toHaveBeenCalledOnce() })
  expect(b.prepare).toHaveBeenCalledWith()
})

it('keeps the prompt open with the reason when the Host rejects the download', async () => {
  const b = fixture()
  b.publish(snapshotOf({ phase: 'absent' }))
  b.prepare.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: '下载并启用 · 4.5 GB' }))
  await screen.findByText('操作没有完成：offline')
  b.prepare.mockRejectedValueOnce('closed')
  fireEvent.click(screen.getByRole('button', { name: '下载并启用 · 4.5 GB' }))
  await screen.findByText('操作没有完成：closed')
  expect(b.onOpenDetails).not.toHaveBeenCalled()
})

it('sends a Mac without enough free space to the details page instead of downloading', () => {
  const b = fixture()
  b.publish(snapshotOf({ phase: 'absent' }, { availableDiskBytes: 3.1e9,
    options: OPTIONS.map(option => sameVariant(option, Q8) ? { ...option, fits: false, reason: 'disk' } : option) }))
  expect(screen.getByText('下载需要 4.5 GB，这台 Mac 当前可用 3.1 GB。可以在详情页更换较小的模型')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['prompt.details'] }))
  expect(b.onOpenDetails).toHaveBeenCalledOnce()
  expect(b.prepare).not.toHaveBeenCalled()
})

it('points to the details when no option fits this Mac', () => {
  const b = fixture()
  b.publish(snapshotOf({ phase: 'absent' }, { recommended: undefined }))
  expect(screen.getByText(zh.noFit)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['prompt.details'] }))
  expect(b.onOpenDetails).toHaveBeenCalledOnce()
  expect(b.prepare).not.toHaveBeenCalled()
})

it('lets the user postpone while leaving the bundle on', () => {
  const b = fixture()
  b.publish(snapshotOf({ phase: 'absent' }))
  fireEvent.click(screen.getByRole('button', { name: zh['prompt.later'] }))
  expect(b.onDismiss).toHaveBeenCalledOnce()
  expect(b.prepare).not.toHaveBeenCalled()
})

it.each([
  ['an unsupported device', snapshotOf({ phase: 'unsupported' }, { device: { supported: false, reason: 'platform' }, options: [], recommended: undefined })],
  ['a downloaded model', snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST })],
  ['an active download', snapshotOf({ phase: 'downloading', variant: Q8, completedBytes: 1, totalBytes: 2, source: 'https://huggingface.co' })],
])('dismisses itself for %s', (_name, snapshot) => {
  const b = fixture()
  b.publish(snapshot)
  expect(screen.queryByText(zh['prompt.title'])).toBeNull()
  expect(b.onDismiss).toHaveBeenCalledOnce()
})
