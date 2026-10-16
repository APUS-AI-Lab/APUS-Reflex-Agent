// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ReflexSettings, type ReflexSettingsProps } from '../src/client/ReflexSettings.tsx'
import type { ReflexCardState } from '../src/client/reflex-settings-controller.ts'
import { zh } from '../src/client/reflex-settings-locales.ts'
import type {} from '../src/client/reflex-settings.ts'

afterEach(cleanup)
const field = (text: string) => ({ text, invalid: false, overridden: false })
const state: ReflexCardState = {
  enabled: true, toggling: false, toggleFailed: false,
  prestep: { available: true, writable: true, enabled: true, toggling: false, failed: false },
  mode: 'custom', localChoiceFailed: false, available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
  endpoint: field('https://reflex.test'), model: field('decision'), protocol: field('openjev'), effort: field('high'),
  timeoutMs: field('1000'), apiKeyEnv: field('REFLEX_API_KEY'), apiKey: field(''),
  apiKeyConfigured: true, apiKeyWritable: true, credentialFailed: false, credentialSaveError: undefined,
  partialSave: false, probe: { pending: false, failed: false },
  runtime: { provider: { id: 'system-one', endpoint: 'https://reflex.test', model: 'decision' }, capabilities: [{ id: 'codexSupervision', implemented: false, enabled: false }] },
}
function props(snapshot = state): ReflexSettingsProps {
  const unused = (): never => { throw new Error('ReflexSettings does not consume global hooks') }
  const globals: GlobalStandardProps = {
    usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
    useSessionRetainInfo: unused, useResource: unused, useWorkspaces: unused,
  }
  return { ...globals, renderSlot: vi.fn(() => null), close: vi.fn(),
    useReflexCard: select => select(snapshot), t: makeTranslate(zh, commonZh),
    selectMode: vi.fn(), reset: vi.fn(), setEnabled: vi.fn(async () => {}), setPrestep: vi.fn(async () => {}),
    edit: vi.fn(), resetField: vi.fn(), save: vi.fn(),
    discard: vi.fn(),
    testConnection: vi.fn(async () => {}), clearCredential: vi.fn(async () => {}), refresh: vi.fn(async () => {}),
  }
}

const chooseMode = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: zh.connectionMode }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}

it('shows the Reflex switch with its state and saves a change at once', () => {
  const p = props()
  const { rerender } = render(<ReflexSettings {...p} />)
  expect(screen.getByText(zh.switchOn)).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: '启用 Reflex 决策' }))
  expect(p.setEnabled).toHaveBeenCalledWith(false)
  rerender(<ReflexSettings {...props({ ...state, enabled: false, toggleFailed: true })} />)
  expect(screen.getByText(zh.switchOff)).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('开关状态未保存，请重试')
  rerender(<ReflexSettings {...props({ ...state, toggling: true })} />)
  expect(screen.getByRole('switch', { name: '启用 Reflex 决策' }).hasAttribute('disabled')).toBe(true)
})

it('shows authentication failure rather than connected for a rejected key', () => {
  render(<ReflexSettings {...props({ ...state, probe: { pending: false, failed: false, result: { kind: 'failed', stage: 'models', model: 'decision', effort: 'high', latencyMs: 10, code: 'http', status: 401 } } })} />)
  expect(screen.getByText(/认证失败/)).toBeTruthy()
  expect(screen.queryByText(/真实判断通过/)).toBeNull()
})

it.each([
  ['timeout', '请求超时'], ['model-missing', '服务未提供该模型'],
  ['decision-rejected', '服务回答未通过真实判断检查'], ['transport', '服务不可用或响应无效'],
  ['missing-credential', zh.noCredential],
] as const)('explains the failed connection reason %s', (code, message) => {
  render(<ReflexSettings {...props({ ...state, probe: { pending: false, failed: false,
    result: { kind: 'failed', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 12, code } } })} />)
  expect(screen.getAllByText(message, { exact: false }).length).toBeGreaterThan(0)
})

it.each(['read-only', 'saving', 'credential-read-only'] as const)('protects disabled controls: %s', (reason) => {
  render(<ReflexSettings {...props({ ...state, writable: reason !== 'read-only', saving: reason === 'saving',
    apiKeyWritable: reason !== 'credential-read-only' })} />)
  expect(screen.getByLabelText('API Key').hasAttribute('disabled')).toBe(true)
})

