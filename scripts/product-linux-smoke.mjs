/** Install and qualify the Ubuntu desktop package with the real Chromium sandbox enabled. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
const packageName = 'apus-reflex-harness'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Isolate application data and credentials while preserving the runner's desktop session.
 * @param {NodeJS.ProcessEnv} source Runner environment.
 * @param {string} profile Private profile directory.
 * @param {string} bin Directory containing only explicitly selected system tools.
 * @returns {NodeJS.ProcessEnv} Installed application environment, without Git or external Node.
 */
export function smokeEnvironment(source, profile, bin) {
  const allowed = new Set(['USER', 'LOGNAME', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'])
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key))),
    HOME: join(profile, 'home'), PATH: bin, TMPDIR: join(profile, 'tmp'),
    XDG_CONFIG_HOME: join(profile, 'config'), XDG_CACHE_HOME: join(profile, 'cache'), XDG_DATA_HOME: join(profile, 'data'),
    SYSTEM3_DESKTOP_USER_DATA_DIR: profile, DSH_HOME: join(profile, 'harness-home'), DSH_TELEMETRY_DISABLED: '1' }
}

/** Reject an installed runtime from another source revision or target.
 * @param {{mode:string,platform:string,arch:string,sourceRevision:string,sourceDirty:boolean,edition?:'full'|'lite'}} runtime Installed runtime manifest.
 * @param {{sourceRevision:string,target:string,edition?:'full'|'lite',version?:string}} build Collected metadata.
 * @returns {void}
 */
export function verifyInstalledIdentity(runtime, build) {
  verifyInstalledEdition(runtime, build)
  if (build.target !== 'linux-x64' || runtime.mode !== 'deployed' || runtime.platform !== 'linux' || runtime.arch !== 'x64' || runtime.sourceDirty || runtime.sourceRevision !== build.sourceRevision) {
    throw new Error('Installed runtime does not match the collected Linux build')
  }
}

/** Query ownership of the fixed Debian executable without enumerating runtime files.
 * @param {typeof execute} query Shell-free command executor.
 * @returns {Promise<string>} Executable owned by the installed product package.
 */
export async function installedExecutable(query = execute) {
  const executable = '/opt/APUS Reflex Harness/apus-reflex-harness'
  const { stdout } = await query('/usr/bin/dpkg-query', ['-S', executable], { timeout: 10_000, maxBuffer: 64 * 1024 })
  if (stdout.trim() !== `${packageName}: ${executable}`) throw new Error('Installed executable is not owned exclusively by the product package')
  return executable
}

/** Require the installer receipt to name the explicitly selected product source.
 * @param {string} sourceRevision Source recorded in collected build metadata.
 * @param {string | undefined} expectedSource Selected full commit identifier.
 * @returns {void}
 */
export function verifyExpectedSource(sourceRevision, expectedSource) {
  if (!expectedSource || !/^[0-9a-f]{40}$/.test(expectedSource) || sourceRevision !== expectedSource) {
    throw new Error('Installer source differs from the explicitly selected build SHA')
  }
}

/** Require actual renderer sandbox observations, not just a launch option.
 * @param {{pid:number,sandbox:boolean,noSandbox:boolean,disableSetuidSandbox:boolean}} renderer Electron observations.
 * @param {string} status The same renderer's /proc status text.
 * @returns {{pid:number,seccomp:number,noNewPrivs:number}} Recorded kernel observations.
 */
export function verifyRendererSandbox(renderer, status) {
  if (!Number.isSafeInteger(renderer.pid) || renderer.pid <= 0 || !renderer.sandbox || renderer.noSandbox || renderer.disableSetuidSandbox) throw new Error('Installed Electron disabled its renderer sandbox')
  const seccomp = /^Seccomp:\s*(\d+)$/m.exec(status)?.[1]
  const noNewPrivs = /^NoNewPrivs:\s*(\d+)$/m.exec(status)?.[1]
  if (seccomp !== '2' || noNewPrivs !== '1') throw new Error('Installed renderer lacks kernel sandbox filtering')
  return { pid: renderer.pid, seccomp: Number(seccomp), noNewPrivs: Number(noNewPrivs) }
}

