import { describe, expect, it, vi } from 'vitest'
import type { ReflexStatus } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ReflexCardController, REFLEX_TRIAL, type PrestepSettings, type ReflexSettings } from '../src/client/reflex-settings-controller.ts'

function fixture(configured = true, protocol?: ReflexSettings['protocol']) {
  const host = stubConfigForm<ReflexSettings>()
  host.publish({ status: 'ready', writable: true, value: { endpoint: 'https://reflex.test', model: 'decision', effort: 'high', timeoutMs: 1000, apiKeyEnv: 'REFLEX_API_KEY', ...(protocol === undefined ? {} : { protocol }) }, user: {} })
  const credentials = {
    describe: vi.fn(async () => ({ ok: true, value: { REFLEX_API_KEY: { configured, writable: true } } })),
    set: vi.fn(async () => ({ ok: true, value: undefined })), unset: vi.fn(async () => ({ ok: true, value: undefined })),
  }
  const reflex = {
    testConnection: vi.fn(async (_input: object, _signal?: AbortSignal) => ({ ok: true, value: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 4 } })),
    readStatus: vi.fn(async (): Promise<{ ok: boolean; value: ReflexStatus }> => ({ ok: true, value: { provider: { id: 'system-one', model: 'decision', endpoint: 'https://reflex.test' }, capabilities: [{ id: 'codexSupervision', implemented: false, enabled: false }] } })),
  }
  const prestep = stubConfigForm<PrestepSettings>()
  const controller = new ReflexCardController(host.scope, { remote: { credentials, reflex } } as never, prestep.scope)
  const face = controller.inject()
  return { host, prestep, credentials, reflex, controller, face, state: () => face.hooks.reflexCard.getSnapshot() }
}

describe('Reflex dedicated settings controller', () => {
  it('probes unsaved settings and a transient key without writing either store', async () => {
    const f = fixture()
    try {
      f.face.edit('endpoint', 'https://candidate.test')
      f.face.edit('apiKey', 'transient-secret')
      await f.face.testConnection()
      expect(f.reflex.testConnection).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://candidate.test', apiKey: 'transient-secret' }), expect.any(AbortSignal))
      expect(f.host.mutate).not.toHaveBeenCalled()
      expect(f.credentials.set).not.toHaveBeenCalled()
      expect(f.state().probe.result?.kind).toBe('ok')
      f.face.edit('model', 'different')
      expect(f.state().probe.result).toBeUndefined()
    } finally { f.controller.dispose() }
  })

  it('saves the Reflex switch at once without the staged connection draft, and reports a refused write', async () => {
    const f = fixture()
    try {
      expect(f.state().enabled).toBe(true)
      f.face.edit('model', 'staged-model')
      const pending = f.face.setEnabled(false)
      expect(f.state().toggling).toBe(true)
      await pending
      expect(f.host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enabled'], value: false }], undefined)
      expect(f.state()).toMatchObject({ toggling: false, toggleFailed: false, dirty: true })
      f.host.publish({ status: 'ready', writable: true, value: { endpoint: 'https://reflex.test', model: 'decision', enabled: false }, user: { enabled: false } })
      expect(f.state().enabled).toBe(false)
      f.host.mutate.mockResolvedValueOnce(false)
      await f.face.setEnabled(true)
      expect(f.state()).toMatchObject({ enabled: false, toggleFailed: true })
      f.host.publish({ status: 'ready', writable: false, value: { enabled: false }, user: {} })
      f.host.mutate.mockClear()
      await f.face.setEnabled(true)
      expect(f.host.mutate).not.toHaveBeenCalled()
    } finally { f.controller.dispose() }
  })

  it('keeps capability state independent from a successful connection probe', async () => {
    const f = fixture()
    try {
      await f.face.refresh()
      await f.face.testConnection()
      expect(f.state().runtime?.capabilities).toEqual([{ id: 'codexSupervision', implemented: false, enabled: false }])
    } finally { f.controller.dispose() }
  })

  it.each(['endpoint', 'model'])('drops a probe response after the user changes %s', async (field) => {
    const f = fixture()
    try {
      const deferred = Promise.withResolvers<Awaited<ReturnType<typeof f.reflex.testConnection>>>()
      f.reflex.testConnection.mockReturnValueOnce(deferred.promise)
      const pending = f.face.testConnection()
      const signal = f.reflex.testConnection.mock.calls[0]?.[1]
      f.face.edit(field, field === 'model' ? 'different-model' : 'https://new.test')
      expect(signal?.aborted).toBe(true)
      deferred.resolve({ ok: true, value: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 4 } })
      await pending
      expect(f.state().probe.result).toBeUndefined()
    } finally { f.controller.dispose() }
  })

  it.each([['protocol', 'invalid'], ['protocol', 'typesafe'], ['effort', 'invalid'], ['endpoint', 'https://key:secret@host'], ['endpoint', 'ftp://reflex.test'], ['timeoutMs', '-1']])('blocks invalid %s before calling the Host', async (field, value) => {
    const f = fixture()
    try {
      f.face.edit(field, value)
      await f.face.testConnection()
      expect(f.state().invalid).toBe(true)
      expect(f.reflex.testConnection).not.toHaveBeenCalled()
    } finally { f.controller.dispose() }
  })

  it('refuses replacing an existing reference and retains the draft', async () => {
    const f = fixture()
    try {
      f.credentials.set.mockResolvedValueOnce({ ok: false, value: undefined })
      f.face.edit('apiKey', 'new-secret')
      f.face.save()
      await vi.waitFor(() =>{  expect(f.state().failed).toBe(true) })
      expect(f.state().apiKey.text).toBe('new-secret')
      expect(f.host.mutate).not.toHaveBeenCalled()
      expect(f.credentials.set).not.toHaveBeenCalled()
      expect(f.state().credentialSaveError).toBe('configured')
      f.face.discard()
      expect(f.state().apiKey.text).toBe('')
    } finally { f.controller.dispose() }
  })

  it('keeps an acknowledged credential save successful when the status refresh fails', async () => {
    const f = fixture(false)
    try {
      await f.face.refresh()
      f.credentials.set.mockImplementationOnce(async () => {
        f.credentials.describe.mockRejectedValueOnce(new Error('status unavailable'))
        return { ok: true, value: undefined }
      })
      f.face.edit('apiKey', 'replacement')
      f.face.save()
      await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
      expect(f.state().failed).toBe(false)
      expect(f.credentials.set).toHaveBeenCalledTimes(1)
      expect(f.state().apiKey.text).toBe('')
    } finally { f.controller.dispose() }
  })

  it('uses the managed reference when saving a key with an empty reference', async () => {
    const f = fixture(false)
    try {
      f.face.edit('apiKey', 'replacement')
      f.face.edit('apiKeyEnv', '')
      f.face.save()
      await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
      expect(f.credentials.set).toHaveBeenCalledWith('REFLEX_CUSTOM_API_KEY', 'replacement')
    } finally { f.controller.dispose() }
  })

  it('reports a refused clear and does not expose keys in runtime state', async () => {
    const f = fixture()
    try {
      await vi.waitFor(() =>{  expect(f.state().apiKeyConfigured).toBe(true) })
      f.credentials.unset.mockResolvedValueOnce({ ok: false, value: undefined })
      await f.face.clearCredential()
      expect(f.state().credentialFailed).toBe(true)
      expect(f.state().apiKeyConfigured).toBe(true)
    } finally { f.controller.dispose() }
  })
})

