/** Source-only Web package guards and extracted launcher behavior. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digest, inventoryName, linuxNativePackage, payloadFiles, verifyWebRuntime, verifyProductClientBuild, webProfilePatch } from './product-web-package.mjs'
import { launchOptions } from './product-web-launch.mjs'
import { readinessUrl, redact, smokeEnvironment, verifyPayload, verifyPublishedInventory, verifyHttpAuthentication, verifySandboxExecution } from './product-web-smoke.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'apus-web-unit-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('launcher keeps loopback binding and persistent data separate from the package', () => {
  assert.deepEqual(launchOptions([], {}, '/home/example'), {
    data: '/home/example/.local/share/apus-reflex-web', args: ['web', '--host', '127.0.0.1', '--port', '3080', '--no-open'],
  })
  assert.equal(launchOptions(['--port', '0', '--data-dir', '/data/profile'], {}).data, '/data/profile')
  assert.equal(launchOptions([], { DSH_HOME: '/custom/data' }).data, '/custom/data')
  assert.throws(() => launchOptions(['--host', '0.0.0.0']), /Usage/)
  assert.throws(() => launchOptions(['--port', '65536']), /Port/)
})

test('collector rejects source and native target mismatches', () => {
  const runtime = { mode: 'deployed', sourceDirty: false, sourceRevision: 'revision', platform: 'linux', arch: 'x64', entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js' }
  verifyWebRuntime(runtime, 'revision')
  for (const change of [{ mode: 'workspace' }, { sourceDirty: true }, { sourceRevision: 'other' }, { platform: 'darwin' }, { arch: 'arm64' }, { entry: '/checkout/bin.js' }]) {
    assert.throws(() => verifyWebRuntime({ ...runtime, ...change }, 'revision'), /same-commit/)
  }
})

test('payload verification rejects modified, additional, and linked files', t => {
  const directory = fixture(t)
  writeFileSync(join(directory, 'entry.mjs'), 'export {}\n')
  writeFileSync(join(directory, 'files.json'), JSON.stringify(payloadFiles(directory)))
  const build = { payloadManifestSha256: digest(join(directory, 'files.json')) }
  verifyPayload(directory, build)
  writeFileSync(join(directory, 'entry.mjs'), 'changed\n')
  assert.throws(() => verifyPayload(directory, build), /differs/)
  writeFileSync(join(directory, 'entry.mjs'), 'export {}\n')
  writeFileSync(join(directory, 'extra'), 'extra')
  assert.throws(() => verifyPayload(directory, build), /differs/)
  symlinkSync(join(directory, 'entry.mjs'), join(directory, 'link'))
  assert.throws(() => payloadFiles(directory), /links/)
})

test('qualification accepts only completed loopback readiness and redacts auth URLs', () => {
  assert.equal(readinessUrl('dsh web: http://127.0.0.1:1234/?token=fixture\n'), 'http://127.0.0.1:1234/?token=fixture')
  assert.equal(readinessUrl('dsh web: http://127.0.0.1:1234/?token=incomplete'), undefined)
  assert.equal(readinessUrl('dsh web: http://0.0.0.0:1234/\n'), undefined)
  assert.equal(readinessUrl('dsh web: http://127.0.0.1:1234/\n'), undefined)
  assert.equal(readinessUrl('dsh web: http://127.0.0.1:1234/?token=\n'), undefined)
  assert.equal(redact('failed http://127.0.0.1:1234/?token=fixture key=ok API_KEY=private'), 'failed [URL redacted] key=ok API_KEY=[redacted]')
  const env = smokeEnvironment('/isolated', '/isolated/tools')
  assert.deepEqual(Object.keys(env).sort(), ['DSH_HOME', 'DSH_TELEMETRY_DISABLED', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR'])
})

test('extracted launcher invokes its own CLI and keeps an existing profile on restart', { skip: process.platform === 'win32' && 'Web tar launcher is POSIX-only' }, t => {
  const directory = fixture(t)
  const installation = join(directory, 'package')
  mkdirSync(join(installation, 'bin'), { recursive: true })
  symlinkSync(process.execPath, join(installation, 'bin/node'))
  copyFileSync(join(root, 'scripts/product-web-launch.mjs'), join(installation, 'launch.mjs'))
  const modules = join(installation, 'runtime/node_modules/@deepseek-ai')
  const boot = join(modules, 'dsh-app-boot')
  mkdirSync(boot, { recursive: true })
  writeFileSync(join(boot, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
  writeFileSync(join(boot, 'index.js'), `import { mkdirSync, writeFileSync } from 'node:fs';
export const PROFILE_TEMPLATES = { web: { bundles: ['base', 'web'] } };
export const resolveProfileDir = (profile, home) => home + '/profiles/' + profile;
export function initProfile(dir, bundles) { mkdirSync(dir, {recursive:true}); writeFileSync(dir + '/package.json', JSON.stringify({bundles})); }
`)
  mkdirSync(join(modules, 'dsh/lib'), { recursive: true })
  writeFileSync(join(modules, 'dsh/package.json'), JSON.stringify({ type: 'module' }))
  writeFileSync(join(modules, 'dsh/lib/bin.js'), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.DSH_HOME + '/observed.json', JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),node:process.execPath,options:process.env.NODE_OPTIONS}));
`)
  const home = join(directory, 'persistent')
  const env = { ...process.env, DSH_HOME: home }
  execFileSync(process.execPath, [join(installation, 'launch.mjs'), '--port', '0'], { env })
  const observed = JSON.parse(readFileSync(join(home, 'observed.json'), 'utf8'))
  assert.equal(observed.cwd, home)
  assert.deepEqual(observed.args, ['--profile', 'web', '--patch', join(installation, 'web.patch.yml'), '--host', '127.0.0.1', '--port', '0', '--no-open'])
  const profile = join(home, 'profiles/web/package.json')
  assert.deepEqual(JSON.parse(readFileSync(profile, 'utf8')).bundles, ['base', 'web', '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'])
  writeFileSync(profile, '{"user":"retained"}')
  execFileSync(process.execPath, [join(installation, 'launch.mjs')], { env })
  assert.equal(readFileSync(profile, 'utf8'), '{"user":"retained"}')
})

for (const mode of ['authenticated', 'unprotected', 'missing-cookie']) {
  test(`HTTP qualification handles ${mode} token exchange`, async t => {
    const requests = []
    const server = createServer((request, response) => {
      requests.push({ path: request.url, cookie: request.headers.cookie })
      if (request.url.includes('token=')) {
        response.writeHead(303, { location: './', ...(mode === 'missing-cookie' ? {} : { 'set-cookie': 'dsh=fixture; HttpOnly; Path=/' }) })
      } else if (request.headers.cookie === 'dsh=fixture' || mode === 'unprotected') {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<div id="root"></div>')
        return
      } else response.writeHead(401)
      response.end()
    })
    t.after(async () => {
      server.closeAllConnections()
      await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
    })
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${server.address().port}/?token=fixture`
    if (mode === 'authenticated') {
      await verifyHttpAuthentication(url)
      assert.deepEqual(requests, [{ path: '/', cookie: undefined }, { path: '/?token=fixture', cookie: undefined }, { path: '/', cookie: 'dsh=fixture' }])
    } else {
      await assert.rejects(verifyHttpAuthentication(url), mode === 'unprotected' ? /unauthenticated/ : /establish browser/)
    }
  })
}

for (const mode of ['no-enforcement', 'passthrough']) {
  test(`sandbox qualification rejects ${mode} launcher`, { skip: process.platform === 'win32' && 'Linux shell probe uses POSIX fixtures' }, async t => {
    const directory = fixture(t)
    const installed = join(directory, 'installed')
    const launcher = join(installed, 'runtime', linuxNativePackage, 'bin/landlock-run')
    mkdirSync(join(installed, 'runtime', linuxNativePackage, 'bin'), { recursive: true })
    mkdirSync(join(installed, 'bin'))
    symlinkSync(process.execPath, join(installed, 'bin/node'))
    writeFileSync(launcher, `#!/bin/sh
if [ "$1" = --probe ]; then
  printf '%s\\n' '${mode === 'no-enforcement' ? 'unsupported' : 'landlock: fully enforced'}'
  exit 0
fi
while [ "$1" != -- ]; do shift; done
shift
exec "$@"
`, { mode: 0o755 })
    await assert.rejects(verifySandboxExecution(installed, directory, smokeEnvironment(directory, '/usr/bin:/bin')),
      mode === 'no-enforcement' ? /did not report enforcement/ : /Landlock allowed a forbidden write/)
    if (mode === 'passthrough') assert.equal(readFileSync(join(directory, 'outside-sandbox.txt'), 'utf8'), 'escaped')
  })
}

test('published inventory references the named release file and the extracted runtime hash and version', t => {
  const directory = fixture(t)
  const file = join(directory, inventoryName)
  writeFileSync(file, '{"packages":[]}\n')
  const runtime = { version: 'fixture-runtime', dependencyInventory: { path: 'runtime-dependencies.json', sha256: digest(file) } }
  const build = { harnessVersion: runtime.version, runtimeDependencyInventory: { ...runtime.dependencyInventory, path: inventoryName } }
  verifyPublishedInventory(directory, build, runtime)
  assert.throws(() => verifyPublishedInventory(directory, { ...build, runtimeDependencyInventory: runtime.dependencyInventory }, runtime), /metadata differs/)
  assert.throws(() => verifyPublishedInventory(directory, { ...build, runtimeDependencyInventory: { ...build.runtimeDependencyInventory, path: '../elsewhere.json' } }, runtime), /metadata differs/)
  assert.throws(() => verifyPublishedInventory(directory, { ...build, harnessVersion: 'another-runtime' }, runtime), /metadata differs/)
  assert.throws(() => verifyPublishedInventory(directory, build, { ...runtime, dependencyInventory: { ...runtime.dependencyInventory, sha256: 'changed' } }), /metadata differs/)
  writeFileSync(file, 'changed inventory')
  assert.throws(() => verifyPublishedInventory(directory, build, runtime), /file differs/)
})

test('collector verifies product version and clean commit against the complete client artifact record', t => {
  const directory = fixture(t)
  mkdirSync(join(directory, 'apps/web/dist'), { recursive: true })
  writeFileSync(join(directory, 'apps/web/dist/index.html'), '<main>fixture</main>')
  const version = '0.1.0'
  const revision = '0123456789abcdef0123456789abcdef01234567'
  const module = new URL('./client-build-environment.ts', import.meta.url).href
  const writeRecord = environment => execFileSync(process.execPath,
    ['--import', fileURLToPath(import.meta.resolve('tsx/esm')), '--input-type=module', '-e',
      `import { writeClientBuildRecord } from ${JSON.stringify(module)}; writeClientBuildRecord(process.argv[1], JSON.parse(process.argv[2]));`,
      directory, JSON.stringify(environment)], { cwd: directory, stdio: 'pipe', timeout: 60_000 })
  const environment = { DSH_CLIENT_VERSION: '1.2.3', DSH_CLIENT_PRODUCT_VERSION: version, DSH_CLIENT_COMMIT_HASH: revision.slice(0, 7) }
  writeRecord(environment)
  verifyProductClientBuild(directory, version, revision)
  for (const change of [{ DSH_CLIENT_PRODUCT_VERSION: undefined }, { DSH_CLIENT_PRODUCT_VERSION: '9.9.9' },
    { DSH_CLIENT_COMMIT_HASH: 'fffffff' }, { DSH_CLIENT_GIT_DIRTY: 'true' }]) {
    writeRecord({ ...environment, ...change })
    assert.throws(() => verifyProductClientBuild(directory, version, revision), /must match the clean product/)
  }
  writeRecord(environment)
  writeFileSync(join(directory, 'apps/web/dist/index.html'), '<main>stale</main>')
  assert.throws(() => verifyProductClientBuild(directory, version, revision), /artifacts differ/)
})

test('product overlay resolves the first workspace inside persistent data without OS directory tools', t => {
  const directory = fixture(t)
  const patch = join(directory, 'web.patch.yml')
  writeFileSync(patch, webProfilePatch)
  const boot = new URL('../packages/boot/app-boot/src/index.ts', import.meta.url).href
  const resolver = new URL('../packages/api/workspace-controller/src/default-directory.ts', import.meta.url).href
  const script = `import { loadOptionalPatches } from ${JSON.stringify(boot)};
import { defaultWorkspaceDirectory } from ${JSON.stringify(resolver)};
const patches = loadOptionalPatches('web', process.argv[1]);
const expression = patches.find(row => row.id === 'workspace-controller').config.documentsDirectory.__jsExpr;
const documents = new Function('process', 'return (' + expression + ')')({env:{DSH_HOME:process.argv[2]}});
const workspace = await defaultWorkspaceDirectory(documents, new AbortController().signal, {
  platform:'linux', run:async () => {throw new Error('OS directory lookup must not run')}
});
process.stdout.write(workspace);`;
  const home = join(directory, 'persistent data')
  const output = execFileSync(process.execPath, ['--import', fileURLToPath(import.meta.resolve('tsx/esm')), '--input-type=module', '-e', script, patch, home],
    { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(output, join(home, 'Documents', 'deepseek-harness', 'default-workspace'))
})
