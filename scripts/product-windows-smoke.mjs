/** Qualify the installed Windows preview with a fresh profile and no external Node on PATH. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { basename } from 'node:path'
import { readInstallerBuild, verifyInstalledEdition, verifyInstalledEditionFiles } from './product-installer-metadata.mjs'

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
 * @param {{mode:string,platform:string,arch:string,sourceRevision:string,sourceDirty:boolean,edition?:'full'|'lite'}} runtime Installed manifest.
 * @param {{sourceRevision:string,target:string,edition?:'full'|'lite',version?:string}} build Collected build receipt.
 * @returns {void}
 */
export function verifyInstalledIdentity(runtime, build) {
  verifyInstalledEdition(runtime, build)
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

/** Preserve command termination evidence without exposing credential-bearing diagnostics. */
export function failureDiagnostic(error) {
  return { type: error.name, message: redactDiagnostic(error.message),
    code: typeof error.code === 'string' || typeof error.code === 'number' ? error.code : undefined,
    killed: typeof error.killed === 'boolean' ? error.killed : undefined,
    signal: typeof error.signal === 'string' || error.signal === null ? error.signal : undefined,
    ...(error.stdout ? { stdout: redactDiagnostic(String(error.stdout)) } : {}),
    ...(error.stderr ? { stderr: redactDiagnostic(String(error.stderr)) } : {}),
    ...(error.observationFailure ? { observationFailure: error.observationFailure } : {}) }
}

/** Wait for an acquired process while sampling its owned descendants; always await its exit. */
export async function runTrackedProcess(command, args, options, acquired, sample) {
  const pending = execute(command, args, options)
  let settled = false
  let failure
  let result
  const completed = pending.then(value => { result = value }, error => { failure = error }).finally(() => { settled = true })
  try {
    acquired(pending.child.pid)
    while (!settled) {
      await sample()
      if (!settled) await Promise.race([completed, pause(500)])
    }
  } catch (error) {
    const commandFailure = settled && failure
    if (commandFailure) {
      commandFailure.observationFailure = failureDiagnostic(error)
      throw commandFailure
    }
    if (!settled) pending.child.kill('SIGKILL')
    throw error
  } finally { await completed }
  if (failure) throw failure
  return result
}

/** Kill only currently owned roots, then require an empty live process observation. */
export async function terminateOwnedProcesses(observe, terminate, roots) {
  const errors = []
  let known = roots
  let alive
  try { alive = ownedProcessIds(await observe(), known) }
  catch (error) { errors.push({ stage: 'observe-before-cleanup', ...failureDiagnostic(error) }); alive = known }
  for (const pid of alive) {
    try { await terminate(pid) }
    catch (error) { if (error.code !== 128) errors.push({ stage: 'terminate-process', ...failureDiagnostic(error) }) }
  }
  const deadline = Date.now() + 20_000
  try {
    do {
      known = ownedProcessIds(await observe(), known)
      if (!known.length) return errors
      await pause(300)
    } while (Date.now() < deadline)
    throw new Error('Owned Windows processes remain after termination')
  } catch (error) { errors.push({ stage: 'wait-process-exit', ...failureDiagnostic(error) }) }
  return errors
}

/** Inspect a bounded number of installation entries; reports contain counts rather than paths. */
async function installationSummary(temporary, installation) {
  const names = await readdir(temporary)
  const roots = names.filter(name => name === 'application' || name.startsWith('application.new-') || name.startsWith('application.old-'))
  const summary = { directoryExists: roots.includes('application'), stagingDirectories: roots.filter(name => name.startsWith('application.new-')).length,
    files: 0, bytes: 0, entriesInspected: 0, truncated: false, executableExists: false }
  const queue = roots.map(name => join(temporary, name))
  while (queue.length && summary.entriesInspected < 2000) {
    const file = queue.pop()
    let stat
    try { stat = await lstat(file) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    summary.entriesInspected++
    if (stat.isFile()) { summary.files++; summary.bytes += stat.size }
    else if (stat.isDirectory()) queue.push(...(await readdir(file)).map(name => join(file, name)))
  }
  summary.truncated = queue.length > 0
  try { await access(join(installation, 'APUS Reflex Harness.exe')); summary.executableExists = true }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  return summary
}

async function run(installer, reportDirectory, expectedSource = process.env.GITHUB_SHA, buildRunId) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Run installed qualification on native Windows x64')
  await mkdir(reportDirectory, { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), 'apus-installed-'))
  const installation = join(temporary, 'application')
  const profile = join(temporary, 'profile')
  const env = smokeEnvironment(process.env, profile)
  const powershell = join(env.SystemRoot ?? env.SYSTEMROOT ?? process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const report = { passed: false, stages: [], helperSourceRevision: process.env.GITHUB_SHA, buildRunId, cleanupErrors: [], limitations: ['Unsigned preview; Authenticode and SmartScreen trust are not qualified.', 'No provider credentials or real model API task is exercised.'] }
  let app
  let known = []
  const psQuote = value => "'" + value.replaceAll("'", "''") + "'"
  const observe = async () => {
    const script = `$ErrorActionPreference='Stop'; $ownedInstall=${psQuote(installation + win32.sep)}; $ownedRoot=${psQuote(temporary)}; $ownedInstaller=${psQuote(installer)}; @(Get-CimInstance Win32_Process | ForEach-Object { [PSCustomObject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;owned=(($_.ExecutablePath -and ($_.ExecutablePath.StartsWith($ownedInstall,[System.StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath.Equals($ownedInstaller,[System.StringComparison]::OrdinalIgnoreCase))) -or ($_.CommandLine -and $_.CommandLine.Contains($ownedRoot))) -and $_.ProcessId -ne $PID} }) | ConvertTo-Json -Compress`
    const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30_000, windowsHide: true })
    const value = JSON.parse(stdout.trim() || '[]')
    return Array.isArray(value) ? value : [value]
  }
  const sample = async () => {
    known = ownedProcessIds(await observe(), known)
  }
  const tracked = (command, args, options) => runTrackedProcess(command, args, options, pid => {
    if (pid) known = [...new Set([...known, pid])]
    if (command === installer && report.installation) report.installation.rootPid = pid
  }, async () => {
    await sample()
    if (command === installer && report.installation) {
      report.installation.observedPids = [...new Set([...(report.installation.observedPids ?? []), ...known])]
    }
  })
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
    known = ownedProcessIds(await observe(), [...known, app.process().pid])
    const closing = app
    app = undefined
    await closing.close()
    await quiescent()
  }
  try {
    const build = await readInstallerBuild(installer, 'win32-x64')
    const asset = build.assets.find(asset => asset.name === basename(installer))
    const digest = createHash('sha256').update(await readFile(installer)).digest('hex')
    if (!asset || digest !== asset.sha256) throw new Error('Installer differs from collected build receipt')
    if (!expectedSource || !/^[0-9a-f]{40}$/.test(expectedSource) || build.sourceRevision !== expectedSource) {
      throw new Error('Installer source differs from the explicitly selected build SHA')
    }
    report.sourceRevision = build.sourceRevision
    report.installerSha256 = digest
    report.version = build.version
    report.edition = build.edition ?? 'full'
    report.stages.push('installer-receipt-verified')
    // NSIS consumes the unquoted remainder after /D= as the destination, including spaces.
    const installationStarted = Date.now()
    report.installation = { timeoutMs: 600_000 }
    try {
      await tracked(installer, ['/S', `/D=${installation}`], { timeout: 600_000, windowsVerbatimArguments: true, windowsHide: true, env })
      report.installation.exitCode = 0
    } catch (error) {
      report.installation.failure = failureDiagnostic(error)
      report.installation.exitCode = typeof error.code === 'number' ? error.code : null
      throw error
    } finally {
      report.installation.durationMs = Date.now() - installationStarted
      try { report.installation.summary = await installationSummary(temporary, installation) }
      catch (error) { report.installation.summaryFailure = failureDiagnostic(error) }
    }
    const executable = join(installation, 'APUS Reflex Harness.exe')
    await access(executable)
    const runtime = JSON.parse(await readFile(join(installation, 'resources', 'system3-runtime', 'runtime-manifest.json'), 'utf8'))
    verifyInstalledIdentity(runtime, build)
    verifyInstalledEditionFiles(join(installation, 'resources/system3-runtime'), build)
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
      known = [...new Set([...known, app.process().pid])]
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
    const versionLabel = page.getByText(new RegExp(`^(当前版本：|Current version: )${escapedVersion}$`))
    await versionLabel.waitFor({ timeout: 20_000 })
    await versionLabel.scrollIntoViewIfNeeded()
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
    await tracked(join(installation, uninstaller), ['/S'], { timeout: 120_000, windowsHide: true, env })
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
    report.failure = { stage: report.stages.at(-1) ?? 'before-install', ...failureDiagnostic(error) }
    throw new Error(`Windows installed qualification failed after ${report.failure.stage}; see report.json`)
  } finally {
    try { await close() }
    catch (error) { report.cleanupErrors.push({ stage: 'close-application', ...failureDiagnostic(error) }) }
    const termination = await terminateOwnedProcesses(observe,
      pid => execute(join(env.SystemRoot ?? env.SYSTEMROOT ?? process.env.SystemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }), known)
    report.cleanupErrors.push(...termination)
    if (!termination.length && report.failure) {
      try {
        const entries = await readdir(installation).catch(error => { if (error.code === 'ENOENT') return []; throw error })
        const uninstaller = entries.find(name => /^Uninstall .*\.exe$/i.test(name))
        if (uninstaller) {
          await tracked(join(installation, uninstaller), ['/S'], { timeout: 120_000, windowsHide: true, env })
          await quiescent()
        }
      } catch (error) {
        report.cleanupErrors.push({ stage: 'uninstall-after-failure', ...failureDiagnostic(error) })
        report.cleanupErrors.push(...await terminateOwnedProcesses(observe,
          pid => execute(join(env.SystemRoot ?? env.SYSTEMROOT ?? process.env.SystemRoot, 'System32', 'taskkill.exe'),
            ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }), known))
      }
    }
    if (!report.cleanupErrors.length) {
      try { await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }) }
      catch (error) { report.cleanupErrors.push({ stage: 'remove-private-directory', ...failureDiagnostic(error) }) }
    }
    if (report.cleanupErrors.length) report.passed = false
    await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    if (report.cleanupErrors.length && !report.failure) throw new Error('Windows qualification cleanup failed; see report.json')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { installer: { type: 'string' }, 'report-dir': { type: 'string' },
      'expected-source': { type: 'string' }, 'build-run-id': { type: 'string' } }, allowPositionals: false })
    if (!values.installer || !values['report-dir']) throw new Error('Usage: --installer <setup.exe> --report-dir <directory> [--expected-source <sha> --build-run-id <id>]')
    await run(resolve(values.installer), resolve(values['report-dir']), values['expected-source'], values['build-run-id'])
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
