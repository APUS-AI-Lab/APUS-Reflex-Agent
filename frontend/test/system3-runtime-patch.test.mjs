import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = 'node_modules/undici/lib/dispatcher/dispatcher1-wrapper.js'
const patchSource = join(root, 'patches/undici+8.11.2.patch')
const patch = 'input.patch'
const patchCommand = process.env.SYSTEM3_PATCH_COMMAND ?? 'patch'
const directories = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'system3-patch-'))
  directories.push(directory)
  await mkdir(dirname(join(directory, target)), { recursive: true })
  const installed = await readFile(join(root, target), 'utf8')
  await writeFile(join(directory, target), installed)
  await writeFile(join(directory, patch), await readFile(patchSource))
  // npm ci applies the maintained patch; reverse it to recover the exact locked input.
  execFileSync(patchCommand, ['--batch', '--reverse', '--fuzz=0', '-p1', '-i', patch], { cwd: directory, stdio: 'pipe', timeout: 30_000 })
  return { directory, installed }
}

describe('System3 third-party runtime patch application', () => {
  it('applies the dispatcher patch without requiring its final hunk to be at EOF', async () => {
    const { directory, installed } = await fixture()
    execFileSync(patchCommand, ['--batch', '--forward', '--fuzz=0', '-p1', '-i', patch], { cwd: directory, stdio: 'pipe', timeout: 30_000 })
    expect(await readFile(join(directory, target), 'utf8')).toBe(installed)
  })

  it('rejects a changed completion handler instead of applying approximate context', async () => {
    const { directory } = await fixture()
    const file = join(directory, target)
    const source = await readFile(file, 'utf8')
    expect(source).toContain('this.#handler.onComplete?.(rawTrailers)')
    await writeFile(file, source.replace('this.#handler.onComplete?.(rawTrailers)', 'this.#handler.onComplete?.([])'))
    expect(() => execFileSync(patchCommand, ['--dry-run', '--batch', '--forward', '--fuzz=0', '-p1', '-i', patch], {
      cwd: directory, stdio: 'pipe', timeout: 30_000
    })).toThrow()
  })
})
