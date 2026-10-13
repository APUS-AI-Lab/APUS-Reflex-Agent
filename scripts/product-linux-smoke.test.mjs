/** Keyless checks for native Linux installer acceptance and kernel sandbox observations. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { readFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installedExecutable, verifyExpectedSource, smokeEnvironment, verifyInstalledIdentity, verifyRendererSandbox, verifyRemovedInstallation, verifySandboxExecution, redactDiagnostic } from './product-linux-smoke.mjs'

test('installed application has isolated state without credentials or developer PATH', () => {
  const source = { HOME: '/existing', PATH: '/usr/bin:/developer', GH_TOKEN: 'private', JEV_API_KEY: 'private', NODE_OPTIONS: '--require=developer.js', ELECTRON_RUN_AS_NODE: '1', DSH_HOME: '/existing-state', DISPLAY: ':99', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/private-bus', USER: 'runner' }
  const env = smokeEnvironment(source, '/fresh', '/private-bin')
  assert.equal(env.PATH, '/private-bin')
  assert.equal(env.HOME, '/fresh/home')
  assert.equal(env.DSH_HOME, '/fresh/harness-home')
  assert.equal(env.XDG_CONFIG_HOME, '/fresh/config')
  assert.equal(env.DISPLAY, ':99')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, source.DBUS_SESSION_BUS_ADDRESS)
  for (const key of ['GH_TOKEN', 'JEV_API_KEY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) assert.equal(env[key], undefined)
  assert.equal(source.HOME, '/existing')
})

test('installed runtime must match the clean collected Linux revision', () => {
  const runtime = { mode: 'deployed', platform: 'linux', arch: 'x64', sourceRevision: 'same', sourceDirty: false }
  const build = { version: '0.1.0', target: 'linux-x64', sourceRevision: 'same' }
  verifyInstalledIdentity(runtime, build)
  for (const override of [{ sourceRevision: 'stale' }, { sourceDirty: true }, { mode: 'workspace' }, { platform: 'darwin' }, { arch: 'arm64' }]) {
    assert.throws(() => verifyInstalledIdentity({ ...runtime, ...override }, build), /does not match/)
  }
  assert.throws(() => verifyInstalledIdentity(runtime, { ...build, target: 'linux-arm64' }), /does not match/)
})

test('sandbox evidence requires a real renderer PID and both kernel restrictions', () => {
  const renderer = { pid: 42, sandbox: true, noSandbox: false, disableSetuidSandbox: false }
  const status = 'Name:\trenderer\nNoNewPrivs:\t1\nSeccomp:\t2\n'
  assert.deepEqual(verifyRendererSandbox(renderer, status), { pid: 42, seccomp: 2, noNewPrivs: 1 })
  for (const override of [{ pid: 0 }, { pid: -1 }, { pid: 1.5 }, { sandbox: false }, { noSandbox: true }, { disableSetuidSandbox: true }]) {
    assert.throws(() => verifyRendererSandbox({ ...renderer, ...override }, status), /disabled/)
  }
  for (const refused of ['', 'NoNewPrivs:\t1\n', 'Seccomp:\t2\n', 'NoNewPrivs:\t0\nSeccomp:\t2\n', 'NoNewPrivs:\t1\nSeccomp:\t0\n']) {
    assert.throws(() => verifyRendererSandbox(renderer, refused), /kernel sandbox/)
  }
})

test('failure reports redact authorization URLs and credential values', () => {
  assert.equal(redactDiagnostic('http://localhost:123/?token=private API_KEY=private token: private'), '[URL redacted] API_KEY=[redacted] token: [redacted]')
  assert.equal(redactDiagnostic('x'.repeat(5000)).length, 2000)
})

test('uninstallation rejects remaining files and a loaded application policy', () => {
  verifyRemovedInstallation({ executable: false, policy: false }, 'other-app (unconfined)\n')
  for (const remaining of [{ executable: true, policy: false }, { executable: false, policy: true }]) {
    assert.throws(() => verifyRemovedInstallation(remaining, ''), /left application/)
  }
  assert.throws(() => verifyRemovedInstallation({ executable: false, policy: false }, 'apus-reflex-harness (unconfined)\n'), /AppArmor/)
})

for (const mode of ['unsupported', 'unconfined']) {
  test(`installed sandbox rejects a ${mode} launcher`, { skip: process.platform === 'win32' }, async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'apus-linux-sandbox-unit-'))
    t.after(() => rm(temporary, { recursive: true, force: true }))
    const resources = join(temporary, 'resources')
    const native = join(resources, 'system3-runtime/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin')
    const nodeDirectory = join(resources, 'app.asar.unpacked/node_modules/node/bin')
    for (const directory of [join(native, 'glibc'), join(native, 'musl'), nodeDirectory]) await mkdir(directory, { recursive: true })
    for (const file of ['glibc/system.node', 'musl/system.node']) await writeFile(join(native, file), 'fixture')
    await symlink(process.execPath, join(nodeDirectory, 'node'))
    const script = `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--probe') process.stdout.write(${JSON.stringify(mode === 'unsupported' ? 'not enforced\n' : 'landlock: fully enforced\n')});
else { const command = args.slice(args.indexOf('--') + 1); const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' }); process.exitCode = result.status ?? 1; }
`
    await writeFile(join(native, 'landlock-run'), script, { mode: 0o755 })
    await assert.rejects(verifySandboxExecution(resources, temporary, { PATH: '', HOME: temporary }),
      mode === 'unsupported' ? /did not report enforcement/ : /forbidden write/)
  })
}

test('installer qualification distinguishes selected product source from helper source', () => {
  const source = 'a'.repeat(40)
  verifyExpectedSource(source, source)
  for (const expected of [undefined, '', 'a'.repeat(7), 'b'.repeat(40)]) {
    assert.throws(() => verifyExpectedSource(source, expected), /explicitly selected build SHA/)
  }
})

test('executable ownership query stays bounded for a package with a large runtime file list', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'apus-linux-query-unit-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const fixture = join(temporary, 'query.cjs')
  await writeFile(fixture, `const args = process.argv.slice(2);
if (args[0] === '-L') process.stdout.write('runtime/file\\n'.repeat(200000));
else if (args[0] === '-S' && args[1] === '/opt/APUS Reflex Harness/apus-reflex-harness') process.stdout.write('apus-reflex-harness: ' + args[1] + '\\n');
else process.exitCode = 2;
`)
  const execute = promisify(execFile)
  await assert.rejects(execute(process.execPath, [fixture, '-L', 'apus-reflex-harness']), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
  const executable = await installedExecutable((command, args, options) => {
    assert.equal(command, '/usr/bin/dpkg-query')
    return execute(process.execPath, [fixture, ...args], options)
  })
  const { build } = JSON.parse(await readFile(new URL('../frontend/package.json', import.meta.url), 'utf8'))
  assert.equal(executable, `/opt/${build.productName}/${build.linux.executableName}`)
  for (const stdout of ['', 'other-package: ' + executable, 'apus-reflex-harness: /opt/other', `apus-reflex-harness: ${executable}\nother-package: ${executable}`]) {
    await assert.rejects(installedExecutable(async () => ({ stdout })), /not owned exclusively/)
  }
})

test('Full and Lite installed runtime identities cannot be mixed', () => {
  const runtime = { mode: 'deployed', platform: 'linux', arch: 'x64', sourceRevision: 'same', sourceDirty: false, edition: 'lite' }
  const build = { version: '0.1.1', target: 'linux-x64', sourceRevision: 'same', edition: 'lite' }
  verifyInstalledIdentity(runtime, build)
  assert.throws(() => verifyInstalledIdentity({ ...runtime, edition: 'full' }, build), /does not match/)
})
