/** electron-builder gate: installed applications must carry an own, target-matched closed runtime. */
const fs = require('node:fs')
const path = require('node:path')
const { verifyDependencyInventory } = require('./runtime-dependency-inventory.cjs')
const { resolveEdition, verifyEditionRuntime } = require('./product-edition.cjs')
module.exports = async context => {
  const root = path.join(context.packager.projectDir, '.build', 'system3-runtime')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'))
  if (manifest.product !== 'xdan-system3' || manifest.version !== '0.1.7-rc.2' || manifest.mode !== 'deployed'
      || !/^[0-9a-f]{40}$/.test(manifest.sourceRevision)) throw new Error('Prepare the own System3 deployed runtime before packaging')
  verifyDependencyInventory(root, manifest)
  const edition = resolveEdition(context.packager.config?.extraMetadata?.apusProductEdition ?? process.env.APUS_PRODUCT_EDITION ?? 'full')
  verifyEditionRuntime(root, edition)
  const arch = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch]
  if (manifest.platform !== context.electronPlatformName || manifest.arch !== arch) throw new Error('System3 runtime platform/architecture does not match package target')
  if (manifest.sourceDirty && process.env.SYSTEM3_ALLOW_DIRTY_PACKAGE !== '1') throw new Error('Uncommitted runtime is for acceptance only; set SYSTEM3_ALLOW_DIRTY_PACKAGE=1 explicitly or prepare a committed release')
  const required = ['@deepseek-ai/dsh', ...['system3', 'system3-policy', 'system3-evidence', 'system3-supervisor', 'apus-dsh-jev-plugin', 'client-ui-system3'].map(name => '@deepseek-ai/dsh-experimental-' + name)]
  if (!required.every(name => manifest.packages.some(item => item.name === name))) throw new Error('System3 runtime manifest is incomplete')
  const receipts = JSON.parse(fs.readFileSync(path.join(root, 'desktop-patch-receipt.json'), 'utf8'))
  if (receipts.length !== 27) throw new Error('Desktop compatibility receipt must cover all 27 maintained patches')
  for (const item of [...manifest.packages, { path: manifest.entry }]) {
    const file = fs.realpathSync(path.join(root, item.path))
    const relative = path.relative(fs.realpathSync(root), file)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('System3 package escapes deployed runtime')
    if (item.name) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (pkg.name !== item.name || pkg.version !== manifest.version) throw new Error('System3 runtime package identity mismatch')
    }
  }
}
