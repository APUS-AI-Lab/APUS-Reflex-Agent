/** Keyless checks for the native macOS installation qualification harness. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { smokeEnvironment, verifyInstalledIdentity, redactDiagnostic } from './product-macos-smoke.mjs'

test('installed application excludes developer credentials, Node options and existing user data', () => {
  const source = { HOME: '/existing', PATH: '/opt/homebrew/bin', GH_TOKEN: 'private', JEV_API_KEY: 'private', NODE_OPTIONS: '--require=developer.js', ELECTRON_RUN_AS_NODE: '1', DSH_HOME: '/existing-state', USER: 'runner' }
  const env = smokeEnvironment(source, '/fresh')
  assert.equal(env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin')
  assert.equal(env.HOME, '/fresh/home')
  assert.equal(env.DSH_HOME, '/fresh/harness-home')
  assert.equal(env.SYSTEM3_DESKTOP_USER_DATA_DIR, '/fresh')
  assert.equal(env.USER, 'runner')
  for (const key of ['GH_TOKEN', 'JEV_API_KEY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) assert.equal(env[key], undefined)
  assert.equal(source.HOME, '/existing')
})

test('both native Mac architectures reject a stale or mismatched installed runtime', () => {
  for (const arch of ['arm64', 'x64']) {
    const runtime = { mode: 'deployed', platform: 'darwin', arch, sourceRevision: 'same', sourceDirty: false }
    const build = { target: `darwin-${arch}`, sourceRevision: 'same' }
    verifyInstalledIdentity(runtime, build, arch)
    for (const override of [{ sourceRevision: 'stale' }, { sourceDirty: true }, { mode: 'workspace' }, { platform: 'win32' }, { arch: 'invalid' }]) {
      assert.throws(() => verifyInstalledIdentity({ ...runtime, ...override }, build, arch), /does not match/)
    }
    assert.throws(() => verifyInstalledIdentity(runtime, { ...build, target: 'darwin-ia32' }, arch), /does not match/)
    assert.throws(() => verifyInstalledIdentity(runtime, build, arch === 'arm64' ? 'x64' : 'arm64'), /does not match/)
  }
})

test('failure diagnostics omit local authorization URLs and credential assignments', () => {
  assert.equal(redactDiagnostic('http://localhost:123/?token=private API_KEY=private token: private'), '[URL redacted] API_KEY=[redacted] token: [redacted]')
  assert.equal(redactDiagnostic('x'.repeat(5000)).length, 2000)
})