it('saves a replacement key through Credentials and clears it through the current reference', async () => {
  const f = fixture(false)
  try {
    f.face.edit('apiKey', 'new-secret')
    f.face.save()
    await vi.waitFor(() => { expect(f.credentials.set).toHaveBeenCalledWith('REFLEX_API_KEY', 'new-secret') })
    await vi.waitFor(() => { expect(f.state().apiKey.text).toBe('') })
    await f.face.clearCredential()
    expect(f.credentials.unset).toHaveBeenCalledWith('REFLEX_API_KEY')
    expect(f.state().credentialFailed).toBe(false)
  } finally { f.controller.dispose() }
})

it('keeps environment credentials read-only and refreshes only the matching reference', async () => {
  const f = fixture()
  try {
    f.credentials.describe.mockResolvedValue({ ok: true, value: { REFLEX_API_KEY: { configured: true, writable: false } } })
    await f.face.refresh()
    expect(f.state().apiKeyWritable).toBe(false)
    await f.face.clearCredential()
    expect(f.credentials.unset).not.toHaveBeenCalled()
    f.credentials.describe.mockClear()
    f.controller.refreshCredential('UNRELATED')
    expect(f.credentials.describe).not.toHaveBeenCalled()
    f.controller.refreshCredential('REFLEX_API_KEY')
    await vi.waitFor(() => { expect(f.credentials.describe).toHaveBeenCalledTimes(1) })
  } finally { f.controller.dispose() }
})

it('drops stale credential reads after changing references', async () => {
  const f = fixture()
  try {
    await f.face.refresh()
    const held = Promise.withResolvers<Awaited<ReturnType<typeof f.credentials.describe>>>()
    f.credentials.describe.mockReturnValueOnce(held.promise)
    f.controller.refreshCredential('REFLEX_API_KEY')
    f.face.edit('apiKeyEnv', 'OTHER_KEY')
    await vi.waitFor(() => { expect(f.state().apiKeyConfigured).toBe(false) })
    held.resolve({ ok: true, value: { REFLEX_API_KEY: { configured: true, writable: false } } })
    await held.promise
    expect(f.state().apiKeyConfigured).toBe(false)
    expect(f.state().apiKeyWritable).toBe(true)
    f.face.resetField('apiKeyEnv')
    await vi.waitFor(() => { expect(f.credentials.describe).toHaveBeenLastCalledWith(['REFLEX_CUSTOM_API_KEY']) })
    expect(f.state().apiKeyConfigured).toBe(false)
  } finally { f.controller.dispose() }
})

