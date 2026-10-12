/** Validate product versions and collect immutable, checksummed release inputs. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dependencyInventory from '../frontend/scripts/runtime-dependency-inventory.cjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')

/** Reject version drift without coupling product versions to Harness packages. */
export function validateRelease(manifest, desktop, lock) {
  if (manifest.product !== 'APUS Reflex Harness' || !/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(manifest.version)) throw new Error('Invalid APUS product release version.')
  const channels = manifest.version.includes('-beta.') ? ['beta'] : manifest.version.includes('-rc.') ? ['rc'] : ['stable', 'preview']
  if (!channels.includes(manifest.channel)) throw new Error('Product version and release channel differ.')
  if (desktop.version !== manifest.version || lock.version !== manifest.version || lock.packages['']?.version !== manifest.version) throw new Error('Update frontend/package.json and its lockfile to the release manifest version.')
  if (!Array.isArray(manifest.targets) || !manifest.targets.length || manifest.targets.some(target => !['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].includes(target))) throw new Error('Release targets must name qualified desktop platforms.')
  if (manifest.repository !== 'APUS-AI-Lab/APUS-Reflex-Harness') throw new Error('Release repository must be the APUS product repository.')
  return manifest
}

/** Read and validate all version owners before building or collecting. */
export function checkRelease(base = root, tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined) {
  const manifest = validateRelease(json(join(base, 'release/manifest.json')), json(join(base, 'frontend/package.json')), json(join(base, 'frontend/package-lock.json')))
  if (tag && tag !== `v${manifest.version}`) throw new Error(`Tag ${tag} does not match v${manifest.version}.`)
  return manifest
}

/** Identify installers for one platform, excluding stale files and updater feeds. */
export function releaseAssetNames(platform, arch) {
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return [`apus-reflex-harness-mac-${arch}.dmg`, `apus-reflex-harness-mac-${arch}.zip`]
  if (platform === 'win32' && arch === 'x64') return ['apus-reflex-harness-windows-x64-setup.exe']
  if (platform === 'linux' && arch === 'x64') return ['apus-reflex-harness-linux-x64.deb']
  throw new Error(`Unsupported installer target ${platform}-${arch}.`)
}

/** Bind a successful builder run to its unique output directory and exact bytes. */
export function recordBuild(directory, base = root) {
  const manifest = checkRelease(base)
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim()
  const runtimeRoot = join(base, 'frontend/.build/system3-runtime')
  const inventory = dependencyInventory.verifyDependencyInventory(runtimeRoot, json(join(runtimeRoot, 'runtime-manifest.json')))
  const assets = releaseAssetNames(process.platform, process.arch).map(name => ({ name, sha256: digest(join(directory, name)) }))
  const receipt = { version: manifest.version, sourceRevision, target: `${process.platform}-${process.arch}`, signing: 'unsigned-preview', runtimeDependencyInventorySha256: inventory.sha256, directory: relative(base, directory), assets }
  writeFileSync(join(base, '.artifacts/product-build-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
}

/** Refuse stale or modified installers even when an external runtime was rebuilt. */
export function verifyReceipt(receipt, manifest, revision, target, hashFile, base = root) {
  if (receipt.version !== manifest.version || receipt.sourceRevision !== revision || receipt.target !== target || receipt.signing !== 'unsigned-preview') throw new Error('Installer receipt does not match this product commit and target.')
  if (receipt.runtimeDependencyInventorySha256 !== hashFile(join(base, 'frontend/.build/system3-runtime', dependencyInventory.inventoryFileName))) throw new Error('Runtime dependency inventory differs from the installer build receipt.')
  if (typeof receipt.directory !== 'string' || isAbsolute(receipt.directory)) throw new Error('Invalid installer receipt directory.')
  const parent = join(base, '.artifacts/product-build')
  const directory = resolve(base, receipt.directory)
  const subpath = relative(parent, directory)
  if (!subpath || subpath === '..' || subpath.startsWith('../') || subpath.startsWith('..\\') || isAbsolute(subpath)) throw new Error('Installer receipt must reference one owned build directory.')
  const [platform, arch] = target.split('-')
  const expected = releaseAssetNames(platform, arch)
  if (!Array.isArray(receipt.assets) || receipt.assets.length !== expected.length) throw new Error('Installer receipt is incomplete.')
  for (const name of expected) {
    const asset = receipt.assets.find(item => item.name === name)
    if (!asset || asset.sha256 !== hashFile(join(directory, name))) throw new Error(`Installer changed after build: ${name}`)
  }
  return directory
}

/** Write supporting release files after the collector has verified the runtime and installers. */
export async function writeReleaseSupportAssets({ base, output, manifest, runtime, revision, target, assets }) {
  const [platform, arch] = target.split('-')
  releaseAssetNames(platform, arch)
  const suffix = target === 'darwin-arm64' ? '' : `-${target}`
  const names = { info: `build-info${suffix}.json`, licenses: `LICENSES${suffix}.zip`, inventory: `runtime-dependencies${suffix}.json`, checksums: `SHA256SUMS${suffix}` }
  const inventory = { ...runtime.dependencyInventory, path: names.inventory }
  copyFileSync(join(base, 'frontend/.build/system3-runtime', runtime.dependencyInventory.path), join(output, names.inventory))
  const licenseRoot = join(base, 'frontend/.build/licenses')
  const { zipSync } = await import('fflate')
  writeFileSync(join(output, names.licenses), zipSync(Object.fromEntries(readdirSync(licenseRoot).map(name => [name, readFileSync(join(licenseRoot, name))]))))
  writeFileSync(join(output, names.info), `${JSON.stringify({ ...manifest, sourceRevision: revision, target, harnessVersion: runtime.version, runtimeDependencyInventory: inventory, signing: 'unsigned-preview', lockfiles: { pnpm: digest(join(base, 'pnpm-lock.yaml')), npm: digest(join(base, 'frontend/package-lock.json')) }, assets: assets.map(name => ({ name, sha256: digest(join(output, name)) })) }, null, 2)}\n`)
  const files = [...assets, names.info, names.licenses, names.inventory]
  writeFileSync(join(output, names.checksums), `${files.map(name => `${digest(join(output, name))}  ${name}`).join('\n')}\n`)
  return names
}

/** Collect only clean, same-commit runtime artifacts; never upload from this script. */
export async function collectRelease(unsigned, base = root) {
  const manifest = checkRelease(base)
  const target = `${process.platform}-${process.arch}`
  if (!manifest.targets.includes(target)) throw new Error(`${target} is not qualified for this release.`)
  if (manifest.channel === 'stable' || !unsigned) throw new Error('This release path only supports explicitly unsigned preview releases. Signed releases require platform signature verification.')
  const git = args => execFileSync('git', args, { cwd: base, encoding: 'utf8' }).trim()
  if (git(['status', '--porcelain'])) throw new Error('Release collection requires a clean source checkout.')
  const revision = git(['rev-parse', 'HEAD'])
  const runtime = json(join(base, 'frontend/.build/system3-runtime/runtime-manifest.json'))
  if (runtime.sourceRevision !== revision || runtime.sourceDirty || runtime.mode !== 'deployed' || runtime.platform !== process.platform || runtime.arch !== process.arch) throw new Error('Rebuild the deployed runtime from this clean commit and platform before collecting.')
  const runtimeRoot = join(base, 'frontend/.build/system3-runtime')
  dependencyInventory.verifyDependencyInventory(runtimeRoot, runtime)
  const receipt = json(join(base, '.artifacts/product-build-receipt.json'))
  const directory = verifyReceipt(receipt, manifest, revision, target, digest, base)
  const output = join(base, '.artifacts/product-release', manifest.version, target)
  if (existsSync(output)) throw new Error(`Release output already exists: ${output}. Use a fresh build directory.`)
  const assets = releaseAssetNames(process.platform, process.arch)
  for (const name of assets) {
    const file = join(directory, name)
    if (!existsSync(file)) throw new Error(`Installer not found: ${name}`)
    if (readFileSync(file).length < 100 * 1024 * 1024) throw new Error(`Installer is incomplete: ${name}`)
  }
  mkdirSync(output, { recursive: true })
  for (const name of assets) copyFileSync(join(directory, name), join(output, name))
  await writeReleaseSupportAssets({ base, output, manifest, runtime, revision, target, assets })
  console.log(`Release inputs collected: ${output}. Install and verify before publishing.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, ...options] = process.argv.slice(2)
    if (options.some(option => option !== '--unsigned')) throw new Error('Only --unsigned is supported.')
    if (action === 'check') console.log(`Validated product v${checkRelease().version}`)
    else if (action === 'collect') await collectRelease(options.includes('--unsigned'))
    else throw new Error('Usage: node scripts/product-release.mjs check | collect [--unsigned]')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
