/** Keyless checks for the native macOS installation qualification harness. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { smokeEnvironment, verifyInstalledIdentity, redactDiagnostic, runCommand, failureDiagnostic, verifyExpectedSource, isImageMounted } from './product-macos-smoke.mjs'

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

test('requalification accepts only the explicitly selected full product source', () => {
  const source = 'a'.repeat(40)
  verifyExpectedSource(source, source)
  for (const expected of [undefined, '', 'a'.repeat(7), 'b'.repeat(40), 'A'.repeat(40)]) {
    assert.throws(() => verifyExpectedSource(source, expected), /explicitly selected/)
  }
})

test('mount inspection detects an image even when attach did not return success', () => {
  const mountpoint = '/private/tmp/apus-macos-installed-abc/volume'
  const listing = `/dev/disk4s1 on ${mountpoint} (hfs, local, nodev, nosuid, read-only, noowners)\n`
  assert.equal(isImageMounted(listing, mountpoint), true)
  assert.equal(isImageMounted(listing, `${mountpoint}-other`), false)
  assert.equal(isImageMounted(`/dev/disk4s1 on ${mountpoint}-other (hfs)`, mountpoint), false)
  assert.equal(isImageMounted('', mountpoint), false)
})

test('a real timed-out child preserves bounded command timing and termination evidence', async () => {
  const commands = []
  await assert.rejects(runCommand('attach', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 100 }, commands), error => {
    assert.equal(error.killed, true)
    return true
  })
  assert.equal(commands.length, 1)
  assert.equal(commands[0].stage, 'attach')
  assert.equal(commands[0].timeoutMs, 100)
  assert.equal(commands[0].killed, true)
  assert.ok(commands[0].durationMs >= 90)
  assert.ok(commands[0].durationMs < 5000)
  assert.notEqual(commands[0].signal, undefined)
})

test('a real nonzero exit preserves code and redacts process output', async () => {
  const commands = []
  await assert.rejects(runCommand('copy', process.execPath,
    ['-e', 'console.error("API_KEY=private"); process.exit(7)'], { timeout: 5000 }, commands))
  assert.equal(commands[0].code, 7)
  assert.equal(commands[0].killed, false)
  assert.equal(commands[0].stderr, 'API_KEY=[redacted]\n')
  assert.ok(!JSON.stringify(commands).includes('API_KEY=private'))
  const cleanup = failureDiagnostic(new Error('https://localhost/?token=private'))
  assert.equal(cleanup.message, '[URL redacted]')
})

test('completed commands retain success and elapsed time', async () => {
  const commands = []
  const result = await runCommand('inspect', process.execPath, ['-e', 'process.stdout.write("ready")'], { timeout: 5000 }, commands)
  assert.equal(result.stdout, 'ready')
  assert.equal(commands[0].exitCode, 0)
  assert.ok(commands[0].durationMs >= 0)
})
