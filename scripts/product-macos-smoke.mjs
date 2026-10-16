/** Qualify a copied DMG application on its native macOS architecture without developer credentials or Node. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { basename } from 'node:path'
import { readInstallerBuild, verifyInstalledEdition, verifyInstalledEditionFiles } from './product-installer-metadata.mjs'
import { verifyReflexExecution, verifyReflexSettings } from './product-reflex-smoke.mjs'

const execute = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Construct the installed application's credential-free environment.
 * @param {NodeJS.ProcessEnv} source Runner environment.
 * @param {string} profile Private user-data directory.
 * @returns {NodeJS.ProcessEnv} System-only launch environment.
 */
export function smokeEnvironment(source, profile) {
  const allowed = new Set(['USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', '__CF_USER_TEXT_ENCODING'])
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key))),
    HOME: join(profile, 'home'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    SYSTEM3_DESKTOP_USER_DATA_DIR: profile, DSH_HOME: join(profile, 'harness-home'), DSH_TELEMETRY_DISABLED: '1' }
}

/** Reject an installed runtime from another source revision or architecture.
 * @param {{mode:string,platform:string,arch:string,sourceRevision:string,sourceDirty:boolean,edition?:'full'|'lite'}} runtime Installed runtime manifest.
 * @param {{sourceRevision:string,target:string,edition?:'full'|'lite',version?:string}} build Collected build metadata.
 * @param {string} arch Native runner architecture.
 * @returns {void}
 */
export function verifyInstalledIdentity(runtime, build, arch) {
  verifyInstalledEdition(runtime, build)
  if (!['arm64', 'x64'].includes(arch) || build.target !== `darwin-${arch}` || runtime.mode !== 'deployed' || runtime.platform !== 'darwin' || runtime.arch !== arch || runtime.sourceDirty || runtime.sourceRevision !== build.sourceRevision) {
    throw new Error('Installed runtime does not match the collected native macOS build')
  }
}

/** Remove authorization URLs and credential assignments from bounded failure reports.
 * @param {string} message Process or browser diagnostic.
 * @returns {string} Redacted diagnostic.
 */
export function redactDiagnostic(message) {
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/(([\w-]*(?:token|password|secret|api[_-]?key)[\w-]*)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 2000)
}

/** Run one bounded native command and retain elapsed time and redacted exit diagnostics.
 * @param {string} stage Qualification step name.
 * @param {string} command Executable path.
 * @param {string[]} args Executable arguments.
 * @param {object} options Child-process options, including a bounded timeout.
 * @param {object[]} diagnostics Mutable report command records.
 * @returns {Promise<{stdout:string,stderr:string}>} Completed command output.
 */
export async function runCommand(stage, command, args, options, diagnostics) {
  const started = Date.now()
  const record = { stage, command, timeoutMs: options.timeout }
  diagnostics.push(record)
  try {
    const result = await execute(command, args, options)
    record.exitCode = 0
    return result
  } catch (error) {
    Object.assign(record, failureDiagnostic(error))
    throw error
  } finally { record.durationMs = Date.now() - started }
}

/** Preserve process exit details without exposing credentials in command output.
 * @param {Error} error Failed command or browser operation.
 * @returns {object} Bounded diagnostic suitable for the qualification report.
 */
export function failureDiagnostic(error) {
  return { type: error.name, message: redactDiagnostic(error.message), code: error.code,
    signal: error.signal, killed: error.killed,
    stdout: error.stdout === undefined ? undefined : redactDiagnostic(String(error.stdout)),
    stderr: error.stderr === undefined ? undefined : redactDiagnostic(String(error.stderr)) }
}

/** Require the selected product source independently of the helper checkout.
 * @param {string} sourceRevision Source recorded by the collected product build.
 * @param {string} expectedSource Explicitly selected full source SHA.
 * @returns {void}
 */
export function verifyExpectedSource(sourceRevision, expectedSource) {
  if (!expectedSource || !/^[0-9a-f]{40}$/.test(expectedSource) || sourceRevision !== expectedSource) {
    throw new Error('DMG source differs from the explicitly selected build SHA')
  }
}

