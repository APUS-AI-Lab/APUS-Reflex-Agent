/** Qualify the extracted Linux Web archive without inherited credentials or developer tools. */
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { archiveName, digest, inventoryName, linuxNativePackage, payloadFiles, verifyWebRuntime } from './product-web-package.mjs'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const pause = ms => new Promise(done => setTimeout(done, ms))

/** Keep only locale and private paths; no ambient model keys or Node resolution overrides. */
export function smokeEnvironment(temporary, path) {
  return { HOME: join(temporary, 'home'), PATH: path, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    TMPDIR: temporary, DSH_HOME: join(temporary, 'data'), DSH_TELEMETRY_DISABLED: '1' }
}

/** Only the supported CLI's authenticated loopback readiness line can start browser checks. */
export function readinessUrl(output) {
  const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+[^\s]*)[ \r\n]/m.exec(output)
  if (!match) return undefined
  try {
    const url = new URL(match[1])
    return url.hostname === '127.0.0.1' && url.searchParams.get('token')?.trim() ? url.href : undefined
  } catch (_error) { return undefined }
}

/** Remove authenticated URLs and credential values from diagnostics. */
export function redact(message) {
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/(([\w-]*(?:token|password|secret|api[_-]?key)[\w-]*)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 2000)
}

/** Verify the collected payload digest and every unpacked file before launching any of it. */
export function verifyPayload(directory, build) {
  if (digest(join(directory, 'files.json')) !== build.payloadManifestSha256) throw new Error('Web payload manifest differs from build metadata.')
  const actual = payloadFiles(directory).filter(file => file.path !== 'files.json')
  const expected = JSON.parse(readFileSync(join(directory, 'files.json'), 'utf8'))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Extracted Web payload differs from its file inventory.')
}

/** Bind the adjacent release inventory to its published filename and extracted runtime metadata. */
export function verifyPublishedInventory(directory, build, runtime) {
  const inventory = build.runtimeDependencyInventory
  if (inventory?.path !== inventoryName || inventory.sha256 !== runtime.dependencyInventory?.sha256
    || build.harnessVersion !== runtime.version) throw new Error('Published Web inventory metadata differs from the extracted runtime.')
  if (digest(join(directory, inventory.path)) !== inventory.sha256) throw new Error('Published Web inventory file differs from its recorded hash.')
}

