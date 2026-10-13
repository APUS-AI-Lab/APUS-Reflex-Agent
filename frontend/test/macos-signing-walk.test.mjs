import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const run = promisify(execFile)
const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'apus-sign-walk-'))
  roots.push(path)
  return path
}
async function fixture(directory) {
  await mkdir(join(directory, 'Nested.app', 'Inner.framework'), { recursive: true })
  await writeFile(join(directory, 'plain.txt'), 'ordinary text')
  await writeFile(join(directory, 'leftover.cstemp'), 'old codesign temporary file')
  await writeFile(join(directory, 'binary'), Buffer.from([0, 1, 2, 3]))
  await writeFile(join(directory, 'Nested.app', 'Inner.framework', 'binary'), Buffer.from([0, 1, 2, 3]))
}

for (const face of ['cjs', 'esm']) {
  describe(`${face} signing traversal`, () => {
    async function walker() {
      return face === 'cjs' ? require('@electron/osx-sign/dist/cjs/util.js')
        : await import('@electron/osx-sign/dist/esm/util.js')
    }
    it('retains binary candidates and nested bundle order while removing signing residue', async () => {
      const directory = await root()
      await fixture(directory)
      const { walkAsync } = await walker()
      const first = await walkAsync(directory)
      expect(first.map(path => relative(directory, path))).toEqual([
        join('Nested.app', 'Inner.framework', 'binary'), join('Nested.app', 'Inner.framework'), 'Nested.app', 'binary'
      ])
      expect(await readdir(directory)).not.toContain('leftover.cstemp')
      expect(await readFile(join(directory, 'plain.txt'), 'utf8')).toBe('ordinary text')
      expect(await walkAsync(directory)).toEqual(first)
    })
    it('propagates a missing directory instead of returning a partial signing set', async () => {
      const { walkAsync } = await walker()
      await expect(walkAsync(join(await root(), 'absent'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
}

it.skipIf(process.platform === 'win32')('scans a large tree with a low descriptor limit without dropping signing candidates', async () => {
  const directory = await root()
  const count = 1200
  for (let index = 0; index < count; index += 1) {
    const group = join(directory, `group-${Math.floor(index / 40)}`)
    await mkdir(group, { recursive: true })
    await writeFile(join(group, `binary-${index}`), Buffer.from([0, 1, 2, 3]))
  }
  const script = join(directory, 'scan.cjs')
  await writeFile(script, `const {walkAsync}=require(${JSON.stringify(require.resolve('@electron/osx-sign/dist/cjs/util.js'))});\nwalkAsync(process.argv[2]).then(paths=>process.stdout.write(JSON.stringify(paths.length))).catch(error=>{console.error(error.code);process.exitCode=1});\n`)
  const result = await run('/bin/sh', ['-c', 'ulimit -n 128 && exec "$@"', 'sign-walk', process.execPath, script, directory], { timeout: 30_000 })
  expect(JSON.parse(result.stdout)).toBe(count)
})
