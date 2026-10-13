/** Keyless checks for the Windows installed-app qualification harness. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ownedProcessIds, redactDiagnostic, smokeEnvironment, verifyInstalledIdentity, failureDiagnostic, runTrackedProcess, runInstalledUninstaller, terminateOwnedProcesses } from './product-windows-smoke.mjs'

test('installed application cannot inherit developer Node, credentials or runtime overrides', () => {
  const source = { SystemRoot: 'C:\\Windows', Path: 'C:\\node;C:\\tools', APPDATA: 'C:\\Users\\runner\\AppData', GH_TOKEN: 'secret', DEEPSEEK_API_KEY: 'secret', JEV_API_KEY: 'secret', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require=developer.js', DSH_HOME: 'C:\\existing' }
  const env = smokeEnvironment(source, 'C:\\fresh')
  assert.equal(env.PATH, 'C:\\Windows\\System32;C:\\Windows')
  assert.equal(env.Path, undefined)
  assert.equal(env.DSH_HOME, 'C:\\fresh\\harness-home')
  assert.equal(env.SYSTEM3_DESKTOP_USER_DATA_DIR, 'C:\\fresh')
  for (const key of ['GH_TOKEN', 'DEEPSEEK_API_KEY', 'JEV_API_KEY', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) assert.equal(env[key], undefined)
  assert.equal(source.GH_TOKEN, 'secret')
  assert.throws(() => smokeEnvironment({}, 'C:\\fresh'), /SystemRoot/)
})

test('teardown follows descendants and detached installed processes without claiming another app', () => {
  const processes = [
    { pid: 9, parent: 8, owned: false },
    { pid: 8, parent: 7, owned: false },
    { pid: 7, parent: 1, owned: false },
    { pid: 10, parent: 1, owned: true },
    { pid: 20, parent: 1, owned: false },
  ]
  assert.deepEqual(ownedProcessIds(processes, [7]), [9, 8, 7, 10])
  assert.deepEqual(ownedProcessIds([], [7]), [])
})

test('installed runtime must come from the collected clean Windows revision', () => {
  const runtime = { mode: 'deployed', platform: 'win32', arch: 'x64', sourceRevision: 'same', sourceDirty: false }
  const build = { version: '0.1.0', target: 'win32-x64', sourceRevision: 'same' }
  verifyInstalledIdentity(runtime, build)
  for (const override of [{ sourceRevision: 'stale' }, { sourceDirty: true }, { mode: 'workspace' }, { platform: 'darwin' }, { arch: 'arm64' }]) {
    assert.throws(() => verifyInstalledIdentity({ ...runtime, ...override }, build), /does not match/)
  }
  assert.throws(() => verifyInstalledIdentity(runtime, { ...build, target: 'darwin-arm64' }), /does not match/)
})

test('failure reports omit local authorization URLs and credential assignments', () => {
  const text = redactDiagnostic('Navigation http://127.0.0.1:123/?token=private-token failed; API_KEY=private-key token: private-token')
  assert.equal(text, 'Navigation [URL redacted] failed; API_KEY=[redacted] token: [redacted]')
})

test('numeric exits and timeouts remain distinct and redact command output', () => {
  const error = Object.assign(new Error('Installer failed'), { code: 2, killed: false, signal: null, stderr: 'API_KEY=private' })
  assert.deepEqual(failureDiagnostic(error), { type: 'Error', message: 'Installer failed', code: 2, killed: false, signal: null, stderr: 'API_KEY=[redacted]' })
  const timeout = failureDiagnostic(Object.assign(new Error('Timed out'), { code: null, killed: true, signal: 'SIGTERM' }))
  assert.equal(timeout.killed, true)
  assert.equal(timeout.signal, 'SIGTERM')
})

test('tracked process preserves the acquired PID and waits for timed-out execution to exit', async () => {
  let pid
  let observations = 0
  await assert.rejects(runTrackedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
    { timeout: 100, killSignal: 'SIGKILL' }, child => { pid = child.pid }, async () => { observations++ }),
  error => error.killed === true && error.signal === 'SIGKILL')
  assert.ok(pid > 0)
  assert.ok(observations > 0)
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
})

test('failed process observation kills and awaits the acquired command rather than abandoning it', async () => {
  let pid
  await assert.rejects(runTrackedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
    { timeout: 5000 }, child => { pid = child.pid }, async () => { throw new Error('Observation unavailable') }), /Observation unavailable/)
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
})

test('cleanup terminates an acquired installer tree and waits for independent empty observation', async () => {
  let processes = [{ pid: 11, parent: 10, owned: false }, { pid: 10, parent: 1, owned: false }, { pid: 99, parent: 1, owned: false }]
  const killed = []
  let observations = 0
  const errors = await terminateOwnedProcesses(async () => { observations++; return processes }, async pid => {
    killed.push(pid)
    processes = processes.filter(process => process.pid !== pid && process.parent !== pid)
  }, [10])
  assert.deepEqual(errors, [])
  assert.deepEqual(killed, [11, 10])
  assert.ok(observations >= 2)
  assert.deepEqual(processes.map(process => process.pid), [99])
})

test('cleanup observation failures remain independently reportable beside an earlier installer failure', async () => {
  const primary = failureDiagnostic(Object.assign(new Error('Installation failed'), { code: 2 }))
  const errors = await terminateOwnedProcesses(async () => { throw new Error('CIM unavailable') }, async () => {}, [10])
  const report = { failure: primary, cleanupErrors: errors }
  assert.equal(report.failure.code, 2)
  assert.deepEqual(report.cleanupErrors.map(error => error.stage), ['observe-before-cleanup', 'wait-process-exit'])
})


for (const ready of [true, false]) {
  test(ready ? 'an observed exit retains its numeric failure before output closes'
    : 'missing output readiness aborts and closes the owned process', async t => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, t.signal])
    const deadline = setTimeout(() => controller.abort(), 5000)
    let child
    let exited
    let outputReady
    let closed = false
    const holdOutput = () => {}
    // A readable listener keeps output in pull mode until the observer releases it.
    // stdin releases exit only after the observer has acquired unread stdout.
    const script = `${ready ? "process.stdout.write('pending output');" : ''}
process.stdin.resume(); process.stdin.once('end', () => process.exit(7));`
    try {
      await assert.rejects(runTrackedProcess(process.execPath, ['-e', script],
        { timeout: 5000 }, command => {
          child = command
          command.stdout.pause()
          command.stdout.on('readable', holdOutput)
          exited = once(command, 'exit', { signal })
          outputReady = once(command.stdout, 'readable', { signal })
          // Both waits are owned before the child can fail or cancellation can settle them.
          void exited.catch(() => {})
          void outputReady.catch(() => {})
          command.once('close', () => { closed = true })
          if (!ready) command.once('spawn', () => controller.abort())
        }, async () => {
          try {
            await outputReady
            assert.ok(child.stdout.readableLength > 0)
            child.stdin.end()
            const [code, termination] = await exited
            assert.equal(code, 7)
            assert.equal(termination, null)
            assert.equal(closed, false)
          } finally { child.stdout.off('readable', holdOutput); child.stdout.resume() }
          throw new Error('Observation unavailable; API_KEY=private')
        }), error => {
        if (!ready) { assert.equal(error.name, 'AbortError'); return true }
        const diagnostic = failureDiagnostic(error)
        assert.equal(diagnostic.code, 7)
        assert.equal(diagnostic.killed, false)
        assert.equal(diagnostic.observationFailure.message, 'Observation unavailable; API_KEY=[redacted]')
        return true
      })
      assert.equal(closed, true)
      assert.ok(child.pid > 0)
      assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH')
    } finally {
      clearTimeout(deadline)
      controller.abort()
      child?.stdout.off('readable', holdOutput)
      child?.stdout.resume()
    }
  })
}

test('Full and Lite installed runtime identities cannot be mixed', () => {
  const runtime = { mode: 'deployed', platform: 'win32', arch: 'x64', sourceRevision: 'same', sourceDirty: false, edition: 'lite' }
  const build = { version: '0.1.1', target: 'win32-x64', sourceRevision: 'same', edition: 'lite' }
  verifyInstalledIdentity(runtime, build)
  assert.throws(() => verifyInstalledIdentity({ ...runtime, edition: 'full' }, build), /does not match/)
})

for (const synchronous of [true, false]) {
  test(`copied uninstaller ${synchronous ? 'removes the owned installation synchronously' : 'rejects the missing synchronous directory argument'}`, async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'apus uninstall fixture '))
    t.after(() => rm(temporary, { recursive: true, force: true }))
    const installation = join(temporary, 'application')
    await mkdir(installation)
    await writeFile(join(installation, 'APUS Reflex Harness.exe'), 'owned application')
    const script = `const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '/S' || !args[1].startsWith('_?=') || args[1].includes('"')) {
  process.stderr.write('Synchronous uninstall requires its final directory argument'); process.exit(86);
}
const installation = args[1].slice(3);
if (path.dirname(__filename) === installation) process.exit(87);
fs.writeFileSync(path.join(process.cwd(), 'uninstall-arguments.json'), JSON.stringify(args));
fs.rmSync(installation, { recursive: true });
`
    await writeFile(join(installation, 'Uninstall APUS Reflex Harness.exe'), script)
    const receipt = {}
    const run = async (command, args, options, observed) => {
      assert.equal(await readFile(command, 'utf8'), script)
      assert.equal(command, join(temporary, 'qualification-uninstaller.exe'))
      assert.deepEqual(args, ['/S', `_?=${installation}`])
      assert.equal(options.timeout, 120_000)
      assert.equal(options.windowsVerbatimArguments, true)
      assert.equal(options.windowsHide, true)
      assert.equal(options.cwd, temporary)
      assert.equal(options.shell, undefined)
      // This Node fixture uses ordinary argv; only native NSIS consumes the verbatim _?= remainder.
      return runTrackedProcess(process.execPath, [command, ...(synchronous ? args : ['/S'])], {
        ...options, windowsVerbatimArguments: false,
      }, child => { observed.rootPid = child.pid }, async () => { observed.observedPids = [observed.rootPid] })
    }
    const pending = runInstalledUninstaller(installation, temporary, process.env, run, receipt)
    if (synchronous) {
      await pending
      assert.equal(receipt.exitCode, 0)
      assert.equal(receipt.summary.executableExists, false)
      assert.equal(receipt.summary.directoryExists, false)
      assert.deepEqual(JSON.parse(await readFile(join(temporary, 'uninstall-arguments.json'), 'utf8')), ['/S', `_?=${installation}`])
    } else {
      await assert.rejects(pending, error => error.code === 86)
      assert.equal(receipt.exitCode, 86)
      assert.equal(receipt.failure.code, 86)
      assert.equal(receipt.summary.executableExists, true)
      assert.match(receipt.failure.stderr, /requires its final directory argument/)
    }
    assert.ok(receipt.rootPid > 0)
    assert.deepEqual(receipt.observedPids, [receipt.rootPid])
    assert.ok(Number.isFinite(receipt.durationMs) && receipt.durationMs >= 0)
    assert.throws(() => process.kill(receipt.rootPid, 0), error => error.code === 'ESRCH')
  })
}
