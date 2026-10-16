// @vitest-environment jsdom
/** The card describes the model chosen in its dropdown: one status, one fact line, one primary action, and secondary actions. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReflexSnapshot } from '@deepseek-ai/dsh-experimental-api-reflex-local/types'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineCard, type EngineCardProps } from '../src/client/EngineCard.tsx'
import type { ReflexReadiness } from '../src/client/readiness.ts'
import { zh } from '../src/client/locales.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { BIG, FAST, GIB, NINE, OPTIONS, Q4, Q8, SIZES, holding, snapshotOf } from './snapshot-fixture.client.ts'
import { sameVariant } from '../src/client/size.ts'

afterEach(cleanup)
const t = makeTranslate(zh)

function fixture(snapshot: ReflexSnapshot | null, connected = true, error: string | null = null) {
  const state = createSnapshotStore<ReflexReadiness>({ snapshot, connected, error }), master = createSnapshotStore<boolean | null>(null)
  const command = () => vi.fn(async () => {})
  const props = { t, useReflexReadiness: bindSnapshotSelector(state), useReflexMaster: bindSnapshotSelector(master), prepare: command(),
    pause: command(), cancel: command(), enable: command(), disable: command(),
    deleteModel: command() } as EngineCardProps
  render(<EngineCard {...props} />)
  return { ...props, publish(next: Partial<ReflexReadiness>) { act(() => { state.set({ ...state.getSnapshot(), ...next }) }) },
    setMaster(next: boolean | null) { act(() => { master.set(next) }) } }
}
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })
const pill = () => button(zh.modelSelect)
const openMenu = () => { fireEvent.click(button(zh.more)) }
const menuItems = () => screen.getAllByRole('menuitem').map(item => item.textContent)
const optionRow = (name: string) => screen.getAllByRole<HTMLButtonElement>('menuitem').find(item => item.textContent.startsWith(name))!
/** Open the dropdown and choose the option whose row starts with `name`. */
const pick = (name: string) => { fireEvent.click(pill()); fireEvent.click(optionRow(name)) }
const DOWNLOADED = { state: 'downloaded', selfTest: 'passed' } as const
const NINE_DOWNLOADING = { phase: 'downloading', variant: NINE, completedBytes: 3.6e9, totalBytes: SIZES.nineQ8, source: 'https://huggingface.co' } as const
/** The 4B Q8_0 model is downloaded, tested, and active. */
const activeQ8 = (overrides: Parameters<typeof snapshotOf>[1] = {}) => snapshotOf({ phase: 'ready', variant: Q8, selfTest: FAST },
  { active: Q8, options: holding([Q8, DOWNLOADED]), ...overrides })

it('shows loading and transport failure before the first snapshot', () => {
  fixture(null, false, 'socket closed')
  expect(screen.getByRole('status').textContent).toBe(zh.loading)
  expect(screen.getByRole('alert').textContent).toBe('操作没有完成：socket closed')
})