it('explains partial settings persistence after a conflicting credential compensation', () => {
  render(<ReflexSettings {...props({ ...state, failed: true, dirty: true, partialSave: true })} />)
  expect(screen.getByText('密钥保存结果尚未确认，连接设置可能部分生效。请重新打开并检查。')).toBeTruthy()
  expect(screen.queryByText('未能保存全部设置，请检查输入并重试')).toBeNull()
})

it.each([
  ['configured', '此引用已有密钥；请为新密钥填写新的专用引用名'],
  ['unavailable', '无法确认密钥引用状态，配置未更改，请重试'],
] as const)('explains refused credential preflight: %s', (credentialSaveError, message) => {
  render(<ReflexSettings {...props({ ...state, failed: true, dirty: true, credentialSaveError })} />)
  expect(screen.getByText(message)).toBeTruthy()
})

it('reports a failed save beside Save, a read-only deployment, and a Reflex service that has not loaded', () => {
  const view = render(<ReflexSettings {...props({ ...state, failed: true, dirty: true, writable: false })} />)
  expect(screen.getByText(zh.saveFailed)).toBeTruthy()
  expect(screen.getByText(zh.readOnly)).toBeTruthy()
  view.rerender(<ReflexSettings {...props({ ...state, available: false })} />)
  expect(screen.getByRole('status').textContent).toBe(zh.unavailable)
  expect(screen.queryByRole('button', { name: zh.save })).toBeNull()
})

it('keeps first-run configuration editable without a separate unconfigured sentence', () => {
  const initial = { ...state, endpoint: field(''), model: field(''),
    runtime: { provider: null, capabilities: state.runtime!.capabilities } }
  render(<ReflexSettings {...props(initial)} />)
  expect(screen.getByLabelText('服务地址').hasAttribute('disabled')).toBe(false)
  expect(screen.getByLabelText('决策模型').hasAttribute('disabled')).toBe(false)
  expect(screen.getByText(zh.untested)).toBeTruthy()
  expect(screen.queryByText('无法读取运行状态')).toBeNull()
})

it('offers the three Reflex connection modes and hides preset connection fields', () => {
  const p = props({ ...state, mode: 'trial' })
  render(<ReflexSettings {...p} />)
  const trigger = screen.getByRole('button', { name: zh.connectionMode })
  expect(trigger.id).toBe('reflex-mode')
  expect(trigger.textContent).toBe(zh.trialMode)
  expect(screen.getByText(zh['modeHint.trial'])).toBeTruthy()
  fireEvent.click(trigger)
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([zh.trialMode, zh.customMode, zh.localMode])
  fireEvent.click(screen.getByRole('menuitem', { name: zh.customMode }))
  expect(p.selectMode).toHaveBeenCalledWith('custom')
  expect(screen.queryByRole('menuitem')).toBeNull()
  fireEvent.click(trigger)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menuitem')).toBeNull()
  expect(screen.queryByLabelText(zh.endpoint)).toBeNull()
  expect(screen.queryByLabelText(zh.apiKey)).toBeNull()
  expect(screen.queryByRole('button', { name: zh.clear })).toBeNull()
  expect(screen.queryByText(/OpenJev|Typesafe/)).toBeNull()
})

it.each(['read-only', 'saving'] as const)('locks the connection mode while %s', (reason) => {
  render(<ReflexSettings {...props({ ...state, writable: reason !== 'read-only', saving: reason === 'saving' })} />)
  expect(screen.getByRole('button', { name: zh.connectionMode }).hasAttribute('disabled')).toBe(true)
})

it('explains a missing preset credential without a duration, since no request was sent', () => {
  render(<ReflexSettings {...props({ ...state, mode: 'trial', probe: { pending: false, failed: false,
    result: { kind: 'failed', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 2, code: 'missing-credential' } } })} />)
  expect(screen.getByText(zh.trialNoCredential).textContent).toBe(zh.trialNoCredential)
  expect(screen.queryByText(new RegExp(zh.trialAuthFailed))).toBeNull()
  expect(screen.queryByText(/耗时/)).toBeNull()
})

it.each([
  ['trial', 403, zh.trialAuthFailed], ['custom', 401, zh.authFailed],
] as const)('explains a credential the %s service refused, with its duration', (mode, status, message) => {
  render(<ReflexSettings {...props({ ...state, mode, probe: { pending: false, failed: false,
    result: { kind: 'failed', stage: 'models', model: 'decision', effort: 'high', latencyMs: 41.6, code: 'http', status } } })} />)
  expect(screen.getByText(`${message} · 耗时：42 毫秒`)).toBeTruthy()
})

