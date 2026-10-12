/** Real profile/Loader settings discovery and durable volatile Reflex edits. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import { expect, it, onTestFinished, vi } from 'vitest'
import Jev from '../src/index.ts'

it.each([false, true])('persists live Reflex edits from a real Loader profile, initially configured=%s', async (configured) => {
  vi.stubEnv('JEV_SETTINGS_TEST_KEY_REF', 'FIRST_RUN_TEST_KEY_REF')
  onTestFinished(() => { vi.unstubAllEnvs() })
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'reflex-settings-profile-')))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'jev', name: 'cordis:jev', config: { ...configured ? { endpoint: 'https://reflex.test', model: 'fixture' } : {}, effort: 'high', apiKeyEnv: { __jsExpr: 'process.env.JEV_SETTINGS_TEST_KEY_REF' } } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const start = async (): Promise<Context> => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, jev: Jev })
    })
    onTestFinished(async () => { await ctx.fiber.dispose() })
    return ctx
  }
  const ctx = await start()
  const descriptor = ctx.settings.describe().find(row => row.ns === 'jev')
  expect(descriptor).toBeDefined()
  if (descriptor === undefined) throw new Error('Reflex settings not registered')
  const wire = JSON.parse(JSON.stringify(descriptor)) as typeof descriptor
  expect(() => { new Schema(wire.schema as ConstructorParameters<typeof Schema>[0])(wire.value) }).not.toThrow()
  expect(wire.value).toMatchObject({ endpoint: configured ? 'https://reflex.test' : '', model: configured ? 'fixture' : '', effort: 'high', apiKeyEnv: 'FIRST_RUN_TEST_KEY_REF' })
  const before = readFileSync(profile.patchPath, 'utf8')
  for (const endpoint of ['https://user:secret@reflex.test', 'ftp://reflex.test', 'http://reflex.test:99999']) {
    await expect(ctx.settings.update('jev', { endpoint })).rejects.toThrow()
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
    expect(ctx.jev.readStatus().provider?.endpoint).toBe(configured ? 'https://reflex.test' : undefined)
  }
  const fiber = ctx.configEditor.entries().find(entry => entry.options.id === 'jev')?.fiber
  await ctx.settings.update('jev', { effort: 'low', endpoint: 'https://changed.test', model: 'fixture' }, descriptor.revision)
  expect(ctx.configEditor.entries().find(entry => entry.options.id === 'jev')?.fiber === fiber).toBe(true)
  expect(ctx.jev.resolve({ state: null, questions: { check: { type: 'noul' } } })).toMatchObject({ effort: 'low' })
  expect(ctx.jev.readStatus().provider?.endpoint).toBe('https://changed.test')
  expect(readFileSync(profile.patchPath, 'utf8')).toContain('https://changed.test')
  await ctx.fiber.dispose()
  const restored = await start()
  expect(restored.settings.describe().find(row => row.ns === 'jev')?.value).toMatchObject({ effort: 'low', endpoint: 'https://changed.test', apiKeyEnv: 'FIRST_RUN_TEST_KEY_REF' })
  await expect(restored.settings.update('jev', { model: '' })).rejects.toThrow('requires both')
  await restored.settings.update('jev', { endpoint: '', model: '' })
  expect(restored.jev.readStatus().provider).toBeNull()
  expect(restored.settings.describe().find(row => row.ns === 'jev')).toBeDefined()
  await expect(restored.jev.decide({ state: null, questions: { q: { type: 'noul' } } })).rejects.toThrow('Jev is not configured')
})