it.each([
  ['platform', zh['unsupported.platform']], ['memory', zh['unsupported.memory']], ['runner-missing', zh['unsupported.runner-missing']],
] as const)('explains an unsupported %s device in one fact line without any action', (reason, text) => {
  fixture(snapshotOf({ phase: 'unsupported' }, { device: { supported: false, reason }, options: [], recommended: undefined }))
  expect(screen.getByText(text)).toBeTruthy()
  expect(screen.getByText('APUS Reflex')).toBeTruthy()
  expect(screen.getByText(zh['state.unsupported'])).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('names where judgments go when a supported device reports the unsupported phase', () => {
  fixture(snapshotOf({ phase: 'unsupported' }))
  expect(screen.getByText(zh.elsewhere)).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('shows checking as status only, and says so while reconnecting', () => {
  fixture(snapshotOf({ phase: 'checking' }), false)
  expect(screen.getByText(zh.checking)).toBeTruthy()
  expect(screen.getByText(zh.reconnecting)).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('preselects the recommendation, states its size and memory tier, and downloads it in one click', () => {
  const b = fixture(snapshotOf({ phase: 'absent' }))
  expect(pill().textContent).toBe('APUS Reflex 4B · Q8_0')
  expect(pill().dataset['reflexModelSelect']).toBe('4b:q8_0')
  expect(screen.getByText(zh['state.absent'])).toBeTruthy()
  expect(screen.getByText('下载 4.5 GB · 需要 16 GB 内存')).toBeTruthy()
  fireEvent.click(button('下载并启用 · 4.5 GB'))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q8 })
  expect(screen.queryByRole('button', { name: zh.more })).toBeNull()
})

it('formats a fractional memory tier with one decimal', () => {
  fixture(snapshotOf({ phase: 'absent' }, { options: OPTIONS.map(option => ({ ...option, minMemoryBytes: 12.5 * GIB })) }))
  expect(screen.getByText('下载 4.5 GB · 需要 12.5 GB 内存')).toBeTruthy()
})

it('describes the smallest option when the Host recommends none', () => {
  fixture(snapshotOf({ phase: 'absent' }, { recommended: undefined }))
  expect(pill().textContent).toBe('APUS Reflex 4B · Q4_K_M')
})

it('offers no model and no download when the Host offers no option', () => {
  fixture(snapshotOf({ phase: 'absent' }, { recommended: undefined, options: [] }))
  expect(screen.getByText(zh.noFit)).toBeTruthy()
  expect(screen.getByText('APUS Reflex')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('states need against free space when the recommendation does not fit the disk', async () => {
  const short = { ...Q4, bytes: SIZES.q4_k_m, minMemoryBytes: 8 * GIB, experimental: false, fits: false, reason: 'disk', inventory: { state: 'absent' } } as const
  const b = fixture(snapshotOf({ phase: 'absent' }, { availableDiskBytes: 1e9, recommended: Q4, options: [short] }))
  expect(button('需要 2.7 GB，当前可用 1.0 GB').disabled).toBe(true)
  fireEvent.click(pill())
  expect(optionRow('4B · Q4_K_M').textContent).toContain(zh['unfit.disk'])
  expect(optionRow('4B · Q4_K_M').disabled).toBe(false)
  b.publish({ snapshot: snapshotOf({ phase: 'absent' }, { availableDiskBytes: undefined, recommended: Q4, options: [short] }) })
  await waitFor(() => { expect(button('下载并启用 · 2.7 GB').disabled).toBe(false) })
})

it('lists every option grouped by size with facts and tags, and choosing one only changes the card', async () => {
  const b = fixture(snapshotOf({ phase: 'absent' }, { options: holding([Q4, { state: 'partial', completedBytes: 1.2e9 }],
    [NINE, { state: 'downloaded', selfTest: 'slow' }]) }))
  fireEvent.click(pill())
  expect(menuItems()).toEqual([
    '4B · Q4_K_M已下载 1.2 GB / 2.7 GB · 需要 8 GB 内存',
    `4B · Q8_0${zh['tag.recommended']}下载 4.5 GB · 需要 16 GB 内存`,
    `9B · Q8_0${zh['tag.downloaded']}下载 9.5 GB · 需要 24 GB 内存`,
    `35B-A3B · Q4_K_M（内存可能不足：需要 32 GB，这台 Mac 24 GB）${zh['tag.experimental']}下载 21.2 GB · 需要 32 GB 内存`,
  ])
  expect(screen.getAllByRole('separator')).toHaveLength(2)
  expect(optionRow('35B-A3B').disabled).toBe(false)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menuitem')).toBeNull()
  fireEvent.click(pill())
  fireEvent.click(optionRow('4B · Q4_K_M'))
  expect(screen.queryByRole('menuitem')).toBeNull()
  expect(pill().textContent).toBe('APUS Reflex 4B · Q4_K_M')
  expect(screen.getByText(zh['state.paused'])).toBeTruthy()
  expect(screen.getByText('已下载 1.2 GB / 2.7 GB · 需要 8 GB 内存')).toBeTruthy()
  expect(b.prepare).not.toHaveBeenCalled()
  fireEvent.click(button(zh.resume))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q4 })
  await waitFor(() => { expect(button(zh.more).disabled).toBe(false) })
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  expect(b.deleteModel).toHaveBeenCalledWith(Q4)
  await waitFor(() => { expect(pill().disabled).toBe(false) })
  pick('9B · Q8_0')
  expect(screen.getByText(zh['state.downloaded'])).toBeTruthy()
  fireEvent.click(button(zh.useAnyway))
  expect(b.prepare).toHaveBeenLastCalledWith({ variant: NINE })
})

it.each([
  [undefined, '下载并启用 · 21.2 GB'], [NINE, '下载并切换 · 21.2 GB'],
] as const)('notes a memory shortfall once and then downloads (active %j)', async (active, label) => {
  const options = active === undefined ? OPTIONS : holding([NINE, DOWNLOADED])
  const b = fixture(snapshotOf({ phase: 'absent' }, { options, ...active === undefined ? {} : { active } }))
  pick('35B-A3B · Q4_K_M')
  expect(screen.getByText('下载 21.2 GB · 需要 32 GB 内存（内存可能不足：需要 32 GB，这台 Mac 24 GB）')).toBeTruthy()
  fireEvent.click(button(label))
  expect(screen.getByText(zh['notice.unfit.title'])).toBeTruthy()
  expect(screen.getByText('需要 32 GB，这台 Mac 24 GB。可能运行很慢或无法加载')).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.dismiss })).toBeNull()
  expect(b.prepare).not.toHaveBeenCalled()
  fireEvent.click(button(zh['notice.unfit.ok']))
  await waitFor(() => { expect(b.prepare).toHaveBeenCalledWith({ variant: BIG, allowUnfit: true }) })
})

it('proceeds when the memory notice is closed rather than acknowledged, for a downloaded model too', async () => {
  const options = OPTIONS.map(option => sameVariant(option, BIG) ? { ...option, inventory: DOWNLOADED } : option)
  const b = fixture(snapshotOf({ phase: 'absent' }, { options }))
  pick('35B-A3B · Q4_K_M')
  fireEvent.click(button(zh.use))
  fireEvent.click(button(zh.close))
  await waitFor(() => { expect(b.prepare).toHaveBeenCalledWith({ variant: BIG, allowUnfit: true }) })
})

it('notes the memory shortfall before asking to pause another download', async () => {
  const b = fixture(snapshotOf(NINE_DOWNLOADING))
  pick('35B-A3B · Q4_K_M')
  fireEvent.click(button('下载并启用 · 21.2 GB'))
  fireEvent.click(button(zh['notice.unfit.ok']))
  expect(screen.getByText(zh['confirm.switch.title'])).toBeTruthy()
  fireEvent.click(button(zh['confirm.switch.confirm']))
  await waitFor(() => { expect(b.prepare).toHaveBeenCalledWith({ variant: BIG, allowUnfit: true }) })
  expect(b.pause).toHaveBeenCalledOnce()
})

it('names a self-test failure of a model memory may not admit as a memory problem', () => {
  fixture(snapshotOf({ phase: 'failed', variant: BIG, failure: { kind: 'runner', message: 'oom' } }))
  expect(screen.getByRole('alert').textContent).toBe(`${zh['failure.runner']}（内存可能不足：需要 32 GB，这台 Mac 24 GB）`)
})

it('shows the memory notice when the Host refuses an option, and reports a malformed refusal', async () => {
  const b = fixture(snapshotOf({ phase: 'absent' }))
  vi.mocked(b.prepare).mockRejectedValueOnce({ code: 'reflexLocal/unfit', message: 'unfit',
    details: { variant: Q8, requiredBytes: 32 * GIB, deviceBytes: 24 * GIB } })
  fireEvent.click(button('下载并启用 · 4.5 GB'))
  await screen.findByText(zh['notice.unfit.title'])
  fireEvent.click(button(zh['notice.unfit.ok']))
  await waitFor(() => { expect(b.prepare).toHaveBeenLastCalledWith({ variant: Q8, allowUnfit: true }) })
  for (const failure of [{ code: 'reflexLocal/unfit', details: { requiredBytes: 'x' } }, { code: 'reflexLocal/unfit', details: null },
    { code: 'reflexLocal/unfit' }, { code: 'other' }, 'closed']) {
    vi.mocked(b.prepare).mockRejectedValueOnce(failure)
    await waitFor(() => { expect(button('下载并启用 · 4.5 GB').disabled).toBe(false) })
    fireEvent.click(button('下载并启用 · 4.5 GB'))
    await screen.findByRole('alert')
    expect(screen.queryByRole('dialog')).toBeNull()
  }
})

it('states partial progress without a byte count when the Host omits one', () => {
  fixture(snapshotOf({ phase: 'absent' }, { options: holding([Q4, { state: 'partial' }]) }))
  pick('4B · Q4_K_M')
  expect(screen.getByText('已下载 0.0 GB / 2.7 GB · 需要 8 GB 内存')).toBeTruthy()
})

it('marks the model in use, switches to another downloaded or new model, and confirms deleting the model in use', async () => {
  const b = fixture(activeQ8({ enabled: true, options: holding([Q8, DOWNLOADED], [NINE, DOWNLOADED]) }))
  fireEvent.click(pill())
  expect(optionRow('4B · Q8_0').textContent).toContain(zh['tag.inUse'])
  expect(optionRow('4B · Q8_0').textContent).not.toContain(zh['tag.downloaded'])
  fireEvent.click(optionRow('9B · Q8_0'))
  fireEvent.click(button(zh.use))
  expect(b.prepare).toHaveBeenCalledWith({ variant: NINE })
  await waitFor(() => { expect(button(zh.more).disabled).toBe(false) })
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  expect(b.deleteModel).toHaveBeenCalledWith(NINE)
  await waitFor(() => { expect(pill().disabled).toBe(false) })
  pick('4B · Q4_K_M')
  expect(button('下载并切换 · 2.7 GB')).toBeTruthy()
  pick('4B · Q8_0')
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  expect(screen.getByText('删除正在使用的 4B · Q8_0？')).toBeTruthy()
  expect(screen.getByText(zh['confirm.deleteActive.body'])).toBeTruthy()
  fireEvent.click(button(zh.dismiss))
  expect(b.deleteModel).toHaveBeenCalledOnce()
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  fireEvent.click(button(zh['confirm.delete']))
  expect(b.deleteModel).toHaveBeenLastCalledWith(Q8)
})

it('deletes the active model without confirmation when local judgments are off', () => {
  const b = fixture(activeQ8())
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(b.deleteModel).toHaveBeenCalledWith(Q8)
})

it('asks before pausing a running download to download another model, and the same after a Host refusal', async () => {
  const b = fixture(snapshotOf(NINE_DOWNLOADING))
  expect(pill().textContent).toBe('APUS Reflex 9B · Q8_0')
  pick('4B · Q4_K_M')
  expect(screen.getByText('正在准备 9B · Q8_0')).toBeTruthy()
  fireEvent.click(button('下载并启用 · 2.7 GB'))
  expect(screen.getByText(zh['confirm.switch.title'])).toBeTruthy()
  expect(screen.getByText('暂停当前下载并改下 4B · Q4_K_M？已下载部分会保留')).toBeTruthy()
  fireEvent.click(button(zh['confirm.switch.confirm']))
  await waitFor(() => { expect(b.prepare).toHaveBeenCalledWith({ variant: Q4 }) })
  expect(b.pause).toHaveBeenCalledOnce()
  b.publish({ snapshot: snapshotOf({ phase: 'absent' }) })
  vi.mocked(b.prepare).mockRejectedValueOnce(new RemoteError('reflexLocal/preparing-other', 'busy', { preparing: NINE, requested: Q4 }))
  await waitFor(() => { expect(button('下载并启用 · 2.7 GB').disabled).toBe(false) })
  fireEvent.click(button('下载并启用 · 2.7 GB'))
  await screen.findByText(zh['confirm.switch.title'])
  vi.mocked(b.prepare).mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(button(zh.dismiss))
  fireEvent.click(button('下载并启用 · 2.7 GB'))
  await screen.findByText('操作没有完成：offline')
})

it('downloads another model at once while a paused one waits, without naming the paused one', () => {
  const b = fixture(snapshotOf({ phase: 'paused', variant: Q4, completedBytes: 1.68e9, totalBytes: SIZES.q4_k_m }))
  pick('4B · Q8_0')
  expect(screen.queryByText(/4B · Q4_K_M/)).toBeNull()
  fireEvent.click(button('下载并启用 · 4.5 GB'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q8 })
})

it('keeps describing the active model while another model prepares in the background', async () => {
  const running = { state: 'running', model: Q8, approxResidentBytes: SIZES.q8_0 } as const
  const b = fixture(activeQ8({ enabled: true, runner: running, preparation: NINE_DOWNLOADING }))
  expect(pill().textContent).toBe('APUS Reflex 4B · Q8_0')
  expect(screen.getByText(zh['state.enabled'])).toBeTruthy()
  expect(screen.getByText('运行中 · 约 4.5 GB 内存')).toBeTruthy()
  expect(screen.getByText('正在准备 9B · Q8_0 37% · 当前仍用 4B · Q8_0 判断')).toBeTruthy()
  pick('9B · Q8_0')
  expect(screen.getByText('准备中 37%')).toBeTruthy()
  fireEvent.click(button(zh.pause))
  expect(b.pause).toHaveBeenCalledOnce()
  b.publish({ snapshot: activeQ8({ enabled: true, runner: running,
    preparation: { phase: 'paused', variant: NINE, completedBytes: 3.6e9, totalBytes: SIZES.nineQ8 } }) })
  await waitFor(() => { expect(button(zh.resume).disabled).toBe(false) })
  fireEvent.click(button(zh.resume))
  expect(b.prepare).toHaveBeenCalledWith({ variant: NINE })
  await waitFor(() => { expect(pill().disabled).toBe(false) })
  pick('4B · Q8_0')
  expect(screen.getByText('9B · Q8_0 已暂停，已完成 37% · 当前仍用 4B · Q8_0 判断')).toBeTruthy()
  b.publish({ snapshot: activeQ8({ enabled: true, runner: running, preparation: { phase: 'testing', variant: NINE } }) })
  expect(screen.getByText('正在检查 9B · Q8_0 · 当前仍用 4B · Q8_0 判断')).toBeTruthy()
})

it.each([
  ['downloading', NINE_DOWNLOADING, '准备中 37%'],
  ['paused', { phase: 'paused', variant: NINE, completedBytes: 3.6e9, totalBytes: SIZES.nineQ8 }, zh['state.paused']],
  ['verifying', { phase: 'verifying', variant: NINE }, zh['state.verifying']],
  ['testing', { phase: 'testing', variant: NINE }, zh['state.testing']],
] as const)('keeps the active model named and its 停用 reachable while describing another model %s', async (_phase, preparation, badge) => {
  const b = fixture(activeQ8({ enabled: true, preparation }))
  pick('9B · Q8_0')
  expect(screen.getByText(badge)).toBeTruthy()
  expect(screen.getByText('当前仍用 4B · Q8_0 判断')).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.disable })).toBeNull()
  openMenu()
  expect(menuItems()).toEqual([zh.cancel, '停用当前模型（4B · Q8_0）'])
  fireEvent.click(screen.getByRole('menuitem', { name: '停用当前模型（4B · Q8_0）' }))
  await waitFor(() => { expect(b.disable).toHaveBeenCalledOnce() })
})