/** Detect the exact private mountpoint, including after a failed attach command.
 * @param {string} listing Native /sbin/mount output.
 * @param {string} mountpoint Private image mountpoint.
 * @returns {boolean} Whether the mount listing contains that exact mountpoint.
 */
export function isImageMounted(listing, mountpoint) {
  return listing.split('\n').some(line => line.includes(` on ${mountpoint} (`))
}

async function run(installer, reportDirectory, expectedSource = process.env.GITHUB_SHA, buildRunId) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Run installed qualification on native macOS')
  await mkdir(reportDirectory, { recursive: true })
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'apus-macos-installed-')))
  const mountpoint = join(temporary, 'volume')
  const installation = join(temporary, 'application', 'APUS Reflex Harness.app')
  const profile = join(temporary, 'profile')
  const env = smokeEnvironment(process.env, profile)
  await mkdir(env.HOME, { recursive: true })
  await mkdir(mountpoint)
  const report = { passed: false, stages: [], commands: [], cleanupErrors: [], helperSourceRevision: process.env.GITHUB_SHA, buildRunId, limitations: ['Unsigned preview; notarization and Gatekeeper trust are not qualified.', 'No provider credentials or real model API task is exercised.'] }
  const command = (stage, executable, args, timeout) => runCommand(stage, executable, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, report.commands)
  let mounted = false
  let app
  let known = new Set()
  const observe = async () => {
    const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,command='], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
    const processes = stdout.trim().split('\n').map(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      return match ? { pid: Number(match[1]), parent: Number(match[2]), owned: match[3].includes(installation) || match[3].includes(profile) } : undefined
    }).filter(Boolean)
    for (const process of processes) if (process.owned) known.add(process.pid)
    let size
    do {
      size = known.size
      for (const process of processes) if (known.has(process.parent)) known.add(process.pid)
    } while (size !== known.size)
    const alive = processes.filter(process => known.has(process.pid)).map(process => process.pid)
    known = new Set(alive)
    return alive
  }
  const quiescent = async () => {
    const deadline = Date.now() + 20_000
    do {
      if (!(await observe()).length) return
      await pause(300)
    } while (Date.now() < deadline)
    throw new Error('Installed application left owned processes running after exit')
  }
  const close = async () => {
    if (!app) return
    await observe()
    const closing = app
    app = undefined
    await closing.close()
    await quiescent()
  }
  try {
    const build = await readInstallerBuild(installer, `darwin-${process.arch}`)
    const asset = build.assets.find(asset => asset.name === basename(installer))
    const digest = createHash('sha256').update(await readFile(installer)).digest('hex')
    if (!asset || digest !== asset.sha256) throw new Error('DMG differs from collected build receipt')
    verifyExpectedSource(build.sourceRevision, expectedSource)
    report.sourceRevision = build.sourceRevision
    report.installerSha256 = digest
    report.version = build.version
    report.edition = build.edition ?? 'full'
    report.target = build.target
    report.stages.push('installer-receipt-verified')
    report.stages.push('dmg-attach-started')
    await command('dmg-attach', '/usr/bin/hdiutil', ['attach', installer, '-readonly', '-nobrowse', '-mountpoint', mountpoint], 600_000)
    mounted = true
    report.stages.push('dmg-copy-started')
    await command('dmg-copy', '/usr/bin/ditto', [join(mountpoint, 'APUS Reflex Harness.app'), installation], 600_000)
    await command('dmg-detach', '/usr/bin/hdiutil', ['detach', mountpoint], 30_000)
    mounted = false
    const executable = join(installation, 'Contents/MacOS/APUS Reflex Harness')
    await access(executable)
    const runtime = JSON.parse(await readFile(join(installation, 'Contents/Resources/system3-runtime/runtime-manifest.json'), 'utf8'))
    verifyInstalledIdentity(runtime, build, process.arch)
    verifyInstalledEditionFiles(join(installation, 'Contents/Resources/system3-runtime'), build)
    const { stdout: version } = await execute('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(installation, 'Contents/Info.plist')])
    if (version.trim() !== build.version) throw new Error('Installed bundle version differs from collected build')
    await command('installed-code-signature', '/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', installation], 120_000)
    report.codeSignature = { verified: true, developerIdOrNotarizationVerified: false }
    if (runtime.llamaServer !== undefined) {
      // The signed runner must still load its sibling libraries under the installed application's hardened runtime.
      // GGML_METAL_DEVICES=0 skips Metal device setup, which llama.cpp runs before `--version` and which can stall on a virtual GPU.
      await runCommand('installed-reflex-runner', join(installation, 'Contents/Resources/system3-runtime/dependencies/llama-server/llama-server'), ['--version'],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...env, GGML_METAL_DEVICES: '0' } }, report.commands)
      report.reflexRunner = runtime.llamaServer
    }
    const { stdout: minimum } = await execute('/usr/bin/plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', '-o', '-', join(installation, 'Contents/Info.plist')])
    report.minimumSystemVersion = minimum.trim()
    report.stages.push('copied-runtime-identity-verified-and-image-detached')
    const { stdout } = await execute('/bin/sh', ['-c', 'command -v node'], { env }).catch(error => {
      if (error.code === 1) return { stdout: '' }
      throw error
    })
    if (stdout.trim()) throw new Error('External Node unexpectedly available on application PATH')
    report.nodeOnPath = false
    const { _electron } = createRequire(join(root, 'apps/web/package.json'))('playwright')
    const launch = async () => {
      app = await _electron.launch({ executablePath: executable, args: [], cwd: temporary, env, timeout: 60_000 })
      known.add(app.process().pid)
      if (await app.evaluate(() => process.arch) !== process.arch) throw new Error('Installed Electron architecture differs from the native runner')
      const deadline = Date.now() + 90_000
      do {
        for (const page of app.windows()) {
          if (page.isClosed()) continue
          const blank = page.getByRole('button', { name: /^(从空白开始|Start empty)$/i })
          if (await blank.isVisible()) { await blank.click(); continue }
          if (new URL(page.url()).pathname === '/' && await page.getByText(/^(设置|Settings)$/).last().isVisible()) return page
        }
        if (app.process().exitCode !== null) throw new Error('Installed application exited before reaching home')
        await pause(300)
      } while (Date.now() < deadline)
      throw new Error('Installed application did not reach its home screen')
    }
    let page = await launch()
    await page.screenshot({ path: join(reportDirectory, 'home.png') })
    report.stages.push('fresh-profile-home')
    report.reflexCapabilities = { initial: await verifyReflexExecution(page) }
    report.stages.push('reflex-execution-modules-ready')
    await page.getByText(/^(设置|Settings)$/).last().click()
    const versionLabel = page.getByText(new RegExp(`^(当前版本：|Current version: )${build.version.replaceAll('.', '\\.')}$`))
    await versionLabel.waitFor({ timeout: 20_000 })
    await versionLabel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(reportDirectory, 'version.png') })
    report.stages.push('product-version-visible')
    await page.getByRole('button', { name: /^(Reflex 配置|Reflex configuration)$/u, exact: true }).click()
    await verifyReflexSettings(page.getByRole('dialog'))
    await page.screenshot({ path: join(reportDirectory, 'reflex-settings.png') })
    report.stages.push('reflex-settings-verified')
    const qualifyMemorySetting = build.edition === 'full' || build.edition === 'lite'
    const continuumSwitch = (page, checked) => page.getByRole('switch', {
      name: /^Continuum (无限记忆|memory)$/u, checked, disabled: false,
    })
    if (qualifyMemorySetting) {
      await continuumSwitch(page, false).waitFor({ state: 'visible', timeout: 20_000 })
      await continuumSwitch(page, false).click()
      await continuumSwitch(page, true).waitFor({ state: 'visible', timeout: 20_000 })
      await page.screenshot({ path: join(reportDirectory, 'continuum-enabled.png') })
      report.memorySetting = { initialEnabled: false, writeAccepted: true, modelRecallExercised: false }
      report.stages.push('continuum-setting-enabled')
    }
    // 决策前置 is a volatile System3 field the System3 profile bundle owns, so its write must also survive a restart.
    const frontLoadedSwitch = (page, checked) => page.getByRole('switch', {
      name: /^(决策前置|Pre-step decisions)$/u, checked, disabled: false,
    })
    await frontLoadedSwitch(page, true).waitFor({ state: 'visible', timeout: 20_000 })
    await frontLoadedSwitch(page, true).click()
    await frontLoadedSwitch(page, false).waitFor({ state: 'visible', timeout: 20_000 })
    await page.screenshot({ path: join(reportDirectory, 'front-loaded-disabled.png') })
    report.frontLoadedSetting = { initialEnabled: true, writeAccepted: true }
    report.stages.push('front-loaded-setting-disabled')
    await close()
    report.stages.push('first-exit-quiescent')
    page = await launch()
    await page.screenshot({ path: join(reportDirectory, 'restart.png') })
    report.reflexCapabilities.restarted = await verifyReflexExecution(page, { frontLoaded: false })
    report.stages.push('reflex-execution-modules-ready-after-restart')
    await page.getByText(/^(设置|Settings)$/).last().click()
    await page.getByText(new RegExp(`^(当前版本：|Current version: )${build.version.replaceAll('.', '\\.')}$`)).waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: /^(Reflex 配置|Reflex configuration)$/u, exact: true }).click()
    if (qualifyMemorySetting) {
      await continuumSwitch(page, true).waitFor({ state: 'visible', timeout: 20_000 })
      await page.screenshot({ path: join(reportDirectory, 'continuum-restart.png') })
      report.memorySetting.persistedAfterRestart = true
      report.stages.push('continuum-setting-persisted-after-restart')
    }
    await frontLoadedSwitch(page, false).waitFor({ state: 'visible', timeout: 20_000 })
    await page.screenshot({ path: join(reportDirectory, 'front-loaded-restart.png') })
    report.frontLoadedSetting.persistedAfterRestart = true
    report.stages.push('front-loaded-setting-persisted-after-restart')
    await close()
    report.stages.push('restart-home-and-exit-quiescent')
    report.passed = true
  } catch (error) {
    report.failure = { stage: report.stages.at(-1) ?? 'before-install', ...failureDiagnostic(error) }
    throw new Error(`macOS installed qualification failed after ${report.failure.stage}; see report.json`)
  } finally {
    try { await close() } catch (error) { report.cleanupErrors.push({ stage: 'close-application', ...failureDiagnostic(error) }) }
    try {
      for (const pid of await observe()) {
        try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
      await quiescent()
    } catch (error) { report.cleanupErrors.push({ stage: 'stop-owned-processes', ...failureDiagnostic(error) }) }
    try {
      // A timed-out attach may already have mounted the image before its child exited.
      const { stdout } = await command('inspect-image-mount', '/sbin/mount', [], 10_000)
      if (mounted || isImageMounted(stdout, mountpoint)) {
        await command('cleanup-image-detach', '/usr/bin/hdiutil', ['detach', mountpoint], 30_000)
      }
    } catch (error) { report.cleanupErrors.push({ stage: 'detach-image', ...failureDiagnostic(error) }) }
    if (report.cleanupErrors.length) { report.cleanupFailed = true; report.passed = false }
    await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    if (report.cleanupFailed && !report.failure) throw new Error('macOS qualification cleanup failed; see report.json')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { installer: { type: 'string' }, 'report-dir': { type: 'string' },
      'expected-source': { type: 'string' }, 'build-run-id': { type: 'string' } }, allowPositionals: false })
    if (!values.installer || !values['report-dir']) throw new Error('Usage: --installer <DMG> --report-dir <directory> [--expected-source <sha> --build-run-id <id>]')
    await run(resolve(values.installer), resolve(values['report-dir']), values['expected-source'], values['build-run-id'])
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
