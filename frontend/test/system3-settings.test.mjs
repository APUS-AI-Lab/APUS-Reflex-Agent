import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import { Config, Settings, serviceConfigs, mountSettings, apply, STATUS_PATH } from '../packages/dsh-desktop-system3-settings/index.js'

const activated = () => Settings({ enabled: true, endpoint: 'https://jev.example.invalid', model: 'decision-model',
  remoteApproved: true, dataClasses: ['workspace'], candidates: [{ id: 'fast', provider: 'configured-provider', model: 'model-1', description: 'Small tasks' }] })

function client(fetcher, react = { createElement() {} }) {
  let definition
  vm.runInNewContext(readFileSync(new URL('../packages/dsh-desktop-system3-settings/client.js', import.meta.url), 'utf8'), {
    URL, structuredClone, AbortController, fetch: fetcher,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }, window: { __ModuleLoader__: { load: value => { definition = value } } },
  })
  return definition.factory(id => id === 'react' ? react : { Button: 'button' })
}

describe('System3 desktop configuration', () => {
  it('starts disabled without requiring endpoint, models or keys', () => {
    expect(Config({}).settings.get()).toMatchObject({ enabled: false, endpoint: '', model: '', candidates: [] })
  })

  it.each([
    { endpoint: 'https://user:secret@example.invalid' }, { endpoint: 'file:///tmp/jev' }, { endpoint: 'https://example.invalid?key=secret' },
    { model: '' }, { remoteApproved: false }, { dataClasses: [] }, { candidates: [] }, { timeoutMs: 0 }, { minConfidence: 1.1 },
    { candidates: [{ id: 'baseline', provider: 'p', model: 'm', description: 'x' }] },
    { candidates: [{ id: 'jev', provider: 'p', model: 'm', description: 'x' }] },
    { candidates: [{ id: 'a', provider: 'p', model: 'm', description: 'x' }, { id: 'a', provider: 'p', model: 'm', description: 'x' }] },
  ])('rejects invalid activation before persistence: %j', patch => {
    expect(() => Settings({ ...activated(), ...patch })).toThrow()
    expect(client().validDraft({ ...activated(), ...patch })).toBe(false)
  })

  it('maps only the selected endpoints, candidates and approved data into existing services', () => {
    expect(serviceConfigs(activated())).toMatchObject({
      jev: { endpoint: 'https://jev.example.invalid', apiKeyEnv: 'APUS_JEV_API_KEY' },
      system3: { approvedRemoteIds: ['jev', 'baseline', 'fast'], approvedRemoteDataClasses: ['workspace'],
        entryRouting: { candidates: [{ provider: 'configured-provider', model: 'model-1', executionDomain: 'network', dataClasses: ['workspace'] }] } },
    })
    expect(serviceConfigs({ ...activated(), credentialRef: '' }).jev).not.toHaveProperty('apiKeyEnv')
  })
})