it('offers no 停用当前模型 while local judgments are already off, and no line while the active model itself is checked', () => {
  fixture(activeQ8({ preparation: { phase: 'testing', variant: Q8 }, options: holding([Q8, DOWNLOADED], [Q4, DOWNLOADED]) }))
  expect(screen.queryByText(/当前仍用/)).toBeNull()
  pick('4B · Q4_K_M')
  openMenu()
  expect(menuItems()).toEqual([zh.deleteThis])
})

it('keeps only pausing a download while the master switch is off', async () => {
  const b = fixture(activeQ8({ enabled: true, reflexEnabled: false }))
  expect(screen.getByText(zh['state.masterOff'])).toBeTruthy()
  expect(screen.getByText(zh.masterOff)).toBeTruthy()
  expect(pill().disabled).toBe(true)
  expect(button(zh.more).disabled).toBe(true)
  b.publish({ snapshot: snapshotOf(NINE_DOWNLOADING, { reflexEnabled: false }) })
  await waitFor(() => { expect(button(zh.pause).disabled).toBe(false) })
  expect(button(zh.more).disabled).toBe(true)
  b.publish({ snapshot: snapshotOf({ phase: 'paused', variant: NINE, completedBytes: 3.6e9, totalBytes: SIZES.nineQ8 }, { reflexEnabled: false }) })
  expect(button(zh.resume).disabled).toBe(true)
})

