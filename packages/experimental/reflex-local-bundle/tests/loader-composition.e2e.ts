/** The shipped bundle patch composes over a real profile through the Loader, beside the Jev bundle that owns `jev`. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

async function compose(layering: 'with-jev' | 'alone'): Promise<unknown> {
  let captures: unknown
  const driver = resolve(import.meta.dirname, 'fixtures/driver.ts')
  await runLoaderSmoke({
    label: `reflex-local bundle composition (${layering})`,
    tempDirPrefix: 'reflex-local-bundle-',
    binScript: driver,
    libBinScript: driver,
    binArgs: [resolve(import.meta.dirname, 'fixtures/headless.patch.yml'), layering],
    configPath: resolve(import.meta.dirname, 'fixtures/headless.patch.yml'),
    tsconfigPath: resolve(import.meta.dirname, '../../../../tsconfig.base.json'),
    inspect: async (cwd) => { captures = JSON.parse(await readFile(resolve(cwd, 'captures.json'), 'utf8')) },
  })
  return captures
}

it('adds only the engine, its Remote, and its UI beside the Jev bundle without duplicate rows', async () => {
  expect(await compose('with-jev')).toEqual({
    rows: { 'jev': 'active', 'reflex-local': 'active', 'api-reflex-local': 'active', 'ui-reflex-local': 'active' },
    duplicateIds: [],
    providers: ['reflex-local'],
    device: { supported: false, reason: 'runner-missing' },
    enabled: false,
    reflexEnabled: true,
    controller: true,
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

it('fails the engine row loudly when no jev entry is composed', async () => {
  expect(await compose('alone')).toMatchObject({
    rows: { 'jev': 'absent', 'reflex-local': 'failed' },
    duplicateIds: [],
    controller: false,
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