describe('System3 native credential writes', () => {
  it('writes keys only through credentials and replaces settings atomically with its revision', async () => {
    const form = { mutate: vi.fn(async () => true) }
    const credentials = { set: vi.fn(async () => ({ ok: true })), describe: vi.fn().mockResolvedValueOnce({ ok: true, value: {} }).mockResolvedValue({ ok: true, value: { APUS_JEV_API_KEY: { configured: true } } }) }
    const result = await client().saveSettings(form, credentials, activated(), 'test-only-secret', 9)
    expect(result.ok).toBe(true)
    expect(credentials.set).toHaveBeenCalledWith('APUS_JEV_API_KEY', 'test-only-secret')
    expect(form.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['settings'], value: activated() }], 9)
    expect(JSON.stringify(form.mutate.mock.calls)).not.toContain('test-only-secret')
  })

  it.each(['refused', 'throws', 'missing'])('never enables after credentials %s', async state => {
    const form = { mutate: vi.fn() }
    const credentials = { set: vi.fn(async () => {
      if (state === 'throws') throw new Error('transport')
      return { ok: state !== 'refused' }
    }), describe: vi.fn(async () => ({ ok: true, value: {} })) }
    const result = await client().saveSettings(form, credentials, activated(), state === 'missing' ? '' : 'test-key', 1)
    expect(result.ok).toBe(false)
    expect(form.mutate).not.toHaveBeenCalled()
  })

  it('reports separately that the key was saved when a config conflict keeps the draft', async () => {
    const form = { mutate: vi.fn(async () => false) }
    const credentials = { set: async () => ({ ok: true }), describe: vi.fn().mockResolvedValueOnce({ ok: true, value: {} }).mockResolvedValue({ ok: true, value: { APUS_JEV_API_KEY: { configured: true } } }) }
    expect(await client().saveSettings(form, credentials, activated(), 'test-key', 1)).toEqual({ ok: false, error: 'settingsFailed', keySaved: true })
  })

  it('never overwrites a key used by the active endpoint when saving another endpoint', async () => {
    const form = { mutate: vi.fn() }
    const credentials = { describe: vi.fn(async () => ({ ok: true, value: { APUS_JEV_API_KEY: { configured: true } } })), set: vi.fn() }
    const draft = { ...activated(), endpoint: 'https://second.example.invalid' }
    expect(await client().saveSettings(form, credentials, draft, 'second-endpoint-key', 1))
      .toEqual({ ok: false, error: 'referenceInUse', keySaved: false })
    expect(credentials.set).not.toHaveBeenCalled()
    expect(form.mutate).not.toHaveBeenCalled()
  })

  it('preserves the active reference when a new reference is saved but configuration conflicts', async () => {
    const store = { APUS_JEV_API_KEY: 'old-endpoint-key' }
    const form = { mutate: vi.fn(async () => false) }
    const credentials = { describe: async refs => ({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: ref in store }])) }),
      set: async (ref, value) => { store[ref] = value; return { ok: true } } }
    const draft = { ...activated(), endpoint: 'https://second.example.invalid', credentialRef: 'SECOND_JEV_KEY' }
    expect(await client().saveSettings(form, credentials, draft, 'second-endpoint-key', 1))
      .toEqual({ ok: false, error: 'settingsFailed', keySaved: true })
    expect(store.APUS_JEV_API_KEY).toBe('old-endpoint-key')
    expect(store.SECOND_JEV_KEY).toBe('second-endpoint-key')
  })

  it('keeps a conflicted draft until the user reloads, then saves with the latest revision', async () => {
    const slots = []
    const values = []
    const dependencies = []
    let cursor = 0
    let pending = []
    let snapshot = { status: 'ready', writable: true, revision: 1, value: { settings: Config({}).settings.get() } }
    const react = {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useState(initial) {
        const index = cursor++
        if (!(index in values)) values[index] = initial
        return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
      },
      useRef(initial) { const [value] = this.useState({ current: initial }); return value },
      useCallback: value => value,
      useSyncExternalStore: (_subscribe, read) => read(),
      useEffect(effect, deps) {
        const index = cursor++
        if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) pending.push(effect)
        dependencies[index] = deps
      },
    }
    const form = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: vi.fn(async (_ops, revision) => {
      if (snapshot.revision === 1) {
        snapshot = { ...snapshot, revision: 2, value: { settings: { ...snapshot.value.settings, model: 'changed-in-another-window' } } }
        return false
      }
      return revision === snapshot.revision
    }) }
    const credentials = { describe: async () => ({ ok: true, value: {} }) }
    const plugin = client(async () => ({ ok: true, json: async () => ({ state: 'disabled', error: null }) }), react)
    plugin.apply({ effect: callback => callback(), locale: { register() {}, bind: () => key => key }, configForms: { get: () => form }, remote: { credentials },
      slots: { inject: (_name, callback) => callback(), register: (config, component) => { slots.push({ config, component }); return () => {} } } })
    const render = () => {
      cursor = 0; pending = []
      const tree = slots[0].component(slots[0].config.inject())
      for (const effect of pending) effect()
      return tree
    }
    const button = (tree, label) => tree.children.find(child => child?.type === 'button' && child.children[0] === label)
    render()
    await button(render(), 'save').props.onClick()
    expect(form.mutate.mock.calls[0][1]).toBe(1)
    const conflicted = render()
    expect(button(conflicted, 'reload')).toBeDefined()
    // Repeating Save preserves the stale revision instead of silently overwriting another window.
    await button(conflicted, 'save').props.onClick()
    expect(form.mutate.mock.calls[1][1]).toBe(1)
    button(conflicted, 'reload').props.onClick()
    render()
    await button(render(), 'save').props.onClick()
    expect(form.mutate.mock.calls[2][1]).toBe(2)
    expect(form.mutate.mock.calls[2][0][0].value.model).toBe('changed-in-another-window')
  })

  it('can turn collaboration off without a key or credential request', async () => {
    const form = { mutate: vi.fn(async () => true) }
    const credentials = { set: vi.fn(), describe: vi.fn() }
    expect((await client().saveSettings(form, credentials, { ...activated(), enabled: false }, '', 1)).ok).toBe(true)
    expect(credentials.describe).not.toHaveBeenCalled()
  })
})