it.each([
  [{ state: 'running', model: Q8, approxResidentBytes: 9.0e9 } as const, '运行中 · 约 9.0 GB 内存 · 每次判断约 0.4 秒'],
  [{ state: 'starting', model: Q8 } as const, zh['runner.starting']],
  [{ state: 'stopped' } as const, zh['runner.stopped']],
])('states the runner as %j while local judgments are in use and stops them', (runner, text) => {
  const b = fixture(activeQ8({ enabled: true, runner }))
  expect(screen.getByText(zh['state.enabled'])).toBeTruthy()
  expect(screen.getByText(text)).toBeTruthy()
  fireEvent.click(button(zh.disable))
  expect(b.disable).toHaveBeenCalledOnce()
})

it('reports a runner that failed repeatedly with its reason and offers turning it on again', () => {
  const b = fixture(activeQ8({ runner: { state: 'failed', reason: 'exit 9' } }))
  expect(screen.getByText(zh['state.failed'])).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('失败：exit 9')
  fireEvent.click(button(zh.enable))
  expect(b.enable).toHaveBeenCalledOnce()
})

it('keeps a stopped model and turns it on again, or on anyway when it is slow', () => {
  const b = fixture(activeQ8())
  expect(screen.getByText(zh['state.disabled'])).toBeTruthy()
  expect(screen.getByText(zh.stopped)).toBeTruthy()
  fireEvent.click(button(zh.enable))
  expect(b.enable).toHaveBeenCalledOnce()
  b.publish({ snapshot: activeQ8({ options: holding([Q8, { state: 'downloaded', selfTest: 'slow' }]) }) })
  expect(screen.getByText(zh.slow)).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.enableAnyway })).toBeTruthy()
})