it('shows RPC failures and prevents duplicate probes while one is pending', async () => {
  const f = fixture()
  try {
    f.reflex.testConnection.mockRejectedValueOnce(new Error('offline'))
    await f.face.testConnection()
    expect(f.state().probe).toEqual({ pending: false, failed: true })
    f.reflex.testConnection.mockResolvedValueOnce({ ok: false, value: { kind: 'failed', stage: 'health', model: '', effort: 'high', latencyMs: 0 } })
    await f.face.testConnection()
    expect(f.state().probe.failed).toBe(true)
    const held = Promise.withResolvers<Awaited<ReturnType<typeof f.reflex.testConnection>>>()
    f.reflex.testConnection.mockReturnValueOnce(held.promise)
    const pending = f.face.testConnection()
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenCalledTimes(3)
    f.controller.dispose()
    held.reject(new Error('cancelled'))
    await pending
  } finally { f.controller.dispose() }
})

it('rejects malformed URLs and clears unavailable runtime observations', async () => {
  const f = fixture()
  try {
    await f.face.refresh()
    f.reflex.readStatus.mockResolvedValueOnce({ ok: false, value: { provider: { id: '', model: '', endpoint: '' }, capabilities: [] } })
    await f.face.refresh()
    expect(f.state().runtime).toBeUndefined()
    f.face.edit('endpoint', 'not a URL')
    await f.face.testConnection()
    expect(f.reflex.testConnection).not.toHaveBeenCalled()
  } finally { f.controller.dispose() }
})

it('invalidates probes after Host settings change and assigns the first managed key reference', async () => {
  const f = fixture(false)
  try {
    await f.face.testConnection()
    f.host.publish({ status: 'ready', writable: true, value: { endpoint: 'http://localhost', model: 'decision',
      effort: 'low', timeoutMs: 1000, protocol: 'openjev' }, user: {} })
    expect(f.state().probe.result).toBeUndefined()
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ protocol: 'openjev' }), expect.any(AbortSignal))
    f.face.edit('timeoutMs', '2147483648')
    expect(f.state().invalid).toBe(true)
    f.face.edit('timeoutMs', '2000')
    expect(f.state().invalid).toBe(false)
    f.face.edit('apiKey', 'first-secret')
    expect(f.state().apiKeyEnv.text).toBe('REFLEX_CUSTOM_API_KEY')
    f.face.save()
    await vi.waitFor(() => { expect(f.credentials.set).toHaveBeenCalledWith('REFLEX_CUSTOM_API_KEY', 'first-secret') })
  } finally { f.controller.dispose() }
})

it('ignores pending runtime and credential deletion results after disposal', async () => {
  const f = fixture()
  await f.face.refresh()
  const status = Promise.withResolvers<Awaited<ReturnType<typeof f.reflex.readStatus>>>()
  const clear = Promise.withResolvers<Awaited<ReturnType<typeof f.credentials.unset>>>()
  f.reflex.readStatus.mockReturnValueOnce(status.promise)
  f.credentials.unset.mockReturnValueOnce(clear.promise)
  const refreshing = f.face.refresh()
  const clearing = f.face.clearCredential()
  f.controller.dispose()
  status.resolve({ ok: false, value: { provider: { id: '', model: '', endpoint: '' }, capabilities: [] } })
  clear.resolve({ ok: false, value: undefined })
  await Promise.all([refreshing, clearing])
  expect(f.state().runtime?.provider?.model).toBe('decision')
  expect(f.state().credentialFailed).toBe(false)
})

it('does not start a second save while credential acknowledgement is pending', async () => {
  const f = fixture(false)
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.credentials.set>>>()
  try {
    f.credentials.set.mockReturnValueOnce(pending.promise)
    f.face.edit('apiKey', 'new-secret')
    f.face.save()
    f.face.save()
    await vi.waitFor(() => { expect(f.credentials.set).toHaveBeenCalledOnce() })
  } finally {
    pending.resolve({ ok: true, value: undefined })
    await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
    f.controller.dispose()
  }
})

