/** Exercise the actual Settings/Loader path against an isolated native profile. */
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import SettingsForms from '@deepseek-ai/dsh-settings'
import { expect, it, vi } from 'vitest'
import { Config, Settings, mountSettings } from '../packages/dsh-desktop-system3-settings/index.js'

it('persists only non-secret settings, rejects invalid activation and disables live services', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'desktop-system3-settings-')))
  let ctx
  try {
    const dir = join(home, 'profiles', 'test')
    initProfile(dir, ['test-bundle'])
    const bundle = join(dir, 'node_modules', 'test-bundle')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
    await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
      { id: 'dsh-desktop-system3-settings', name: 'cordis:desktop-system3' },
    ] }]))
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
    class Jev extends Service {
      static Config = z.object({ model: z.string() })
      constructor(scope, config) { super(scope, 'jev'); this.model = config.model }
    }
    class System3 extends Service {
      static Config = z.object({})
      constructor(scope) { super(scope, 'system3') }
    }
    ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), scope => {
      scope.provide('profileContext', profile)
      scope.provide('appReady', { onReady: listener => { listener(); return () => {} } })
      Object.assign(scope.loader.builtins, {
        editor: ConfigEditor, settings: SettingsForms,
        'desktop-system3': { Config, async apply(scope, config) { await mountSettings(scope, () => config.settings.get(), async () => ({ Jev, System3 })) } },
      })
    })
    const row = () => ctx.settings.describe().find(item => item.ns === 'dsh-desktop-system3-settings')
    expect(row().value.settings.enabled).toBe(false)
    const before = await readFile(profile.patchPath, 'utf8')
    await expect(ctx.settings.mutate('dsh-desktop-system3-settings', [{ op: 'set', path: ['settings'], value: { enabled: true } }], row().revision)).rejects.toThrow()
    expect(await readFile(profile.patchPath, 'utf8')).toBe(before)
    const config = Settings({ enabled: true, endpoint: 'https://jev.example.invalid', model: 'decision-model',
      remoteApproved: true, dataClasses: ['workspace'], candidates: [{ id: 'fast', provider: 'provider', model: 'model', description: 'Small tasks' }] })
    await ctx.settings.mutate('dsh-desktop-system3-settings', [{ op: 'set', path: ['settings'], value: config }], row().revision)
    await vi.waitFor(() => expect(ctx.get('jev')?.model).toBe('decision-model'))
    expect(row().value.settings.enabled).toBe(true)
    const saved = await readFile(profile.patchPath, 'utf8')
    expect(saved).toContain('credentialRef: APUS_JEV_API_KEY')
    expect(saved).not.toContain('apiKey:')
    await ctx.settings.mutate('dsh-desktop-system3-settings', [{ op: 'set', path: ['settings'], value: { ...config, enabled: false } }], row().revision)
    await vi.waitFor(() => expect(ctx.get('jev')).toBeUndefined())
    expect(ctx.get('system3')).toBeUndefined()
  } finally {
    if (ctx) await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
