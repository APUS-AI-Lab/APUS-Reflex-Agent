/** Copy the closed runtime after electron-builder filtering, then verify the actual application resources. */
const fs = require('node:fs/promises')
const path = require('node:path')
const { verifyDependencyInventory } = require('./runtime-dependency-inventory.cjs')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

module.exports = async function packageSystem3Runtime(context) {
  const product = context.packager.appInfo.productFilename
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, product + '.app', 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  for (const name of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'HARNESS-LICENSE.txt', 'HARNESS-THIRD_PARTY_NOTICES.txt', 'ELECTRON-LICENSE.txt', 'CHROMIUM-LICENSES.html']) {
    const prepared = await fs.readFile(path.join(context.packager.projectDir, '.build/licenses', name))
    const packaged = await fs.readFile(path.join(resources, 'licenses', name))
    if (!prepared.equals(packaged)) throw new Error('Packaged license differs from original: ' + name)
  }
  const source = path.join(context.packager.projectDir, '.build', 'system3-runtime')
  const target = path.join(resources, 'system3-runtime')
  await fs.cp(source, target, { recursive: true, force: true, dereference: false })
  const manifest = JSON.parse(await fs.readFile(path.join(target, 'runtime-manifest.json'), 'utf8'))
  if (manifest.mode !== 'deployed' || manifest.packages.length !== 7) throw new Error('Packaged System3 runtime is incomplete')
  verifyDependencyInventory(target, manifest)
  const physicalRoot = await fs.realpath(target)
  async function requireContained(relative) {
    const file = await fs.realpath(path.join(target, relative))
    const rel = path.relative(physicalRoot, file)
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Packaged runtime escapes Resources')
    return file
  }
  for (const item of manifest.packages) {
    const pkg = JSON.parse(await fs.readFile(await requireContained(item.path), 'utf8'))
    if (pkg.name !== item.name || pkg.version !== manifest.version) throw new Error('Packaged System3 identity mismatch')
  }
  const receipts = JSON.parse(await fs.readFile(path.join(target, 'desktop-patch-receipt.json'), 'utf8'))
  if (receipts.length !== 27) throw new Error('Packaged Desktop compatibility receipt is incomplete')
  for (const receipt of receipts) for (const item of receipt.targets) {
    const hash = createHash('sha256').update(await fs.readFile(await requireContained(item.path))).digest('hex')
    if (hash !== item.sha256) throw new Error('Packaged Desktop patch hash mismatch: ' + item.path)
  }
  async function verifyPhysicalTree(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('Packaged System3 runtime contains a symlink')
      if (item.isDirectory()) await verifyPhysicalTree(path.join(directory, item.name))
    }
  }
  await verifyPhysicalTree(target)
  const executable = context.electronPlatformName === 'win32'
    ? path.join(context.appOutDir, product + '.exe')
    : path.join(resources, 'app.asar.unpacked', 'node_modules', 'node', 'bin', 'node')
  const result = await execFileAsync(executable, [await requireContained(manifest.entry), '--version'], {
    cwd: target, timeout: 30_000, maxBuffer: 1024 * 1024,
    env: context.electronPlatformName === 'win32' ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
  })
  if (result.stdout.trim() !== manifest.version) throw new Error('Packaged dsh runtime version mismatch')
  const imports = ['dsh-ppt/lib/preview-manifest.js', 'dsh-ppt/lib/index.js', 'dsh-ppt-composer/lib/index.js',
    ...manifest.packages.filter(item => item.name !== '@deepseek-ai/dsh').map(item => item.name + '/lib/index.js')]
  const smoke = imports.map(name => 'await import(' + JSON.stringify(pathToFileURL(path.join(target, 'node_modules', name)).href) + ');').join('\n')
  await execFileAsync(executable, ['--input-type=module', '-e', smoke], { cwd: target, timeout: 60_000, maxBuffer: 1024 * 1024,
    env: context.electronPlatformName === 'win32' ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env })
  await require('./verify-packaged-ppt-runtime.cjs')(context)
  console.log('System3 packaged resources verified: 7 own packages, 27 compatibility patches, ' + manifest.version)
}
