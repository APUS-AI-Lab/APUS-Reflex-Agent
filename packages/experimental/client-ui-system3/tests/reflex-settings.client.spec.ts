import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ReflexCardController, type ReflexSettings } from '../src/client/reflex-settings-controller.ts'

function fixture() {
  const host = stubConfigForm<ReflexSettings>()
  host.publish({ status: 'ready', writable: true, value: { endpoint: 'https://reflex.test', model: 'decision', effort: 'high', timeoutMs: 1000, apiKeyEnv: 'REFLEX_API_KEY' }, user: {} })
  const credentials = {
    describe: vi.fn(async () => ({ ok: true, value: { REFLEX_API_KEY: { configured: true, writable: true } } })),
    set: vi.fn(async () => ({ ok: true, value: undefined })), unset: vi.fn(async () => ({ ok: true, value: undefined })),
  }
  const reflex = {
    testConnection: vi.fn(async (_input: object, _signal?: AbortSignal) => ({ ok: true, value: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 4 } })),
    readStatus: vi.fn(async () => ({ ok: true, value: { provider: { id: 'system-one', model: 'decision', endpoint: 'https://reflex.test' }, capabilities: [{ id: 'codexSupervision', implemented: false, enabled: false }] } })),
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

  it('drops a probe response after the user changes its input', async () => {
    const f = fixture()
    try {
      const deferred = Promise.withResolvers<Awaited<ReturnType<typeof f.reflex.testConnection>>>()
      f.reflex.testConnection.mockReturnValueOnce(deferred.promise)
      const pending = f.face.testConnection()
      const signal = f.reflex.testConnection.mock.calls[0]?.[1]
      f.face.edit('endpoint', 'https://new.test')
      expect(signal?.aborted).toBe(true)
      deferred.resolve({ ok: true, value: { kind: 'ok', stage: 'decision', model: 'decision', effort: 'high', latencyMs: 4 } })
      await pending
      expect(f.state().probe.result).toBeUndefined()
    } finally { f.controller.dispose() }
  })

  it.each([['effort', 'invalid'], ['endpoint', 'https://key:secret@host'], ['endpoint', 'ftp://reflex.test'], ['timeoutMs', '-1']])('blocks invalid %s before calling the Host', async (field, value) => {
    const f = fixture()
    try {
      f.face.edit(field, value)
      await f.face.testConnection()
      expect(f.state().invalid).toBe(true)
      expect(f.reflex.testConnection).not.toHaveBeenCalled()
    } finally { f.controller.dispose() }
  })

  it('does not claim a refused replacement succeeded because an old key exists', async () => {
    const f = fixture()
    try {
      f.credentials.set.mockResolvedValueOnce({ ok: false, value: undefined })
      f.face.edit('apiKey', 'new-secret')
      f.face.save()
      await vi.waitFor(() =>{  expect(f.state().failed).toBe(true) })
      expect(f.state().apiKey.text).toBe('new-secret')
      expect(f.host.mutate).not.toHaveBeenCalled()
      f.face.discard()
      expect(f.state().apiKey.text).toBe('')
    } finally { f.controller.dispose() }
  })

  it('keeps an acknowledged credential save successful when the status refresh fails', async () => {
    const f = fixture()
    try {
      await vi.waitFor(() => { expect(f.state().apiKeyConfigured).toBe(true) })
      f.credentials.describe.mockRejectedValueOnce(new Error('status unavailable'))
      f.face.edit('apiKey', 'replacement')
      f.face.save()
      await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
      expect(f.state().failed).toBe(false)
      expect(f.credentials.set).toHaveBeenCalledTimes(1)
      expect(f.state().apiKey.text).toBe('')
    } finally { f.controller.dispose() }
  })

  it('uses the managed reference when saving a key with an empty reference', async () => {
    const f = fixture()
    try {
      f.face.edit('apiKey', 'replacement')
      f.face.edit('apiKeyEnv', '')
      f.face.save()
      await vi.waitFor(() => { expect(f.state().saving).toBe(false) })
      expect(f.credentials.set).toHaveBeenCalledWith('REFLEX_API_KEY', 'replacement')
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
  const f = fixture()
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
    await vi.waitFor(() => { expect(f.state().apiKeyConfigured).toBe(true) })
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
  const f = fixture()
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
    expect(f.state().apiKeyEnv.text).toBe('REFLEX_API_KEY')
    f.face.save()
    await vi.waitFor(() => { expect(f.credentials.set).toHaveBeenCalledWith('REFLEX_API_KEY', 'first-secret') })
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
  expect(f.state().runtime?.provider.model).toBe('decision')
  expect(f.state().credentialFailed).toBe(false)
})

it('does not start a second save while credential acknowledgement is pending', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.credentials.set>>>()
  try {
    f.credentials.set.mockReturnValueOnce(pending.promise)
    f.face.edit('apiKey', 'new-secret')
    f.face.save()
    f.face.save()
    expect(f.credentials.set).toHaveBeenCalledOnce()
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
