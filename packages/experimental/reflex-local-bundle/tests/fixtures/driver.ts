/** Loader composition of the bundle patch over the headless profile, reporting what each inserted row provides. */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-api-reflex-local'
import type {} from '@deepseek-ai/dsh-experimental-system3'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const FIBER_ACTIVE = 2 as FiberState.ACTIVE
const ROWS = ['jev', 'reflex-local', 'api-reflex-local', 'ui-reflex-local', 'system3', 'ui-system3']
const overlay = process.argv[2]
if (overlay === undefined) throw new Error('reflex-local bundle fixture requires an overlay')
// No desktop Host exports the bundled runtime here, so the engine must report the runner as missing.
delete process.env.DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE
const ctx = await bootProductionProfile({ binName: 'reflex-local-bundle-test', profile: 'headless',
  overlayPaths: [resolve(import.meta.dirname, '../../cordis.patch.yml'), overlay] })
try {
  const rows: Record<string, boolean> = {}
  for (const id of ROWS) {
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === id)
    await entry?.fiber?.await()
    rows[id] = entry?.fiber?.state === FIBER_ACTIVE
  }
  const system3 = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'system3')
  const spec = ctx.get('jev')?.resolve({ state: 'composition', questions: { ready: { type: 'noul' } } })
  await writeFile('captures.json', JSON.stringify({
    rows,
    defaultProvider: spec?.providerId,
    providers: ctx.get('jev')?.listProviders().map(provider => provider.id),
    device: ctx.get('reflexLocal')?.snapshot().device,
    controller: ctx.get('reflexLocalController') !== undefined,
    privacyMode: ctx.get('system3')?.privacyPolicy.mode,
    jevExecutionDomain: (system3?.options.config as { jevExecutionDomain?: string } | undefined)?.jevExecutionDomain,
  }))
} finally {
  await ctx.fiber.dispose()
}
