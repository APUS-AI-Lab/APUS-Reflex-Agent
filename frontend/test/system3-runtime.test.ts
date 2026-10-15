import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSystem3Runtime } from '../src/main/system3-runtime'

const roots: string[] = []
const reflexLocalPackages = ['reflex-local-bundle', 'reflex-local', 'api-reflex-local', 'client-ui-reflex-local'].map(name => `@deepseek-ai/dsh-experimental-${name}`)
function fixture(mode: 'workspace' | 'deployed' = 'workspace') {
  const root = mkdtempSync(join(tmpdir(), 'system3-runtime-'))
  roots.push(root)
  const runtime = join(root, '.build', 'system3-runtime')
  mkdirSync(runtime, { recursive: true })
  const source = mode === 'workspace' ? join(root, 'source') : runtime
  mkdirSync(source, { recursive: true })
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-experimental-system3', '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin', '@deepseek-ai/dsh-experimental-system3-policy', '@deepseek-ai/dsh-experimental-system3-evidence', '@deepseek-ai/dsh-experimental-system3-supervisor', '@deepseek-ai/dsh-experimental-client-ui-system3', '@deepseek-ai/dsh-continuum', '@deepseek-ai/dsh-experimental-continuum-jev',
    ...reflexLocalPackages]
  const packages = names.map((name, index) => {
    const path = `package-${index}.json`
    writeFileSync(join(source, path), JSON.stringify({ name, version: '0.1.7-rc.2' }))
    return { name, path }
  })
  writeFileSync(join(source, 'entry.js'), '')
  const manifest = { formatVersion: 1, product: 'xdan-system3', version: '0.1.7-rc.2', sourceRevision: 'a'.repeat(40), platform: process.platform, arch: process.arch, mode, sourceRoot: source, entry: 'entry.js', packages }
  const save = () => writeFileSync(join(runtime, 'runtime-manifest.json'), JSON.stringify(manifest))
  save()
  return { root, runtime, source, manifest, save }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('own System3 runtime identity', () => {
  it.each(['@deepseek-ai/dsh-continuum', '@deepseek-ai/dsh-experimental-continuum-jev', ...reflexLocalPackages])('rejects a current edition missing %s', (name) => {
    const f = fixture()
    writeFileSync(join(f.runtime, 'product-edition.patch.yml'), '[]\n')
    writeFileSync(join(f.runtime, 'runtime-manifest.json'), JSON.stringify({ ...f.manifest,
      edition: 'full', editionPatch: 'product-edition.patch.yml', packages: f.manifest.packages.filter(item => item.name !== name) }))
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow(name)
  })
  it('exposes the prepared local Reflex runner only as a regular file inside the artifact root', () => {
    const f = fixture()
    expect(resolveSystem3Runtime(f.root, '/unused', false)).not.toHaveProperty('reflexRunnerPath')
    const directory = join(f.runtime, 'dependencies', 'llama-server')
    const runner = join(directory, 'llama-server')
    mkdirSync(runner, { recursive: true })
    expect(resolveSystem3Runtime(f.root, '/unused', false)).not.toHaveProperty('reflexRunnerPath')
    rmSync(runner, { recursive: true })
    writeFileSync(runner, '')
    expect(resolveSystem3Runtime(f.root, '/unused', false).reflexRunnerPath).toBe(realpathSync(runner))
    rmSync(runner)
    const external = join(f.root, 'llama-server')
    writeFileSync(external, '')
    symlinkSync(external, runner)
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('escapes its prepared root')
  })
  it('launches the explicitly prepared rc.2 checkout', () => {
    const f = fixture()
    expect(resolveSystem3Runtime(f.root, '/unused', false)).toMatchObject({ entry: realpathSync(join(f.source, 'entry.js')), version: '0.1.7-rc.2', mode: 'workspace' })
  })
  it.each(['full', 'lite'] as const)('requires the final %s edition policy under the artifact root', (edition) => {
    const f = fixture()
    const manifest = { ...f.manifest, edition, editionPatch: 'product-edition.patch.yml' }
    writeFileSync(join(f.runtime, 'runtime-manifest.json'), JSON.stringify(manifest))
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('edition policy is missing or invalid')
    const patch = join(f.runtime, 'product-edition.patch.yml')
    writeFileSync(patch, '[]\n')
    expect(resolveSystem3Runtime(f.root, '/unused', false)).toMatchObject({ edition, editionPatchPath: realpathSync(patch) })
    rmSync(patch)
    mkdirSync(patch)
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('edition policy is missing or invalid')
    rmSync(patch, { recursive: true })
    const external = join(f.root, 'outside.patch.yml')
    writeFileSync(external, '[]\n')
    symlinkSync(external, patch)
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('edition policy is missing or invalid')
  })
  it('keeps legacy Full manifests compatible and rejects an unknown edition', () => {
    const f = fixture()
    expect(resolveSystem3Runtime(f.root, '/unused', false)).toMatchObject({ edition: 'full', editionPatchPath: undefined })
    writeFileSync(join(f.runtime, 'runtime-manifest.json'), JSON.stringify({ ...f.manifest, edition: 'unexpected' }))
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('incompatible')
    for (const manifest of [{ ...f.manifest, edition: 'lite' }, { ...f.manifest, editionPatch: 'product-edition.patch.yml' }, { ...f.manifest, edition: 'lite', editionPatch: '../outside.patch.yml' }]) {
      writeFileSync(join(f.runtime, 'runtime-manifest.json'), JSON.stringify(manifest))
      expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('incompatible')
    }
  })
  it('fails without a prepared runtime even when a stock install exists', () => {
    const f = fixture()
    rmSync(join(f.runtime, 'runtime-manifest.json'))
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('runtime is missing')
  })
  it('rejects a mismatched package version', () => {
    const f = fixture()
    const jev = f.manifest.packages[2]
    if (!jev) throw new Error('Missing Jev fixture')
    writeFileSync(join(f.source, 'package-2.json'), JSON.stringify({ name: jev.name, version: '0.1.7-rc.1' }))
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('own rc.2')
  })
  it('rejects stock-only or incomplete manifests', () => {
    const f = fixture()
    f.manifest.packages = f.manifest.packages.slice(0, 1)
    f.save()
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('incomplete')
  })
  it('rejects path traversal', () => {
    const f = fixture()
    f.manifest.entry = '../outside.js'
    writeFileSync(join(f.root, 'outside.js'), '')
    f.save()
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('escapes')
  })
  it('rejects an unpinned source revision', () => {
    const f = fixture()
    f.manifest.sourceRevision = 'main'
    f.save()
    expect(() => resolveSystem3Runtime(f.root, '/unused', false)).toThrow('incompatible')
  })
  it('rejects a runtime prepared for another platform', () => {
    const f = fixture('deployed')
    f.manifest.arch = 'wrong-target' as NodeJS.Architecture
    f.save()
    expect(() => resolveSystem3Runtime('/unused', join(f.root, '.build'), true)).toThrow('target')
  })
  it('requires a deployed closure in packaged apps', () => {
    const f = fixture()
    expect(() => resolveSystem3Runtime('/unused', join(f.root, '.build'), true)).toThrow('source checkout')
    const d = fixture('deployed')
    expect(resolveSystem3Runtime('/unused', join(d.root, '.build'), true).mode).toBe('deployed')
  })
})