it('describes the active model rather than a failure that names no model', () => {
  fixture(activeQ8({ preparation: { phase: 'failed', failure: { kind: 'disk', requiredBytes: 1, availableBytes: 0 } } }))
  expect(screen.getByText(zh['state.disabled'])).toBeTruthy()
})

it('describes an active model the Host still lists when its preparation reads absent', () => {
  fixture(snapshotOf({ phase: 'absent' }, { active: Q8, enabled: true, runner: { state: 'stopped' } }))
  expect(pill().textContent).toBe('APUS Reflex 4B · Q8_0')
  expect(screen.getByText(zh['runner.stopped'])).toBeTruthy()
})

it('picks a download source from the secondary menu and labels known origins', () => {
  const sources = ['https://huggingface.co', 'https://hf-mirror.com', 'https://models.example']
  const b = fixture(snapshotOf({ phase: 'absent' }, { downloadSources: sources }))
  openMenu()
  expect(menuItems()).toEqual([zh.sourceChoice])
  fireEvent.click(screen.getByRole('menuitem', { name: zh.sourceChoice }))
  expect(menuItems()).toEqual([zh.sourceChoice, zh.sourceAuto, zh.sourceHuggingFace, zh.sourceMirror, 'https://models.example'])
  fireEvent.click(screen.getByRole('menuitem', { name: zh.sourceMirror }))
  fireEvent.click(button('下载并启用 · 4.5 GB'))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q8, downloadSource: 'https://hf-mirror.com' })
})

