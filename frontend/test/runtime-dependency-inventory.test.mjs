import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import inventory from '../scripts/runtime-dependency-inventory.cjs'
import beforePack from '../scripts/verify-system3-runtime.cjs'
import afterPack from '../scripts/package-system3-runtime.cjs'
import metadata from '../scripts/package-metadata-policy.cjs'
import asar from '@electron/asar'
import productEdition from '../scripts/product-edition.cjs'

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
  const manifest = { product: 'xdan-system3', version: '0.1.7-rc.2', mode: 'deployed', edition: 'full', editionPatch: 'product-edition.patch.yml', sourceRevision: 'a'.repeat(40), sourceDirty: false, platform: 'darwin', arch: 'arm64', packages, entry, dependencyInventory: inventory.writeDependencyInventory(root) }
  writeFileSync(join(root, manifest.editionPatch), productEdition.editionPatch(manifest.edition))
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


describe('upstream CI metadata exclusion', () => {
  it.each(metadata.excludedMetadata)('removes only %s and rejects its return in the deployed runtime', async file => {
    const { root, manifest, context } = fixture()
    const directory = join(root, file, '..')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(root, file), 'repo_token: fixture-only-not-a-credential\n')
    writeFileSync(join(directory, 'LICENSE'), 'retained license')
    writeFileSync(join(directory, 'index.js'), 'retained code')
    expect(() => inventory.verifyDependencyInventory(root, manifest)).toThrow('excluded CI metadata')
    await expect(beforePack(context)).rejects.toThrow('excluded CI metadata')
    await expect(afterPack(context)).rejects.toThrow('excluded CI metadata')
    metadata.removeExcludedMetadata(root)
    expect(() => metadata.verifyExcludedMetadata(root)).not.toThrow()
    expect(existsSync(join(root, file))).toBe(false)
    expect(readFileSync(join(directory, 'LICENSE'), 'utf8')).toBe('retained license')
    expect(readFileSync(join(directory, 'index.js'), 'utf8')).toBe('retained code')
    metadata.removeExcludedMetadata(root)
  })

  it.each(metadata.excludedMetadata)('rejects %s in an actual ASAR and unpacked resources', async file => {
    const { project, context } = fixture()
    const input = join(project, 'asar-input')
    const resources = join(context.appOutDir, 'APUS.app/Contents/Resources')
    mkdirSync(join(input, file, '..'), { recursive: true })
    writeFileSync(join(input, file), 'repo_token: fixture-only-not-a-credential\n')
    await asar.createPackage(input, join(resources, 'app.asar'))
    expect(() => metadata.verifyPackagedMetadata(resources)).toThrow('ASAR contains excluded CI metadata')
    await expect(afterPack(context)).rejects.toThrow('ASAR contains excluded CI metadata')
    metadata.removeExcludedMetadata(input)
    writeFileSync(join(input, 'LICENSE'), 'retained license')
    await asar.createPackage(input, join(resources, 'app.asar'))
    asar.uncache(join(resources, 'app.asar'))
    expect(() => metadata.verifyPackagedMetadata(resources)).not.toThrow()
    expect(asar.extractFile(join(resources, 'app.asar'), 'LICENSE').toString()).toBe('retained license')
    const unpacked = join(resources, 'app.asar.unpacked')
    mkdirSync(join(unpacked, file, '..'), { recursive: true })
    writeFileSync(join(unpacked, file), 'repo_token: fixture-only-not-a-credential\n')
    expect(() => metadata.verifyPackagedMetadata(resources)).toThrow('excluded CI metadata')
  })

  it('wires preparation cleanup, electron-builder exclusions, and the final resource check', () => {
    const prepare = readFileSync(new URL('../scripts/prepare-system3-runtime.mjs', import.meta.url), 'utf8')
    expect(prepare).toContain('packageMetadata.removeExcludedMetadata(root)')
    expect(prepare).toContain('packageMetadata.verifyExcludedMetadata(root)')
    const config = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build
    for (const file of metadata.excludedMetadata) expect(config.files).toContain('!' + file)
    expect(config.afterPack).toBe('scripts/package-system3-runtime.cjs')
  })
})
