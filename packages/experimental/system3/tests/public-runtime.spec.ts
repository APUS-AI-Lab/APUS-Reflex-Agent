/** Startup and privacy policy for the System3 row shipped in the deployment overlay. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot, loadOptionalPatches, StartupError } from '@deepseek-ai/dsh-app-boot'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import System3 from '../src/index.ts'

beforeEach(() => { vi.stubEnv('SYSTEM3_SESSION_DATA_CLASSES', undefined) })
afterEach(() => { vi.unstubAllEnvs() })

async function start(override?: { disabled?: boolean; config?: Record<string, unknown> }) {
  const root = mkdtempSync(join(tmpdir(), 'system3-public-runtime-'))
  let context: Context | undefined = undefined
  onTestFinished(async () => {
    await context?.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  const path = join(root, 'cordis.yml')
  writeFileSync(path, '[]\n')
  const patches = loadOptionalPatches('test', fileURLToPath(new URL('../../../../deploy/system3/runtime.patch.yml', import.meta.url))) ?? []
  const entry = patches.flatMap(patch => patch.insert ?? []).find(candidate => candidate.id === 'system3')
  if (entry === undefined) throw new Error('deployment overlay has no System3 entry')
  // Other deployment rows own generation and network providers; this suite checks the unchanged System3 row.
  context = await boot('test', path, [
    { insert: [{ ...entry, name: 'cordis:system3' }] },
    ...override === undefined ? [] : [{ id: 'system3', ...override }],
  ], (ctx) => { ctx.loader.builtins.system3 = System3 })
  return context
}

it.each([undefined, '', 'null'])('leaves System3 disabled when classification is %j', async (value) => {
  vi.stubEnv('SYSTEM3_SESSION_DATA_CLASSES', value)
  const ctx = await start()
  expect(ctx.get('system3')).toBeUndefined()
  expect([...ctx.loader.entries()].find(entry => entry.options.id === 'system3')?.disabled).toBe(true)
})

it.each(['[]', '{', '   ', '["unknown-class"]', '"workspace"'])('rejects explicitly invalid classification %s at startup', async (value) => {
  vi.stubEnv('SYSTEM3_SESSION_DATA_CLASSES', value)
  await expect(start()).rejects.toBeInstanceOf(StartupError)
})

it('mounts the classified deployment and enforces approved route identities and data classes', async () => {
  vi.stubEnv('SYSTEM3_SESSION_DATA_CLASSES', '["workspace"]')
  const ctx = await start()
  const service = ctx.get('system3')
  expect(service).toBeDefined()
  expect(service?.route([{ id: 'fast', executionDomain: 'network', dataClasses: ['workspace'] }]).selected?.id).toBe('fast')
  expect(service?.route([{ id: 'fast', executionDomain: 'network', dataClasses: ['secret'] }]).selected).toBeUndefined()
  expect(service?.route([{ id: 'unapproved', executionDomain: 'network', dataClasses: ['workspace'] }]).selected).toBeUndefined()
})

it('preserves a config-only local profile without a remote classification field', async () => {
  const ctx = await start({ config: { privacyMode: 'local-only' } })
  const service = ctx.get('system3')
  expect(service).toBeDefined()
  expect(service?.route([{ id: 'local', executionDomain: 'local', dataClasses: ['workspace'] }]).selected?.id).toBe('local')
  expect(service?.route([{ id: 'fast', executionDomain: 'network', dataClasses: ['workspace'] }]).selected).toBeUndefined()
})

it('uses an existing config-only remote policy instead of deployment environment defaults', async () => {
  vi.stubEnv('SYSTEM3_SESSION_DATA_CLASSES', 'invalid environment ignored by profile')
  const ctx = await start({ config: {
    privacyMode: 'controlled', approvedRemoteIds: ['custom'], approvedRemoteDataClasses: ['public'],
  } })
  const service = ctx.get('system3')
  expect(service).toBeDefined()
  expect(service?.route([{ id: 'custom', executionDomain: 'network', dataClasses: ['public'] }]).selected?.id).toBe('custom')
  expect(service?.route([{ id: 'custom', executionDomain: 'network', dataClasses: ['workspace'] }]).selected).toBeUndefined()
})

it('keeps an explicitly enabled but unclassified deployment from silently losing System3', async () => {
  await expect(start({ disabled: false })).rejects.toBeInstanceOf(StartupError)
})

it('honors explicit disable even when the unused deployment classification is invalid', async () => {
  vi.stubEnv('SYSTEM3_SESSION_DATA_CLASSES', '{')
  const ctx = await start({ disabled: true })
  expect(ctx.get('system3')).toBeUndefined()
})
