import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import inventory from '../scripts/runtime-dependency-inventory.cjs'
import beforePack from '../scripts/verify-system3-runtime.cjs'
import afterPack from '../scripts/package-system3-runtime.cjs'

const roots = []
const licenses = ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'HARNESS-LICENSE.txt', 'HARNESS-THIRD_PARTY_NOTICES.txt', 'ELECTRON-LICENSE.txt', 'CHROMIUM-LICENSES.html']
function packageAt(root, relative, name, version = '1.0.0') {
  const directory = join(root, relative)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }))
  return directory
}
function fixture() {
  const project = mkdtempSync(join(tmpdir(), 'runtime-inventory-'))
  roots.push(project)
  const root = join(project, '.build/system3-runtime')
  const names = ['@deepseek-ai/dsh', ...['system3', 'system3-policy', 'system3-evidence', 'system3-supervisor', 'apus-dsh-jev-plugin', 'client-ui-system3'].map(name => `@deepseek-ai/dsh-experimental-${name}`)]
  const packages = names.map(name => {
    packageAt(root, `node_modules/${name}`, name, '0.1.7-rc.2')
    return { name, path: `node_modules/${name}/package.json` }
  })
  packageAt(root, 'node_modules/extra', 'extra')
  packageAt(root, 'node_modules/extra/node_modules/@nested/child', '@nested/child', '2.0.0')
  packageAt(root, 'node_modules/extra/node_modules/@nested/child/node_modules/deep', 'deep', '3.0.0')
  const entry = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
  mkdirSync(join(root, 'node_modules/@deepseek-ai/dsh/lib'))
  writeFileSync(join(root, entry), '')
  const manifest = { product: 'xdan-system3', version: '0.1.7-rc.2', mode: 'deployed', sourceRevision: 'a'.repeat(40), sourceDirty: false, platform: 'darwin', arch: 'arm64', packages, entry, dependencyInventory: inventory.writeDependencyInventory(root) }
  writeFileSync(join(root, 'runtime-manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'desktop-patch-receipt.json'), JSON.stringify(Array.from({ length: 27 }, () => ({ targets: [] }))))
  const appOutDir = join(project, 'output')
  const resources = join(appOutDir, 'APUS.app/Contents/Resources')
  for (const directory of [join(project, '.build/licenses'), join(resources, 'licenses')]) {
    mkdirSync(directory, { recursive: true })
    for (const license of licenses) writeFileSync(join(directory, license), 'original license')
  }
  const context = { packager: { projectDir: project, appInfo: { productFilename: 'APUS' } }, electronPlatformName: 'darwin', arch: 3, appOutDir }
  return { project, root, manifest, context }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('deployed runtime dependency inventory', () => {
  it('records stable paths, identities, and manifest hashes through nested scoped dependencies', async () => {
    const { root, manifest, context } = fixture()
    const first = readFileSync(join(root, inventory.inventoryFileName), 'utf8')
    const actual = JSON.parse(first)
    expect(actual.packages).toHaveLength(10)
    expect(actual.packages.map(item => item.path)).toEqual(actual.packages.map(item => item.path).sort())
    expect(actual.packages).toContainEqual(expect.objectContaining({ path: 'node_modules/extra/node_modules/@nested/child/node_modules/deep/package.json', name: 'deep', version: '3.0.0', packageJsonSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }))
    expect(inventory.writeDependencyInventory(root)).toEqual(manifest.dependencyInventory)
    expect(readFileSync(join(root, inventory.inventoryFileName), 'utf8')).toBe(first)
    expect(inventory.verifyDependencyInventory(root, manifest)).toEqual(manifest.dependencyInventory)
    await expect(beforePack(context)).resolves.toBeUndefined()
  })

  it('does not describe a workspace checkout as a deployed dependency inventory', () => {
    const { root, manifest } = fixture()
    expect(() => inventory.verifyDependencyInventory(root, { ...manifest, mode: 'workspace' })).toThrow('deployed runtime dependency inventory')
    expect(() => inventory.verifyDependencyInventory(root, { ...manifest, dependencyInventory: undefined })).toThrow('deployed runtime dependency inventory')
  })

  it('rejects additions and same-version metadata replacements', () => {
    const { root, manifest } = fixture()
    writeFileSync(join(root, 'node_modules/extra/package.json'), JSON.stringify({ name: 'extra', version: '1.0.0', dependencies: { injected: '*' } }))
    expect(() => inventory.verifyDependencyInventory(root, manifest)).toThrow('installed package manifests')
    writeFileSync(join(root, 'node_modules/extra/package.json'), JSON.stringify({ name: 'extra', version: '1.0.0' }))
    packageAt(root, 'node_modules/added', 'added')
    expect(() => inventory.verifyDependencyInventory(root, manifest)).toThrow('installed package manifests')
  })

  it('does not follow dependency symlinks outside the materialized tree', () => {
    const { root, project, manifest } = fixture()
    const external = packageAt(project, 'external', 'external')
    symlinkSync(external, join(root, 'node_modules/linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => inventory.verifyDependencyInventory(root, manifest)).toThrow('symlink')
  })

  for (const [phase, hook] of [['beforePack', beforePack], ['afterPack', afterPack]]) {
    it.each(['missing package', 'replaced version', 'inventory drift', 'missing inventory'])(`${phase} rejects %s before accepting an application`, async mutation => {
      const { root, context } = fixture()
      if (mutation === 'missing package') rmSync(join(root, 'node_modules/extra/node_modules/@nested/child/node_modules/deep'), { recursive: true })
      if (mutation === 'replaced version') packageAt(root, 'node_modules/extra/node_modules/@nested/child', '@nested/child', '9.0.0')
      if (mutation === 'inventory drift') writeFileSync(join(root, inventory.inventoryFileName), '{}\n')
      if (mutation === 'missing inventory') rmSync(join(root, inventory.inventoryFileName))
      await expect(hook(context)).rejects.toThrow(mutation === 'missing inventory' ? 'ENOENT' : /dependency inventory/)
    })
  }
})
