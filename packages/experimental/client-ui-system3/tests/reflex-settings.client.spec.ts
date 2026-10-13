import { describe, expect, it, vi } from 'vitest'
import type { ReflexStatus } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ReflexCardController, REFLEX_TRIAL, type ReflexSettings } from '../src/client/reflex-settings-controller.ts'

function fixture(configured = true) {
  const host = stubConfigForm<ReflexSettings>()
  host.publish({ status: 'ready', writable: true, value: { endpoint: 'https://reflex.test', model: 'decision', effort: 'high', timeoutMs: 1000, apiKeyEnv: 'REFLEX_API_KEY' }, user: {} })
  const credentials = {
    describe: vi.fn(async () => ({ ok: true, value: { REFLEX_API_KEY: { configured, writable: true } } })),
    set: vi.fn(async () => ({ ok: true, value: undefined })), unset: vi.fn(async () => ({ ok: true, value: undefined })),
  }
  const reflex = {
    testConnection: vi.fn(async (_input: object, _signal?: AbortSignal) => ({ ok: true, value: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 4 } })),
    readStatus: vi.fn(async (): Promise<{ ok: boolean; value: ReflexStatus }> => ({ ok: true, value: { provider: { id: 'system-one', model: 'decision', endpoint: 'https://reflex.test' }, capabilities: [{ id: 'codexSupervision', implemented: false, enabled: false }] } })),
  }
  const controller = new ReflexCardController(host.scope, { remote: { credentials, reflex } } as never)
  const face = controller.inject()
  return { host, credentials, reflex, controller, face, state: () => face.hooks.reflexCard.getSnapshot() }
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

  it('keeps capability state independent from a successful connection probe', async () => {
    const f = fixture()
    try {
      await f.face.refresh()
      await f.face.testConnection()
      expect(f.state().runtime?.capabilities).toEqual([{ id: 'codexSupervision', implemented: false, enabled: false }])
    } finally { f.controller.dispose() }
  })

  it.each(['endpoint', 'protocol'])('drops a probe response after the user changes %s', async (field) => {
    const f = fixture()
    try {
      const deferred = Promise.withResolvers<Awaited<ReturnType<typeof f.reflex.testConnection>>>()
      f.reflex.testConnection.mockReturnValueOnce(deferred.promise)
      const pending = f.face.testConnection()
      const signal = f.reflex.testConnection.mock.calls[0]?.[1]
      f.face.edit(field, field === 'protocol' ? 'typesafe' : 'https://new.test')
      expect(signal?.aborted).toBe(true)
      deferred.resolve({ ok: true, value: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 4 } })
      await pending
      expect(f.state().probe.result).toBeUndefined()
    } finally { f.controller.dispose() }
  })

  it.each([['protocol', 'invalid'], ['effort', 'invalid'], ['endpoint', 'https://key:secret@host'], ['endpoint', 'ftp://reflex.test'], ['timeoutMs', '-1']])('blocks invalid %s before calling the Host', async (field, value) => {
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
      effort: 'low', timeoutMs: 1000, protocol: 'typesafe' }, user: {} })
    expect(f.state().probe.result).toBeUndefined()
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ protocol: 'typesafe' }), expect.any(AbortSignal))
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

it.each(['openjev'] as const)('probes and saves the draft protocol %s without saving during a probe', async (protocol) => {
  const f = fixture()
  try {
    expect(f.state().protocol.text).toBe('openjev')
    f.host.publish({ ...f.host.scope.getSnapshot(), value: { ...f.host.scope.getSnapshot().value, protocol: protocol === 'openjev' ? 'typesafe' : 'openjev' } })
    f.face.edit('protocol', protocol)
    await f.face.testConnection()
    expect(f.reflex.testConnection).toHaveBeenCalledWith(expect.objectContaining({ protocol }), expect.any(AbortSignal))
    expect(f.host.mutate).not.toHaveBeenCalled()
    f.face.save()
    await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
    expect(f.host.mutate).toHaveBeenCalledWith(expect.arrayContaining([{ op: 'set', path: ['protocol'], value: protocol }]), undefined)
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
