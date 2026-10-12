import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const prepare = await readFile(new URL('../scripts/prepare-system3-runtime.mjs', import.meta.url), 'utf8')
const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
const pnpmVersion = JSON.parse(await readFile(new URL('../node_modules/pnpm/package.json', import.meta.url), 'utf8')).version

// Execute production assignments without starting the full runtime preparation.
function deploymentManifest(sourcePackage, closure) {
  const start = prepare.indexOf('    sourcePackage.name =')
  const end = prepare.indexOf('    await writeFile(sourcePackagePath', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  runInNewContext(prepare.slice(start, end), { sourcePackage, closure })
  return sourcePackage
}

it('selects the dependency-only workspace root and recovers packages from that root', () => {
  expect(prepare).toContain("'--filter', sourcePackage.name, 'deploy'")
  expect(prepare).toContain("copyPackage(join(buildSource, 'node_modules', name), destination)")
  const closure = { name: 'fixture-closure', dependencies: { 'fixture-tool': 'workspace:*' } }
  const manifest = deploymentManifest({ name: 'fixture-workspace', scripts: { postinstall: 'must-not-run' }, devDependencies: { 'fixture-dev': 'workspace:*' } }, closure)
  expect(manifest.name).not.toBe(closure.name)
  expect(manifest.dependencies).toEqual(closure.dependencies)
  expect(manifest.files).toEqual(['package.json'])
  expect(manifest.scripts).toBeUndefined()
  expect(manifest.devDependencies).toBeUndefined()
})

it.each(['nested', 'root'])('observes real offline pnpm bin destinations for a %s closure', async mode => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'apus-deploy-root-')))
  const source = join(root, 'source')
  const stage = join(root, 'stage')
  const closure = { name: 'fixture-closure', version: '1.0.0', private: true, dependencies: { 'fixture-tool': 'workspace:*' } }
  const original = { name: 'fixture-workspace', version: '1.0.0', private: true, packageManager: `pnpm@${pnpmVersion}` }
  const manifest = mode === 'root' ? deploymentManifest({ ...original,
    scripts: { postinstall: 'node -e "throw new Error(\'Development hook must not run\')"' },
    devDependencies: { 'fixture-dev': 'workspace:*' } }, closure) : original
  try {
    for (const path of ['deploy/system3/runtime', 'packages/tool', 'packages/dev']) await mkdir(join(source, path), { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(source, 'deploy/system3/runtime/package.json'), JSON.stringify(closure))
    await writeFile(join(source, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - deploy/system3/runtime\n')
    await writeFile(join(source, 'packages/tool/package.json'), JSON.stringify({ name: 'fixture-tool', version: '1.0.0', bin: { 'fixture-command': 'index.js' } }))
    await writeFile(join(source, 'packages/tool/index.js'), '#!/usr/bin/env node\nconsole.log("fixture executable")\n')
    await writeFile(join(source, 'packages/dev/package.json'), JSON.stringify({ name: 'fixture-dev', version: '1.0.0' }))
    execFileSync(process.execPath, [pnpm, '--filter', mode === 'root' ? manifest.name : closure.name,
      'deploy', '--legacy', '--prod', '--offline', '--store-dir', join(root, 'store'),
      '--config.node-linker=hoisted', '--config.auto-install-peers=false', '--config.link-workspace-packages=true', stage],
    { cwd: source, stdio: 'pipe', timeout: 30_000 })
    expect(existsSync(join(stage, 'node_modules/.bin/fixture-command'))).toBe(true)
    // The old nested closure also writes three levels below the workspace root.
    expect(existsSync(join(source, 'deploy/system3/stage/node_modules/.bin/fixture-command'))).toBe(mode === 'nested')
    expect(existsSync(join(stage, 'packages'))).toBe(false)
    expect(existsSync(join(stage, 'deploy'))).toBe(false)
    expect(existsSync(join(stage, 'node_modules/fixture-dev'))).toBe(false)
    expect(JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')).scripts).toBeUndefined()
    expect(execFileSync(process.execPath, [join(stage, 'node_modules/fixture-tool/index.js')], { encoding: 'utf8' }).trim()).toBe('fixture executable')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
