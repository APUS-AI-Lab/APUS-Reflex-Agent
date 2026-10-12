/** Prepare, launch and package the integrated desktop from this repository. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const frontend = join(root, 'frontend')

/** Locate npm's JavaScript entry so Windows never needs a shell or npm.cmd. */
export function npmEntry(environment = process.env, executable = process.execPath) {
  const directories = [dirname(executable), ...(environment.PATH ?? '').split(delimiter)]
  for (const directory of directories) {
    for (const candidate of [join(directory, 'node_modules/npm/bin/npm-cli.js'), join(directory, '../lib/node_modules/npm/bin/npm-cli.js'), join(directory, 'npm')]) {
      if (!existsSync(candidate)) continue
      const actual = realpathSync(candidate)
      if (actual.endsWith('npm-cli.js')) return actual
    }
  }
  throw new Error('npm is required. Install a supported Node.js distribution including npm.')
}

function run(command, args, cwd = root, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.signal || result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} failed (${result.signal ?? result.status}). Correct the reported error and run this command again.`)
}

function node(script, args = [], cwd = root, environment = process.env) {
  run(process.execPath, [join(cwd, script), ...args], cwd, environment)
}

function npm(args) {
  run(process.execPath, [npmEntry(), '--workspaces=false', ...args], frontend)
}

function pnpm(args) {
  const entry = process.env.npm_execpath
  if (!entry || !/pnpm/i.test(entry)) throw new Error('Run this command with pnpm run; pnpm 11.7.0 is required.')
  run(process.execPath, [entry, ...args])
}

/** Refuse unsupported hosts before installing dependencies. */
export function checkNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  if (!(major >= 24 || (major === 22 && minor >= 19))) throw new Error('Node.js 22.19+ (22.x) or 24+ is required.')
}

function preflight() {
  checkNode()
  npmEntry()
  for (const command of ['git', ...(process.platform === 'win32' ? [] : ['cc'])]) {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true })
    if (result.error || result.status !== 0) throw new Error(`${command} is required. Install Git and your platform C build tools (Xcode Command Line Tools on macOS).`)
  }
  console.log('Prerequisites found. Native compilation will also check the platform Node headers.')
}

/** Ordered stages keep runtime copies separate from writes to Harness artifacts. */
export function productStages(action, platform = process.platform) {
  const stages = {
    setup: ['preflight', 'install-harness', 'install-desktop', 'build-harness', 'prepare-runtime', 'build-desktop'],
    dev: ['require-build', 'dev-desktop'],
    start: ['require-build', 'start-desktop'],
    package: ['preflight', 'check-release', 'build-harness', 'deploy-runtime', 'build-desktop', 'package-desktop'],
    check: ['preflight'],
  }
  if (!Object.hasOwn(stages, action)) throw new Error('Usage: pnpm run setup | dev:desktop | start:desktop | package:product [--unsigned]')
  const selected = stages[action]
  if (platform === 'linux' && selected.includes('build-harness')) selected.splice(selected.indexOf('build-harness') + 1, 0, 'build-native-linux')
  return selected
}

/** Select the builder platform without treating an unknown host as macOS. */
export function desktopBuilderFlag(platform) {
  if (platform === 'darwin') return '--mac'
  if (platform === 'win32') return '--win'
  if (platform === 'linux') return '--linux'
  throw new Error(`Unsupported desktop platform ${platform}.`)
}

/** Execute an explicit product action; packaging never publishes a release. */
export async function main(args = process.argv.slice(2)) {
  const [action, ...options] = args
  if (options.some(option => option !== '--unsigned') || (options.length && action !== 'package')) throw new Error('Only package accepts --unsigned.')
  for (const stage of productStages(action)) {
    console.log(`APUS: ${stage}`)
    switch (stage) {
      case 'preflight': preflight(); break
      case 'install-harness': pnpm(['install', '--frozen-lockfile']); break
      case 'install-desktop': npm(['ci']); break
      case 'build-harness': pnpm(['run', 'build']); break
      case 'build-native-linux':
        pnpm(['--dir', 'native/system', 'run', 'build:native'])
        node('native/system/scripts/verify-launcher-binary.mjs', [`packages/linux-${process.arch}`])
        break
      case 'prepare-runtime': node('scripts/prepare-system3-runtime.mjs', ['--deploy', '--allow-dirty'], frontend); break
      case 'deploy-runtime': node('scripts/prepare-system3-runtime.mjs', ['--deploy'], frontend); break
      case 'build-desktop': npm(['run', 'build']); break
      case 'dev-desktop': npm(['run', 'dev']); break
      case 'start-desktop': npm(['run', 'preview']); break
      case 'require-build':
        for (const file of ['apps/cli/lib/bin.js', 'frontend/.build/system3-runtime/runtime-manifest.json', 'frontend/out/main/index.js']) {
          if (!existsSync(join(root, file))) throw new Error(`Missing ${file}. Run pnpm run setup first.`)
        }
        break
      case 'check-release':
        node('scripts/product-release.mjs', ['check'])
        if (!options.includes('--unsigned') || JSON.parse(readFileSync(join(root, 'release/manifest.json'), 'utf8')).channel === 'stable') throw new Error('Use --unsigned for a preview release. Signed release verification is not configured.')
        break
      case 'package-desktop': {
        const manifest = JSON.parse(readFileSync(join(root, 'release/manifest.json'), 'utf8'))
        const target = `${process.platform}-${process.arch}`
        if (!manifest.targets.includes(target)) throw new Error(`Release ${manifest.version} does not qualify ${target}.`)
        node('scripts/verify-target.mjs', [process.platform, process.arch], frontend)
        const builder = process.platform === 'win32' ? 'scripts/electron-builder-windows.mjs' : 'node_modules/electron-builder/cli.js'
        const environment = options.includes('--unsigned') ? { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } : process.env
        const builds = join(root, '.artifacts/product-build')
        mkdirSync(builds, { recursive: true })
        const directory = mkdtempSync(join(builds, `${manifest.version}-`))
        node(builder, [desktopBuilderFlag(process.platform), `--${process.arch}`, '--publish', 'never', `--config.directories.output=${directory}`], frontend, environment)
        const { recordBuild } = await import('./product-release.mjs')
        recordBuild(directory)
        node('scripts/product-release.mjs', ['collect', ...(options.includes('--unsigned') ? ['--unsigned'] : [])])
        break
      }
      default: throw new Error(`Unknown product stage: ${stage}`)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