describe('System3 child fiber lifecycle', () => {
  class JevProbe extends Service {
    static Config = z.object({ model: z.string().required() })
    constructor(ctx, config) { super(ctx, 'jev'); this.model = config.model }
  }
  class System3Probe extends Service {
    static Config = z.object({})
    constructor(ctx) { super(ctx, 'system3') }
  }

  it('loads lazily, replaces services on live change and removes both on disable and teardown', async () => {
    const ctx = new Context()
    let current = Config({}).settings.get()
    const load = vi.fn(async () => ({ Jev: JevProbe, System3: System3Probe }))
    const parent = await ctx.plugin({ name: 'test-system3-settings', async apply(scope) { await mountSettings(scope, () => current, load) } })
    try {
      expect(load).not.toHaveBeenCalled()
      expect(ctx.get('jev')).toBeUndefined()
      current = activated()
      ctx.emit('loader/volatile-update', [['settings']])
      await vi.waitFor(() => expect(ctx.get('jev')?.model).toBe('decision-model'))
      expect(ctx.get('system3')).toBeDefined()
      const previous = ctx.get('jev')
      current = { ...current, model: 'changed-model' }
      ctx.emit('loader/volatile-update', [['settings']])
      await vi.waitFor(() => expect(ctx.get('jev')?.model).toBe('changed-model'))
      expect(ctx.get('jev')).not.toBe(previous)
      current = { ...current, enabled: false }
      ctx.emit('loader/volatile-update', [['settings']])
      await vi.waitFor(() => expect(ctx.get('jev')).toBeUndefined())
      expect(ctx.get('system3')).toBeUndefined()
      current = { ...current, enabled: true }
      ctx.emit('loader/volatile-update', [['settings']])
      await vi.waitFor(() => expect(ctx.get('system3')).toBeDefined())
    } finally {
      await parent.dispose()
      expect(ctx.get('jev')).toBeUndefined()
      expect(ctx.get('system3')).toBeUndefined()
      await ctx.fiber.dispose()
    }
  })

  it('reports activation errors without exposing details and can recover to disabled', async () => {
    const ctx = new Context()
    let current = activated()
    let controller
    const parent = await ctx.plugin({ name: 'test-system3-status', async apply(scope) {
      controller = await mountSettings(scope, () => current, async () => { throw new Error('private detail that must stay out of status') })
    } })
    try {
      expect(await controller.status()).toEqual({ state: 'error', error: 'activation-failed' })
      current = { ...current, enabled: false }
      ctx.emit('loader/volatile-update', [['settings']])
      await vi.waitFor(async () => expect(await controller.status()).toEqual({ state: 'disabled', error: null }))
    } finally { await parent.dispose(); await ctx.fiber.dispose() }
  })

  it('removes partially started services and retries unchanged config after a child startup failure', async () => {
    const ctx = new Context()
    let fail = true
    class FailingSystem3 extends Service {
      static Config = z.object({})
      constructor(scope) {
        super(scope, 'system3')
        if (fail) throw new Error('startup failure')
      }
    }
    let controller
    const parent = await ctx.plugin({ name: 'test-system3-child-failure', async apply(scope) {
      controller = await mountSettings(scope, activated, async () => ({ Jev: JevProbe, System3: FailingSystem3 }))
    } })
    try {
      expect(await controller.status()).toEqual({ state: 'error', error: 'activation-failed' })
      expect(ctx.get('jev')).toBeUndefined()
      expect(ctx.get('system3')).toBeUndefined()
      fail = false
      ctx.emit('loader/volatile-update', [['settings']])
      await vi.waitFor(async () => expect(await controller.status()).toEqual({ state: 'ready', error: null }))
      expect(ctx.get('jev')).toBeDefined()
      expect(ctx.get('system3')).toBeDefined()
    } finally { await parent.dispose(); await ctx.fiber.dispose() }
  })

  it('does not mount late services when disposed during import', async () => {
    const ctx = new Context()
    let current = Config({}).settings.get()
    let resolve
    const loading = new Promise(done => { resolve = done })
    const parent = await ctx.plugin({ name: 'test-system3-settings', async apply(scope) { await mountSettings(scope, () => current, () => loading) } })
    current = activated()
    ctx.emit('loader/volatile-update', [['settings']])
    const disposed = parent.dispose()
    resolve({ Jev: JevProbe, System3: System3Probe })
    await disposed
    expect(ctx.get('jev')).toBeUndefined()
    expect(ctx.get('system3')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})


describe('System3 activation status UI', () => {
  it('registers a GET-only status route on the authenticated API and removes it on unload', async () => {
    const ctx = new Context()
    const routes = []
    ctx.provide('connection', { fetch: { register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    } } })
    const parent = await ctx.plugin({ name: 'test-desktop-system3', Config, apply })
    try {
      expect(routes).toHaveLength(1)
      expect(routes[0]).toMatchObject({ path: STATUS_PATH, methods: ['GET'], requestBody: 'buffered' })
      const response = await routes[0].fetch(new Request(`http://localhost${STATUS_PATH}`))
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ state: 'disabled', error: null })
    } finally { await parent.dispose(); expect(routes).toEqual([]); await ctx.fiber.dispose() }
  })

  it('reads local readiness with same-origin authentication, independent of provider connectivity', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ state: 'ready', error: null }) }))
    const signal = new AbortController().signal
    expect(await client(fetcher).readStatus(signal)).toEqual({ state: 'ready', error: null })
    expect(fetcher).toHaveBeenCalledWith('/api/desktop-system3.status', { credentials: 'same-origin', cache: 'no-store', signal })
  })

  it.each([false, true])('rejects unavailable or malformed activation state (HTTP success: %s)', async ok => {
    await expect(client(async () => ({ ok, json: async () => ({ state: 'connected-to-model' }) })).readStatus()).rejects.toThrow()
  })
})
