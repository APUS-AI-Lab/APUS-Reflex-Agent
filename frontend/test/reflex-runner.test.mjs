import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { PRIMARY_RUNTIME_TARGETS, prepareReflexRunner } from '../scripts/reflex-runner.mjs'

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url))
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('maps every host target onto the Harness primary-runtime lock', () => {
  const lock = JSON.parse(readFileSync(join(sourceRoot, 'scripts/primary-runtime/lock.json'), 'utf8'))
  expect(Object.values(PRIMARY_RUNTIME_TARGETS).sort()).toEqual(Object.keys(lock.targets).sort())
})

it.each([
  ['an unlocked host', { platform: 'win32', arch: 'arm64' }],
  ['a locked target without a runner', { platform: 'linux', arch: 'x64' }],
])('stages nothing for %s', async (_case, host) => {
  const root = mkdtempSync(join(tmpdir(), 'apus-reflex-runner-'))
  roots.push(root)
  await expect(prepareReflexRunner(sourceRoot, join(root, 'runner'), join(root, 'cache'), host)).resolves.toBeUndefined()
  expect(existsSync(join(root, 'runner'))).toBe(false)
  expect(existsSync(join(root, 'cache'))).toBe(false)
})

it('stages the runtime runner from the shared Harness builder', () => {
  const prepare = readFileSync(new URL('../scripts/prepare-system3-runtime.mjs', import.meta.url), 'utf8')
  expect(prepare).toContain("prepareReflexRunner(sourceRoot, join(stage, 'dependencies', 'llama-server')")
  expect(prepare).toContain('...(llamaServer === undefined ? {} : { llamaServer })')
})
