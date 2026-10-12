/** Keyless checks for the Windows installed-app qualification harness. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate, setTimeout } from 'node:timers/promises'
import { ownedProcessIds, redactDiagnostic, smokeEnvironment, verifyInstalledIdentity, validateRequalification, failureDiagnostic, runTrackedProcess, terminateOwnedProcesses } from './product-windows-smoke.mjs'

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
  const build = { target: 'win32-x64', sourceRevision: 'same' }
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

test('requalification rejects another run, source, repository, workflow, or ambiguous artifact', () => {
  const source = 'a'.repeat(40)
  const repository = 'APUS-AI-Lab/APUS-Reflex-Harness'
  const run = { id: 123, repository: { full_name: repository }, head_repository: { full_name: repository },
    head_sha: source, path: '.github/workflows/product-release.yml', status: 'completed' }
  const artifact = { id: 456, name: 'apus-preview-win32-x64-123', expired: false, workflow_run: { id: 123, head_sha: source } }
  assert.equal(validateRequalification(run, [artifact], repository, '123', source), 456)
  for (const change of [{ id: 999 }, { head_sha: 'b'.repeat(40) }, { repository: { full_name: 'other/repo' } },
    { head_repository: { full_name: 'other/repo' } }, { path: '.github/workflows/ci.yml' }, { status: 'in_progress' }]) {
    assert.throws(() => validateRequalification({ ...run, ...change }, [artifact], repository, '123', source), /source run/)
  }
  for (const artifacts of [[], [artifact, artifact], [{ ...artifact, expired: true }], [{ ...artifact, name: 'other' }],
    [{ ...artifact, workflow_run: { id: 999, head_sha: source } }], [{ ...artifact, workflow_run: { id: 123, head_sha: 'b'.repeat(40) } }]]) {
    assert.throws(() => validateRequalification(run, artifacts, repository, '123', source), /exactly one/)
  }
  assert.throws(() => validateRequalification(run, [artifact], repository, '123', 'short'), /full lowercase/)
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
    { timeout: 100, killSignal: 'SIGKILL' }, value => { pid = value }, async () => { observations++ }),
  error => error.killed === true && error.signal === 'SIGKILL')
  assert.ok(pid > 0)
  assert.ok(observations > 0)
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
})

test('failed process observation kills and awaits the acquired command rather than abandoning it', async () => {
  let pid
  await assert.rejects(runTrackedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
    { timeout: 5000 }, value => { pid = value }, async () => { throw new Error('Observation unavailable') }), /Observation unavailable/)
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


test('an exit already observed during sampling keeps its numeric failure and separate observation diagnostic', async () => {
  let pid
  await assert.rejects(runTrackedProcess(process.execPath, ['-e', 'process.exit(7)'],
    { timeout: 5000 }, value => { pid = value }, async () => {
      const deadline = Date.now() + 5000
      while (true) {
        try { process.kill(pid, 0) }
        catch (error) { if (error.code === 'ESRCH') break; throw error }
        assert.ok(Date.now() < deadline, 'Child must exit before the observer fails')
        await setTimeout(10)
      }
      await setImmediate()
      throw new Error('Observation unavailable; API_KEY=private')
    }), error => {
    const diagnostic = failureDiagnostic(error)
    assert.equal(diagnostic.code, 7)
    assert.equal(diagnostic.killed, false)
    assert.equal(diagnostic.observationFailure.message, 'Observation unavailable; API_KEY=[redacted]')
    return true
  })
})