it('retains drafts when a profile without a user layer rejects its first configuration write', async () => {
  const f = fixture()
  try {
    f.host.publish({ user: undefined })
    f.host.mutate.mockResolvedValueOnce(false)
    f.face.edit('endpoint', 'https://candidate.test')
    f.face.save()
    await vi.waitFor(() => { expect(f.state().failed).toBe(true) })
    expect(f.state().endpoint.text).toBe('https://candidate.test')
    expect(f.credentials.set).not.toHaveBeenCalled()
  } finally { f.controller.dispose() }
})


it('rejects a reused reference before changing the endpoint or writing its new key', async () => {
  const f = fixture()
  try {
    f.face.edit('endpoint', 'https://other-service.test')
    f.face.edit('apiKey', 'other-service-secret')
    f.face.save()
    await vi.waitFor(() => { expect(f.state().credentialSaveError).toBe('configured') })
    expect(f.host.mutate).not.toHaveBeenCalled()
    expect(f.credentials.set).not.toHaveBeenCalled()
    expect(f.state().endpoint.text).toBe('https://other-service.test')
    expect(f.state().apiKey.text).toBe('other-service-secret')
    f.face.edit('apiKeyEnv', 'OTHER_SERVICE_KEY')
    expect(f.state().credentialSaveError).toBeUndefined()
    f.face.save()
    await vi.waitFor(() => { expect(f.credentials.set).toHaveBeenCalledWith('OTHER_SERVICE_KEY', 'other-service-secret') })
    expect(f.credentials.set).toHaveBeenCalledOnce()
  } finally { f.controller.dispose() }
})

it.each(['throws', 'refused'])('keeps both stores unchanged when credential preflight %s', async (failure) => {
  const f = fixture(false)
  try {
    await f.face.refresh()
    if (failure === 'throws') f.credentials.describe.mockRejectedValueOnce(new Error('offline'))
    else f.credentials.describe.mockResolvedValueOnce({ ok: false, value: { REFLEX_API_KEY: { configured: false, writable: false } } })
    f.face.edit('endpoint', 'https://other-service.test')
    f.face.edit('apiKey', 'new-key')
    f.face.save()
    await vi.waitFor(() => { expect(f.state().credentialSaveError).toBe('unavailable') })
    expect(f.host.mutate).not.toHaveBeenCalled()
    expect(f.credentials.set).not.toHaveBeenCalled()
    expect(f.state().apiKey.text).toBe('new-key')
  } finally { f.controller.dispose() }
})

it.each([false, true])('owns one credential preflight and prevents late writes after disposal=%s', async (dispose) => {
  const f = fixture(false)
  await f.face.refresh()
  const held = Promise.withResolvers<Awaited<ReturnType<typeof f.credentials.describe>>>()
  f.credentials.describe.mockReturnValueOnce(held.promise)
  const before = f.credentials.describe.mock.calls.length
  f.face.edit('apiKey', 'new-key')
  f.face.save()
  f.face.save()
  expect(f.state().saving).toBe(true)
  expect(f.credentials.describe.mock.calls.length - before).toBe(1)
  f.face.edit('apiKeyEnv', 'CHANGED_WHILE_CHECKING')
  f.face.resetField('apiKeyEnv')
  f.face.discard()
  expect(f.state().apiKeyEnv.text).toBe('REFLEX_API_KEY')
  expect(f.state().apiKey.text).toBe('new-key')
  if (dispose) f.controller.dispose()
  held.resolve({ ok: true, value: { REFLEX_API_KEY: { configured: false, writable: true } } })
  await held.promise
  if (dispose) {
    expect(f.host.mutate).not.toHaveBeenCalled()
    expect(f.credentials.set).not.toHaveBeenCalled()
  } else {
    await vi.waitFor(() => { expect(f.credentials.set).toHaveBeenCalledOnce() })
    f.controller.dispose()
  }
})

it('refreshes unconfigured runtime status after saving the first connection', async () => {
  const f = fixture(false)
  try {
    f.reflex.readStatus.mockResolvedValueOnce({ ok: true, value: { provider: null, capabilities: [] } })
    await f.face.refresh()
    expect(f.state().runtime?.provider).toBeNull()
    f.face.edit('endpoint', 'https://first.test')
    f.face.save()
    await vi.waitFor(() => { expect(f.state().runtime?.provider?.model).toBe('decision') })
    expect(f.state().failed).toBe(false)
    f.reflex.readStatus.mockRejectedValueOnce(new Error('status transport unavailable'))
    f.face.edit('endpoint', 'https://next.test')
    f.face.save()
    await vi.waitFor(() => { expect(f.state().runtime).toBeUndefined() })
    expect(f.state().failed).toBe(false)
  } finally { f.controller.dispose() }
})

