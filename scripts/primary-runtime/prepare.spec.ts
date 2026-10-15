import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { zipSync } from 'fflate'
import { c as createTar } from 'tar'
import { expect, it } from 'vitest'
import {
  downloadPrimaryRuntimeAsset, machOLinks, prepareLlamaServer, prepareLockedLlamaServer, prepareOfficeSkillAssets,
  primaryRuntimePayloadDigest, smokeLlamaServer, smokePrimaryRuntime, unpackPrimaryRuntimeWheel,
} from './prepare.ts'
import lock from './lock.json' with { type: 'json' }

it('covers every SDK wheel target with the shared interpreter lock', () => {
  const platforms = JSON.parse(readFileSync(new URL('../../python/sdk-runtime/platforms.json', import.meta.url), 'utf8')) as Record<string, unknown>
  expect(Object.keys(lock.targets).sort()).toEqual(Object.keys(platforms).map(target => target.replace('macos-', 'mac-')).sort())
})

const libraryWheel = Buffer.from('UEsDBAoAAAAAAASeLl0sYMPjDAAAAAwAAAAJAAAAc2FtcGxlLnB5c2FtcGxlID0gNDIKUEsBAh4DCgAAAAAABJ4uXSxgw+MMAAAADAAAAAkAAAAAAAAAAQAAAKSBAAAAAHNhbXBsZS5weVBLBQYAAAAAAQABADcAAAAzAAAAAAA=', 'base64')
const relocatedWheel = Buffer.from('UEsDBAoAAAAAAASeLl3x0Nj9FAAAABQAAAAeAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlcmVxdWlyZXMgcmVsb2NhdGlvbgpQSwECHgMKAAAAAAAEni5d8dDY/RQAAAAUAAAAHgAAAAAAAAABAAAApIEAAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlUEsFBgAAAAABAAEATAAAAFAAAAAAAA==', 'base64')
const externalLibraryWheel = Buffer.from('UEsDBBQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAc2FtcGxlLTEuMC5kYXRhL3B1cmVsaWIvc2FtcGxlLnB5cmVxdWlyZXMgbGlicmFyeSByZWxvY2F0aW9uClBLAQIUAxQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAAAAAAAAAAACAAQAAAABzYW1wbGUtMS4wLmRhdGEvcHVyZWxpYi9zYW1wbGUucHlQSwUGAAAAAAEAAQBPAAAAWwAAAAAA', 'base64')

it.each(Object.entries(lock.targets))('records every locked wheel distribution and version for %s', (_target, artifact) => {
  const normalize = (name: string): string => name.toLowerCase().replace(/[-_.]+/gu, '-')
  const distributions = [...artifact.wheels, ...lock.wheels].map(({ url }) => {
    const [name, version] = basename(new URL(url).pathname).split('-')
    return [normalize(name!), version] as const
  })
  const declared = Object.entries(lock.pythonPackages).map(([name, version]) => [normalize(name), version] as const)
  expect(new Set(distributions.map(([name]) => name)).size).toBe(distributions.length)
  expect(new Set(declared.map(([name]) => name)).size).toBe(declared.length)
  expect(Object.fromEntries(distributions)).toEqual(Object.fromEntries(declared))
})

