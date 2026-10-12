/** Qualify the installed Windows preview with a fresh profile and no external Node on PATH. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Build a credential-free launch environment with only Windows system commands on PATH.
 * @param {NodeJS.ProcessEnv} source Parent environment.
 * @param {string} profile Private Electron user-data directory.
 * @returns {NodeJS.ProcessEnv} Installed application environment.
 */
export function smokeEnvironment(source, profile) {
  const allowed = new Set(['systemroot', 'windir', 'comspec', 'temp', 'tmp', 'userprofile', 'appdata', 'localappdata', 'homedrive', 'homepath', 'username', 'computername', 'pathext', 'programfiles', 'programfiles(x86)', 'programdata', 'public'])
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())))
  const windows = Object.entries(source).find(([key]) => key.toLowerCase() === 'systemroot')?.[1]
  if (!windows) throw new Error('SystemRoot is required for native Windows qualification')
  env.PATH = [win32.join(windows, 'System32'), windows].join(';')
  env.SYSTEM3_DESKTOP_USER_DATA_DIR = profile
  env.DSH_HOME = win32.join(profile, 'harness-home')
  env.DSH_TELEMETRY_DISABLED = '1'
  return env
}

/** Find the owned process tree without storing process command lines in reports.
 * @param {{pid:number,parent:number,owned:boolean}[]} processes Native process observations.
 * @param {number[]} roots Acquired process identifiers.
 * @returns {number[]} Owned live identifiers.
 */
export function ownedProcessIds(processes, roots) {
  const ids = new Set(roots)
  for (const process of processes) if (process.owned) ids.add(process.pid)
  let size
  do {
    size = ids.size
    for (const process of processes) if (ids.has(process.parent)) ids.add(process.pid)
  } while (size !== ids.size)
  return processes.filter(process => ids.has(process.pid)).map(process => process.pid)
}

/** Reject an installed runtime belonging to a different build or platform.
 * @param {{mode:string,platform:string,arch:string,sourceRevision:string,sourceDirty:boolean}} runtime Installed manifest.
 * @param {{sourceRevision:string,target:string}} build Collected build receipt.
 * @returns {void}
 */
export function verifyInstalledIdentity(runtime, build) {
  if (build.target !== 'win32-x64' || runtime.mode !== 'deployed' || runtime.platform !== 'win32' || runtime.arch !== 'x64' || runtime.sourceDirty || runtime.sourceRevision !== build.sourceRevision) {
    throw new Error('Installed runtime does not match the collected Windows build')
  }
}

/** Remove local authorization URLs and credential assignments from failure diagnostics.
 * @param {string} message Process or browser error text.
 * @returns {string} Redacted, bounded report text.
 */
export function redactDiagnostic(message) {
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/((?:[\w-]*(?:token|password|secret|api[_-]?key)[\w-]*)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 2000)
}