it('stages a legacy protocol as Reflex and probes it before explicitly saving the migration', async () => {
  const f = fixture(true, 'typesafe')
  try {
    expect(f.state().mode).toBe('custom')
    expect(f.state().protocol.text).toBe('openjev')
    expect(f.state().invalid).toBe(false)
    expect(f.host.scope.getSnapshot().value?.protocol).toBe('typesafe')
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'openjev' }), expect.any(AbortSignal))
    expect(f.host.mutate).not.toHaveBeenCalled()
    f.face.save()
    await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
    expect(f.host.mutate).toHaveBeenCalledWith(expect.arrayContaining([{ op: 'set', path: ['protocol'], value: 'openjev' }]), undefined)
  } finally { f.controller.dispose() }
})


it('stages the preset without sharing either custom secrets or its credential reference', async () => {
  const f = fixture()
  try {
    f.face.edit('endpoint', 'https://my-custom.test')
    f.face.edit('apiKey', 'custom-draft-secret')
    f.face.selectMode('trial')
    expect(f.state().mode).toBe('trial')
    expect(f.state().endpoint.text).toBe(REFLEX_TRIAL.endpoint)
    expect(f.state().apiKey.text).toBe('')
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ ...REFLEX_TRIAL, protocol: 'openjev' }), expect.any(AbortSignal))
    expect(f.reflex.testConnection.mock.calls.at(-1)?.[0]).not.toHaveProperty('apiKey')
    f.face.edit('endpoint', 'https://attacker.test')
    expect(f.state().endpoint.text).toBe(REFLEX_TRIAL.endpoint)
    await f.face.clearCredential()
    expect(f.credentials.unset).not.toHaveBeenCalled()
    f.face.selectMode('custom')
    expect(f.state().endpoint.text).toBe('https://my-custom.test')
    expect(f.state().apiKeyEnv.text).toBe('REFLEX_API_KEY')
    expect(f.state().apiKey.text).toBe('')
    f.face.edit('apiKeyEnv', REFLEX_TRIAL.apiKeyEnv)
    expect(f.state().apiKeyEnv.text).toBe('REFLEX_API_KEY')
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint: 'https://my-custom.test', apiKeyEnv: 'REFLEX_API_KEY' }), expect.any(AbortSignal))
    f.face.selectMode('trial')
    f.face.discard()
    expect(f.state().mode).toBe('custom')
    expect(f.state().endpoint.text).toBe('https://reflex.test')
    expect(f.state().dirty).toBe(false)
    expect(f.host.mutate).not.toHaveBeenCalled()
  } finally { f.controller.dispose() }
})


it('cancels a pending custom probe when selecting the preset and discards its late answer', async () => {
  const f = fixture()
  try {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.reflex.testConnection>>>()
    f.reflex.testConnection.mockReturnValueOnce(pending.promise)
    const probe = f.face.testConnection()
    const signal = f.reflex.testConnection.mock.calls[0]?.[1]
    f.face.selectMode('trial')
    expect(signal?.aborted).toBe(true)
    pending.resolve({ ok: true, value: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 4 } })
    await probe
    expect(f.state().probe.result).toBeUndefined()
    expect(f.state().mode).toBe('trial')
  } finally { f.controller.dispose() }
})

it('does not probe a changed Host endpoint with the trial credential', async () => {
  const f = fixture()
  try {
    f.host.publish({ status: 'ready', writable: true, value: { ...REFLEX_TRIAL, effort: 'high', timeoutMs: 1000 }, user: {} })
    expect(f.state().mode).toBe('trial')
    f.host.publish({ status: 'ready', writable: true, value: { ...REFLEX_TRIAL, endpoint: 'https://changed.test', effort: 'high', timeoutMs: 1000 }, user: {} })
    expect(f.state().mode).toBe('custom')
    f.face.discard()
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint: 'https://changed.test', apiKeyEnv: 'REFLEX_CUSTOM_API_KEY' }), expect.any(AbortSignal))
    f.face.edit('model', 'updated-model')
    f.face.save()
    await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
    expect(f.host.mutate).toHaveBeenLastCalledWith(expect.arrayContaining([{ op: 'set', path: ['apiKeyEnv'], value: 'REFLEX_CUSTOM_API_KEY' }]), undefined)
  } finally { f.controller.dispose() }
})

it('reads local mode from the saved default provider and leaves it only by saving the built-in provider', async () => {
  const f = fixture()
  try {
    f.host.publish({ status: 'ready', writable: true, value: { endpoint: 'https://reflex.test', model: 'decision', effort: 'high',
      timeoutMs: 1000, apiKeyEnv: 'REFLEX_API_KEY', defaultProviderId: 'reflex-local' }, user: { defaultProviderId: 'reflex-local' } })
    expect(f.state().mode).toBe('local')
    f.face.edit('endpoint', 'https://ignored.test')
    f.face.resetField('endpoint')
    await f.face.clearCredential()
    expect(f.state()).toMatchObject({ dirty: false, endpoint: { text: 'https://reflex.test' } })
    expect(f.credentials.unset).not.toHaveBeenCalled()
    f.face.selectMode('custom')
    expect(f.state()).toMatchObject({ mode: 'custom', dirty: true, endpoint: { text: 'https://reflex.test' } })
    f.face.save()
    await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
    expect(f.host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['defaultProviderId'], value: 'system-one' }], undefined)
  } finally { f.controller.dispose() }
})

