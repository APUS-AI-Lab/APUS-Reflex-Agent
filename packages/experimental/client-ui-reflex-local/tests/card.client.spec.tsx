// @vitest-environment jsdom
/** The card offers exactly the actions each Host state allows and reports Host rejections in place. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineCard, type EngineCardProps } from '../src/client/EngineCard.tsx'
import type { ReflexReadiness } from '../src/client/readiness.ts'
import { zh } from '../src/client/locales.ts'
import { FAST, OPTIONS, Q4, Q8, SIZES, snapshotOf } from './snapshot-fixture.client.ts'

afterEach(cleanup)
const t = makeTranslate(zh)

function fixture(snapshot: ReflexSnapshot | null, connected = true, error: string | null = null) {
  const state = createSnapshotStore<ReflexReadiness>({ snapshot, connected, error })
  const command = () => vi.fn(async () => {})
  const props = { t, useReflexReadiness: bindSnapshotSelector(state), prepare: vi.fn(async () => {}),
    pause: command(), cancel: command(), enable: command(), disable: command(), remove: command() } as EngineCardProps
  render(<EngineCard {...props} />)
  return { ...props, publish(next: Partial<ReflexReadiness>) { act(() => { state.set({ ...state.getSnapshot(), ...next }) }) } }
}
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })

it('shows loading and transport failure before the first snapshot', () => {
  fixture(null, false, 'socket closed')
  expect(screen.getByRole('status').textContent).toBe(zh.loading)
  expect(screen.getByRole('alert').textContent).toBe('操作没有完成：socket closed')
})

it.each([
  ['platform', zh['unsupported.platform']], ['memory', zh['unsupported.memory']], ['runner-missing', zh['unsupported.runner-missing']],
] as const)('explains an unsupported %s device without offering an action', (reason, text) => {
  fixture(snapshotOf({ phase: 'unsupported' }, { device: { supported: false, reason }, options: [] }))
  expect(screen.getByText(text)).toBeTruthy()
  expect(screen.getByText(zh.elsewhere)).toBeTruthy()
  expect(screen.getByText(zh['state.unsupported'])).toBeTruthy()
  expect(screen.queryByText(zh.masterOff)).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})

it('names where judgments go when a supported device reports the unsupported phase', () => {
  fixture(snapshotOf({ phase: 'unsupported' }))
  expect(screen.getByText(zh.elsewhere)).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('shows checking as status only', () => {
  fixture(snapshotOf({ phase: 'checking' }))
  expect(screen.getByText(zh.checking)).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('states the cost of the recommendation and downloads it in one click', () => {
  const b = fixture(snapshotOf({ phase: 'absent' }))
  expect(screen.getByText('需要 4.5 GB 磁盘和至少 16.0 GB 内存。判断内容留在这台 Mac，回答仍由你配置的模型生成')).toBeTruthy()
  fireEvent.click(button('下载并启用 · 4.5 GB'))
  expect(b.prepare).toHaveBeenCalledWith({})
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('offers no download when no option fits this Mac', () => {
  fixture(snapshotOf({ phase: 'absent' }, { recommended: undefined }))
  expect(screen.getByText(zh.noFit)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /下载并启用 ·/ })).toBeNull()
})

it('states need against free space when the recommendation does not fit the disk', async () => {
  const short = { ...Q4, bytes: SIZES.q4_k_m, minMemoryBytes: 8e9, experimental: false, fits: false, reason: 'disk' } as const
  const b = fixture(snapshotOf({ phase: 'absent' }, { availableDiskBytes: 1e9, recommended: Q4, options: [short] }))
  expect(button('需要 2.7 GB，当前可用 1.0 GB').disabled).toBe(true)
  expect(screen.queryByText(zh.chooseModel)).toBeNull()
  b.publish({ snapshot: snapshotOf({ phase: 'absent' }, { availableDiskBytes: undefined, recommended: Q4, options: [short] }) })
  await waitFor(() => { expect(button('下载并启用 · 2.7 GB').disabled).toBe(false) })
})

it('lists every option with its facts, greys unfit ones with the reason, and downloads a chosen one', () => {
  const b = fixture(snapshotOf({ phase: 'absent' }))
  fireEvent.click(screen.getByText(zh.chooseModel))
  const rows = screen.getAllByRole('listitem')
  expect(rows.map(row => row.querySelector('strong')?.textContent)).toEqual([
    'APUS Reflex 4B · Q4_K_M', 'APUS Reflex 4B · Q8_0', 'APUS Reflex 9B · Q8_0', 'APUS Reflex 35B-A3B · Q4_K_M'])
  expect(rows[1]!.textContent).toContain(zh['tag.recommended'])
  expect(rows[3]!.textContent).toContain(`${zh['tag.experimental']}下载 21.2 GB · 需要 32.0 GB 内存${zh['unfit.memory']}`)
  expect(button('下载并使用 APUS Reflex 35B-A3B · Q4_K_M').disabled).toBe(true)
  fireEvent.click(button('下载并使用 APUS Reflex 9B · Q8_0'))
  expect(b.prepare).toHaveBeenCalledWith({ variant: { model: '9b', quant: 'q8_0' } })
})

it('marks the downloaded option as current without offering it again', () => {
  fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST }, { enabled: true }))
  expect(screen.getByText('APUS Reflex 4B · Q8_0', { selector: 'header strong' })).toBeTruthy()
  fireEvent.click(screen.getByText(zh.chooseModel))
  expect(screen.getAllByRole('listitem')[1]!.textContent).toContain(zh['tag.current'])
  expect(screen.queryByRole('button', { name: '下载并使用 APUS Reflex 4B · Q8_0' })).toBeNull()
  expect(screen.getAllByRole('button', { name: /^下载并使用/ })).toHaveLength(3)
})

it('hides the chooser when the Host offers a single option', () => {
  fixture(snapshotOf({ phase: 'absent' }, { options: [OPTIONS[1]!] }))
  expect(screen.queryByText(zh.chooseModel)).toBeNull()
})

it('explains that the Reflex master switch stops local judgments', () => {
  fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST }, { enabled: true, reflexEnabled: false }))
  expect(screen.getByText(zh['state.masterOff'])).toBeTruthy()
  expect(screen.getByText(zh.masterOff)).toBeTruthy()
})

it('sends an explicitly chosen download source and labels known origins', () => {
  const sources = ['https://huggingface.co', 'https://hf-mirror.com', 'https://models.example']
  const b = fixture(snapshotOf({ phase: 'absent' }, { downloadSources: sources }))
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: zh.sourceChoice })
  expect([...select.options].map(option => option.text)).toEqual([zh.sourceAuto, zh.sourceHuggingFace, zh.sourceMirror, 'https://models.example'])
  fireEvent.change(select, { target: { value: 'https://hf-mirror.com' } })
  fireEvent.click(button('下载并启用 · 4.5 GB'))
  expect(b.prepare).toHaveBeenCalledWith({ downloadSource: 'https://hf-mirror.com' })
})

it('shows exact byte progress, pauses, and cancels a download', async () => {
  const b = fixture(snapshotOf({ phase: 'downloading', variant: Q8, completedBytes: 2.8e9, totalBytes: SIZES.q8_0, source: 'https://huggingface.co' }))
  expect(screen.getByRole('progressbar', { name: zh.progressLabel }).getAttribute('value')).toBe('2800000000')
  expect(screen.getByText('2.8 GB / 4.5 GB · 62%')).toBeTruthy()
  fireEvent.click(button(zh.pause))
  await waitFor(() => { expect(button(zh.cancel).disabled).toBe(false) })
  fireEvent.click(button(zh.cancel))
  expect(b.pause).toHaveBeenCalledOnce()
  expect(b.cancel).toHaveBeenCalledOnce()
})

it('resumes a paused download with its variant and offers cancellation', async () => {
  const b = fixture(snapshotOf({ phase: 'paused', variant: Q4, completedBytes: 1.68e9, totalBytes: SIZES.q4_k_m }))
  expect(screen.getByText('下载已暂停，已完成 61%，继续会从断点接上')).toBeTruthy()
  expect(screen.getByRole('progressbar')).toBeTruthy()
  fireEvent.click(button(zh.resume))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q4 })
  await waitFor(() => { expect(button(zh.cancel).disabled).toBe(false) })
  fireEvent.click(button(zh.cancel))
  expect(b.cancel).toHaveBeenCalledOnce()
})

it.each(['verifying', 'testing'] as const)('shows %s as status only', (phase) => {
  fixture(snapshotOf({ phase, variant: Q8 }))
  expect(screen.getByText(zh[phase])).toBeTruthy()
  expect(screen.getByText(zh[`state.${phase}`])).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('turns local decisions off and deletes the model only after confirmation', async () => {
  const b = fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST }, { enabled: true }))
  expect(screen.getByText(zh['state.enabled'])).toBeTruthy()
  expect(screen.getByText('自检通过 · 每次判断约 0.4 秒')).toBeTruthy()
  fireEvent.click(button(zh.disable))
  expect(b.disable).toHaveBeenCalledOnce()
  await waitFor(() => { expect(button(zh.remove).disabled).toBe(false) })
  fireEvent.click(button(zh.remove))
  expect(screen.getByText(zh['removeConfirm.body'])).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: zh.cancel }).at(-1)!)
  await waitFor(() => { expect(screen.queryByText(zh['removeConfirm.body'])).toBeNull() })
  expect(b.remove).not.toHaveBeenCalled()
  fireEvent.click(button(zh.remove))
  fireEvent.click(button(zh['removeConfirm.confirm']))
  expect(b.remove).toHaveBeenCalledOnce()
})

it('enables a downloaded model and names the fallback when deleting', async () => {
  const b = fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST }))
  expect(screen.getByText(zh.readyDetail)).toBeTruthy()
  fireEvent.click(button(zh.enable))
  expect(b.enable).toHaveBeenCalledOnce()
  await waitFor(() => { expect(button(zh.remove).disabled).toBe(false) })
  fireEvent.click(button(zh.remove))
  expect(screen.getByText(zh['removeConfirm.body'])).toBeTruthy()
})

it('leaves a slow Mac off until the user enables it anyway', () => {
  const b = fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: { prefillTokensPerSecond: 120, decisionMs: 1800, slow: true } }))
  expect(screen.getByText('这台 Mac 判断较慢，每次约 1.8 秒，建议使用其他接入方式')).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.enable })).toBeNull()
  fireEvent.click(button(zh.enableAnyway))
  expect(b.enable).toHaveBeenCalledOnce()
})

it.each([
  [{ kind: 'download', download: { reason: 'network', source: 'https://huggingface.co' } }, zh['failure.download.network']],
  [{ kind: 'download', download: { reason: 'http', source: 'https://huggingface.co', status: 503 } }, '下载失败：下载服务返回 HTTP 503'],
  [{ kind: 'download', download: { reason: 'integrity', source: 'https://huggingface.co' } }, zh['failure.download.integrity']],
  [{ kind: 'disk', requiredBytes: SIZES.q8_0, availableBytes: 3.1e9 }, '磁盘空间不足：需要 4.5 GB，当前可用 3.1 GB'],
  [{ kind: 'runner', message: 'exit 9' }, zh['failure.runner']],
  [{ kind: 'self-test', message: 'choice mismatch' }, zh['failure.self-test']],
] as const)('states one plain reason for a %j failure and retries its variant', (failure, text) => {
  const b = fixture(snapshotOf({ phase: 'failed', variant: Q4, failure }))
  const alerts = screen.getAllByRole('alert').map(alert => alert.textContent)
  expect(alerts[0]).toBe(text)
  expect(alerts.slice(1)).toEqual(failure.kind === 'download' ? [] : [zh.elsewhere])
  expect(screen.getByText(zh['state.failed'])).toBeTruthy()
  fireEvent.click(button(zh.retry))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q4 })
})

it('retries a failure without a variant through the configured choice and source picker', () => {
  const b = fixture(snapshotOf({ phase: 'failed', failure: { kind: 'download', download: { reason: 'timeout', source: 'https://hf-mirror.com' } } },
    { downloadSources: ['https://huggingface.co', 'https://hf-mirror.com'] }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'https://huggingface.co' } })
  fireEvent.click(button(zh.retry))
  expect(b.prepare).toHaveBeenCalledWith({ downloadSource: 'https://huggingface.co' })
})

it('disables commands while reconnecting and reports a rejected command in place', async () => {
  const b = fixture(snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST }), false)
  expect(screen.getByText(zh.reconnecting)).toBeTruthy()
  expect(button(zh.enable).disabled).toBe(true)
  b.publish({ connected: true })
  vi.mocked(b.enable).mockRejectedValueOnce(new Error('not ready'))
  fireEvent.click(button(zh.enable))
  await screen.findByText('操作没有完成：not ready')
  vi.mocked(b.enable).mockRejectedValueOnce('closed')
  fireEvent.click(button(zh.enable))
  await screen.findByText('操作没有完成：closed')
})
