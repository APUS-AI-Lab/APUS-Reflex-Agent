import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import productEdition from '../scripts/product-edition.cjs'
import inventory from '../scripts/runtime-dependency-inventory.cjs'
import { generateSystem3Patch } from '../scripts/generate-system3-patch.mjs'
import beforePack from '../scripts/verify-system3-runtime.cjs'

const require = createRequire(import.meta.url)
const { doMergeConfigs } = require('app-builder-lib/out/util/config/config.js')
const { getFileMatchers, getMainFileMatchers, getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher.js')
const { AsarPackager } = require('app-builder-lib/out/asar/asarUtil.js')
const { listPackage } = require('@electron/asar')
const base = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build
const roots = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'apus-edition-'))
  roots.push(root)
  return root
}
function fileAt(root, relative, value = 'retained code') {
  const file = join(root, relative)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, value)
  return file
}
function packageAt(root, name, dependencies) {
  return fileAt(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', ...dependencies }))
}
function matchers(root, edition, platform, arch) {
  const config = doMergeConfigs([productEdition.createBuilderConfig(base, edition, platform, arch)])
  const info = { config, projectDir: root, buildResourcesDir: 'build', isPrepackedAppAsar: false, debugLogger: { isEnabled: false } }
  const platformOptions = config[platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux']
  return {
    main: getMainFileMatchers(root, join(root, 'packed'), value => value, platformOptions, { info }, join(root, 'dist'), false),
    dependencies: getNodeModuleFileMatcher(root, join(root, 'packed'), value => value, platformOptions, info),
  }
}
function accepted(root, matcher, relative) {
  const file = fileAt(root, relative)
  return matcher.createFilter()(file, lstatSync(file))
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Full / Lite product editions', () => {
  it('defaults to Full and rejects misspelled, empty and duplicate edition arguments', () => {
    expect(productEdition.resolveEdition()).toBe('full')
    expect(productEdition.resolveEditionFromArgs([], {})).toBe('full')
    expect(productEdition.resolveEditionFromArgs(['--deploy', '--edition', 'lite'], { APUS_PRODUCT_EDITION: 'full' })).toBe('lite')
    expect(productEdition.resolveEditionFromArgs(['--edition=full'], { APUS_PRODUCT_EDITION: 'lite' })).toBe('full')
    for (const value of ['Full', 'slim', '', null]) expect(() => productEdition.resolveEdition(value)).toThrow('full or lite')
    expect(() => productEdition.resolveEditionFromArgs(['--edition', '--deploy'])).toThrow('requires')
    expect(() => productEdition.resolveEditionFromArgs(['--edition='])).toThrow('requires')
    expect(() => productEdition.resolveEditionFromArgs(['--edition=full', '--edition=lite'])).toThrow('only once')
    expect(() => productEdition.resolveEditionFromArgs([], { APUS_PRODUCT_EDITION: 'unknown' })).toThrow('full or lite')
  })

  it.each(['full', 'lite'])('names %s artifacts while preserving installation identity', edition => {
    const config = productEdition.createBuilderConfig(base, edition, 'darwin', 'arm64')
    expect(config.artifactName).toBe(`apus-reflex-agent-${edition}-\${os}-\${arch}.\${ext}`)
    expect(config.nsis.artifactName).toBe(`apus-reflex-agent-${edition}-windows-\${arch}-setup.\${ext}`)
    expect(config.deb.artifactName).toBe(`apus-reflex-agent-${edition}-linux-x64.deb`)
    expect(config.extraMetadata.apusProductEdition).toBe(edition)
    expect(config.directories.output).toBe(`dist/${edition}`)
    expect(config.appId).toBe(base.appId)
    expect(config.productName).toBe(base.productName)
    expect(config.mac.minimumSystemVersion).toBe('15.0')
    expect(config.mac.identity).toBe('-')
    expect(config.mac.notarize).toBe(false)
    expect(config.mac.strictVerify).toBe(true)
    expect(config.afterSign).toBe('scripts/verify-macos-signature.cjs')
    expect(config.linux.executableName).toBe(base.linux.executableName)
    expect(config.deb.packageName).toBe(base.deb.packageName)
    expect(base.extraMetadata).toBeUndefined()
  })

  it.each([['darwin', 'arm64'], ['win32', 'x64'], ['linux', 'x64']])('stages the %s-%s target without maps, foreign binaries or Lite engines', (platform, arch) => {
    const root = fixture()
    const engineNames = ['@deepseek-ai/libreoffice-kit', '@deepseek-ai/libreoffice-kit-wasm', `@deepseek-ai/libreoffice-kit-${platform}-${arch}`]
    for (const name of engineNames) packageAt(root, name)
    packageAt(root, 'retained')
    fileAt(root, 'node_modules/retained/LICENSE', 'retained license')
    fileAt(root, 'node_modules/retained/index.js.map', 'debug information')
    fileAt(root, `node_modules/node-pty/prebuilds/${platform}-${arch}/conpty.dll`)
    fileAt(root, 'node_modules/node-pty/prebuilds/foreign-x64/binary.node')
    const removed = productEdition.pruneRuntimeFiles(root, { edition: 'lite', platform, arch })
    expect(removed.map(item => item.reason)).toContain('source map')
    expect(removed.map(item => item.reason)).toContain('foreign node-pty prebuild')
    for (const name of engineNames) expect(existsSync(join(root, 'node_modules', name))).toBe(false)
    expect(existsSync(join(root, `node_modules/node-pty/prebuilds/${platform}-${arch}/conpty.dll`))).toBe(true)
    expect(readFileSync(join(root, 'node_modules/retained/LICENSE'), 'utf8')).toBe('retained license')
    expect(() => productEdition.verifyEditionFiles(root, 'lite', { platform, arch })).not.toThrow()
    packageAt(root, '@deepseek-ai/libreoffice-kit-wasm')
    expect(() => productEdition.verifyEditionFiles(root, 'lite', { platform, arch })).toThrow('Office engine')
  })

  it('keeps Full engines and rejects missing declared native engines', () => {
    const root = fixture()
    packageAt(root, '@deepseek-ai/libreoffice-kit', { optionalDependencies: { '@deepseek-ai/libreoffice-kit-win32-x64': '1.0.0', '@deepseek-ai/libreoffice-kit-wasm': '1.0.0' } })
    packageAt(root, '@deepseek-ai/libreoffice-kit-wasm')
    productEdition.pruneRuntimeFiles(root, { edition: 'full', platform: 'win32', arch: 'x64' })
    expect(() => productEdition.verifyOfficeEngine(root, 'win32', 'x64')).toThrow('declared Office engine')
    packageAt(root, '@deepseek-ai/libreoffice-kit-win32-x64')
    expect(productEdition.verifyOfficeEngine(root, 'win32', 'x64')).toBe('@deepseek-ai/libreoffice-kit-win32-x64')
    expect(productEdition.verifyOfficeEngine(root, 'linux', 'x64')).toBe('@deepseek-ai/libreoffice-kit-wasm')
  })

  it('rejects symlinks before following source installations', () => {
    const root = fixture()
    const source = fixture()
    const sourceMap = fileAt(source, 'index.js.map', 'unchanged source installation')
    symlinkSync(source, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => productEdition.pruneRuntimeFiles(root, { edition: 'lite' })).toThrow('symlink')
    expect(readFileSync(sourceMap, 'utf8')).toBe('unchanged source installation')
  })

  it('records an inventory of the actual pruned packages and rejects edition or overlay drift', () => {
    const root = fixture()
    packageAt(root, 'retained')
    packageAt(root, '@deepseek-ai/libreoffice-kit')
    productEdition.pruneRuntimeFiles(root, { edition: 'lite' })
    const manifest = { mode: 'deployed', edition: 'lite', editionPatch: 'product-edition.patch.yml', platform: process.platform, arch: process.arch, dependencyInventory: inventory.writeDependencyInventory(root) }
    fileAt(root, 'runtime-manifest.json', JSON.stringify(manifest))
    fileAt(root, 'product-edition.patch.yml', productEdition.editionPatch('lite'))
    expect(inventory.verifyDependencyInventory(root, manifest)).toEqual(manifest.dependencyInventory)
    expect(JSON.parse(readFileSync(join(root, 'runtime-dependencies.json'), 'utf8')).packages.map(item => item.name)).toEqual(['retained'])
    expect(productEdition.verifyEditionRuntime(root, 'lite')).toMatchObject({ edition: 'lite' })
    expect(() => productEdition.verifyEditionRuntime(root, 'full')).toThrow('Runtime edition differs')
    fileAt(root, 'product-edition.patch.yml', '- id: office-to-pdf\n  disabled: false\n')
    expect(() => productEdition.verifyEditionRuntime(root, 'lite')).toThrow('overlay differs')
  })

  it('rejects a mismatched Desktop edition before packaging a valid runtime inventory', async () => {
    const project = fixture()
    const root = join(project, '.build/system3-runtime')
    packageAt(root, 'retained')
    fileAt(root, 'product-edition.patch.yml', productEdition.editionPatch('lite'))
    const manifest = { product: 'xdan-system3', version: '0.1.7-rc.2', mode: 'deployed', sourceRevision: 'a'.repeat(40), edition: 'lite', editionPatch: 'product-edition.patch.yml', platform: process.platform, arch: process.arch, dependencyInventory: inventory.writeDependencyInventory(root) }
    fileAt(root, 'runtime-manifest.json', JSON.stringify(manifest))
    await expect(beforePack({ packager: { projectDir: project, config: { extraMetadata: { apusProductEdition: 'full' } } } })).rejects.toThrow('Runtime edition differs')
  })

  it.each(['full', 'lite'])('generates the %s Desktop defaults with no remote export and the correct provider state', async edition => {
    const root = fixture()
    await generateSystem3Patch(root, { edition })
    const content = readFileSync(join(root, 'desktop.patch.yml'), 'utf8')
    expect(content).toContain('session-log-deepseek')
    expect(content).toContain('enabled: false')
    expect(content.includes('- id: office-to-pdf\n  disabled: true')).toBe(edition === 'lite')
    expect(content).not.toContain('- id: skill-office')
  })
})

describe('pinned electron-builder production file matching', () => {
  it.each(['full', 'lite'].flatMap(edition => [
    [edition, 'darwin', 'arm64'], [edition, 'darwin', 'x64'],
    [edition, 'win32', 'x64'], [edition, 'linux', 'x64'],
  ]))('unpacks generated PPT mappings without a duplicate staging tree for %s %s-%s', async (edition, platform, arch) => {
    const root = fixture()
    const destination = join(root, 'packed')
    const resources = join(root, 'resources')
    mkdirSync(resources)
    const config = doMergeConfigs([productEdition.createBuilderConfig(base, edition, platform, arch)])
    const { main } = matchers(root, edition, platform, arch)
    const application = main.find(item => item.from === root)
    const fileSets = ['dsh-ppt', 'dsh-ppt-composer'].map(name => {
      const file = fileAt(root, `.build/ppt-runtime/packages/${name}/lib/index.js`, 'export const available = true;\n')
      const mapping = main.find(item => item.to === join(destination, 'node_modules', name))
      const stat = lstatSync(file)
      expect(application.createFilter()(file, stat)).toBe(false)
      expect(mapping.createFilter()(file, stat)).toBe(true)
      return { src: mapping.from, destination: mapping.to, files: [file], metadata: new Map([[file, stat]]) }
    })
    const unpack = getFileMatchers(config, 'asarUnpack', destination, {
      defaultSrc: root, globalOutDir: resources, macroExpander: value => value,
      customBuildOptions: config[platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'],
    })[0]
    await new AsarPackager({ info: { getWorkspaceRoot: async () => root } }, {
      defaultDestination: destination, resourcePath: resources,
      options: { smartUnpack: false }, unpackPattern: unpack.createFilter(),
    }).pack(fileSets)
    for (const name of ['dsh-ppt', 'dsh-ppt-composer']) {
      expect(readFileSync(join(resources, 'app.asar.unpacked', 'node_modules', name, 'lib/index.js'), 'utf8')).toBe('export const available = true;\n')
    }
    expect(listPackage(join(resources, 'app.asar')).some(file => file.includes('.build/ppt-runtime'))).toBe(false)
  })

  it.each([['darwin', 'arm64'], ['win32', 'x64'], ['linux', 'x64']])('rejects checkout files and selects native dependencies for %s-%s Lite', (platform, arch) => {
    const root = fixture()
    const { main, dependencies } = matchers(root, 'lite', platform, arch)
    const application = main.find(item => item.from === root)
    expect(application).toBeDefined()
    expect(accepted(root, application, 'out/main/index.js')).toBe(true)
    expect(accepted(root, application, 'package.json')).toBe(true)
    for (const relative of ['src/main/index.ts', 'test/runtime.test.ts', 'docs/architecture.md', '.npmrc', '.build/licenses/CHROMIUM-LICENSES.html']) {
      expect(accepted(root, application, relative), relative).toBe(false)
    }
    expect(main.some(item => item.to.endsWith('node_modules/dsh-ppt'))).toBe(true)
    expect(accepted(root, dependencies, 'node_modules/ws/index.js')).toBe(true)
    expect(accepted(root, dependencies, 'node_modules/ws/index.js.map')).toBe(false)
    for (const relative of ['node_modules/@deepseek-ai/libreoffice-kit/lib/index.js', 'node_modules/@deepseek-ai/libreoffice-kit-wasm/engine.wasm', `node_modules/@deepseek-ai/libreoffice-kit-${platform}-${arch}/engine`]) {
      expect(accepted(root, dependencies, relative), relative).toBe(false)
    }
    expect(accepted(root, dependencies, `node_modules/node-pty/prebuilds/${platform}-${arch}/binary.node`)).toBe(true)
    expect(accepted(root, dependencies, 'node_modules/node-pty/prebuilds/foreign-x64/binary.node')).toBe(false)
    expect(accepted(root, dependencies, 'node_modules/node/bin/node')).toBe(platform !== 'win32')
  })

  it('retains the Full Office native payload with the same pinned matcher', () => {
    const root = fixture()
    const { dependencies } = matchers(root, 'full', 'darwin', 'arm64')
    expect(accepted(root, dependencies, 'node_modules/@deepseek-ai/libreoffice-kit/lib/index.js')).toBe(true)
    expect(accepted(root, dependencies, 'node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/engine')).toBe(true)
  })
})