/** A local engine's connection-mode facts whose choice the test sets. */
function localMode(chosen: boolean | null = null) {
  const store = createSnapshotStore<boolean | null>(chosen)
  return { chosen: store, choose: vi.fn(async () => {}) }
}

it('keeps local mode chosen on the engine across turning it off and reopening, and ignores it once a cloud mode is saved', () => {
  const f = fixture()
  try {
    const mode = localMode(true)
    const detach = f.controller.attachLocalMode(mode)
    expect(f.state().mode).toBe('local')
    f.host.publish({ value: { endpoint: 'https://reflex.test', model: 'decision', defaultProviderId: 'reflex-local' } })
    expect(f.state().mode).toBe('local')
    // 停用 removes the provider; the engine keeps the choice, so a reopened page still shows local mode.
    f.host.publish({ value: { endpoint: 'https://reflex.test', model: 'decision' } })
    f.face.reset()
    expect(f.state().mode).toBe('local')
    f.host.publish({ value: { endpoint: 'https://reflex.test', model: 'decision', defaultProviderId: 'system-one' } })
    f.face.reset()
    expect(f.state().mode).toBe('custom')
    f.host.publish({ value: { endpoint: 'https://reflex.test', model: 'decision' } })
    detach()
    f.face.reset()
    expect(f.state().mode).toBe('custom')
  } finally { f.controller.dispose() }
})

it('replaces the preset staged on first load with a local choice the engine reports later, but never user edits', () => {
  const host = stubConfigForm<ReflexSettings>()
  host.publish({ status: 'ready', writable: true, value: {}, user: {} })
  const remote = { credentials: { describe: vi.fn(async () => ({ ok: true, value: {} })) }, reflex: {} }
  const controller = new ReflexCardController(host.scope, { remote } as never, stubConfigForm<PrestepSettings>().scope)
  try {
    const face = controller.inject(), state = () => face.hooks.reflexCard.getSnapshot()
    expect(state()).toMatchObject({ mode: 'trial', dirty: true })
    const mode = localMode()
    controller.attachLocalMode(mode)
    expect(state().mode).toBe('trial')
    mode.chosen.set(true)
    expect(state()).toMatchObject({ mode: 'local', dirty: false })
    face.selectMode('custom')
    face.edit('endpoint', 'https://mine.test')
    mode.chosen.set(false)
    mode.chosen.set(true)
    expect(state()).toMatchObject({ mode: 'custom', dirty: true })
  } finally { controller.dispose() }
})

it('waits for the first settings snapshot before following a reported local choice', () => {
  const host = stubConfigForm<ReflexSettings>()
  const remote = { credentials: { describe: vi.fn(async () => ({ ok: true, value: {} })) }, reflex: {} }
  const controller = new ReflexCardController(host.scope, { remote } as never, stubConfigForm<PrestepSettings>().scope)
  try {
    controller.attachLocalMode(localMode(true))
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    expect(controller.inject().hooks.reflexCard.getSnapshot()).toMatchObject({ mode: 'local', dirty: false })
  } finally { controller.dispose() }
})

it('commits a local mode pick through the engine and reports a choice the engine did not persist', async () => {
  const f = fixture()
  try {
    f.face.selectMode('local')
    expect(f.state().mode).toBe('local')
    const mode = localMode(false)
    f.controller.attachLocalMode(mode)
    f.face.selectMode('trial')
    f.face.selectMode('local')
    await vi.waitFor(() => { expect(mode.choose).toHaveBeenCalledOnce() })
    expect(f.state().localChoiceFailed).toBe(false)
    mode.choose.mockRejectedValueOnce(new Error('offline'))
    f.face.selectMode('trial')
    f.face.selectMode('local')
    await vi.waitFor(() => { expect(f.state().localChoiceFailed).toBe(true) })
    f.face.selectMode('trial')
    expect(f.state()).toMatchObject({ localChoiceFailed: false, mode: 'trial' })
  } finally { f.controller.dispose() }
})

it('stops reporting a local choice the engine settles after disposal', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<undefined>()
  const mode = { ...localMode(false), choose: vi.fn(async () => { await pending.promise }) }
  f.controller.attachLocalMode(mode)
  f.face.selectMode('local')
  f.controller.dispose()
  pending.resolve(undefined)
  await pending.promise
  expect(f.state().mode).toBe('local')
})