it('shows the first download with its percent, exact bytes, pause, and cancel', async () => {
  const b = fixture(snapshotOf({ phase: 'downloading', variant: Q8, completedBytes: 2.8e9, totalBytes: SIZES.q8_0, source: 'https://huggingface.co' }))
  expect(screen.getByRole('progressbar', { name: zh.progressLabel }).getAttribute('value')).toBe('2800000000')
  expect(screen.getByText('准备中 62%')).toBeTruthy()
  expect(screen.getByText('已下载 2.8 GB / 4.5 GB')).toBeTruthy()
  fireEvent.click(button(zh.pause))
  expect(b.pause).toHaveBeenCalledOnce()
  await waitFor(() => { expect(button(zh.more).disabled).toBe(false) })
  openMenu()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menuitem')).toBeNull()
  openMenu()
  expect(menuItems()).toEqual([zh.cancel])
  fireEvent.click(screen.getByRole('menuitem', { name: zh.cancel }))
  expect(screen.getByText('取消并删除已下载的 2.8 GB？')).toBeTruthy()
  expect(screen.getByText(zh['confirm.cancel.body'])).toBeTruthy()
  fireEvent.click(button(zh['confirm.cancel.keep']))
  expect(b.cancel).not.toHaveBeenCalled()
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.cancel }))
  fireEvent.click(button(zh['confirm.cancel.confirm']))
  expect(b.cancel).toHaveBeenCalledOnce()
})

