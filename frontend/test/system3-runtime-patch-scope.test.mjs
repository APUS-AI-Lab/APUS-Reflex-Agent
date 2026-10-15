import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { patchSystem3Runtime } from '../scripts/patch-system3-runtime.mjs'

const directories = []
const runtimeTarget = 'node_modules/runtime-fixture/lib/index.js'
const runtimePatch = `diff --git a/${runtimeTarget} b/${runtimeTarget}
--- a/${runtimeTarget}
+++ b/${runtimeTarget}
@@ -1 +1 @@
-module.exports = 'original'
+module.exports = 'patched'
`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'apus-runtime-patch-scope-'))
  directories.push(root)
  const app = join(root, 'app')
  const stage = join(root, 'stage')
  await mkdir(join(app, 'patches'), { recursive: true })
  await mkdir(stage)
  return { app, stage }
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('desktop runtime patch scope', () => {
  it('excludes the real build-only signer patch without requiring the signer in production', async () => {
    const { app, stage } = await fixture()
    await cp(new URL('../patches/@electron+osx-sign+1.3.3.patch', import.meta.url),
      join(app, 'patches/@electron+osx-sign+1.3.3.patch'))
    await patchSystem3Runtime(stage, app)
    expect(JSON.parse(await readFile(join(stage, 'desktop-patch-receipt.json'), 'utf8'))).toEqual([])
  })

  it('applies ordinary runtime patches and records the changed runtime target', async () => {
    const { app, stage } = await fixture()
    await writeFile(join(app, 'patches/runtime-fixture+1.0.0.patch'), runtimePatch)
    for (const root of [app, stage]) {
      await mkdir(dirname(join(root, runtimeTarget)), { recursive: true })
      await writeFile(join(root, runtimeTarget), "module.exports = 'original'\n")
    }
    await patchSystem3Runtime(stage, app)
    expect(await readFile(join(stage, runtimeTarget), 'utf8')).toBe("module.exports = 'patched'\n")
    const receipts = JSON.parse(await readFile(join(stage, 'desktop-patch-receipt.json'), 'utf8'))
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ name: 'runtime-fixture+1.0.0.patch', targets: [{ path: runtimeTarget }] })
  })

  it('skips hunks the own build already contains and applies the rest', async () => {
    const { app, stage } = await fixture()
    const twoHunks = `diff --git a/${runtimeTarget} b/${runtimeTarget}
--- a/${runtimeTarget}
+++ b/${runtimeTarget}
@@ -1,3 +1,3 @@
-export const a = 'original'
+export const a = 'patched'
 export const b = 1
 export const c = 2
@@ -7,3 +7,3 @@
 export const g = 6
-export const h = 'original'
+export const h = 'patched'
 export const i = 8
`
    await writeFile(join(app, 'patches/runtime-fixture+1.0.0.patch'), twoHunks)
    const lines = ["export const a = 'original'", 'export const b = 1', 'export const c = 2', 'export const d = 3', 'export const e = 4',
      'export const f = 5', 'export const g = 6', "export const h = 'original'", 'export const i = 8']
    await mkdir(dirname(join(app, runtimeTarget)), { recursive: true })
    await writeFile(join(app, runtimeTarget), `${lines.join('\n')}\n`)
    // The own build already carries the second fix from source.
    await mkdir(dirname(join(stage, runtimeTarget)), { recursive: true })
    await writeFile(join(stage, runtimeTarget), `${lines.join('\n').replace("h = 'original'", "h = 'patched'")}\n`)
    await patchSystem3Runtime(stage, app)
    expect(await readFile(join(stage, runtimeTarget), 'utf8')).toBe(`${lines.join('\n').replaceAll("'original'", "'patched'")}\n`)
    const receipts = JSON.parse(await readFile(join(stage, 'desktop-patch-receipt.json'), 'utf8'))
    expect(receipts[0]).toMatchObject({ alreadyAppliedHunks: 1 })
  })

  it('recognizes an applied hunk the bundler printed without braces', async () => {
    const { app, stage } = await fixture()
    const braced = `diff --git a/${runtimeTarget} b/${runtimeTarget}
--- a/${runtimeTarget}
+++ b/${runtimeTarget}
@@ -1,3 +1,5 @@
 export function f(x) {
-  return 'original'
+  if (x) {
+    return 'patched'
+  }
 }
`
    await writeFile(join(app, 'patches/runtime-fixture+1.0.0.patch'), braced)
    await mkdir(dirname(join(app, runtimeTarget)), { recursive: true })
    await writeFile(join(app, runtimeTarget), "export function f(x) {\n  return 'original'\n}\n")
    await mkdir(dirname(join(stage, runtimeTarget)), { recursive: true })
    await writeFile(join(stage, runtimeTarget), "export function f(x) {\n  if (x) return 'patched';\n}\n")
    await patchSystem3Runtime(stage, app)
    expect(await readFile(join(stage, runtimeTarget), 'utf8')).toBe("export function f(x) {\n  if (x) return 'patched';\n}\n")
  })

  it('still rejects a hunk whose context matches neither the original nor the patched own build', async () => {
    const { app, stage } = await fixture()
    await writeFile(join(app, 'patches/runtime-fixture+1.0.0.patch'), runtimePatch)
    for (const [root, text] of [[app, "module.exports = 'original'\n"], [stage, "module.exports = 'diverged'\n"]]) {
      await mkdir(dirname(join(root, runtimeTarget)), { recursive: true })
      await writeFile(join(root, runtimeTarget), text)
    }
    await expect(patchSystem3Runtime(stage, app)).rejects.toThrow('requires review')
  })

  it('rejects missing runtime dependencies instead of treating every absent patch target as build-only', async () => {
    const { app, stage } = await fixture()
    await writeFile(join(app, 'patches/runtime-fixture+1.0.0.patch'), runtimePatch)
    await expect(patchSystem3Runtime(stage, app)).rejects.toMatchObject({ code: 'ENOENT', path: join(stage, runtimeTarget) })
    await expect(readFile(join(stage, 'desktop-patch-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
