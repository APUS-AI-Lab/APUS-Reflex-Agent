import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { HarnessRuntime } from '../src/main/runtime/harness-runtime'
import { resolveTestNodeExecutable } from './node-executable'
import { projectRoot } from './patch-path'

it('keeps the Lite CLI policy after re-reading edited profile and home patches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'apus-edition-reload-'))
  try {
    const home = join(root, 'home')
    const profileDir = join(home, 'profiles', 'web')
    const app = join(root, 'app')
    const bundle = join(app, 'node_modules', 'office-test-bundle')
    const patchPath = join(profileDir, 'cordis.patch.yml')
    await mkdir(profileDir, { recursive: true })
    await mkdir(bundle, { recursive: true })
    await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'edition-test', dependencies: { 'office-test-bundle': '0.0.0' } }))
    await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'office-test-bundle', version: '0.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(bundle, 'cordis.patch.yml'), '- insert:\n    - id: office-to-pdf\n      name: office-provider\n')
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['office-test-bundle'] } } }))
    const context = { name: 'web', dir: profileDir, home, cwd: home, patchPath,
      installAnchor: join(app, 'package.json'), startedBundles: ['office-test-bundle'],
      overlays: [{ id: 'office-to-pdf', disabled: true }], telemetryDisabledEnv: undefined }
    for (const disabled of [true, false, null]) {
      const text = `- id: office-to-pdf\n  disabled: ${disabled}\n`
      await writeFile(patchPath, text)
      await writeFile(join(home, 'cordis.patch.yml'), text)
      expect(composeEntries([readProfilePatches('edition-test', context)])[0]?.disabled).toBe(true)
      expect(await readFile(patchPath, 'utf8')).toBe(text)
    }
    expect(composeEntries([readProfilePatches('edition-test', { ...context, overlays: [] })])[0]?.disabled).toBeNull()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('boots Lite with an unavailable Office kit despite a legacy enabled provider and preserves the user patch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'apus-office-edition-'))
  const normalPatch = join(projectRoot, 'build', 'dsh-desktop.patch.yml')
  const editionPatch = join(home, 'product-edition.patch.yml')
  const hook = join(home, 'missing-office.mjs')
  const attempts = join(home, 'office-imports.txt')
  const missing = 'APUS test: Office kit is not installed in Lite'
  await writeFile(attempts, '')
  await writeFile(editionPatch, '- id: office-to-pdf\n  disabled: true\n')
  await writeFile(hook, `
import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/libreoffice-kit')) {
    appendFileSync(${JSON.stringify(attempts)}, specifier + '\\n');
    throw new Error(${JSON.stringify(missing)});
  }
  return next(specifier, context);
}});
`)
  const legacyPatch = '- id: office-to-pdf\n  disabled: false\n'
  const userPatch = join(home, 'profiles', 'web', 'cordis.patch.yml')
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await writeFile(userPatch, legacyPatch)
  const launches: string[][] = []
  const makeRuntime = (policy?: string) => new HarnessRuntime({
    dshEntryPath: join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    nodeExecutablePath: resolveTestNodeExecutable(),
    nodeEntryPath: join(projectRoot, 'build', 'harness-node-entry.mjs'),
    dshPatchPath: normalPatch,
    dshSafePatchPath: join(projectRoot, 'build', 'dsh-desktop-safe.patch.yml'),
    dshEditionPatchPath: policy,
    dshHome: home,
    logPath: join(home, policy === undefined ? 'full.log' : 'lite.log'),
    preferredPort: 0,
    startupTimeoutMs: 30_000,
    launchProcess: (executable, args, options) => {
      launches.push(args)
      return spawn(executable, ['--import', pathToFileURL(hook).href, ...args], options)
    },
    onChanged() {}
  })
  const full = makeRuntime()
  const lite = makeRuntime(editionPatch)
  try {
    // The positive control demonstrates that the unavailable kit actually reaches the Host import path.
    await full.start(home)
    expect(await readFile(attempts, 'utf8')).toContain('@deepseek-ai/libreoffice-kit')
    expect(full.snapshot().logs.join('\n')).toContain(missing)
    await full.stop()
    await writeFile(attempts, '')

    await lite.start(home)
    expect(lite.snapshot().phase, lite.snapshot().logs.join('\n')).toBe('ready')
    expect(await readFile(attempts, 'utf8')).toBe('')
    expect(await readFile(userPatch, 'utf8')).toBe(legacyPatch)
    const args = launches.at(-1)!
    const overlays = args.flatMap((argument, index) => argument === '--patch' ? [args[index + 1]] : [])
    expect(overlays.at(-1)).toBe(editionPatch)
    const snapshot = lite.snapshot()
    if (snapshot.url === undefined || snapshot.authToken === undefined) throw new Error('Lite did not announce its authenticated endpoint')
    const login = await fetch(`${snapshot.url}/?token=${encodeURIComponent(snapshot.authToken)}`, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const html = await fetch(snapshot.url, { headers: { Cookie: cookie } })
    expect(html.status).toBe(200)
    expect(await html.text()).toContain('dsh-client-modules')
    expect(lite.snapshot().logs.join('\n')).not.toContain(missing)
  } finally {
    await full.stop()
    await lite.stop()
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 90_000)
