import { describe, expect, it } from 'vitest'
import { checkNode, desktopBuilderFlag, productStages } from './product.mjs'
import { releaseAssetNames, validateRelease, verifyReceipt } from './product-release.mjs'

describe('integrated product preparation', () => {
  it('installs both lockfiles before building and stages runtime before desktop assets', () => {
    expect(productStages('setup', 'darwin')).toEqual(['preflight', 'install-harness', 'install-desktop', 'build-harness', 'prepare-runtime', 'build-desktop'])
    const stages = productStages('package')
    expect(stages.indexOf('deploy-runtime')).toBeLessThan(stages.indexOf('build-desktop'))
    expect(stages.at(-1)).toBe('package-desktop')
    expect(() => productStages('publish')).toThrow('Usage')
  })

  it('builds the full Linux native payload before either runtime assembly', () => {
    for (const action of ['setup', 'package']) {
      const stages = productStages(action, 'linux')
      expect(stages.indexOf('build-native-linux')).toBe(stages.indexOf('build-harness') + 1)
      expect(stages.indexOf('build-native-linux')).toBeLessThan(stages.indexOf(action === 'setup' ? 'prepare-runtime' : 'deploy-runtime'))
      for (const platform of ['darwin', 'win32']) expect(productStages(action, platform)).not.toContain('build-native-linux')
    }
    expect(productStages('start', 'linux')).not.toContain('build-native-linux')
  })

  it('rejects unsupported Node lines before installing dependencies', () => {
    expect(() => { checkNode('22.19.0') }).not.toThrow()
    expect(() => { checkNode('24.0.0') }).not.toThrow()
    expect(() => { checkNode('22.18.0') }).toThrow('Node.js')
    expect(() => { checkNode('23.9.0') }).toThrow('Node.js')
  })
})

describe('product release identity', () => {
  const manifest = { product: 'APUS Reflex Harness', version: '0.1.0', channel: 'preview', repository: 'APUS-AI-Lab/APUS-Reflex-Harness', targets: ['darwin-arm64'] }
  const desktop = { version: manifest.version }
  const lock = { version: manifest.version, packages: { '': { version: manifest.version } } }

  it('keeps product versions aligned without rewriting the Harness version', () => {
    expect(validateRelease(manifest, desktop, lock)).toBe(manifest)
    expect(() => validateRelease(manifest, { version: '0.1.7-rc.2' }, lock)).toThrow('lockfile')
    expect(() => validateRelease({ ...manifest, channel: 'beta' }, desktop, lock)).toThrow('channel')
    expect(() => validateRelease({ ...manifest, targets: ['linux-arm64'] }, desktop, lock)).toThrow('qualified')
    expect(() => validateRelease({ ...manifest, repository: 'dataelement/dsh-desktop' }, desktop, lock)).toThrow('repository')
  })

  it('collects only installers for the selected target', () => {
    expect(releaseAssetNames('darwin', 'arm64')).toEqual(['apus-reflex-harness-mac-arm64.dmg', 'apus-reflex-harness-mac-arm64.zip'])
    expect(releaseAssetNames('linux', 'x64')).toEqual(['apus-reflex-harness-linux-x64.deb'])
    expect(() => releaseAssetNames('linux', 'arm64')).toThrow('Unsupported')
    expect(releaseAssetNames('win32', 'x64')).toEqual(['apus-reflex-harness-windows-x64-setup.exe'])
    expect(() => releaseAssetNames('win32', 'arm64')).toThrow('Unsupported')
  })

  it('rejects old, replaced or unowned installers before publishing current metadata', () => {
    const target = 'darwin-arm64'
    const receipt = { version: manifest.version, sourceRevision: 'current', target, signing: 'unsigned-preview', runtimeDependencyInventorySha256: 'original', directory: '.artifacts/product-build/run-unique', assets: releaseAssetNames('darwin', 'arm64').map(name => ({ name, sha256: 'original' })) }
    expect(() => verifyReceipt(receipt, manifest, 'current', target, () => 'original')).not.toThrow()
    expect(() => verifyReceipt(receipt, manifest, 'newer', target, () => 'original')).toThrow('commit')
    expect(() => verifyReceipt(receipt, manifest, 'current', target, file => file.endsWith('runtime-dependencies.json') ? 'original' : 'replaced')).toThrow('changed after build')
    expect(() => verifyReceipt(receipt, manifest, 'current', target, file => file.endsWith('runtime-dependencies.json') ? 'changed-runtime' : 'original')).toThrow('dependency inventory')
    expect(() => verifyReceipt({ ...receipt, runtimeDependencyInventorySha256: undefined }, manifest, 'current', target, () => 'original')).toThrow('dependency inventory')
    expect(() => verifyReceipt({ ...receipt, directory: '../stale' }, manifest, 'current', target, () => 'original')).toThrow('owned build')
    expect(() => verifyReceipt({ ...receipt, assets: [] }, manifest, 'current', target, () => 'original')).toThrow('incomplete')
  })
})
it('selects the native desktop builder flag and refuses an unsupported host', () => {
  expect(desktopBuilderFlag('darwin')).toBe('--mac')
  expect(desktopBuilderFlag('win32')).toBe('--win')
  expect(desktopBuilderFlag('linux')).toBe('--linux')
  expect(() => desktopBuilderFlag('freebsd')).toThrow('Unsupported desktop platform')
})
