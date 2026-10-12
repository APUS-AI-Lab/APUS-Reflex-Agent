/** Collect a complete native Linux Web product from the deployed Harness runtime. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dependencyInventory from '../frontend/scripts/runtime-dependency-inventory.cjs'
import { checkRelease } from './product-release.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const json = file => JSON.parse(readFileSync(file, 'utf8'))
export const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')
export const archiveName = 'apus-reflex-harness-web-linux-x64.tar.gz'
export const linuxNativePackage = 'node_modules/@deepseek-ai/node-addon-system-linux-x64'

/** Record every physical payload file; reject links rather than trusting a checkout. */
export function payloadFiles(directory) {
  const records = []
  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      const file = join(current, name)
      const stat = lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error(`Web archive must not contain links: ${relative(directory, file)}`)
      if (stat.isDirectory()) walk(file)
      else if (stat.isFile()) records.push({ path: relative(directory, file).split('\\').join('/'), sha256: digest(file) })
      else throw new Error('Web archive contains a non-file entry.')
    }
  }
  walk(directory)
  return records
}

/** Reject stale, workspace-backed, or cross-platform deployment inputs. */
export function verifyWebRuntime(runtime, revision) {
  if (runtime.mode !== 'deployed' || runtime.sourceDirty || runtime.sourceRevision !== revision
    || runtime.platform !== 'linux' || runtime.arch !== 'x64'
    || runtime.entry !== 'node_modules/@deepseek-ai/dsh/lib/bin.js') {
    throw new Error('Web packaging requires a clean same-commit deployed Linux x64 runtime.')
  }
}

/** Create the tarball and independent Web release metadata; never publish it. */
export function packageWeb(base = root) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build Web archives on a native Linux x64 runner.')
  const manifest = checkRelease(base)
  const git = args => execFileSync('git', args, { cwd: base, encoding: 'utf8' }).trim()
  if (git(['status', '--porcelain'])) throw new Error('Web packaging requires a clean source checkout.')
  const revision = git(['rev-parse', 'HEAD'])
  const prepared = join(base, 'frontend/.build/system3-runtime')
  const runtime = json(join(prepared, 'runtime-manifest.json'))
  verifyWebRuntime(runtime, revision)
  dependencyInventory.verifyDependencyInventory(prepared, runtime)
  for (const path of [runtime.entry, 'node_modules/@deepseek-ai/dsh-web-app/lib/index.js',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
    'node_modules/@deepseek-ai/dsh-experimental-client-ui-system3/lib/client.js',
    'node_modules/@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin/lib/index.js',
    `${linuxNativePackage}/bin/landlock-run`, `${linuxNativePackage}/bin/glibc/system.node`,
    `${linuxNativePackage}/bin/musl/system.node`]) {
    if (!existsSync(join(prepared, path))) throw new Error(`Web runtime is missing ${path}`)
  }
  if (existsSync(join(prepared, 'node_modules/electron'))) throw new Error('Web runtime must not include Electron.')
  const nodeRoot = join(base, 'frontend/node_modules/node')
  const node = join(nodeRoot, 'bin/node')
  const pin = json(join(base, 'frontend/package.json')).dependencies.node
  const probe = JSON.parse(execFileSync(node, ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'], { encoding: 'utf8' }))
  if (probe.version !== pin || probe.platform !== 'linux' || probe.arch !== 'x64') throw new Error('Bundled Node differs from the locked native version.')
  const nodePackage = join(nodeRoot, 'node_modules/node-linux-x64')
  if (json(join(nodePackage, 'package.json')).version.replace(/^v/, '') !== pin) throw new Error('Bundled Node license package version differs.')
  const output = join(base, '.artifacts/product-release', manifest.version, 'web-linux-x64')
  if (existsSync(output)) throw new Error('Web release output already exists; use a fresh build.')
  mkdirSync(output, { recursive: true })
  const stage = mkdtempSync(join(output, '.stage-'))
  const payload = join(stage, 'apus-reflex-harness-web')
  mkdirSync(join(payload, 'bin'), { recursive: true })
  try {
    cpSync(prepared, join(payload, 'runtime'), { recursive: true, dereference: false })
    copyFileSync(node, join(payload, 'bin/node'))
    chmodSync(join(payload, 'bin/node'), 0o755)
    copyFileSync(join(base, 'scripts/product-web-launch.mjs'), join(payload, 'launch.mjs'))
    writeFileSync(join(payload, 'start.sh'), '#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nunset NODE_OPTIONS NODE_PATH ELECTRON_RUN_AS_NODE\nexec "$ROOT/bin/node" "$ROOT/launch.mjs" "$@"\n', { mode: 0o755 })
    writeFileSync(join(payload, 'web.patch.yml'), '- insert:\n    - id: ui-system3\n      name: "@deepseek-ai/dsh-experimental-client-ui-system3"\n- id: session-log-deepseek\n  config:\n    enabled: false\n- id: ui-settings-account\n  disabled: true\n')
    mkdirSync(join(payload, 'licenses'))
    for (const [source, name] of [['LICENSE', 'HARNESS-LICENSE.txt'], ['THIRD_PARTY_NOTICES.md', 'HARNESS-NOTICES.md'],
      ['frontend/LICENSE', 'FRONTEND-LICENSE.txt'], ['frontend/THIRD_PARTY_NOTICES.md', 'FRONTEND-NOTICES.md']]) {
      copyFileSync(join(base, source), join(payload, 'licenses', name))
    }
    copyFileSync(join(nodePackage, 'LICENSE'), join(payload, 'licenses/NODE-LICENSE.txt'))
    for (const name of ['README.md', 'README.zh.md']) copyFileSync(join(base, 'docs/release-web-runtime', name), join(payload, name))
    const files = payloadFiles(payload)
    writeFileSync(join(payload, 'files.json'), `${JSON.stringify(files, null, 2)}\n`)
    const archive = join(output, archiveName)
    execFileSync('tar', ['-czf', archive, '-C', stage, 'apus-reflex-harness-web'])
    const sourceArchive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: base, maxBuffer: 512 * 1024 * 1024 })
    const info = { product: manifest.product, version: manifest.version, channel: manifest.channel, target: 'web-linux-x64',
      sourceRevision: revision, sourceArchiveSha256: createHash('sha256').update(sourceArchive).digest('hex'),
      bundledNode: { version: pin, sha256: digest(node) },
      lockfiles: { pnpm: digest(join(base, 'pnpm-lock.yaml')), npm: digest(join(base, 'frontend/package-lock.json')) },
      payloadManifestSha256: digest(join(payload, 'files.json')), runtimeDependencyInventory: runtime.dependencyInventory,
      assets: [{ name: archiveName, sha256: digest(archive) }] }
    writeFileSync(join(output, 'build-info-web-linux-x64.json'), `${JSON.stringify(info, null, 2)}\n`)
    copyFileSync(join(prepared, runtime.dependencyInventory.path), join(output, 'runtime-dependencies-web-linux-x64.json'))
    const names = [archiveName, 'build-info-web-linux-x64.json', 'runtime-dependencies-web-linux-x64.json']
    writeFileSync(join(output, 'SHA256SUMS-web-linux-x64'), `${names.map(name => `${digest(join(output, name))}  ${name}`).join('\n')}\n`)
    console.log(`Collected ${archive}. Native extracted-archive qualification is required before publishing.`)
    return output
  } finally { rmSync(stage, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { packageWeb() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