it('reads capabilities again after a saved pre-step change only', async () => {
  const f = fixture()
  try {
    f.prestep.publish({ status: 'ready', writable: true, value: {}, user: {} })
    f.reflex.readStatus.mockClear()
    await f.face.setPrestep(false)
    expect(f.reflex.readStatus).toHaveBeenCalledOnce()
    f.prestep.mutate.mockResolvedValueOnce(false)
    await f.face.setPrestep(true)
    expect(f.reflex.readStatus).toHaveBeenCalledOnce()
  } finally { f.controller.dispose() }
})

it('discards staged connection edits when choosing local mode and keeps the custom draft for a return', () => {
  const f = fixture()
  try {
    f.face.edit('endpoint', 'https://my-custom.test')
    f.face.selectMode('local')
    expect(f.state()).toMatchObject({ mode: 'local', dirty: false, endpoint: { text: 'https://reflex.test' } })
    f.face.selectMode('trial')
    expect(f.state()).toMatchObject({ mode: 'trial', endpoint: { text: REFLEX_TRIAL.endpoint } })
    f.face.selectMode('local')
    f.face.selectMode('custom')
    expect(f.state()).toMatchObject({ mode: 'custom', endpoint: { text: 'https://my-custom.test' } })
    expect(f.host.mutate).not.toHaveBeenCalled()
  } finally { f.controller.dispose() }
})

it('stays in a chosen local mode when the Host publishes a change such as the master switch', async () => {
  const f = fixture()
  try {
    f.face.selectMode('local')
    await f.face.setEnabled(false)
    f.host.publish({ value: { endpoint: 'https://reflex.test', model: 'decision', enabled: false }, user: { enabled: false } })
    expect(f.state()).toMatchObject({ mode: 'local', enabled: false })
    f.face.reset()
    expect(f.state().mode).toBe('custom')
  } finally { f.controller.dispose() }
})

it('keeps a saved local mode without a connection instead of staging the preset', () => {
  const host = stubConfigForm<ReflexSettings>()
  host.publish({ status: 'ready', writable: true, value: { defaultProviderId: 'reflex-local' }, user: {} })
  const remote = { credentials: { describe: vi.fn(async () => ({ ok: true, value: {} })) }, reflex: {} }
  const controller = new ReflexCardController(host.scope, { remote } as never, stubConfigForm<PrestepSettings>().scope)
  try {
    expect(controller.inject().hooks.reflexCard.getSnapshot()).toMatchObject({ mode: 'local', dirty: false })
  } finally { controller.dispose() }
})

it('saves the pre-step switch at once once its Host section is served, and reports a refused or rejected write', async () => {
  const f = fixture()
  try {
    expect(f.state().prestep).toEqual({ available: false, writable: false, enabled: true, toggling: false, failed: false })
    await f.face.setPrestep(false)
    expect(f.prestep.mutate).not.toHaveBeenCalled()
    f.prestep.publish({ status: 'ready', writable: true, value: {}, user: {}, revision: 3 })
    expect(f.state().prestep).toMatchObject({ available: true, writable: true, enabled: true })
    f.face.edit('model', 'staged-model')
    const pending = f.face.setPrestep(false)
    expect(f.state().prestep.toggling).toBe(true)
    await pending
    expect(f.prestep.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['frontLoadedDecisions'], value: false }], 3)
    expect(f.host.mutate).not.toHaveBeenCalled()
    f.prestep.publish({ value: { frontLoadedDecisions: false }, user: { frontLoadedDecisions: false } })
    expect(f.state().prestep).toMatchObject({ enabled: false, toggling: false, failed: false })
    f.prestep.mutate.mockResolvedValueOnce(false)
    await f.face.setPrestep(true)
    expect(f.state().prestep.failed).toBe(true)
    f.prestep.mutate.mockRejectedValueOnce(new Error('offline'))
    await f.face.setPrestep(true)
    expect(f.state().prestep).toMatchObject({ enabled: false, failed: true, toggling: false })
  } finally { f.controller.dispose() }
  expect(f.prestep.listenerCount()).toBe(0)
})

it('moves a custom preset endpoint off the shared reference and reports a rejected switch write', async () => {
  const f = fixture()
  try {
    f.face.edit('endpoint', REFLEX_TRIAL.endpoint)
    expect(f.state().apiKeyEnv.text).toBe('REFLEX_API_KEY')
    f.face.edit('endpoint', 'https://another.test')
    expect(f.state().apiKeyEnv.text).toBe('REFLEX_CUSTOM_API_KEY')
    f.host.mutate.mockRejectedValueOnce(new Error('offline'))
    await f.face.setEnabled(false)
    expect(f.state()).toMatchObject({ toggling: false, toggleFailed: true })
  } finally { f.controller.dispose() }
})

