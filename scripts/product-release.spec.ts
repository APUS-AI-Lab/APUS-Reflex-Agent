import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { load } from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'
import { releaseAssetNames, releaseSupportNames, verifyReceipt, writeReleaseSupportAssets } from './product-release.mjs'

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
  const manifest = { product: 'APUS Reflex Agent', version: '0.1.1', editions: ['full', 'lite'] as ('full' | 'lite')[], channel: 'preview', repository: 'APUS-AI-Lab/APUS-Reflex-Harness', targets: ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'] }
  const retained = new Map<string, Buffer>()
  for (const edition of ['full', 'lite'] as const) for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']] as const) {
    const target = `${platform}-${arch}`
    const inventoryBytes = JSON.stringify({ edition, target, packages: [] })
    writeFileSync(join(runtimeRoot, 'runtime-dependencies.json'), inventoryBytes)
    const assets = releaseAssetNames(platform, arch, edition)
    for (const asset of assets) writeFileSync(join(output, asset), `${edition} ${target} installer fixture`)
    const runtime = { edition, version: '0.1.7-rc.2', dependencyInventory: { path: 'runtime-dependencies.json', sha256: digest(inventoryBytes) } }
    const names = await writeReleaseSupportAssets({ base, output, manifest, runtime, revision: 'a'.repeat(40), target, assets, edition })
    expect(names).toEqual({ info: `build-info-${edition}-${target}.json`, licenses: `LICENSES-${edition}-${target}.zip`, inventory: `runtime-dependencies-${edition}-${target}.json`, checksums: `SHA256SUMS-${edition}-${target}` })
    const info: unknown = JSON.parse(readFileSync(join(output, names.info), 'utf8'))
    expect(info).toMatchObject({ edition, sourceRevision: 'a'.repeat(40), target, harnessVersion: runtime.version,
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
  expect(readdirSync(output)).toHaveLength(44)
})

it('rejects unsupported support-file targets before writing output', async () => {
  await expect(writeReleaseSupportAssets({ base: '', output: '', manifest: { product: '', version: '', channel: '', repository: '', targets: [], editions: [] },
    runtime: { edition: 'full', version: '', dependencyInventory: { path: '', sha256: '' } }, revision: '', target: 'win32-arm64', assets: [] }))
    .rejects.toThrow('Unsupported installer target')
})

it('checks out the dispatch commit and retains review evidence without release-write permission', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/product-release.yml', import.meta.url), 'utf8')) as {
    permissions: Record<string, string>
    jobs: Record<string, {
      if?: string
      steps: { name?: string; uses?: string; if?: string; with?: Record<string, string>; run?: string }[]
    }>
  }
  expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' })
  expect(Object.keys(workflow.jobs)).toEqual(['build', 'windows_requalification', 'unix_requalification'])
  expect(workflow.jobs['build']!.if).toBe("${{ inputs.qualification_run_id == '' && inputs.qualification_source == '' }}")
  expect(workflow.jobs['windows_requalification']!.if).toBe("${{ inputs.target == 'windows' && (inputs.qualification_run_id != '' || inputs.qualification_source != '') }}")
  const qualification = workflow.jobs['windows_requalification']!.steps
  const download = qualification.find(step => step.uses?.startsWith('actions/download-artifact@'))
  expect(download?.with?.['run-id']).toBe('${{ inputs.qualification_run_id }}')
  expect(download?.with?.['artifact-ids']).toBe('${{ steps.source.outputs.artifact_id }}')
  expect(qualification.some(step => step.with?.['script']?.includes('validateRequalification'))).toBe(true)
  expect(qualification.some(step => step.run?.includes('--expected-source $env:QUALIFICATION_SOURCE'))).toBe(true)
  expect(qualification.some(step => step.run?.includes('package:product') || step.run?.includes('npm ci'))).toBe(false)
  const unix = workflow.jobs['unix_requalification']!.steps
  expect(workflow.jobs['unix_requalification']!.if).toContain("inputs.target != 'windows'")
  expect(unix.find(step => step.uses?.startsWith('actions/download-artifact@'))?.with?.['artifact-ids']).toBe('${{ steps.source.outputs.artifact_id }}')
  expect(unix.some(step => step.with?.['script']?.includes('validateRequalification'))).toBe(true)
  expect(unix.some(step => step.run?.includes("'--expected-source', process.env.QUALIFICATION_SOURCE"))).toBe(true)
  expect(unix.some(step => step.run?.includes('package:product') || step.run?.includes('npm ci'))).toBe(false)
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

it('pins the Debian artifact name to the release collector without architecture macro translation', () => {
  const desktop = JSON.parse(readFileSync(new URL('../frontend/package.json', import.meta.url), 'utf8')) as {
    build: {
      files: string[]
      directories: { output: string }
      nsis: Record<string, string>
      linux: { target: { target: string; arch: string[] }[] }
      deb: { artifactName?: string }
    }
  }
  expect(desktop.build.linux.target).toEqual([{ target: 'deb', arch: ['x64'] }])
  const module = new URL('../frontend/scripts/product-edition.cjs', import.meta.url)
  const { createBuilderConfig } = createRequire(import.meta.url)(fileURLToPath(module)) as {
    createBuilderConfig: (base: typeof desktop.build, edition: string) => typeof desktop.build
  }
  for (const edition of ['full', 'lite']) expect([createBuilderConfig(desktop.build, edition).deb.artifactName]).toEqual(releaseAssetNames('linux', 'x64', edition))
})

it('binds receipts to one edition and rejects mixed installer names before collection', () => {
  const manifest = { product: 'APUS Reflex Agent', version: '0.1.1', channel: 'preview', repository: 'APUS-AI-Lab/APUS-Reflex-Harness', targets: ['darwin-arm64'], editions: ['full', 'lite'] as ('full' | 'lite')[] }
  for (const edition of ['full', 'lite'] as const) {
    const receipt = { version: manifest.version, edition, sourceRevision: 'current', target: 'darwin-arm64', signing: 'unsigned-preview', runtimeDependencyInventorySha256: 'hash', directory: '.artifacts/product-build/owned', assets: releaseAssetNames('darwin', 'arm64', edition).map(name => ({ name, sha256: 'hash' })) }
    expect(verifyReceipt(receipt, manifest, 'current', 'darwin-arm64', () => 'hash', undefined, edition)).toContain('owned')
    const other = edition === 'full' ? 'lite' : 'full'
    expect(() => verifyReceipt(receipt, manifest, 'current', 'darwin-arm64', () => 'hash', undefined, other)).toThrow('edition differs')
    expect(() => verifyReceipt({ ...receipt, assets: releaseAssetNames('darwin', 'arm64', other).map(name => ({ name, sha256: 'hash' })) }, manifest, 'current', 'darwin-arm64', () => 'hash', undefined, edition)).toThrow('changed after build')
  }
  expect(() => releaseSupportNames('darwin-arm64', 'other')).toThrow()
})

it('rejects mismatched runtime or installer editions before writing support files', async () => {
  const manifest = { product: 'APUS Reflex Agent', version: '0.1.1', channel: 'preview', repository: 'APUS-AI-Lab/APUS-Reflex-Harness', targets: ['darwin-arm64'], editions: ['full', 'lite'] as ('full' | 'lite')[] }
  const input = { base: '', output: '', manifest, runtime: { edition: 'full' as const, version: 'runtime', dependencyInventory: { path: '', sha256: '' } }, revision: '', target: 'darwin-arm64', assets: releaseAssetNames('darwin', 'arm64', 'full'), edition: 'lite' as const }
  await expect(writeReleaseSupportAssets(input)).rejects.toThrow('Runtime edition')
  await expect(writeReleaseSupportAssets({ ...input, runtime: { ...input.runtime, edition: 'lite' } })).rejects.toThrow('Release assets differ')
})

it('builds and qualifies each edition in a separate desktop and Web job with unique artifacts', () => {
  const desktop = load(readFileSync(new URL('../.github/workflows/product-release.yml', import.meta.url), 'utf8')) as {
    jobs: Record<string, {
      strategy: { matrix: { edition: string } }
      env: Record<string, string>
      steps: { uses?: string; with?: Record<string, string>; run?: string }[]
    }>
  }
  const web = load(readFileSync(new URL('../.github/workflows/product-web-release.yml', import.meta.url), 'utf8')) as typeof desktop
  for (const job of [desktop.jobs['build']!, web.jobs['linux-web']!]) {
    expect(job.strategy.matrix.edition).toContain('["full","lite"]')
    expect(job.env['APUS_PRODUCT_EDITION']).toBe('${{ matrix.edition }}')
    const artifacts = job.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))
    expect(artifacts.every(step => step.with?.['name']?.includes('${{ matrix.edition }}'))).toBe(true)
  }
  expect(desktop.jobs['build']!.steps.some(step => step.run?.includes('--edition ${{ matrix.edition }}'))).toBe(true)
  expect(web.jobs['linux-web']!.steps.some(step => step.run?.includes('/$APUS_PRODUCT_EDITION/web-linux-x64/apus-reflex-agent-$APUS_PRODUCT_EDITION-'))).toBe(true)
  for (const job of [desktop.jobs['windows_requalification']!, desktop.jobs['unix_requalification']!]) {
    expect(job.env['QUALIFICATION_EDITION']).toBe('${{ matrix.edition }}')
    expect(job.steps.some(step => step.with?.['script']?.includes('process.env.QUALIFICATION_EDITION'))).toBe(true)
  }
})