it('cancels a download that has no bytes yet without asking', () => {
  const b = fixture(snapshotOf({ phase: 'downloading', variant: Q8, completedBytes: 0, totalBytes: SIZES.q8_0, source: 'https://huggingface.co' }))
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.cancel }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(b.cancel).toHaveBeenCalledOnce()
})

it('resumes a paused first download with its variant', () => {
  const b = fixture(snapshotOf({ phase: 'paused', variant: Q4, completedBytes: 1.68e9, totalBytes: SIZES.q4_k_m }))
  expect(screen.getByText('下载已暂停，已完成 61%，继续会从断点接上')).toBeTruthy()
  expect(screen.getByRole('progressbar')).toBeTruthy()
  fireEvent.click(button(zh.resume))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q4 })
})

it.each(['verifying', 'testing'] as const)('shows the first model %s with cancellation of the whole file only', (phase) => {
  fixture(snapshotOf({ phase, variant: Q8 }))
  expect(screen.getByText(zh[phase])).toBeTruthy()
  expect(screen.getByText(zh[`state.${phase}`])).toBeTruthy()
  openMenu()
  expect(menuItems()).toEqual([zh.cancel])
  fireEvent.click(screen.getByRole('menuitem', { name: zh.cancel }))
  expect(screen.getByText('取消并删除已下载的 4.5 GB？')).toBeTruthy()
})

it('follows the live master switch without a remount, and the Host copy while no settings form serves it', () => {
  const b = fixture(activeQ8({ enabled: true, reflexEnabled: true }))
  expect(screen.getByText(zh['state.enabled'])).toBeTruthy()
  b.setMaster(false)
  expect(screen.getByText(zh['state.masterOff'])).toBeTruthy()
  expect(pill().disabled).toBe(true)
  expect(screen.queryByRole('button', { name: zh.disable })).toBeNull()
  b.setMaster(true)
  expect(screen.getByText(zh['state.enabled'])).toBeTruthy()
  expect(button(zh.disable).disabled).toBe(false)
  b.publish({ snapshot: activeQ8({ enabled: true, reflexEnabled: false }) })
  expect(screen.getByText(zh['state.enabled'])).toBeTruthy()
  b.setMaster(null)
  expect(screen.getByText(zh['state.masterOff'])).toBeTruthy()
})

it('moves to the model the Host names next after a delete, and keeps a picked model through a pause at zero', async () => {
  const b = fixture(activeQ8({ enabled: true, recommended: NINE, options: holding([Q8, DOWNLOADED], [Q4, DOWNLOADED]) }))
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  fireEvent.click(button(zh['confirm.delete']))
  expect(b.deleteModel).toHaveBeenCalledWith(Q8)
  // Deleting the model in use turns local judging off and leaves no active model.
  b.publish({ snapshot: snapshotOf({ phase: 'ready', variant: Q4, selfTest: FAST },
    { enabled: false, recommended: NINE, options: holding([Q4, DOWNLOADED]) }) })
  await waitFor(() => { expect(pill().disabled).toBe(false) })
  expect(pill().textContent).toBe('APUS Reflex 4B · Q4_K_M')
  expect(button(zh.use)).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.disable })).toBeNull()
  expect(screen.queryByRole('button', { name: zh.enable })).toBeNull()
  fireEvent.click(pill())
  expect(optionRow('4B · Q8_0').textContent).not.toMatch(new RegExp(`${zh['tag.inUse']}|${zh['tag.downloaded']}`))
  fireEvent.keyDown(document, { key: 'Escape' })
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  expect(b.deleteModel).toHaveBeenLastCalledWith(Q4)
  b.publish({ snapshot: snapshotOf({ phase: 'absent' }, { enabled: true, recommended: NINE }) })
  await waitFor(() => { expect(pill().textContent).toBe('APUS Reflex 9B · Q8_0') })
  expect(screen.getByText(zh['state.absent'])).toBeTruthy()
  await waitFor(() => { expect(pill().disabled).toBe(false) })
  fireEvent.click(pill())
  fireEvent.click(optionRow('4B · Q4_K_M'))
  fireEvent.click(button('下载并启用 · 2.7 GB'))
  b.publish({ snapshot: snapshotOf({ phase: 'paused', variant: Q4, completedBytes: 0, totalBytes: SIZES.q4_k_m },
    { enabled: true, recommended: NINE, options: holding([Q4, { state: 'partial', completedBytes: 0 }]) }) })
  await waitFor(() => { expect(button(zh.resume).disabled).toBe(false) })
  expect(pill().textContent).toBe('APUS Reflex 4B · Q4_K_M')
  b.publish({ snapshot: snapshotOf({ phase: 'absent' }, { enabled: true, recommended: NINE, options: holding([Q4, { state: 'partial', completedBytes: 0 }]) }) })
  expect(pill().textContent).toBe('APUS Reflex 4B · Q4_K_M')
  expect(screen.getByText('已下载 0.0 GB / 2.7 GB · 需要 8 GB 内存')).toBeTruthy()
})