it('never shows a zero duration', () => {
  render(<ReflexSettings {...props({ ...state, probe: { pending: false, failed: false,
    result: { kind: 'failed', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 0.2, code: 'transport' } } })} />)
  expect(screen.getByText(zh.unavailableService).textContent).toBe(zh.unavailableService)
})

it('renders the local engine contribution as the local mode body without a form, probe, or Save', () => {
  const p = props({ ...state, mode: 'local' })
  vi.mocked(p.renderSlot).mockImplementation((key: string, _owner: object, opts?: { fallback?: ReactNode }) => key === 'settings.reflex.local'
    ? opts?.fallback : null)
  const view = render(<ReflexSettings {...p} />)
  expect(vi.mocked(p.renderSlot).mock.calls.some(([key]) => key === 'settings.reflex.local')).toBe(true)
  expect(screen.getByText(zh['modeHint.local'])).toBeTruthy()
  expect(screen.getByText(zh.localUnavailable)).toBeTruthy()
  expect(screen.queryByLabelText(zh.endpoint)).toBeNull()
  expect(screen.queryByRole('button', { name: zh.test })).toBeNull()
  expect(screen.queryByRole('button', { name: zh.save })).toBeNull()
  expect(screen.queryByText(zh.effective)).toBeNull()
  chooseMode(zh.trialMode)
  expect(p.selectMode).toHaveBeenCalledWith('trial')
  view.unmount()
  expect(p.reset).toHaveBeenCalledOnce()
})

it('renders the header, the master row, and three titled modules with one Save row and the connection status last', () => {
  const p = props({ ...state, probe: { pending: false, failed: false, result: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 10 } } })
  vi.mocked(p.renderSlot).mockImplementation((key: string) => key === 'settings.reflex.item' ? <div>continuum-row</div> : null)
  render(<ReflexSettings {...p} />)
  expect(screen.getByRole('region', { name: 'Reflex 配置' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Reflex 配置' })).toBeTruthy()
  expect(screen.getByText(zh.subtitle)).toBeTruthy()
  expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
    .toEqual([zh.serviceTitle, zh.prestepModule, zh.memoryModule])
  expect(screen.queryByText(zh.pausedByMaster)).toBeNull()
  const service = screen.getByRole('region', { name: zh.serviceTitle })
  expect(within(service).getByText('真实判断通过 · 耗时：10 毫秒')).toBeTruthy()
  expect(within(service).getAllByRole('button', { name: zh.save })).toHaveLength(1)
  expect(within(service).getAllByText(zh.effective)).toHaveLength(1)
  expect(within(screen.getByRole('region', { name: zh.memoryModule })).getByText('continuum-row')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '测试连接与真实判断' }))
  expect(p.testConnection).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('API Key').getAttribute('type')).toBe('password')
  expect(screen.getByRole('button', { name: zh.save }).hasAttribute('disabled')).toBe(true)
})

it('distinguishes pending tests, transport rejection, unavailable runtime and credential removal failure', () => {
  const p = props({ ...state, runtime: undefined, credentialFailed: true, apiKeyConfigured: false,
    probe: { pending: true, failed: false } })
  const view = render(<ReflexSettings {...p} />)
  expect(screen.getByRole('button', { name: '正在检测…' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(zh.runtimeUnavailable)).toBeTruthy()
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  expect(screen.getByText('密钥未清除，请重试')).toBeTruthy()
  expect(screen.getByText('未配置密钥')).toBeTruthy()
  view.rerender(<ReflexSettings {...props({ ...state, probe: { pending: false, failed: true } })} />)
  expect(screen.getByText('连接测试失败')).toBeTruthy()
})

it('edits and resets settings and clears a stored key', () => {
  const p = props({ ...state, dirty: true, endpoint: { ...state.endpoint, overridden: true } })
  render(<ReflexSettings {...p} />)
  expect(p.refresh).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByLabelText('服务地址'), { target: { value: 'https://updated.test' } })
  expect(p.edit).toHaveBeenCalledWith('endpoint', 'https://updated.test')
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'draft-fixture' } })
  expect(p.edit).toHaveBeenCalledWith('apiKey', 'draft-fixture')
  fireEvent.click(screen.getByRole('button', { name: '恢复部署值' }))
  expect(p.resetField).toHaveBeenCalledWith('endpoint')
  fireEvent.click(screen.getByRole('button', { name: '清除已保存的密钥' }))
  expect(p.clearCredential).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(p.save).toHaveBeenCalledOnce()
})