/** Reject application files or loaded AppArmor policy left after package removal.
 * @param {{executable:boolean,policy:boolean}} remaining Observed filesystem entries.
 * @param {string} profiles The kernel's loaded AppArmor profiles.
 * @returns {void}
 */
export function verifyRemovedInstallation(remaining, profiles) {
  if (remaining.executable || remaining.policy || profiles.split('\n').some(line => line.startsWith(`${packageName} (`))) {
    throw new Error('Package removal left application files or AppArmor policy')
  }
}

/** Redact authorization URLs and credential assignments in bounded failure reports.
 * @param {string} message Process or browser error.
 * @returns {string} Redacted report text.
 */
export function redactDiagnostic(message) {
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/(([\w-]*(?:token|password|secret|api[_-]?key)[\w-]*)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 2000)
}

/** Exercise the installed native launcher and Node with allowed and forbidden filesystem writes.
 * @param {string} resources Installed application resources directory.
 * @param {string} temporary Owned acceptance directory.
 * @param {NodeJS.ProcessEnv} env Application environment with no external Node or credentials.
 * @returns {Promise<string>} Kernel enforcement level reported by the installed launcher.
 */
export async function verifySandboxExecution(resources, temporary, env) {
  const native = join(resources, 'system3-runtime/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin')
  for (const file of ['landlock-run', 'glibc/system.node', 'musl/system.node']) await access(join(native, file))
  const launcher = join(native, 'landlock-run')
  const options = { env, cwd: temporary, timeout: 30_000, killSignal: 'SIGKILL' }
  const { stdout: probe } = await execute(launcher, ['--probe'], options)
  if (!['landlock: fully enforced\n', 'landlock: partially enforced (older ABI)\n'].includes(probe)) throw new Error('Installed Landlock launcher did not report enforcement')
  const allowed = await mkdtemp(join(temporary, 'allowed-'))
  const forbidden = join(temporary, 'outside-sandbox.txt')
  await writeFile(forbidden, 'unchanged', { flag: 'wx', mode: 0o600 })
  const rules = ['--ro', '/', '--rw', allowed, '--']
  const shellFile = join(allowed, 'shell.txt')
  await execute(launcher, [...rules, '/bin/sh', '-c', 'printf shell-ok > "$1"', 'qualification', shellFile], options)
  if (await readFile(shellFile, 'utf8') !== 'shell-ok') throw new Error('Confined shell could not write to its permitted directory')
  const script = `const fs = require('node:fs');
fs.writeFileSync(process.argv[1], 'node-ok');
let denied = false;
try { fs.writeFileSync(process.argv[2], 'escaped'); }
catch (error) { if (!['EACCES', 'EPERM'].includes(error.code)) throw error; denied = true; }
if (!denied) throw new Error('Landlock allowed a forbidden write');
process.stdout.write('node-confined');`
  const nodeFile = join(allowed, 'node.txt')
  const node = join(resources, 'app.asar.unpacked/node_modules/node/bin/node')
  const { stdout } = await execute(launcher, [...rules, node, '-e', script, nodeFile, forbidden], options)
  if (stdout !== 'node-confined' || await readFile(nodeFile, 'utf8') !== 'node-ok' || await readFile(forbidden, 'utf8') !== 'unchanged') throw new Error('Installed Node confinement verification failed')
  return probe.trim()
}