/** Verify the real token exchange and cookie-protected frontend without exposing credentials. */
export async function verifyHttpAuthentication(url) {
  const home = new URL('/', url)
  const anonymous = await fetch(home, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  await anonymous.body?.cancel()
  if (anonymous.status !== 401) throw new Error('Web frontend did not reject an unauthenticated request.')
  const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  await exchange.body?.cancel()
  const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
  if (exchange.status !== 303 || !cookie || exchange.headers.get('location') !== './') {
    throw new Error('Web launch URL did not establish browser authentication.')
  }
  const response = await fetch(home, { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  if (response.status !== 200 || !(await response.text()).includes('id="root"')) {
    throw new Error('Authenticated Web runtime did not serve its browser application.')
  }
}

/** Exercise the shipped launcher with real shell and Node writes, including a forbidden write. */
export async function verifySandboxExecution(installed, temporary, env) {
  const launcher = join(installed, 'runtime', linuxNativePackage, 'bin/landlock-run')
  const options = { env, cwd: temporary, timeout: 30_000, killSignal: 'SIGKILL' }
  const { stdout: probe } = await execute(launcher, ['--probe'], options)
  if (!['landlock: fully enforced\n', 'landlock: partially enforced (older ABI)\n'].includes(probe)) {
    throw new Error('Bundled Landlock launcher did not report enforcement.')
  }
  const writable = await mkdtemp(join(temporary, 'allowed-'))
  const forbidden = join(temporary, 'outside-sandbox.txt')
  await writeFile(forbidden, 'unchanged', { flag: 'wx', mode: 0o600 })
  const shellFile = join(writable, 'shell.txt')
  const rule = ['--ro', '/', '--rw', writable, '--']
  await execute(launcher, [...rule, '/bin/sh', '-c', 'printf shell-ok > "$1"', 'qualification', shellFile], options)
  if (await readFile(shellFile, 'utf8') !== 'shell-ok') throw new Error('Confined shell could not write to its permitted directory.')
  const script = `const fs = require('node:fs');
fs.writeFileSync(process.argv[1], 'node-ok');
let denied = false;
try { fs.writeFileSync(process.argv[2], 'escaped'); }
catch (error) { if (!['EACCES', 'EPERM'].includes(error.code)) throw error; denied = true; }
if (!denied) throw new Error('Landlock allowed a forbidden write');
process.stdout.write('node-confined');`
  const nodeFile = join(writable, 'node.txt')
  const { stdout } = await execute(launcher, [...rule, join(installed, 'bin/node'), '-e', script, nodeFile, forbidden], options)
  if (stdout !== 'node-confined' || await readFile(nodeFile, 'utf8') !== 'node-ok'
    || await readFile(forbidden, 'utf8') !== 'unchanged') throw new Error('Bundled Node confinement verification failed.')
  return probe.trim()
}

/** Extract, visit configuration pages, save a keyless setting, and verify it after restart. */
export async function qualify(archive, reports) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Web qualification requires native Linux x64.')
  await mkdir(reports, { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), 'apus-web-installed-'))
  const toolPath = join(temporary, 'tools')
  const env = smokeEnvironment(temporary, toolPath)
  const installed = join(temporary, 'apus-reflex-harness-web')
  const report = { passed: false, stages: [], limitations: ['No provider credentials or external model task is exercised.', 'This archive qualifies Linux x64 on the native CI distribution.'] }
  let browser
  let child
  let childClosed
  let group
  const groupAlive = async () => {
    if (!group) return false
    const { stdout } = await execute('/bin/ps', ['-eo', 'pgid='])
    return stdout.split(/\s+/).some(value => Number(value) === group)
  }
  const stop = async () => {
    if (!child) return
    child.kill('SIGTERM')
    const deadline = Date.now() + 30_000
    while (await groupAlive()) {
      if (Date.now() >= deadline) throw new Error('Web runtime left owned processes after shutdown.')
      await pause(100)
    }
    await childClosed
    child = undefined
    group = undefined
  }
  try {
    await mkdir(toolPath)
    for (const name of ['sh', 'dirname', 'bash', 'env']) await symlink(`/usr/bin/${name}`, join(toolPath, name))
    await mkdir(env.HOME)
    const build = JSON.parse(await readFile(join(dirname(archive), 'build-info-web-linux-x64.json'), 'utf8'))
    const asset = build.assets.find(item => item.name === archiveName)
    if (build.target !== 'web-linux-x64' || asset?.sha256 !== digest(archive)) throw new Error('Web archive differs from collected build metadata.')
    if (process.env.GITHUB_SHA && build.sourceRevision !== process.env.GITHUB_SHA) throw new Error('Web archive differs from the workflow commit.')
    report.sourceRevision = build.sourceRevision
    report.archiveSha256 = asset.sha256
    report.version = build.version
    report.stages.push('archive-receipt-verified')
    await execute('/bin/tar', ['-xzf', archive, '-C', temporary], { timeout: 600_000 })
    verifyPayload(installed, build)
    const runtime = JSON.parse(await readFile(join(installed, 'runtime/runtime-manifest.json'), 'utf8'))
    verifyWebRuntime(runtime, build.sourceRevision)
    verifyPublishedInventory(dirname(archive), build, runtime)
    const { stdout: tools } = await execute('/bin/sh', ['-c', 'command -v node || command -v git || command -v pnpm || true'], { env })
    if (tools.trim()) throw new Error('External developer tools are unexpectedly available.')
    report.stages.push('extracted-payload-verified-no-external-tools')
    const { stdout: nodeIdentity } = await execute(join(installed, 'bin/node'),
      ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'],
      { env, cwd: temporary, timeout: 30_000, killSignal: 'SIGKILL' })
    const node = JSON.parse(nodeIdentity)
    if (node.version !== build.bundledNode.version || node.platform !== 'linux' || node.arch !== 'x64') {
      throw new Error('Extracted Node does not match the native build receipt.')
    }
    report.landlock = await verifySandboxExecution(installed, temporary, env)
    report.stages.push('bundled-node-and-confined-shell-allowed-and-denied-writes')
    const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
    browser = await chromium.launch()
    const start = async () => {
      child = spawn(join(installed, 'start.sh'), ['--port', '0'], { cwd: temporary, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      group = child.pid
      childClosed = new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
      let launchError
      childClosed.catch(error => { launchError = error })
      let output = ''
      child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-128 * 1024) })
      child.stderr.on('data', bytes => { output = (output + bytes.toString()).slice(-128 * 1024) })
      const deadline = Date.now() + 90_000
      while (!readinessUrl(output)) {
        if (launchError) throw launchError
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Web exited before readiness: ${redact(output)}`)
        if (Date.now() > deadline) throw new Error(`Web readiness deadline exceeded: ${redact(output)}`)
        await pause(100)
      }
      const url = readinessUrl(output)
      await verifyHttpAuthentication(url)
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
      await page.goto(url, { waitUntil: 'load' })
      await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 30_000 })
      return page
    }
    const settings = async page => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      return page.getByRole('dialog', { name: 'Settings', exact: true })
    }
    const workspace = join(env.DSH_HOME, 'Documents', 'deepseek-harness', 'default-workspace')
    const verifyWorkspace = async page => {
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
      if ((await page.getByRole('button', { name: 'Choose workspace', exact: true }).textContent())?.trim() !== 'Default workspace') {
        throw new Error('Web first-use workspace was not selected.')
      }
    }
    let page = await start()
    await verifyWorkspace(page)
    await writeFile(join(workspace, 'qualification.txt'), 'workspace-retained', { flag: 'wx' })
    report.stages.push('default-workspace-created-and-composer-editable')
    await page.getByText(`${build.version}-${build.sourceRevision.slice(0, 7)}`, { exact: true }).waitFor()
    await page.screenshot({ path: join(reports, 'home.png') })
    let dialog = await settings(page)
    const versionLabel = dialog.getByText(`Current version: ${build.version}`, { exact: true })
    await versionLabel.waitFor()
    await versionLabel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(reports, 'version.png') })
    report.stages.push('product-version-in-home-and-general-settings')
    await dialog.getByRole('button', { name: 'Models', exact: true }).click()
    await dialog.getByRole('button', { name: 'Add model provider', exact: true }).waitFor()
    await page.screenshot({ path: join(reports, 'models.png') })
    await dialog.getByRole('button', { name: 'Reflex model configuration', exact: true }).click()
    await dialog.locator('#reflex-endpoint').fill('https://qualification.invalid')
    await dialog.locator('#reflex-model').fill('qualification-only')
    await dialog.locator('#reflex-protocol').selectOption('typesafe')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    const save = dialog.getByRole('button', { name: 'Save', exact: true })
    const savedDeadline = Date.now() + 30_000
    while (!(await save.isVisible()) || !(await save.isDisabled())) {
      if (Date.now() > savedDeadline) throw new Error('Reflex settings did not finish saving.')
      await pause(100)
    }
    await page.screenshot({ path: join(reports, 'reflex.png') })
    report.stages.push('fresh-profile-http-models-and-reflex-save')
    await page.close()
    await stop()
    report.stages.push('first-exit-quiescent')
    page = await start()
    await verifyWorkspace(page)
    if (await readFile(join(workspace, 'qualification.txt'), 'utf8') !== 'workspace-retained') {
      throw new Error('Web workspace contents did not survive restart.')
    }
    report.stages.push('default-workspace-retained-after-restart')
    dialog = await settings(page)
    await dialog.getByRole('button', { name: 'Reflex model configuration', exact: true }).click()
    if (await dialog.locator('#reflex-endpoint').inputValue() !== 'https://qualification.invalid'
      || await dialog.locator('#reflex-model').inputValue() !== 'qualification-only'
      || await dialog.locator('#reflex-protocol').inputValue() !== 'typesafe') throw new Error('Web profile settings did not survive restart.')
    await page.screenshot({ path: join(reports, 'restart.png') })
    await page.close()
    await stop()
    report.stages.push('restart-settings-retained-and-exit-quiescent')
    report.passed = true
  } catch (error) {
    report.failure = { stage: report.stages.at(-1), message: redact(error.message) }
    throw new Error('Web archive qualification failed; see report.json')
  } finally {
    try { await browser?.close() }
    catch (error) { report.passed = false; report.cleanupFailure = redact(error.message) }
    try {
      if (child) {
        try { await stop() }
        catch (error) {
          if (group) { try { process.kill(-group, 'SIGKILL') } catch (killError) { if (killError.code !== 'ESRCH') throw killError } }
          await childClosed
          const deadline = Date.now() + 10_000
          while (await groupAlive()) {
            if (Date.now() > deadline) throw error
            await pause(100)
          }
          throw error
        }
      }
    } catch (error) { report.passed = false; report.cleanupFailure = redact(error.message) }
    try { await rm(temporary, { recursive: true, force: true }) }
    catch (error) { report.passed = false; report.cleanupFailure = redact(error.message) }
    await writeFile(join(reports, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    if (report.cleanupFailure) throw new Error('Web qualification cleanup failed; see report.json')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--archive' || args[2] !== '--report-dir') {
    console.error('Usage: node scripts/product-web-smoke.mjs --archive <tar.gz> --report-dir <directory>')
    process.exitCode = 1
  } else await qualify(resolve(args[1]), resolve(args[3])).catch(error => { console.error(error.message); process.exitCode = 1 })
}
