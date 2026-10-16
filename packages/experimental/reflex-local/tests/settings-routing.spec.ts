/**
 * Real profile/Loader composition: the Reflex master switch saved through settings stops and restarts the resident runner
 * through Jev's `jev/enabled` event, without waiting for the routing poll.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import Settings from '@deepseek-ai/dsh-settings'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { inspectDevice } from '../src/device.ts'
import ReflexLocal from '../src/index.ts'
import type { CatalogAsset } from '../src/models.ts'
import type { ReflexSnapshot } from '../src/types.ts'
import { assetOf, fakeRunner, temporaryRoot } from './harness.ts'

const weights = Buffer.from('4b-q4_k_m weights '.repeat(20))
const lock = vi.hoisted(() => ({ models: {} as Record<string, CatalogAsset> }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (args[0] instanceof URL && args[0].pathname.endsWith('/runtime/assets.json')) return JSON.stringify(lock)
    return actual.readFileSync(...args)
  } }
})
vi.mock('../src/device.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/device.ts')>(), inspectDevice: vi.fn() }))
for (const key of ['4b-q4_k_m', '4b-q8_0', '9b-q4_k_m', '9b-q8_0', '35b-a3b-q4_k_m', '35b-a3b-q8_0']) {
  lock.models[key] = { ...assetOf(`${key}.gguf`, key === '4b-q4_k_m' ? weights : Buffer.from(key)), experimental: key.startsWith('35b') }
}

async function untilSnapshot(ctx: Context, accept: (snapshot: ReflexSnapshot) => boolean): Promise<ReflexSnapshot> {
  const abort = new AbortController()
  try {
    for await (const snapshot of ctx.reflexLocal.follow(abort.signal)) if (accept(snapshot)) return snapshot
  } finally { abort.abort() }
  throw new Error('engine disposed')
}

describe.skipIf(process.platform === 'win32')('Reflex master switch through profile settings', () => {
  it('stops the resident runner when the master switch is saved off and starts it again when saved on', async () => {
    vi.mocked(inspectDevice).mockReturnValue({ supported: true, memoryBytes: 24 * 1024 ** 3 })
    const home = realpathSync(await temporaryRoot())
    const runner = await fakeRunner(home)
    const dataRoot = join(home, 'reflex')
    mkdirSync(join(dataRoot, 'models'), { recursive: true })
    const file = join(dataRoot, 'models', '4b-q4_k_m.gguf')
    writeFileSync(file, weights)
    const asset = lock.models['4b-q4_k_m'] as CatalogAsset
    const variant = { model: '4b', quant: 'q4_k_m' } as const
    writeFileSync(join(dataRoot, 'state.json'), JSON.stringify({ active: variant, localChosen: true, models: { '4b-q4_k_m': {
      sha256: asset.sha256, size: weights.length, mtimeMs: (await stat(file)).mtimeMs,
      selfTest: { prefillTokensPerSecond: 400, decisionMs: 10, slow: false },
    } } }))
    const dir = join(home, 'profiles', 'test')
    initProfile(dir, ['test-bundle'])
    const bundle = join(dir, 'node_modules', 'test-bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
      { id: 'subprocess', name: 'cordis:subprocess' },
      { id: 'jev', name: 'cordis:jev', config: { defaultProviderId: 'reflex-local' } },
      { id: 'reflex-local', name: 'cordis:reflex-local', config: { dataRoot, runnerPath: runner.path, routingPollMs: 600_000, graceMs: 500 } },
    ] }]))
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, subprocess: LocalSubprocess, jev: Jev, 'reflex-local': ReflexLocal })
    })
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await untilSnapshot(ctx, snapshot => snapshot.runner.state === 'running')
    await ctx.settings.update('jev', { enabled: false })
    expect(await untilSnapshot(ctx, snapshot => snapshot.runner.state === 'stopped')).toMatchObject({ reflexEnabled: false, enabled: true })
    await ctx.settings.update('jev', { enabled: true })
    // Eager start: the runner starts without waiting for a decision.
    expect(await untilSnapshot(ctx, snapshot => snapshot.runner.state === 'running')).toMatchObject({ reflexEnabled: true, active: variant })
  })
})