it.each([
  [undefined, zh.verifyEnable], [Q4, zh.verifySwitch],
] as const)('verifies a full file without a self-test before using it (active %j)', (active, label) => {
  const options = holding([NINE, { state: 'downloaded' }], [Q4, DOWNLOADED])
  const b = fixture(snapshotOf({ phase: 'absent' }, { options, recommended: NINE, ...active === undefined ? {} : { active } }))
  if (active !== undefined) pick('9B · Q8_0')
  fireEvent.click(button(label))
  expect(b.prepare).toHaveBeenCalledWith({ variant: NINE })
})

it('opens on a tested file the Host names while no model is active', () => {
  fixture(snapshotOf({ phase: 'ready', variant: Q4, selfTest: FAST }, { enabled: true, recommended: NINE, options: holding([Q4, DOWNLOADED]) }))
  expect(pill().textContent).toBe('APUS Reflex 4B · Q4_K_M')
  expect(screen.getByText(zh['state.downloaded'])).toBeTruthy()
})

it('says the model is loading while turning local judgments on starts the runner', () => {
  fixture(activeQ8({ runner: { state: 'starting', model: Q8 } }))
  expect(screen.getByText(zh['state.disabled'])).toBeTruthy()
  expect(screen.getByText(zh['runner.starting'])).toBeTruthy()
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
  expect(pill().textContent).toBe('APUS Reflex 4B · Q4_K_M')
  expect(screen.getByRole('alert').textContent).toBe(text)
  expect(screen.getByText(zh['state.failed'])).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.more })).toBeNull()
  fireEvent.click(button(zh.retry))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q4 })
})

it('offers deleting a held file whose preparation failed', () => {
  const b = fixture(snapshotOf({ phase: 'failed', variant: Q8, failure: { kind: 'self-test', message: 'x' } },
    { options: holding([Q8, { state: 'downloaded', selfTest: 'failed' }]) }))
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteThis }))
  expect(b.deleteModel).toHaveBeenCalledWith(Q8)
})

it('retries a failure without a variant for the recommendation through the source chosen in the menu', () => {
  const b = fixture(snapshotOf({ phase: 'failed', failure: { kind: 'download', download: { reason: 'timeout', source: 'https://hf-mirror.com' } } },
    { downloadSources: ['https://huggingface.co', 'https://hf-mirror.com'] }))
  expect(pill().textContent).toBe('APUS Reflex 4B · Q8_0')
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.sourceChoice }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.sourceHuggingFace }))
  fireEvent.click(button(zh.retry))
  expect(b.prepare).toHaveBeenCalledWith({ variant: Q8, downloadSource: 'https://huggingface.co' })
})

it('disables commands while reconnecting and reports a rejected command in place', async () => {
  const b = fixture(activeQ8(), false)
  expect(screen.getByText(zh.reconnecting)).toBeTruthy()
  expect(button(zh.enable).disabled).toBe(true)
  expect(pill().disabled).toBe(true)
  b.publish({ connected: true })
  vi.mocked(b.enable).mockRejectedValueOnce(new Error('not ready'))
  fireEvent.click(button(zh.enable))
  await screen.findByText('操作没有完成：not ready')
  vi.mocked(b.enable).mockRejectedValueOnce('closed')
  fireEvent.click(button(zh.enable))
  await screen.findByText('操作没有完成：closed')
})
