/** Keyless checks for the Windows installed-app qualification harness. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ownedProcessIds, redactDiagnostic, smokeEnvironment, verifyInstalledIdentity } from './product-windows-smoke.mjs'

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
