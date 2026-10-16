/** Loader composition of the bundle patch, optionally layered over the Jev bundle, reporting what each row provides. */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-experimental-api-reflex-local'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const FIBER_ACTIVE = 2 as FiberState.ACTIVE
const FIBER_FAILED = 3 as FiberState.FAILED
const ROWS = ['jev', 'reflex-local', 'api-reflex-local', 'ui-reflex-local']
const [overlay, layering] = process.argv.slice(2)
if (overlay === undefined) throw new Error('reflex-local bundle fixture requires an overlay')
// Neither runner variable is exported here, so the engine must report the runner as missing.
delete process.env.APUS_REFLEX_RUNNER
delete process.env.DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE
const jevBundle = resolve(import.meta.dirname, '../../../apus-dsh-jev-plugin/cordis.patch.yml')
const ctx = await bootProductionProfile({ binName: 'reflex-local-bundle-test', profile: 'headless',
  overlayPaths: [...layering === 'with-jev' ? [jevBundle] : [], resolve(import.meta.dirname, '../../cordis.patch.yml'), overlay] })
try {
  const rows: Record<string, string> = {}
  for (const id of ROWS) {
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === id)
    await entry?.fiber?.await().catch((_failure: unknown) => {
      // A failed row is reported through its state below.
    })
    const state = entry?.fiber?.state
    rows[id] = entry === undefined ? 'absent' : state === FIBER_ACTIVE ? 'active' : state === FIBER_FAILED ? 'failed' : 'pending'
  }
  const ids = [...ctx.loader.entries()].map(entry => entry.options.id)
  const snapshot = ctx.get('reflexLocal')?.snapshot()
  await writeFile('captures.json', JSON.stringify({
    rows,
    duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    providers: ctx.get('jev')?.listProviders().map(provider => provider.id),
    device: snapshot?.device,
    enabled: snapshot?.enabled,
    reflexEnabled: snapshot?.reflexEnabled,
    controller: ctx.get('reflexLocalController') !== undefined,
  }))
} finally {
  await ctx.fiber.dispose()
}