async function run(installer, reportDirectory, expectedSource = process.env.GITHUB_SHA, buildRunId) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid() === 0) throw new Error('Run installed qualification as an ordinary user on native Linux x64')
  await mkdir(reportDirectory, { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), 'apus-linux-installed-'))
  const profile = join(temporary, 'profile')
  const bin = join(temporary, 'bin')
  const env = smokeEnvironment(process.env, profile, bin)
  const report = { passed: false, stages: [], helperSourceRevision: process.env.GITHUB_SHA, buildRunId, limitations: ['Ubuntu 24.04 x64 only; other distributions and architectures are not qualified.', 'No provider credentials or real model API task is exercised.'] }
  let acquired = false
  let app
  let installation
  let executable
  let known = new Set()
  const sudo = args => execute('/usr/bin/sudo', ['-n', ...args], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 })
  const verifyRemoval = async () => {
    const exists = file => access(file).then(() => true, error => {
      if (error.code === 'ENOENT') return false
      throw error
    })
    const { stdout: profiles } = await sudo(['cat', '/sys/kernel/security/apparmor/profiles'])
    verifyRemovedInstallation({ executable: executable ? await exists(executable) : false,
      policy: await exists(`/etc/apparmor.d/${packageName}`) }, profiles)
  }
  const observe = async () => {
    const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,command='], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
    const processes = stdout.trim().split('\n').map(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      return match ? { pid: Number(match[1]), parent: Number(match[2]), owned: (installation && match[3].includes(installation)) || match[3].includes(profile) } : undefined
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
    for (const directory of [bin, env.HOME, env.TMPDIR]) await mkdir(directory, { recursive: true })
    for (const name of ['bash', 'sh', 'env', 'uname', 'readlink', 'dirname', 'basename', 'mkdir', 'ln', 'rm', 'chmod', 'cat', 'ps', 'kill', 'sed', 'awk', 'grep', 'true', 'xdg-open']) {
      const source = `/usr/bin/${name}`
      await access(source)
      await symlink(source, join(bin, name))
    }
    const osRelease = await readFile('/etc/os-release', 'utf8')
    if (!/^ID=ubuntu$/m.test(osRelease) || !/^VERSION_ID="24\.04"$/m.test(osRelease)) throw new Error('Linux qualification requires Ubuntu 24.04')
    const installed = await execute('/usr/bin/dpkg-query', ['-W', '-f=${db:Status-Status}', packageName]).then(() => true, error => {
      if (error.code === 1) return false
      throw error
    })
    if (installed) throw new Error('Refusing to replace an existing product installation')
    const build = await readInstallerBuild(installer, 'linux-x64')
    const asset = build.assets.find(asset => asset.name === basename(installer))
    const digest = createHash('sha256').update(await readFile(installer)).digest('hex')
    if (!asset || digest !== asset.sha256) throw new Error('Debian package differs from collected build receipt')
    verifyExpectedSource(build.sourceRevision, expectedSource)
    for (const [field, value] of [['Package', packageName], ['Version', build.version], ['Architecture', 'amd64']]) {
      const { stdout } = await execute('/usr/bin/dpkg-deb', ['--field', installer, field])
      if (stdout.trim() !== value) throw new Error(`Debian package ${field} differs from the release`)
    }
    report.sourceRevision = build.sourceRevision
    report.installerSha256 = digest
    report.version = build.version
    report.edition = build.edition ?? 'full'
    report.stages.push('installer-receipt-verified')
    acquired = true
    await sudo(['apt-get', 'install', '-y', installer])
    report.stages.push('package-manager-install-completed')
    executable = await installedExecutable()
    await access(executable)
    installation = dirname(executable)
    const runtime = JSON.parse(await readFile(join(installation, 'resources/system3-runtime/runtime-manifest.json'), 'utf8'))
    verifyInstalledIdentity(runtime, build)
    verifyInstalledEditionFiles(join(installation, 'resources/system3-runtime'), build)
    const desktop = `/usr/share/applications/${packageName}.desktop`
    await execute('/usr/bin/desktop-file-validate', [desktop])
    if ((await readFile(desktop, 'utf8')).includes('--no-sandbox')) throw new Error('Installed desktop entry bypasses the Chromium sandbox')
    const restriction = (await readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim()
    if (restriction !== '1') throw new Error('Qualification requires restricted unprivileged user namespaces')
    const { stdout: profiles } = await sudo(['cat', '/sys/kernel/security/apparmor/profiles'])
    if (!profiles.split('\n').some(line => line.startsWith(`${packageName} (`))) throw new Error('Installed application AppArmor profile is not loaded')
    report.apparmor = { restrictedUnprivilegedUserns: Number(restriction), applicationProfileLoaded: true }
    report.stages.push('installed-identity-and-apparmor-verified')
    for (const command of ['node', 'git']) {
      const { stdout } = await execute('/bin/sh', ['-c', `command -v ${command}`], { env }).catch(error => {
        if (error.code === 1 || error.code === 127) return { stdout: '' }
        throw error
      })
      if (stdout.trim()) throw new Error(`External ${command} unexpectedly available on application PATH`)
    }
    report.landlock = await verifySandboxExecution(join(installation, 'resources'), temporary, env)
    report.stages.push('installed-landlock-shell-and-node-write-restrictions')
    report.externalNodeOnPath = false
    report.gitOnPath = false
    const { _electron } = createRequire(join(root, 'apps/web/package.json'))('playwright')
    const launch = async () => {
      app = await _electron.launch({ executablePath: executable, chromiumSandbox: true, args: [], cwd: temporary, env, timeout: 60_000 })
      known.add(app.process().pid)
      if (await app.evaluate(() => process.arch) !== 'x64') throw new Error('Installed Electron architecture differs from the native runner')
      const deadline = Date.now() + 90_000
      do {
        for (const page of app.windows()) {
          if (page.isClosed()) continue
          const blank = page.getByRole('button', { name: /^(从空白开始|Start empty)$/i })
          if (await blank.isVisible()) { await blank.click(); continue }
          if (new URL(page.url()).pathname === '/' && await page.getByText(/^(设置|Settings)$/).last().isVisible()) {
            const renderer = await app.evaluate(({ app, BrowserWindow }) => {
              const window = BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).pathname === '/')
              if (!window) throw new Error('Installed home renderer is missing')
              return { pid: window.webContents.getOSProcessId(), sandbox: window.webContents.getLastWebPreferences().sandbox === true,
                noSandbox: app.commandLine.hasSwitch('no-sandbox'), disableSetuidSandbox: app.commandLine.hasSwitch('disable-setuid-sandbox') }
            })
            report.rendererSandbox = verifyRendererSandbox(renderer, await readFile(`/proc/${renderer.pid}/status`, 'utf8'))
            return page
          }
        }
        if (app.process().exitCode !== null) throw new Error('Installed application exited before reaching home')
        await pause(300)
      } while (Date.now() < deadline)
      throw new Error('Installed application did not reach its home screen')
    }
    let page = await launch()
    await page.screenshot({ path: join(reportDirectory, 'home.png') })
    report.stages.push('fresh-profile-home-with-renderer-sandbox')
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
    await close()
    report.stages.push('first-exit-quiescent')
    page = await launch()
    await page.screenshot({ path: join(reportDirectory, 'restart.png') })
    report.reflexCapabilities.restarted = await verifyReflexExecution(page)
    report.stages.push('reflex-execution-modules-ready-after-restart')
    await close()
    report.stages.push('restart-home-and-exit-quiescent')
    await sudo(['apt-get', 'purge', '-y', packageName])
    await verifyRemoval()
    acquired = false
    report.stages.push('package-uninstalled')
    report.passed = true
  } catch (error) {
    report.failure = { stage: report.stages.at(-1) ?? 'before-install', type: error.name, message: redactDiagnostic(error.message), command: error.cmd ? redactDiagnostic(error.cmd) : undefined, code: error.code, signal: error.signal, killed: error.killed }
    throw new Error(`Linux installed qualification failed after ${report.failure.stage}; see report.json`)
  } finally {
    try { await close() } catch (error) { report.cleanupFailed = true }
    try {
      for (const pid of await observe()) {
        try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
      await quiescent()
    } catch (error) { report.cleanupFailed = true }
    if (acquired) {
      try { await sudo(['apt-get', 'purge', '-y', packageName]); await verifyRemoval() }
      catch (error) { report.cleanupFailed = true }
    }
    try { await rm(temporary, { recursive: true, force: true }) }
    catch (error) { report.cleanupFailed = true }
    if (report.cleanupFailed) report.passed = false
    await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    if (report.cleanupFailed) throw new Error('Linux qualification cleanup failed; see report.json')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { installer: { type: 'string' }, 'report-dir': { type: 'string' },
      'expected-source': { type: 'string' }, 'build-run-id': { type: 'string' } }, allowPositionals: false })
    if (!values.installer || !values['report-dir']) throw new Error('Usage: --installer <deb> --report-dir <directory> [--expected-source <sha> --build-run-id <id>]')
    await run(resolve(values.installer), resolve(values['report-dir']), values['expected-source'], values['build-run-id'])
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
