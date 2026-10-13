/** Edition identity checks run before native installation changes the host. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { installerMetadata, readInstallerBuild, verifyInstalledEdition } from './product-installer-metadata.mjs'
import { releaseAssetNames } from './product-release.mjs'

test('edition-specific metadata cannot be reused for the other edition or target', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'apus-edition-metadata-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
    const [platform, arch] = target.split('-')
    for (const edition of ['full', 'lite']) {
      const name = releaseAssetNames(platform, arch, edition)[0]
      const installer = join(directory, name)
      const selected = installerMetadata(installer, target)
      assert.equal(selected.edition, edition)
      const build = { version: '0.1.1', edition, target, assets: [{ name, sha256: 'recorded' }] }
      await writeFile(selected.file, JSON.stringify(build))
      assert.deepEqual(await readInstallerBuild(installer, target), build)
      for (const changed of [{ edition: edition === 'full' ? 'lite' : 'full' }, { target: 'other' }, { assets: [] }, { assets: [{ name: 'other.exe' }] }]) {
        await writeFile(selected.file, JSON.stringify({ ...build, ...changed }))
        await assert.rejects(readInstallerBuild(installer, target), /metadata/)
      }
    }
  }
})

test('historical filenames remain usable only with their original 0.1.0 metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'apus-legacy-metadata-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const name = 'apus-reflex-harness-mac-arm64.dmg'
  const installer = join(directory, name)
  const selected = installerMetadata(installer, 'darwin-arm64')
  assert.equal(selected.file, join(directory, 'build-info.json'))
  const build = { version: '0.1.0', target: 'darwin-arm64', assets: [{ name }] }
  await writeFile(selected.file, JSON.stringify(build))
  assert.deepEqual(await readInstallerBuild(installer, 'darwin-arm64'), build)
  await writeFile(selected.file, JSON.stringify({ ...build, version: '0.1.1' }))
  await assert.rejects(readInstallerBuild(installer, 'darwin-arm64'), /edition/)
  assert.throws(() => installerMetadata(join(directory, 'apus-reflex-agent-mini-mac-arm64.dmg'), 'darwin-arm64'), /filename/)
  assert.throws(() => installerMetadata(installer, 'darwin-ia32'), /Unsupported/)
})

test('new Full builds require an explicit installed edition', () => {
  verifyInstalledEdition({}, { version: '0.1.0' })
  verifyInstalledEdition({ edition: 'full' }, { version: '0.1.1', edition: 'full' })
  for (const runtime of [{}, { edition: 'lite' }, { edition: 'other' }]) {
    assert.throws(() => verifyInstalledEdition(runtime, { version: '0.1.1', edition: 'full' }), /edition/)
  }
  assert.throws(() => verifyInstalledEdition({}, { version: '0.1.1' }), /edition/)
})