async function run(installer, reportDirectory) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Run installed qualification on native Windows x64')
  await mkdir(reportDirectory, { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), 'apus-installed-'))
  const installation = join(temporary, 'application')
  const profile = join(temporary, 'profile')
  const env = smokeEnvironment(process.env, profile)
  const powershell = join(env.SystemRoot ?? env.SYSTEMROOT ?? process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const report = { passed: false, stages: [], limitations: ['Unsigned preview; Authenticode and SmartScreen trust are not qualified.', 'No provider credentials or real model API task is exercised.'] }
  let app
  let known = []
  const psQuote = value => "'" + value.replaceAll("'", "''") + "'"
  const observe = async () => {
    const script = `$ErrorActionPreference='Stop'; $install=${psQuote(installation + win32.sep)}; $profile=${psQuote(profile)}; @(Get-CimInstance Win32_Process | ForEach-Object { [PSCustomObject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;owned=(($_.ExecutablePath -and $_.ExecutablePath.StartsWith($install,[System.StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.Contains($profile))) -and $_.ProcessId -ne $PID} }) | ConvertTo-Json -Compress`
    const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30_000, windowsHide: true })
    return JSON.parse(stdout || '[]')
  }
  const quiescent = async () => {
    const deadline = Date.now() + 20_000
    do {
      const alive = ownedProcessIds(await observe(), known)
      if (!alive.length) { known = []; return }
      known = alive
      await pause(300)
    } while (Date.now() < deadline)
    throw new Error('Installed application left owned processes running after exit')
  }
  const close = async () => {
    if (!app) return
    known = ownedProcessIds(await observe(), [app.process().pid])
    const closing = app
    app = undefined
    await closing.close()
    await quiescent()
  }
  try {
    const build = JSON.parse(await readFile(join(dirname(installer), 'build-info-win32-x64.json'), 'utf8'))
    const asset = build.assets.find(asset => asset.name === 'apus-reflex-harness-windows-x64-setup.exe')
    const digest = createHash('sha256').update(await readFile(installer)).digest('hex')
    if (!asset || digest !== asset.sha256) throw new Error('Installer differs from collected build receipt')
    report.sourceRevision = build.sourceRevision
    report.installerSha256 = digest
    report.version = build.version
    report.stages.push('installer-receipt-verified')
    // NSIS consumes the unquoted remainder after /D= as the destination, including spaces.
    await execute(installer, ['/S', `/D=${installation}`], { timeout: 180_000, windowsVerbatimArguments: true, windowsHide: true, env })
    const executable = join(installation, 'APUS Reflex Harness.exe')
    await access(executable)
    const runtime = JSON.parse(await readFile(join(installation, 'resources', 'system3-runtime', 'runtime-manifest.json'), 'utf8'))
    verifyInstalledIdentity(runtime, build)
    report.stages.push('installed-runtime-identity-verified')
    const { stdout } = await execute(join(env.SystemRoot ?? env.SYSTEMROOT ?? process.env.SystemRoot, 'System32', 'where.exe'), ['node.exe'], { env, windowsHide: true }).catch(error => {
      if (error.code === 1) return { stdout: '' }
      throw error
    })
    if (stdout.trim()) throw new Error('External Node unexpectedly available on application PATH')
    report.nodeOnPath = false
    const { _electron } = createRequire(join(root, 'apps/web/package.json'))('playwright')
    const launch = async () => {
      app = await _electron.launch({ executablePath: executable, args: [], cwd: temporary, env, timeout: 60_000 })
      known = [app.process().pid]
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
    await page.getByText(/^(设置|Settings)$/).last().click()
    const escapedVersion = build.version.replaceAll('.', '\\.')
    await page.getByText(new RegExp(`^(当前版本：|Current version: )${escapedVersion}$`)).waitFor({ timeout: 20_000 })
    await page.screenshot({ path: join(reportDirectory, 'version.png') })
    report.stages.push('product-version-visible')
    await close()
    report.stages.push('first-exit-quiescent')
    page = await launch()
    await page.screenshot({ path: join(reportDirectory, 'restart.png') })
    await close()
    report.stages.push('restart-home-and-exit-quiescent')
    const uninstaller = (await readdir(installation)).find(name => /^Uninstall .*\.exe$/i.test(name))
    if (!uninstaller) throw new Error('Installed uninstaller is missing')
    await execute(join(installation, uninstaller), ['/S'], { timeout: 120_000, windowsHide: true, env })
    const removalDeadline = Date.now() + 30_000
    let removed = false
    do {
      try { await access(executable) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        removed = true
        break
      }
      await pause(300)
    } while (Date.now() < removalDeadline)
    if (!removed) throw new Error('Silent uninstall left the installed application executable')
    await quiescent()
    report.stages.push('silent-uninstall')
    report.passed = true
  } catch (error) {
    // Playwright diagnostics can contain local authorization URLs.
    report.failure = { stage: report.stages.at(-1) ?? 'before-install', type: error.name, message: redactDiagnostic(error.message), code: typeof error.code === 'string' ? error.code : undefined }
    throw new Error(`Windows installed qualification failed after ${report.failure.stage}; see report.json`)
  } finally {
    try { await close() } catch (error) { report.cleanupFailed = true }
    let alive = known
    try { alive = ownedProcessIds(await observe(), known) } catch (error) { report.cleanupFailed = true }
    for (const pid of alive) {
      try { await execute('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }) }
      catch (error) { if (error.code !== 128) report.cleanupFailed = true }
    }
    try { await quiescent() } catch (error) { report.cleanupFailed = true }
    if (report.cleanupFailed) report.passed = false
    await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    if (report.cleanupFailed) throw new Error('Windows qualification cleanup failed; see report.json')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--installer' || args[2] !== '--report-dir') {
    console.error('Usage: node scripts/product-windows-smoke.mjs --installer <setup.exe> --report-dir <directory>')
    process.exitCode = 1
  } else {
    await run(resolve(args[1]), resolve(args[3])).catch(error => { console.error(error.message); process.exitCode = 1 })
  }
}
