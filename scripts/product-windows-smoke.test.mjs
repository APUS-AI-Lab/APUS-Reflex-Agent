/** Keyless checks for the Windows installed-app qualification harness. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { ownedProcessIds, redactDiagnostic, smokeEnvironment, verifyInstalledIdentity, failureDiagnostic, runTrackedProcess, terminateOwnedProcesses } from './product-windows-smoke.mjs'

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


test('an observed exit retains its numeric failure while inherited output is still open', async t => {
  const server = createServer()
  let keeper
  t.after(async () => {
    keeper?.destroy()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const connected = once(server, 'connection').then(([socket]) => { keeper = socket; return socket })
  const port = server.address().port
  // A connected descendant holds stdout until the observer releases it, separating exit from close.
  const keepOutput = `const socket = require('node:net').connect(${port}, '127.0.0.1'); socket.on('close', () => process.exit(0));`
  const script = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(keepOutput)}], { stdio: ['ignore', 1, 2] }).unref(); process.exit(7);`
  let exited
  let closed = false
  await assert.rejects(runTrackedProcess(process.execPath, ['-e', script],
    { timeout: 5000 }, child => {
      exited = once(child, 'exit')
      child.once('close', () => { closed = true })
    }, async () => {
      const [[code, signal], socket] = await Promise.all([exited, connected])
      try {
        assert.equal(code, 7)
        assert.equal(signal, null)
        assert.equal(closed, false)
      } finally { socket.end() }
      throw new Error('Observation unavailable; API_KEY=private')
    }), error => {
    const diagnostic = failureDiagnostic(error)
    assert.equal(diagnostic.code, 7)
    assert.equal(diagnostic.killed, false)
    assert.equal(diagnostic.observationFailure.message, 'Observation unavailable; API_KEY=[redacted]')
    return true
  })
  assert.equal(closed, true)
})

test('Full and Lite installed runtime identities cannot be mixed', () => {
  const runtime = { mode: 'deployed', platform: 'win32', arch: 'x64', sourceRevision: 'same', sourceDirty: false, edition: 'lite' }
  const build = { version: '0.1.1', target: 'win32-x64', sourceRevision: 'same', edition: 'lite' }
  verifyInstalledIdentity(runtime, build)
  assert.throws(() => verifyInstalledIdentity({ ...runtime, edition: 'full' }, build), /does not match/)
})
