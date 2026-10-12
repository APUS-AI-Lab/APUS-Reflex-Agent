// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
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
  return { ...globals, close: vi.fn(), useReflexCard: select => select(snapshot), t: makeTranslate(zh, commonZh),
    edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(),
    testConnection: vi.fn(async () => {}), clearCredential: vi.fn(async () => {}), refresh: vi.fn(async () => {}),
  }
}

it('renders the dedicated page and separates successful connectivity from missing capability', () => {
  const p = props({ ...state, probe: { pending: false, failed: false, result: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 10 } } })
  render(<ReflexSettings {...p} />)
  expect(screen.getByRole('region', { name: 'Reflex 模型配置' })).toBeTruthy()
  expect(screen.getByText(/真实判断通过/)).toBeTruthy()
  expect(screen.getByText('模块未加载')).toBeTruthy()
  expect(screen.queryByText('已启用')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '测试连接与真实判断' }))
  expect(p.testConnection).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('API Key').getAttribute('type')).toBe('password')
})

it('shows authentication failure rather than connected for a rejected key', () => {
  render(<ReflexSettings {...props({ ...state, probe: { pending: false, failed: false, result: { kind: 'failed', stage: 'models', model: 'decision', effort: 'high', latencyMs: 10, code: 'http', status: 401 } } })} />)
  expect(screen.getByText(/认证失败/)).toBeTruthy()
  expect(screen.queryByText(/真实判断通过/)).toBeNull()
})

it.each([
  ['timeout', '请求超时'], ['model-missing', '服务未提供该模型'],
  ['decision-rejected', '服务回答未通过真实判断检查'], ['transport', '服务不可用或响应无效'],
  ['missing-credential', '认证失败，请检查 API Key'],
] as const)('explains the failed connection reason %s', (code, message) => {
  render(<ReflexSettings {...props({ ...state, probe: { pending: false, failed: false,
    result: { kind: 'failed', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 12, code } } })} />)
  expect(screen.getAllByText(message, { exact: false }).length).toBeGreaterThan(0)
})

