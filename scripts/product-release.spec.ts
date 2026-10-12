import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { load } from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'
import { releaseAssetNames, writeReleaseSupportAssets } from './product-release.mjs'

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

it('combines macOS, Windows and Linux support files without replacing either target or losing checksum references', async () => {
  const base = mkdtempSync(join(tmpdir(), 'product-release-support-'))
  onTestFinished(() => { rmSync(base, { recursive: true, force: true }) })
  const output = join(base, 'combined-release')
  const runtimeRoot = join(base, 'frontend/.build/system3-runtime')
  const licenseRoot = join(base, 'frontend/.build/licenses')
  for (const directory of [output, runtimeRoot, licenseRoot]) mkdirSync(directory, { recursive: true })
  writeFileSync(join(base, 'pnpm-lock.yaml'), 'harness locked fixture')
  writeFileSync(join(base, 'frontend/package-lock.json'), 'desktop locked fixture')
  writeFileSync(join(licenseRoot, 'LICENSE.txt'), 'original fixture license')
  writeFileSync(join(licenseRoot, 'THIRD_PARTY_NOTICES.txt'), 'original fixture credit')
  const manifest = { product: 'APUS Reflex Harness', version: '0.1.0', channel: 'preview', repository: 'APUS-AI-Lab/APUS-Reflex-Harness', targets: ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'] }
  const retained = new Map<string, Buffer>()
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']] as const) {
    const target = `${platform}-${arch}`
    const inventoryBytes = JSON.stringify({ target, packages: [] })
    writeFileSync(join(runtimeRoot, 'runtime-dependencies.json'), inventoryBytes)
    const assets = releaseAssetNames(platform, arch)
    for (const asset of assets) writeFileSync(join(output, asset), `${target} installer fixture`)
    const runtime = { version: '0.1.7-rc.2', dependencyInventory: { path: 'runtime-dependencies.json', sha256: digest(inventoryBytes) } }
    const names = await writeReleaseSupportAssets({ base, output, manifest, runtime, revision: 'a'.repeat(40), target, assets })
    expect(names).toEqual(target !== 'darwin-arm64'
      ? { info: `build-info-${target}.json`, licenses: `LICENSES-${target}.zip`, inventory: `runtime-dependencies-${target}.json`, checksums: `SHA256SUMS-${target}` }
      : { info: 'build-info.json', licenses: 'LICENSES.zip', inventory: 'runtime-dependencies.json', checksums: 'SHA256SUMS' })
    const info = JSON.parse(readFileSync(join(output, names.info), 'utf8'))
    expect(info).toMatchObject({ sourceRevision: 'a'.repeat(40), target, harnessVersion: runtime.version,
      runtimeDependencyInventory: { path: names.inventory, sha256: digest(readFileSync(join(output, names.inventory))) },
      assets: assets.map(name => ({ name, sha256: digest(readFileSync(join(output, name))) })) })
    expect(readFileSync(join(output, names.inventory), 'utf8')).toBe(inventoryBytes)
    const licenses = unzipSync(readFileSync(join(output, names.licenses)))
    expect(strFromU8(licenses['LICENSE.txt']!)).toBe('original fixture license')
    expect(strFromU8(licenses['THIRD_PARTY_NOTICES.txt']!)).toBe('original fixture credit')
    const sums = readFileSync(join(output, names.checksums), 'utf8').trim().split('\n')
    expect(sums).toHaveLength(assets.length + 3)
    for (const line of sums) {
      const [hash, name] = line.split('  ')
      expect(hash).toBe(digest(readFileSync(join(output, name!))))
    }
    for (const [name, bytes] of retained) expect(readFileSync(join(output, name))).toEqual(bytes)
    for (const name of readdirSync(output)) retained.set(name, readFileSync(join(output, name)))
  }
  expect(readdirSync(output)).toHaveLength(22)
})

it('rejects unsupported support-file targets before writing output', async () => {
  await expect(writeReleaseSupportAssets({ base: '', output: '', manifest: { product: '', version: '', channel: '', repository: '', targets: [] },
    runtime: { version: '', dependencyInventory: { path: '', sha256: '' } }, revision: '', target: 'win32-arm64', assets: [] }))
    .rejects.toThrow('Unsupported installer target')
})

it('checks out the dispatch commit and retains review evidence without release-write permission', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/product-release.yml', import.meta.url), 'utf8')) as {
    permissions: Record<string, string>
    jobs: Record<string, { steps: { name?: string; uses?: string; if?: string; with?: Record<string, string>; run?: string }[] }>
  }
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(Object.keys(workflow.jobs)).toEqual(['build'])
  const steps = workflow.jobs['build']!.steps
  expect(steps.find(step => step.uses?.startsWith('actions/checkout@'))?.with?.['ref']).toBe('${{ github.sha }}')
  expect(steps.filter(step => step.uses?.startsWith('actions/upload-artifact@')).every(step => step.if === '${{ always() }}')).toBe(true)
  expect(steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))).toHaveLength(2)
  expect(steps.some(step => step.run?.includes('product-windows-smoke.mjs --installer'))).toBe(true)
  expect(steps.some(step => step.run?.includes('product-macos-smoke.mjs --installer'))).toBe(true)
  expect(JSON.stringify(workflow)).toContain('macos-15-intel')
  expect(steps.some(step => step.run?.includes('product-linux-smoke.mjs --installer'))).toBe(true)
  expect(JSON.stringify(workflow)).toContain('ubuntu-24.04')
  expect(JSON.stringify(workflow)).not.toContain('gh release')
})
