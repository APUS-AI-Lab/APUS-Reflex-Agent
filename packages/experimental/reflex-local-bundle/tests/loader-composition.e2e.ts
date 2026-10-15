/** The shipped bundle patch composes over a real profile through the Loader. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

it('routes default Jev decisions to the local provider and mounts the engine, its Remote, and local-only System3', async () => {
  let captures: unknown
  const driver = resolve(import.meta.dirname, 'fixtures/driver.ts')
  await runLoaderSmoke({
    label: 'reflex-local bundle composition',
    tempDirPrefix: 'reflex-local-bundle-',
    binScript: driver,
    libBinScript: driver,
    configPath: resolve(import.meta.dirname, 'fixtures/headless.patch.yml'),
    tsconfigPath: resolve(import.meta.dirname, '../../../../tsconfig.base.json'),
    inspect: async (cwd) => { captures = JSON.parse(await readFile(resolve(cwd, 'captures.json'), 'utf8')) },
  })
  expect(captures).toEqual({
    rows: { 'jev': true, 'reflex-local': true, 'api-reflex-local': true, 'ui-reflex-local': true, 'system3': true, 'ui-system3': true },
    defaultProvider: 'reflex-local',
    providers: ['reflex-local'],
    device: { supported: false, reason: 'runner-missing' },
    controller: true,
    privacyMode: 'local-only',
    jevExecutionDomain: 'local',
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