it('distinguishes pending tests, transport rejection, unavailable runtime and credential removal failure', () => {
  const p = props({ ...state, runtime: undefined, credentialFailed: true, apiKeyConfigured: false,
    probe: { pending: true, failed: false } })
  const view = render(<ReflexSettings {...p} />)
  expect(screen.getByRole('button', { name: '正在检测…' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('无法读取运行状态')).toBeTruthy()
  expect(screen.getByText('密钥未清除，请重试')).toBeTruthy()
  expect(screen.getByText('未配置密钥')).toBeTruthy()
  view.rerender(<ReflexSettings {...props({ ...state, probe: { pending: false, failed: true } })} />)
  expect(screen.getByText('连接测试失败')).toBeTruthy()
})

it('edits and resets settings, clears a stored key, and refreshes independent capability evidence', () => {
  const p = props({ ...state, dirty: true, endpoint: { ...state.endpoint, overridden: true },
    runtime: { provider: state.runtime!.provider, capabilities: [
      { id: 'entryRouting', implemented: true, enabled: true, lastOutcome: 'selected', verifiedAt: 10000,
        settings: { stallMs: 123, recoveryReassessmentMs: 30000 } },
      { id: 'contextMemory', implemented: true, enabled: false },
    ] } })
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
  fireEvent.click(screen.getByRole('button', { name: '刷新能力状态' }))
  expect(p.refresh).toHaveBeenCalledTimes(2)
  expect(screen.getByText('已启用')).toBeTruthy()
  expect(screen.getByText('未启用')).toBeTruthy()
  expect(screen.getByText('selected')).toBeTruthy()
  expect(screen.getByText(/1970-01-01T00:00:10/)).toBeTruthy()
  expect(screen.getByText('123')).toBeTruthy()
  expect(screen.getByText('30000')).toBeTruthy()
})

it.each(['read-only', 'saving', 'credential-read-only'] as const)('protects disabled controls: %s', (reason) => {
  render(<ReflexSettings {...props({ ...state, writable: reason !== 'read-only', saving: reason === 'saving',
    apiKeyWritable: reason !== 'credential-read-only' })} />)
  expect(screen.getByLabelText('API Key').hasAttribute('disabled')).toBe(true)
})

it.each([true, false])('shows Goal-relevance activation independently of fingerprint supervision (%s)', (enabled) => {
  render(<ReflexSettings {...props({ ...state, runtime: {
    provider: { id: 'system-one', endpoint: 'https://reflex.test', model: 'decision' },
    capabilities: [{ id: 'codexSupervision', implemented: true, enabled: true, semanticSupervision: { enabled } }],
  } })} />)
  expect(screen.getByText('已启用', { exact: true })).toBeTruthy()
  expect(screen.getByText(enabled ? '目标相关性判断：已启用' : '目标相关性判断：未启用')).toBeTruthy()
  expect(screen.getByText('尚无执行验收记录')).toBeTruthy()
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

it('keeps first-run configuration editable and distinguishes a draft probe from saved configuration', () => {
  const initial = { ...state, endpoint: field(''), model: field(''),
    runtime: { provider: null, capabilities: state.runtime!.capabilities } }
  const view = render(<ReflexSettings {...props(initial)} />)
  expect(screen.getByText('尚未配置决策服务；填写服务地址和模型后保存')).toBeTruthy()
  expect(screen.getByLabelText('服务地址').hasAttribute('disabled')).toBe(false)
  expect(screen.getByLabelText('决策模型').hasAttribute('disabled')).toBe(false)
  expect(screen.queryByText('无法读取运行状态')).toBeNull()
  view.rerender(<ReflexSettings {...props({ ...initial, endpoint: field('https://reflex.test'), model: field('decision'),
    probe: { pending: false, failed: false, result: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 10 } } })} />)
  expect(screen.getByText('尚未配置决策服务；填写服务地址和模型后保存')).toBeTruthy()
  expect(screen.getByText(/真实判断通过/)).toBeTruthy()
  expect(screen.queryByText('已启用')).toBeNull()
})

it('selects the decision protocol and restores its deployment value', () => {
  const p = props({ ...state, protocol: { ...state.protocol, text: 'typesafe', overridden: true } })
  render(<ReflexSettings {...p} />)
  const select = screen.getByRole('combobox', { name: zh.protocol }) as HTMLSelectElement
  expect(select.value).toBe('typesafe')
  const effort = screen.getByLabelText(zh.effort) as HTMLInputElement
  expect(effort.disabled).toBe(true)
  expect(effort.value).toBe('high')
  expect(screen.getByText(zh.effortNotApplicable)).toBeTruthy()
  fireEvent.change(select, { target: { value: 'openjev' } })
  expect(p.edit).toHaveBeenCalledWith('protocol', 'openjev')
  fireEvent.click(screen.getByRole('button', { name: zh.reset }))
  expect(p.resetField).toHaveBeenCalledWith('protocol')
})

it.each(['read-only', 'saving'] as const)('locks the protocol selector while %s', (reason) => {
  render(<ReflexSettings {...props({ ...state, writable: reason !== 'read-only', saving: reason === 'saving' })} />)
  expect(screen.getByRole('combobox', { name: zh.protocol }).hasAttribute('disabled')).toBe(true)
})

it('explains an invalid protocol with protocol-specific guidance', () => {
  render(<ReflexSettings {...props({ ...state, protocol: { ...state.protocol, text: 'invalid', invalid: true } })} />)
  expect(screen.getByText(zh.invalidProtocol)).toBeTruthy()
  expect(screen.queryByText(zh.invalidNumber)).toBeNull()
  expect(screen.getByRole('combobox', { name: zh.protocol }).getAttribute('aria-invalid')).toBe('true')
})
