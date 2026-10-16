// @vitest-environment jsdom
/** First-run DeepSeek prompt and deferred composer notice behavior over the shared Models join. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingDialogProps } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { ReadinessDeferral } from '../src/client/readiness-deferral.ts'
import { ReadinessNotice } from '../src/client/ReadinessNotice.tsx'
import type { ReadinessNoticeProps } from '../src/client/ReadinessNotice.tsx'
import { createModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

/** Credentials answers over the Remote carrier, which has no envelope. */
function remoteOk<T>(value: T) {
  return { ok: true as const, value }
}
function remoteFail(message: string) {
  return { ok: false as const, error: new RemoteError('gateway/internal', message, {}) }
}

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  reasoningEffort: Schema.union(['off', 'low', 'high', 'max']),
  defaultContextWindow: Schema.number().step(1).min(1),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  })),
})

type AttentionSnapshot = Parameters<Parameters<DeepSeekOnboardingDialogProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: DeepSeekOnboardingDialogProps['useSessionStatus'] = selector => selector(noAttention)

function deepSeekNamespace(apiKeyEnv: string | null): SettingsNamespaceView {
  const value = apiKeyEnv === null ? {} : { apiKeyEnv }
  return {
    ns: 'llm-deepseek',
    schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
    value,
    base: value,
    user: {},
    autoGenerate: true, applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function harness(options: {
  provider?: boolean
  providerSettingsNs?: string
  providerActive?: boolean
  settingsNamespace?: boolean
  apiKeyEnv?: string | null
  configured?: () => boolean
  credential?: { source?: string; writable: boolean }
  describeFailure?: string
  settingsWritable?: boolean
  providersFailure?: string
  setFailure?: string
} = {}) {
  if (document.getElementById('root') === null) {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
  }
  let fileConfigured = false
  const configured = options.configured ?? (() => fileConfigured)
  const apiKeyEnv = options.apiKeyEnv === undefined ? 'DEEPSEEK_API_KEY' : options.apiKeyEnv
  const mutate = vi.fn(() => Promise.resolve(remoteOk(deepSeekNamespace(apiKeyEnv))))
  const set = vi.fn((_ref: string, _value: string) => {
    if (options.setFailure !== undefined) return Promise.resolve(remoteFail(options.setFailure))
    fileConfigured = true
    return Promise.resolve(remoteOk(undefined))
  })
  const face = {
    llm: {
      listProviders: () => {
        if (options.providersFailure !== undefined) return Promise.resolve(remoteFail(options.providersFailure))
        return Promise.resolve(remoteOk(
          options.provider === false || options.providerActive === false
            ? []
            : [{ id: 'deepseek-official', name: 'DeepSeek' }],
        ))
      },
      listConfigurableProviders: () => Promise.resolve(remoteOk(
        options.provider === false
          ? []
          : [{
            provider: 'deepseek-official',
            displayName: 'DeepSeek',
            settingsNs: options.providerSettingsNs ?? 'llm-deepseek',
            settingsPath: [],
          }],
      )),
      discoverModels: () => Promise.resolve(remoteOk([])),
    },
    settings: {
      describe: () => Promise.resolve(remoteOk({
        writable: options.settingsWritable ?? true,
        hasDocument: false,
        namespaces: options.settingsNamespace === false ? [] : [deepSeekNamespace(apiKeyEnv)],
      })),
      mutate,
    },
    credentials: {
      describe: () => options.describeFailure === undefined
        ? Promise.resolve(remoteOk({
          DEEPSEEK_API_KEY: {
            configured: configured(),
            ...configured() && options.credential?.source !== undefined
              ? { source: options.credential.source }
              : {},
            writable: options.credential?.writable ?? true,
          },
        }))
        : Promise.resolve(remoteFail(options.describeFailure)),
      set,
    },
  }
  // The page plugin's context, scripted down to the namespaces it reaches.
  const ctx = { remote: { ...face, session: { initializeDefaultModel: async () => ({ ok: true, value: undefined }) } } } as never
  const operations = createModelsOperations(ctx)
  const controller = new ModelsSettingsStore(ctx, settingsSchema, new SettingsDescribeMirror(ctx))
  const deferral = new ReadinessDeferral()
  const openSection = vi.fn()
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: DeepSeekOnboardingDialogProps = {
    automatic: true,
    stepId: 'deepseek-official',
    complete,
    openSection,
    renderSlot: (_name, _props, options) => options?.fallback,
    useSessions: unusedHook,
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: unusedHook,
    controller,
    deferral,
    useModels: bindSnapshotSelector(controller.store),
    useDeferral: bindSnapshotSelector(deferral.store),
    operations,
    schema: settingsSchema,
    t: key => en[key],
  }
  return {
    controller, deferral, complete, openSection, props, mutate, set,
    configure: () => { fileConfigured = true },
  }
}

describe('DeepSeekOnboardingDialog', () => {
  it('renders when the shell root is absent', async () => {
    const h = harness()
    document.getElementById('root')!.remove()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
  })

  it('loads a credential-only modal, inerts the product, and focuses the key', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
    expect(document.getElementById('root')?.inert).toBe(true)
    expect(screen.getByText(en.onboardingDescription)).toBeTruthy()
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(document.activeElement).toBe(key) })
    expect(screen.queryByText(en.customized)).toBeNull()
  })

  it('cannot be dismissed implicitly and restores the previous inert state', async () => {
    const h = harness()
    const appRoot = document.getElementById('root')!
    appRoot.inert = true
    const view = render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()

    view.unmount()
    expect(appRoot.inert).toBe(true)
  })

  it('requires a non-blank key before Save and continue is available', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    const save = screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingSave })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: '   ' } })
    expect(save.disabled).toBe(true)
    expect(screen.getByText(en.keyRequired)).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
  })

  it('keeps the modal open and reports a refused credential write', async () => {
    for (const [options, message] of [
      [{ setFailure: 'credential was rejected' }, 'credential was rejected'],
    ] as const) {
      const h = harness(options)
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await screen.findByRole('dialog')
      fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-live' } })
      fireEvent.click(screen.getByRole('button', { name: en.onboardingSave }))
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingSave }).disabled).toBe(false)
      expect(h.complete).not.toHaveBeenCalled()
      expect(h.mutate).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('defers configure-later for the page load without opening settings', async () => {
    const h = harness()
    const view = render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en.onboardingLater }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.deferral.store.getSnapshot()).toEqual({ deferred: true, noticeClosed: false })
    expect(h.openSection).not.toHaveBeenCalled()
    expect(h.set).not.toHaveBeenCalled()
    expect(h.mutate).not.toHaveBeenCalled()

    // A later coordinator pass in the same page load does not prompt again.
    view.unmount()
    h.complete.mockClear()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('still opens an explicit request after the automatic prompt was deferred', async () => {
    const h = harness()
    h.deferral.defer()
    h.props.explicit = true
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingLater }))
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('does not block the product when DeepSeek setup is unavailable', async () => {
    for (const h of [
      harness({ describeFailure: 'credentials service is absent' }),
      harness({ credential: { writable: false } }),
      harness({ settingsWritable: false }),
      harness({ providersFailure: 'the provider directory is unavailable' }),
      harness({ providerActive: false }),
      harness({ settingsNamespace: false }),
      harness({ apiKeyEnv: null }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      expect(h.openSection).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('skips an absent adapter and an already-configured environment credential', async () => {
    for (const h of [
      harness({ provider: false }),
      harness({ providerSettingsNs: '' }),
      harness({ configured: () => true, credential: { source: 'env', writable: false } }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      view.unmount()
    }
  })

  it('closes when an external credential invalidation refreshes the shared join', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    h.configure()
    await act(async () => { await h.controller.load() })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(h.complete).toHaveBeenCalledOnce()
  })
})

it('lets the account seat route to the existing API key editor', async () => {
  const h = harness()
  h.props.renderSlot = (_name, owner: unknown) => <button onClick={(owner as { useApiKey: () => void }).useApiKey}>Choose API key</button>
  render(<DeepSeekOnboardingDialog {...h.props} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Choose API key' })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: 'Choose API key' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(h.complete).not.toHaveBeenCalled()
})

it('lets the account seat defer the automatic prompt to the composer notice', async () => {
  const h = harness()
  h.props.renderSlot = (_name, owner: unknown) => <button onClick={(owner as { later: () => void }).later}>Later</button>
  render(<DeepSeekOnboardingDialog {...h.props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
  await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
  expect(h.deferral.store.getSnapshot().deferred).toBe(true)
  expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
})
it('explicit account-menu setup reuses the editor without another login choice', async () => {
  const h = harness({ configured: () => true })
  h.props.explicit = true
  const choice = vi.fn()
  h.props.renderSlot = (_name, _owner, options) => { choice(); return options?.fallback }
  render(<DeepSeekOnboardingDialog {...h.props} />)
  await waitFor(() => { expect(screen.getByRole('dialog')).toBeTruthy() })
  expect(choice).not.toHaveBeenCalled()
  expect(h.complete).not.toHaveBeenCalled()
})

it('keeps explicit API key setup available when automatic onboarding is disabled', async () => {
  const h = harness()
  h.props.automatic = false
  h.props.explicit = true
  render(<DeepSeekOnboardingDialog {...h.props} />)
  await waitFor(() => { expect(screen.getByRole('dialog')).toBeTruthy() })
  expect(h.complete).not.toHaveBeenCalled()
})

describe('ReadinessNotice', () => {
  function noticeProps(h: ReturnType<typeof harness>): ReadinessNoticeProps {
    return {
      useModels: bindSnapshotSelector(h.controller.store), useDeferral: bindSnapshotSelector(h.deferral.store),
      controller: h.controller, deferral: h.deferral, operations: h.props.operations, schema: h.props.schema, t: h.props.t,
    }
  }
  function notice(h: ReturnType<typeof harness>) {
    return render(<ReadinessNotice {...noticeProps(h)} />)
  }

  it('stays hidden until the prompt is deferred and while readiness is unknown', async () => {
    const h = harness()
    const view = notice(h)
    expect(view.container.textContent).toBe('')
    h.deferral.defer()
    view.rerender(<ReadinessNotice {...noticeProps(h)} />)
    expect(view.container.textContent).toBe('')
    await act(async () => { await h.controller.load() })
    expect(screen.getByRole('status').textContent).toContain(en.readinessNotice)
  })

  it('reopens the credential editor and keeps the notice after another Configure later', async () => {
    const h = harness()
    h.deferral.defer()
    await act(async () => { await h.controller.load() })
    notice(h)
    fireEvent.click(screen.getByRole('button', { name: en.readinessConfigure }))
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingLater }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
  })

  it('disappears once the stored credential makes the official route usable', async () => {
    const h = harness()
    h.deferral.defer()
    await act(async () => { await h.controller.load() })
    notice(h)
    fireEvent.click(screen.getByRole('button', { name: en.readinessConfigure }))
    fireEvent.change(await screen.findByLabelText(en.keyInput), { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByRole('button', { name: en.onboardingSave }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
    expect(h.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-live')
  })

  it('closes for the rest of the page load', async () => {
    const h = harness()
    h.deferral.defer()
    await act(async () => { await h.controller.load() })
    const view = notice(h)
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(h.deferral.store.getSnapshot()).toEqual({ deferred: true, noticeClosed: true })
    expect(view.container.textContent).toBe('')
    h.deferral.closeNotice()
    h.deferral.defer()
    expect(h.deferral.store.getSnapshot()).toEqual({ deferred: true, noticeClosed: true })
  })
})