it('keeps a target payload identity independent of other target archives', () => {
  const changed = structuredClone(lock)
  changed.targets['win-x64'].wheels[0]!.sha256 = 'a'.repeat(64)
  expect(primaryRuntimePayloadDigest('mac-arm64', changed, '11.7.0')).toBe(primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.0'))
  expect(primaryRuntimePayloadDigest('win-x64', changed, '11.7.0')).not.toBe(primaryRuntimePayloadDigest('win-x64', lock, '11.7.0'))
})

it('invalidates payload identity for shared wheels, package versions and package-manager changes', () => {
  const wheel = structuredClone(lock), distribution = structuredClone(lock)
  wheel.wheels[0]!.sha256 = 'a'.repeat(64)
  distribution.pythonPackages['python-docx'] = '1.2.1'
  const original = primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.0')
  expect(primaryRuntimePayloadDigest('mac-arm64', wheel, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('mac-arm64', distribution, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.1')).not.toBe(original)
})

it('reports missing distribution metadata before trying to execute a stale native payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-stale-runtime-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      components: { python: '3.12.14', numpy: '2.3.5', pandas: '3.0.1' } }))
    expect(() => { smokePrimaryRuntime(root) }).toThrow('missing Python distribution versions; prepare the payload')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('extracts a hash-verified cached library without a Python installer or network request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const hash = createHash('sha256').update(libraryWheel).digest('hex')
    const archive = join(root, hash)
    await writeFile(archive, libraryWheel)
    expect(await downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).toBe(archive)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample.py'), 'utf8')).toBe('sample = 42\n')
    await writeFile(archive, 'corrupt archive')
    await expect(downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).rejects.toThrow('checksum mismatch')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('fully extracts a large deflate-compressed wheel entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-large-wheel-'))
  try {
    const expected = Buffer.alloc(1024 * 1024)
    // Seeded xorshift bytes keep the compressed entry larger than the stream buffers.
    let state = 26
    for (let index = 0; index < expected.length; index++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      expected[index] = state & 255
    }
    const archive = join(root, 'large.whl')
    await writeFile(archive, zipSync({ 'large.bin': expected }, { level: 6 }))
    await unpackPrimaryRuntimeWheel(archive, root)
    expect(await readFile(join(root, 'large.bin'))).toEqual(expected)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('retains auxiliary wheel scripts without generating command wrappers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, relocatedWheel)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample-1.0.data/scripts/sample'), 'utf8')).toBe('requires relocation\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects library files requiring an unsupported installation scheme', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, externalLibraryWheel)
    await expect(unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))).rejects.toThrow('unsupported installation paths')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('copies complete Office resources outside the application archive and removes obsolete assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-office-assets-'))
  try {
    const source = join(root, 'package', 'assets')
    const destination = join(root, 'Contents', 'Resources', 'runtime', 'office-skills')
    await mkdir(join(source, 'scripts'), { recursive: true })
    await writeFile(join(source, 'scripts', 'check_office.py'), 'print("checker")\n')
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      await mkdir(join(source, name))
      await writeFile(join(source, name, 'SKILL.md'), `# ${name}\n`)
    }
    await prepareOfficeSkillAssets(source, destination)
    await writeFile(join(destination, 'obsolete.py'), 'old helper')
    await prepareOfficeSkillAssets(source, destination)
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      expect(await readFile(join(destination, name, 'SKILL.md'), 'utf8')).toBe(`# ${name}\n`)
    }
    expect(await readFile(join(destination, 'scripts', 'check_office.py'), 'utf8')).toBe('print("checker")\n')
    await expect(readFile(join(destination, 'obsolete.py'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('gives Python-only payloads a distinct identity', () => {
  expect(primaryRuntimePayloadDigest('linux-x64', lock, undefined)).not.toBe(primaryRuntimePayloadDigest('linux-x64', lock, '11.7.0'))
})

it('keeps carrier pnpm versions aligned with the shared payload build', () => {
  const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    packageManager: string
    devDependencies: { pnpm: string }
  }
  const desktop = JSON.parse(readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8')) as {
    devDependencies: { pnpm: string }
  }
  expect(desktop.devDependencies.pnpm).toBe(root.devDependencies.pnpm)
  expect(root.packageManager).toBe(`pnpm@${root.devDependencies.pnpm}`)
})

it('locks the llama.cpp runner for macOS arm64 only', () => {
  expect(Object.entries(lock.targets).filter(([, artifact]) => 'llamaServer' in artifact).map(([target]) => target)).toEqual(['mac-arm64'])
  const { release, url, sha256 } = lock.targets['mac-arm64'].llamaServer
  expect(url).toBe(`https://github.com/ggml-org/llama.cpp/releases/download/${release}/llama-${release}-bin-macos-arm64.tar.gz`)
  expect(sha256).toMatch(/^[a-f0-9]{64}$/u)
})

it.each(['linux-x64', 'mac-x64', 'win-x64'] as const)('stages no runner and downloads nothing for %s', async (target) => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-llama-target-'))
  try {
    expect(await prepareLockedLlamaServer(target, join(root, 'runner'), join(root, 'cache'))).toBeUndefined()
    await expect(lstat(join(root, 'runner'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(root, 'cache'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

/** Thin arm64 Mach-O image carrying only the load commands the runner closure reads. */
function machO(dylibs: readonly string[], rpaths: readonly string[] = ['@loader_path']): Buffer {
  const command = (type: number, header: number, value: string): Buffer => {
    const size = Math.ceil((header + Buffer.byteLength(value) + 1) / 8) * 8
    const body = Buffer.alloc(size)
    body.writeUInt32LE(type, 0)
    body.writeUInt32LE(size, 4)
    body.writeUInt32LE(header, 8)
    body.write(value, header)
    return body
  }
  const commands = [
    ...dylibs.map(dylib => command(dylib.startsWith('/usr/lib/') ? 0x80000018 : 0xc, 24, dylib)),
    ...rpaths.map(path => command(0x8000001c, 12, path)),
  ]
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(commands.length, 16)
  return Buffer.concat([header, ...commands])
}

/** Release archive whose top-level directory mirrors llama.cpp's versioned library links and unrelated tools. */
async function llamaRelease(root: string, server: Buffer): Promise<string> {
  const release = join(root, 'llama-b1')
  await mkdir(release, { recursive: true })
  await writeFile(join(release, 'llama-server'), server)
  await writeFile(join(release, 'libllama.0.4.1.dylib'), machO(['@rpath/libllama.0.dylib', '@rpath/libggml-base.0.dylib']))
  await symlink('libllama.0.4.1.dylib', join(release, 'libllama.0.dylib'))
  await symlink('libllama.0.dylib', join(release, 'libllama.dylib'))
  await writeFile(join(release, 'libggml-base.0.24.0.dylib'), machO(['@rpath/libggml-base.0.dylib']))
  await symlink('libggml-base.0.24.0.dylib', join(release, 'libggml-base.0.dylib'))
  await writeFile(join(release, 'llama-cli'), machO(['@rpath/libllama-cli-impl.dylib']))
  await writeFile(join(release, 'libllama-cli-impl.dylib'), machO([]))
  await writeFile(join(release, 'LICENSE'), 'MIT License\n')
  const archive = join(root, 'llama.tar.gz')
  await createTar({ gzip: true, file: archive, cwd: root }, ['llama-b1'])
  return archive
}

it.skipIf(process.platform === 'win32')('materializes llama-server and only the libraries it loads as regular files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-llama-server-'))
  try {
    const archive = await llamaRelease(join(root, 'release'), machO(['/usr/lib/librdma.dylib', '@rpath/libllama.0.dylib', '/usr/lib/libSystem.B.dylib']))
    const destination = join(root, 'dependencies', 'llama-server')
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'obsolete.dylib'), 'old runner')
    await prepareLlamaServer(archive, 'b1', destination)
    expect((await readdir(destination)).sort()).toEqual(['LICENSE', 'libggml-base.0.dylib', 'libllama.0.dylib', 'llama-server'])
    for (const name of ['libggml-base.0.dylib', 'libllama.0.dylib', 'llama-server']) {
      const entry = await lstat(join(destination, name))
      expect(entry.isFile()).toBe(true)
      expect(entry.mode & 0o777).toBe(0o755)
    }
    expect(await readFile(join(destination, 'libllama.0.dylib'))).toEqual(await readFile(join(root, 'release', 'llama-b1', 'libllama.0.4.1.dylib')))
    expect(await readFile(join(destination, 'LICENSE'), 'utf8')).toBe('MIT License\n')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32').each([
  ['a library missing from the release', machO(['@rpath/libmissing.0.dylib']), 'loads @rpath/libmissing.0.dylib, which the release directory does not provide'],
  ['a library installed outside the system directories', machO(['/opt/homebrew/lib/libomp.dylib']), 'loads /opt/homebrew/lib/libomp.dylib'],
  ['a run-path library without a run path', machO(['@rpath/libllama.0.dylib'], []), 'loads @rpath/libllama.0.dylib'],
  ['a run path outside the runner directory', machO(['@rpath/libllama.0.dylib'], ['@loader_path', '/opt/homebrew/lib']), 'searches run path /opt/homebrew/lib'],
  ['a universal image', Buffer.from('cafebabe00000002', 'hex'), 'expected a thin 64-bit Mach-O file'],
])('rejects %s', async (_case, server, message) => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-llama-server-'))
  try {
    await expect(prepareLlamaServer(await llamaRelease(join(root, 'release'), server), 'b1', join(root, 'runner'))).rejects.toThrow(message)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('rejects a library link leaving the release directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-llama-server-'))
  try {
    const archive = join(root, 'llama.tar.gz')
    await mkdir(join(root, 'llama-b1'))
    await writeFile(join(root, 'outside.dylib'), machO([]))
    await writeFile(join(root, 'llama-b1', 'llama-server'), machO(['@rpath/libescape.dylib']))
    await symlink('../outside.dylib', join(root, 'llama-b1', 'libescape.dylib'))
    await createTar({ gzip: true, file: archive, cwd: root }, ['llama-b1', 'outside.dylib'])
    await expect(prepareLlamaServer(archive, 'b1', join(root, 'runner'))).rejects.toThrow('libescape.dylib links outside the release directory')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('reads dependent libraries and run paths in load-command order', () => {
  expect(machOLinks(machO(['/usr/lib/librdma.dylib', '@rpath/libllama.0.dylib'], ['@loader_path']))).toEqual({
    dylibs: ['/usr/lib/librdma.dylib', '@rpath/libllama.0.dylib'], rpaths: ['@loader_path'],
  })
})

it.skipIf(process.platform === 'win32')('requires the runner to report its locked build number without Metal devices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-llama-smoke-'))
  try {
    const executable = join(root, 'llama-server')
    // The fixture fails unless the smoke disables Metal device setup, whatever the caller's environment says.
    await writeFile(executable, '#!/bin/sh\n[ "$GGML_METAL_DEVICES" = 0 ] || exit 7\necho "version: 0.4.1-dev (build 11118, commit e6ab7c1a4)" >&2\n')
    await chmod(executable, 0o755)
    smokeLlamaServer(executable, 'b11118', { ...process.env, GGML_METAL_DEVICES: '1' })
    expect(() => { smokeLlamaServer(executable, 'b1111', process.env) }).toThrow('did not report release b1111')
    expect(() => { smokeLlamaServer(join(root, 'missing'), 'b11118', process.env) }).toThrow('ENOENT')
  } finally { await rm(root, { recursive: true, force: true }) }
})