it('moves a saved custom connection off the preset reference on load and after a reset', () => {
  const f = fixture()
  try {
    f.host.publish({ status: 'ready', writable: true, value: { endpoint: 'https://reflex.test', model: 'decision', apiKeyEnv: REFLEX_TRIAL.apiKeyEnv },
      user: {}, base: { apiKeyEnv: REFLEX_TRIAL.apiKeyEnv } })
    const late = new ReflexCardController(f.host.scope, { remote: { credentials: f.credentials, reflex: f.reflex } } as never,
      stubConfigForm<PrestepSettings>().scope)
    try {
      const face = late.inject(), state = () => face.hooks.reflexCard.getSnapshot()
      expect(state().apiKeyEnv.text).toBe('REFLEX_CUSTOM_API_KEY')
      face.resetField('apiKeyEnv')
      expect(state().apiKeyEnv.text).toBe('REFLEX_CUSTOM_API_KEY')
    } finally { late.dispose() }
  } finally { f.controller.dispose() }
})

it('stages nothing for a read-only scope or a repeated mode choice', () => {
  const host = stubConfigForm<ReflexSettings>()
  host.publish({ status: 'ready', writable: false, value: {}, user: {} })
  const remote = { credentials: { describe: vi.fn(async () => ({ ok: true, value: {} })) }, reflex: {} }
  const controller = new ReflexCardController(host.scope, { remote } as never, stubConfigForm<PrestepSettings>().scope)
  try {
    const face = controller.inject()
    face.selectMode('custom')
    expect(face.hooks.reflexCard.getSnapshot()).toMatchObject({ mode: 'custom', dirty: false })
  } finally { controller.dispose() }
})

it('moves a custom draft that copied the preset connection onto the custom reference', () => {
  const f = fixture()
  try {
    f.face.edit('endpoint', REFLEX_TRIAL.endpoint)
    f.face.edit('model', REFLEX_TRIAL.model)
    f.face.selectMode('trial')
    f.face.selectMode('custom')
    expect(f.state()).toMatchObject({ endpoint: { text: REFLEX_TRIAL.endpoint }, apiKeyEnv: { text: 'REFLEX_CUSTOM_API_KEY' } })
  } finally { f.controller.dispose() }
})

it('stops after disposal during a switch write or a save preflight', async () => {
  const f = fixture(false)
  const write = Promise.withResolvers<boolean>()
  f.host.mutate.mockReturnValueOnce(write.promise)
  const toggling = f.face.setEnabled(false)
  const check = Promise.withResolvers<{ ok: boolean; value: { REFLEX_API_KEY: { configured: boolean; writable: boolean } } }>()
  f.credentials.describe.mockReturnValueOnce(check.promise)
  f.face.edit('apiKey', 'secret')
  f.face.save()
  f.controller.dispose()
  write.resolve(true); check.resolve({ ok: true, value: { REFLEX_API_KEY: { configured: false, writable: true } } })
  await toggling
  await vi.waitFor(() => { expect(f.credentials.describe).toHaveBeenCalled() })
  expect(f.credentials.set).not.toHaveBeenCalled()
})

it('reports a refused credential-only save without compensating unchanged settings', async () => {
  const f = fixture(false)
  try {
    f.credentials.set.mockResolvedValueOnce({ ok: false, value: undefined })
    f.face.edit('apiKey', 'secret')
    f.face.save()
    await vi.waitFor(() => { expect(f.credentials.set).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
    expect(f.state()).toMatchObject({ failed: true, partialSave: false })
    expect(f.host.mutate).not.toHaveBeenCalled()
  } finally { f.controller.dispose() }
})

it('leaves a disposed page alone when the status refresh after a save fails', async () => {
  const f = fixture()
  const status = Promise.withResolvers<never>()
  f.reflex.readStatus.mockReturnValueOnce(status.promise)
  f.face.edit('model', 'next-model')
  f.face.save()
  await vi.waitFor(() => { expect(f.reflex.readStatus).toHaveBeenCalledOnce() })
  f.controller.dispose()
  status.reject(new Error('offline'))
  await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
  expect(f.state().runtime).toBeUndefined()
})

it('keeps a staged local mode when its form unmounts and returns to the saved mode when the page closes', () => {
  const f = fixture()
  try {
    f.face.edit('endpoint', 'https://my-custom.test')
    f.face.selectMode('local')
    f.face.discard()
    expect(f.state()).toMatchObject({ mode: 'local', dirty: false })
    f.face.selectMode('custom')
    expect(f.state()).toMatchObject({ mode: 'custom', endpoint: { text: 'https://my-custom.test' } })
    f.face.selectMode('local')
    f.face.reset()
    expect(f.state()).toMatchObject({ mode: 'custom', dirty: false, endpoint: { text: 'https://reflex.test' } })
  } finally { f.controller.dispose() }
})
