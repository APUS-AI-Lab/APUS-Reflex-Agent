/** Real profile/Loader settings discovery and durable volatile Reflex edits. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import { expect, it, onTestFinished, vi } from 'vitest'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { SettingsController } from '@deepseek-ai/dsh-api-settings-controller'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { ConfigFormController } from '@deepseek-ai/dsh-client-ui-settings/src/client/config-form.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { ReflexCardController, type ReflexSettings } from '../src/client/reflex-settings-controller.ts'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'


it.each([false, true])('saves through ConfigForms and BFF with a read-only key; CLI locked=%s', async (locked) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'reflex-settings-profile-')))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle', '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
  ] }]))
  const providerBundle = join(dir, 'node_modules', '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin')
  mkdirSync(providerBundle, { recursive: true })
  writeFileSync(join(providerBundle, 'package.json'), readFileSync(new URL('../../apus-dsh-jev-plugin/package.json', import.meta.url)))
  writeFileSync(join(providerBundle, 'cordis.patch.yml'), readFileSync(new URL('../../apus-dsh-jev-plugin/cordis.patch.yml', import.meta.url), 'utf8').replace('name: ./lib/index.js', 'name: cordis:jev'))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: locked ? [{ id: 'jev', config: { endpoint: 'https://reflex.test', model: 'fixture', effort: 'high', apiKeyEnv: 'JEV_API_KEY' } }] : [], telemetryDisabledEnv: undefined }
  const start = async (): Promise<Context> => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, jev: Jev })
    })
    onTestFinished(async () => { await ctx.fiber.dispose() })
    return ctx
  }

  const host = await start()
  await host.plugin(SettingsController)
  const client = new Context()
  onTestFinished(async () => { await client.fiber.dispose() })
  const failures: string[] = []
  const credentialWrite = vi.fn(async () => ({ ok: false, value: undefined }))
  new TestRemote(client, {
    settings: {
      describe: async () => ({ ok: true, value: JSON.parse(JSON.stringify(host.settingsController.describe())) as ReturnType<SettingsController['describe']> }),
      mutate: async (ns: string, ops: SettingsPathOpView[], revision: number | undefined) => {
        try { return { ok: true, value: JSON.parse(JSON.stringify(await host.settingsController.mutate(ns, ops, revision))) as Awaited<ReturnType<SettingsController['mutate']>> } }
        catch (error) { failures.push(error instanceof Error ? error.message : String(error)); return { ok: false, error } }
      },
    },
    reflex: { readStatus: async () => ({ ok: true, value: host.jev.readStatus() }) },
    credentials: { describe: async () => ({ ok: true, value: { JEV_API_KEY: { configured: true, writable: false } } }),
      set: credentialWrite },
  })
  const mirror = new SettingsDescribeMirror(client)
  const scope = new ConfigFormController<ReflexSettings>(client, { namespace: 'jev' }, mirror, 'host', new SettingsSchemaService(client))
  const card = new ReflexCardController(scope, client)
  const face = card.inject()
  onTestFinished(async () => { card.dispose(); await scope.dispose() })
  await mirror.load()
  expect(scope.getSnapshot().status).toBe('ready')
  if (!locked) {
    await face.refresh()
    expect(face.hooks.reflexCard.getSnapshot().runtime?.provider).toBeNull()
    expect(face.hooks.reflexCard.getSnapshot().endpoint.text).toBe('')
    expect(face.hooks.reflexCard.getSnapshot().model.text).toBe('')
    face.edit('endpoint', 'https://reflex.test')
    face.edit('model', 'fixture')
  }
  face.edit('effort', 'low')
  face.save()
  await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().saving).toBe(false) })
  expect(credentialWrite).not.toHaveBeenCalled()
  expect(face.hooks.reflexCard.getSnapshot().failed, JSON.stringify(failures)).toBe(locked)
  expect(host.jev.resolve({ state: null, questions: { q: { type: 'noul' } } }).effort).toBe(locked ? 'high' : 'low')
  if (locked) expect(failures).toEqual([expect.stringContaining('overridden by a home patch or command-line overlay')])
  else {
    await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().runtime?.provider?.model).toBe('fixture') })
    expect(readFileSync(profile.patchPath, 'utf8')).toContain('low')
    await mirror.load()
    expect(scope.getSnapshot().value?.effort).toBe('low')
    await scope.mutate([{ op: 'set', path: ['endpoint'], value: 'https://original.test' },
      { op: 'set', path: ['model'], value: 'original-model' }], scope.getSnapshot().revision)
    const original = scope.getSnapshot().value
    const beforeReuse = readFileSync(profile.patchPath, 'utf8')
    const originalWrites = credentialWrite.mock.calls.length
    face.edit('endpoint', 'https://must-not-receive-old-key.test')
    face.edit('apiKeyEnv', 'JEV_API_KEY')
    face.edit('apiKey', 'replacement-secret')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().credentialSaveError).toBe('configured') })
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(beforeReuse)
    expect(credentialWrite.mock.calls.length).toBe(originalWrites)
    expect(host.jev.resolve({ state: null, questions: { q: { type: 'noul' } } }).model).toBe('original-model')
    face.discard()
    for (const failure of ['refused', 'thrown'] as const) {
      if (failure === 'thrown') credentialWrite.mockRejectedValueOnce(new Error('credential store unavailable'))
      face.edit('endpoint', 'https://replacement.test')
      face.edit('model', 'replacement-model')
      face.edit('apiKeyEnv', 'REPLACEMENT_KEY')
      face.edit('apiKey', 'replacement-secret')
      face.save()
      await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().saving).toBe(false) })
      expect(face.hooks.reflexCard.getSnapshot().failed).toBe(true)
      await mirror.load()
      expect(scope.getSnapshot().value).toEqual(original)
      expect(face.hooks.reflexCard.getSnapshot().apiKey.text).toBe('replacement-secret')
      expect(face.hooks.reflexCard.getSnapshot().partialSave).toBe(failure === 'thrown')
      if (failure === 'refused') {
        face.save()
        await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().saving).toBe(false) })
        expect(scope.getSnapshot().value).toEqual(original)
        expect(face.hooks.reflexCard.getSnapshot().partialSave).toBe(false)
      }
      face.discard()
    }
    credentialWrite.mockImplementationOnce(async () => {
      await host.settingsController.mutate('jev', [{ op: 'set', path: ['model'], value: 'concurrent-model' }], undefined)
      await mirror.load()
      return { ok: false, value: undefined }
    })
    face.edit('endpoint', 'https://replacement.test')
    face.edit('apiKeyEnv', 'REPLACEMENT_KEY')
    face.edit('apiKey', 'replacement-secret')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().saving).toBe(false) })
    expect(face.hooks.reflexCard.getSnapshot().partialSave).toBe(true)
    expect(scope.getSnapshot().value?.model).toBe('concurrent-model')
    expect(face.hooks.reflexCard.getSnapshot().apiKey.text).toBe('replacement-secret')
    face.discard()
    const mutation = scope.mutate.bind(scope)
    const writes = vi.spyOn(scope, 'mutate')
    credentialWrite.mockResolvedValueOnce({ ok: true, value: undefined })
    const credentialCalls = credentialWrite.mock.calls.length
    face.edit('endpoint', 'https://confirmed.test')
    face.edit('apiKeyEnv', 'CONFIRMED_KEY')
    face.edit('apiKey', 'confirmed-secret')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().saving).toBe(false) })
    expect(face.hooks.reflexCard.getSnapshot().failed).toBe(false)
    expect(writes).toHaveBeenCalledOnce()
    expect(credentialWrite.mock.calls.length - credentialCalls).toBe(1)
    expect(credentialWrite).toHaveBeenLastCalledWith('CONFIRMED_KEY', 'confirmed-secret')
    expect(scope.getSnapshot().value?.endpoint).toBe('https://confirmed.test')
    writes.mockImplementationOnce(async (ops, revision) => {
      const accepted = await mutation(ops, revision)
      await host.settingsController.mutate('jev', [{ op: 'set', path: ['model'], value: 'changed-before-ack' }], undefined)
      await mirror.load()
      return accepted
    })
    face.edit('endpoint', 'https://another.test')
    face.edit('apiKey', 'unconfirmed-secret')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().saving).toBe(false) })
    expect(face.hooks.reflexCard.getSnapshot().partialSave).toBe(true)
    expect(scope.getSnapshot().value?.model).toBe('changed-before-ack')
    face.discard()
    writes.mockImplementationOnce(mutation).mockRejectedValueOnce(new Error('connection lost before compensation'))
    face.edit('endpoint', 'https://last.test')
    face.edit('apiKey', 'unconfirmed-secret')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.reflexCard.getSnapshot().saving).toBe(false) })
    expect(face.hooks.reflexCard.getSnapshot().partialSave).toBe(true)
  }
})
