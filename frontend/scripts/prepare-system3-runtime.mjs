/** Stage the own built Harness with explicit product edition exclusions or a checkout identity. */
import { access, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile, readdir, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { prepareBrand } from './prepare-brand.mjs'
import { patchSystem3Runtime } from './patch-system3-runtime.mjs'
import { generateSystem3Patch } from './generate-system3-patch.mjs'
import dependencyInventory from './runtime-dependency-inventory.cjs'
import packageMetadata from './package-metadata-policy.cjs'
import productEdition from './product-edition.cjs'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const edition = productEdition.resolveEditionFromArgs(args)
const sourceIndex = args.indexOf('--source')
const source = sourceIndex >= 0 ? args[sourceIndex + 1] : (process.env.SYSTEM3_HARNESS_ROOT || join(appRoot, '..'))
if (!source) throw new Error('--source requires a Harness checkout path')
const sourceRoot = await realpath(resolve(source))
const artifactRoot = join(appRoot, '.build', 'system3-runtime')
const deployed = args.includes('--deploy')
if (args.includes('--deployed')) throw new Error('Use --deploy to create and verify a production dependency closure')
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error('Harness source revision is invalid')
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim().length > 0
if (deployed && sourceDirty && !args.includes('--allow-dirty')) throw new Error('Production preparation requires committed Harness source; --allow-dirty is for local acceptance only')
const version = '0.1.7-rc.2'
const names = ['system3-policy', 'system3', 'system3-evidence', 'system3-supervisor', 'apus-dsh-jev-plugin', 'client-ui-system3']
const sourceDefinitions = [['@deepseek-ai/dsh', 'apps/cli/package.json'], ...names.map(name => [`@deepseek-ai/dsh-experimental-${name}`, `packages/experimental/${name}/package.json`])]
async function checkPackages(root, definitions) {
  for (const [name, path] of definitions) {
    const actual = await realpath(join(root, path))
    const rel = relative(root, actual)
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error(`${name} escapes runtime root`)
    const pkg = JSON.parse(await readFile(actual, 'utf8'))
    if (pkg.name !== name || pkg.version !== version) throw new Error(`${name} must be the own ${version} package`)
  }
}
await checkPackages(sourceRoot, sourceDefinitions)
await access(join(sourceRoot, 'apps/cli/lib/bin.js'))
await prepareBrand(sourceRoot, appRoot)
const licenseRoot = join(appRoot, '.build/licenses')
await mkdir(licenseRoot, { recursive: true })
for (const [source, destination] of [
  [join(appRoot, 'LICENSE'), 'LICENSE.txt'],
  [join(appRoot, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.txt'],
  [join(sourceRoot, 'LICENSE'), 'HARNESS-LICENSE.txt'],
  [join(sourceRoot, 'THIRD_PARTY_NOTICES.md'), 'HARNESS-THIRD_PARTY_NOTICES.txt'],
  [join(appRoot, 'node_modules/electron/dist/LICENSE'), 'ELECTRON-LICENSE.txt'],
  [join(appRoot, 'node_modules/electron/dist/LICENSES.chromium.html'), 'CHROMIUM-LICENSES.html']
]) await cp(source, join(licenseRoot, destination))
await mkdir(dirname(artifactRoot), { recursive: true })
const stage = `${artifactRoot}.stage-${process.pid}`
let root = sourceRoot
let buildSource
try {
  if (deployed) {
    execFileSync(process.execPath, [join(appRoot, 'scripts/prepare-ppt-runtime.mjs')], { cwd: appRoot, stdio: 'inherit' })
    // pnpm legacy deploy changes source installation metadata, so run it in an isolated copy.
    buildSource = await mkdtemp(join(tmpdir(), 'system3-deploy-source-'))
    const excluded = new Set(['node_modules', '.git', '.Codex', '.build', '.venv', '__pycache__'])
    for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vendor', 'packages', 'native', 'apps', 'deploy', 'scripts', 'python', 'website', 'benchmarks', 'patches']) {
      if (!existsSync(join(sourceRoot, name))) continue
      await cp(join(sourceRoot, name), join(buildSource, name), { recursive: true,
        filter: path => !relative(sourceRoot, path).split(/[\\/]/).some(part => excluded.has(part) || part === '.env' || part.startsWith('.env.')) })
    }
    const desktopPackage = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
    const closurePath = join(buildSource, 'deploy/system3/runtime/package.json')
    const closure = JSON.parse(await readFile(closurePath, 'utf8'))
    const cliPath = join(buildSource, 'apps/cli/package.json')
    const cli = JSON.parse(await readFile(cliPath, 'utf8'))
    for (const [name, spec] of Object.entries(desktopPackage.dependencies)) {
      if (!spec.startsWith('file:')) continue
      const pluginRoot = ['dsh-ppt', 'dsh-ppt-composer'].includes(name)
        ? join(appRoot, '.build/ppt-runtime/packages', name)
        : join(appRoot, spec.slice(5))
      await cp(pluginRoot, join(buildSource, 'packages/desktop', name), { recursive: true,
        filter: path => !relative(pluginRoot, path).split(/[\\/]/).some(part => part === 'node_modules' || part === '.env' || part.startsWith('.env.')) })
      const copiedManifest = join(buildSource, 'packages/desktop', name, 'package.json')
      const plugin = JSON.parse(await readFile(copiedManifest, 'utf8'))
      for (const dependency of Object.keys(plugin.dependencies ?? {})) {
        if (desktopPackage.dependencies[dependency]?.startsWith('file:')) plugin.dependencies[dependency] = 'workspace:*'
      }
      await writeFile(copiedManifest, JSON.stringify(plugin))
      closure.dependencies[name] = 'workspace:*'
      cli.dependencies[name] = 'workspace:*'
    }
    for (const [name] of sourceDefinitions.slice(1)) cli.dependencies[name] = 'workspace:*'
    for (const name of ['@deepseek-ai/dsh-deepseek-account', 'react-dom']) {
      if (desktopPackage.dependencies[name]) closure.dependencies[name] = cli.dependencies[name] = name.startsWith('@deepseek-ai/') ? 'workspace:*' : desktopPackage.dependencies[name]
    }
    await writeFile(closurePath, JSON.stringify(closure))
    await writeFile(cliPath, JSON.stringify(cli))
    const sourcePackagePath = join(buildSource, 'package.json')
    const sourcePackage = JSON.parse(await readFile(sourcePackagePath, 'utf8'))
    // Legacy deploy resolves bin paths against the selected project; select the temporary workspace root.
    sourcePackage.name = 'apus-desktop-temporary-deploy-root'
    sourcePackage.dependencies = closure.dependencies
    sourcePackage.files = ['package.json']
    delete sourcePackage.devDependencies
    delete sourcePackage.scripts
    await writeFile(sourcePackagePath, JSON.stringify(sourcePackage))
    execFileSync(process.execPath, [join(appRoot, 'node_modules/pnpm/bin/pnpm.cjs'), '--filter', sourcePackage.name, 'deploy', '--legacy', '--prod', '--config.allow-unused-patches=true', '--config.node-linker=hoisted', '--config.auto-install-peers=false', '--config.link-workspace-packages=true', stage], { cwd: buildSource, stdio: 'inherit' })
    root = await realpath(stage)
    // Match the upstream Python carrier: legacy hoists need restoring, then materialize links.
    async function copyPackage(source, destination) {
      const nested = join(source, 'node_modules')
      await mkdir(dirname(destination), { recursive: true })
      await cp(source, destination, { recursive: true, dereference: true,
        filter: path => path !== nested && !path.startsWith(`${nested}/`) && !path.startsWith(`${nested}\\`) })
    }
    const deployedPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    for (const name of Object.keys(deployedPackage.dependencies ?? {})) {
      const destination = join(root, 'node_modules', name)
      if (!existsSync(destination)) await copyPackage(join(buildSource, 'node_modules', name), destination)
    }
    async function materialize(directory) {
      for (const item of await readdir(directory)) {
        const path = join(directory, item)
        const stat = await lstat(path)
        if (stat.isSymbolicLink()) {
          if (directory.endsWith('/.bin') || directory.endsWith('\\.bin')) { await rm(path); continue }
          const target = await realpath(path)
          await rm(path)
          await copyPackage(target, path)
        } else if (stat.isDirectory()) await materialize(path)
      }
    }
    await materialize(join(root, 'node_modules'))
    productEdition.pruneRuntimeFiles(root, { edition, platform: process.platform, arch: process.arch })
    productEdition.verifyEditionFiles(root, edition)
    if (edition === 'full') productEdition.verifyOfficeEngine(root, process.platform, process.arch)
    packageMetadata.removeExcludedMetadata(root)
    packageMetadata.verifyExcludedMetadata(root)
    await patchSystem3Runtime(root, appRoot)
    execFileSync(process.execPath, [join(appRoot, 'scripts/install-brand-assets.mjs'), root], { cwd: appRoot, stdio: 'pipe' })
    const deployedCli = JSON.parse(await readFile(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
    if (sourceDefinitions.slice(1).some(([name]) => !deployedCli.dependencies[name])) throw new Error('Own CLI resolver manifest omits a System3 package')
    const smokeImports = ['dsh-ppt/lib/preview-manifest.js', 'dsh-ppt/lib/index.js', 'dsh-ppt-composer/lib/index.js',
      ...names.map(name => `@deepseek-ai/dsh-experimental-${name}/lib/index.js`)]
    const smoke = smokeImports.map(name => `await import(${JSON.stringify(pathToFileURL(join(root, 'node_modules', name)).href)});`).join('\n')
    execFileSync(process.execPath, ['--input-type=module', '-e', smoke], { cwd: root, stdio: 'pipe', timeout: 60_000 })
  } else await mkdir(stage)
  const definitions = deployed ? sourceDefinitions.map(([name]) => [name, `node_modules/${name}/package.json`]) : sourceDefinitions
  await checkPackages(root, definitions)
  const entry = deployed ? 'node_modules/@deepseek-ai/dsh/lib/bin.js' : 'apps/cli/lib/bin.js'
  await access(join(root, entry))
  const manifest = { formatVersion: 1, product: 'xdan-system3', version, edition, editionPatch: 'product-edition.patch.yml', sourceRevision, sourceDirty,
    platform: process.platform, arch: process.arch, mode: deployed ? 'deployed' : 'workspace',
    ...(deployed ? { dependencyInventory: dependencyInventory.writeDependencyInventory(root) } : { sourceRoot }), entry, packages: definitions.map(([name, path]) => ({ name, path })) }
  await generateSystem3Patch(stage, { sourceRoot, mode: manifest.mode, edition })
  await writeFile(join(stage, manifest.editionPatch), productEdition.editionPatch(edition))
  await writeFile(join(stage, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const previous = `${artifactRoot}.previous-${process.pid}`
  let hadPrevious = false
  try { await rename(artifactRoot, previous); hadPrevious = true }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await rename(stage, artifactRoot) }
  catch (error) { if (hadPrevious) await rename(previous, artifactRoot); throw error }
  if (hadPrevious) await rm(previous, { recursive: true, force: true })
  console.log(`Prepared APUS Reflex Agent ${edition} runtime ${version} ${manifest.mode}: ${sourceRevision}${sourceDirty ? ' (dirty local acceptance)' : ''}`)
} finally {
  await rm(stage, { recursive: true, force: true })
  if (buildSource) await rm(buildSource, { recursive: true, force: true })
}