it('saves the pre-step switch at once and lists the installed pre-step capabilities read-only beneath it', () => {
  const p = props({ ...state, runtime: { provider: state.runtime!.provider, capabilities: [
    { id: 'entryRouting', implemented: true, enabled: false }, { id: 'skillSelection', implemented: true, enabled: true },
    { id: 'codexSupervision', implemented: true, enabled: true }, { id: 'contextMemory', implemented: false, enabled: false },
  ] } })
  const { rerender } = render(<ReflexSettings {...p} />)
  const module = screen.getByRole('region', { name: zh.prestepModule })
  expect(within(module).getByText(zh.prestepDescription)).toBeTruthy()
  fireEvent.click(within(module).getByRole('switch', { name: zh.prestepTitle }))
  expect(p.setPrestep).toHaveBeenCalledWith(false)
  const rows = within(module).getAllByRole('listitem')
  expect(rows.map(row => row.textContent)).toEqual([`${zh.skillSelection}${zh.enabled}`])
  expect(screen.queryByRole('switch', { name: zh.skillSelection })).toBeNull()
  expect(within(module).getByRole('list').dataset['active']).toBe('true')
  const current = p.useReflexCard(value => value)
  rerender(<ReflexSettings {...props({ ...current, prestep: { ...state.prestep, enabled: false, failed: true },
    runtime: { provider: state.runtime!.provider, capabilities: [{ id: 'entryRouting', implemented: true, enabled: false, suspended: true },
      { id: 'skillSelection', implemented: true, enabled: false, suspended: true }] } })} />)
  expect(within(screen.getByRole('region', { name: zh.prestepModule })).getByRole('alert').textContent).toBe(zh.switchFailed)
  expect(screen.getAllByRole('listitem').map(row => row.textContent))
    .toEqual([`${zh.skillSelection}${zh.suspendedByPrestep}`, `${zh.entryRouting}${zh.suspendedByPrestep}`])
  expect(screen.getByRole('list').dataset['active']).toBe('false')
  rerender(<ReflexSettings {...props({ ...current, prestep: { ...state.prestep, writable: false },
    runtime: { provider: state.runtime!.provider, capabilities: [{ id: 'entryRouting', implemented: true, enabled: false }] } })} />)
  expect(screen.getByRole('switch', { name: zh.prestepTitle }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('list')).toBeNull()
})

it('reports a local mode choice that was not saved under the connection mode', () => {
  render(<ReflexSettings {...props({ ...state, mode: 'local', localChoiceFailed: true })} />)
  expect(screen.getByRole('alert').textContent).toBe(zh.localChoiceFailed)
})

it('lists capabilities as following the master switch when the Host serves no pre-step switch', () => {
  render(<ReflexSettings {...props({ ...state, prestep: { ...state.prestep, available: false },
    runtime: { provider: state.runtime!.provider, capabilities: [{ id: 'skillSelection', implemented: true, enabled: true }] } })} />)
  expect(screen.queryByRole('switch', { name: zh.prestepTitle })).toBeNull()
  expect(screen.getByRole('listitem').textContent).toBe(`${zh.skillSelection}${zh.enabled}`)
})

it('pauses every module while the master switch is off and keeps the memory row out of reach', () => {
  const p = props({ ...state, enabled: false, runtime: { provider: state.runtime!.provider,
    capabilities: [{ id: 'skillSelection', implemented: true, enabled: true }] } })
  vi.mocked(p.renderSlot).mockImplementation((key: string) => key === 'settings.reflex.item' ? <div>continuum-row</div> : null)
  const { rerender } = render(<ReflexSettings {...p} />)
  expect(screen.getAllByText(zh.pausedByMaster)).toHaveLength(4)
  expect(screen.getByRole('listitem').textContent).toBe(`${zh.skillSelection}${zh.pausedByMaster}`)
  for (const name of [zh.serviceTitle, zh.prestepModule, zh.memoryModule]) {
    expect(screen.getByRole('region', { name }).dataset['paused']).toBe('true')
  }
  expect(screen.getByRole('region', { name: zh.memoryModule }).inert).toBe(true)
  expect(screen.getByRole('button', { name: zh.connectionMode }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('switch', { name: zh.prestepTitle }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByLabelText(zh.endpoint).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: zh.test }).hasAttribute('disabled')).toBe(true)
  rerender(<ReflexSettings {...p} useReflexCard={select => select({ ...state, enabled: true })} />)
  expect(screen.getByRole('region', { name: zh.memoryModule }).inert).toBe(false)
})
