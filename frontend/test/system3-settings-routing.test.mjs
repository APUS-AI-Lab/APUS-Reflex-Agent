/** Verify desktop consent against the real source-plane router before making any network call. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('admits the explicitly approved current model even when it is outside the routing candidates', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { Context } from '@deepseek-ai/cordis'
    import { Settings, serviceConfigs, mountSettings } from './frontend/packages/dsh-desktop-system3-settings/index.js'
    import { createSystem3EntryRouter } from './packages/experimental/system3/src/entry-routing.ts'
    import Jev from './packages/experimental/apus-dsh-jev-plugin/src/index.ts'
    import System3 from './packages/experimental/system3/src/index.ts'
    const settings = Settings({ enabled: true, endpoint: 'https://jev.example.invalid', model: 'decision-model',
      remoteApproved: true, dataClasses: ['workspace'], candidates: [{ id: 'fast', provider: 'candidate-provider', model: 'fast-model', description: 'Small tasks' }] })
    const configs = serviceConfigs(settings)
    Jev.Config(configs.jev)
    System3.Config(configs.system3)
    const ctx = new Context()
    let current = settings
    let controller
    const owner = await ctx.plugin({ name: 'real-desktop-system3-smoke', async apply(scope) {
      controller = await mountSettings(scope, () => current, async () => ({ Jev, System3 }))
    } })
    assert.deepEqual(await controller.status(), { state: 'ready', error: null })
    const policy = ctx.system3.privacyPolicy
    const options = { routeId: 'jev', executionDomain: 'network', effort: 'low' }
    const input = { baseline: { provider: 'current-provider', model: 'current-model' } }
    const router = createSystem3EntryRouter(ctx, configs.system3.entryRouting, policy, options)
    assert.doesNotThrow(() => router.validateBaseline(input))
    const restricted = createSystem3EntryRouter(ctx, configs.system3.entryRouting,
      { ...policy, approvedRemoteIds: ['jev', 'fast'] }, options)
    assert.throws(() => restricted.validateBaseline(input), /baseline route/)
    current = { ...settings, enabled: false }
    ctx.emit('loader/volatile-update', [['settings']])
    assert.deepEqual(await controller.status(), { state: 'disabled', error: null })
    assert.equal(ctx.get('jev'), undefined)
    assert.equal(ctx.get('system3'), undefined)
    await owner.dispose()
    await ctx.fiber.dispose()
  `], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 30000 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
})
