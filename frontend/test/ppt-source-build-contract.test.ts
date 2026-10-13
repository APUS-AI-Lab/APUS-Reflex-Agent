import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

const generatedPatterns = [
  'packages/ppt-bundles',
  'packages/ppt-runtime/templates',
  'packages/ppt-runtime/artifacts.json'
]

describe('PPT source build contract', () => {
  it('loads the PPT compiler from tracked seeds in a clean source snapshot', async () => {
    const seeds = ['packages/ppt-runtime/core', 'packages/ppt-runtime/adapter'] as const
    const files = execFileSync('git', ['ls-files', '-z', '--', ...seeds], {
      cwd: projectRoot, encoding: 'utf8'
    }).split('\0').filter(Boolean)
    // This repository-input check uses Git's index, never ignored files left by a local build.
    for (const kind of ['core', 'adapter']) {
      for (const entry of ['lib/index.js', 'lib/client.js', 'lib/invariant.js', 'lib/types/index.d.ts']) {
        expect(files, `Missing maintained ${kind} seed ${entry}`).toContain(`packages/ppt-runtime/${kind}/${entry}`)
      }
    }
    expect(files).toContain('packages/ppt-runtime/core/lib/bin.js')
    const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], {
      cwd: projectRoot, encoding: 'utf8'
    }).trim()
    const snapshot = await mkdtemp(path.join(tmpdir(), 'ppt-clean-source-'))
    try {
      for (const file of files) {
        const target = path.join(snapshot, file)
        await mkdir(path.dirname(target), { recursive: true })
        const bytes = execFileSync('git', ['show', `:${prefix}${file}`], { cwd: projectRoot })
        await writeFile(target, bytes)
      }
      // Only installed third-party dependencies are shared; every relative compiler import
      // resolves inside this fresh snapshot, without the checkout's runtime seeds or outputs.
      await symlink(path.join(projectRoot, 'node_modules'), path.join(snapshot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir')
      const compiler = path.join(snapshot, 'packages/ppt-runtime/core/lib/bin.js')
      const version = execFileSync(process.execPath, [compiler, '--version'], {
        cwd: snapshot, encoding: 'utf8', timeout: 30_000
      }).trim()
      const manifest = JSON.parse(await readFile(path.join(snapshot, seeds[0], 'package.json'), 'utf8'))
      expect(version).toBe(manifest.version)
      const wrapper = path.join(snapshot, 'import-compiler.mjs')
      await writeFile(wrapper, `await import(${JSON.stringify(pathToFileURL(compiler).href)})\n`)
      expect(execFileSync(process.execPath, [wrapper, '--version'], {
        cwd: snapshot, encoding: 'utf8', timeout: 30_000
      })).toBe('')
      for (const kind of ['core', 'adapter']) {
        const client = await readFile(path.join(snapshot, `packages/ppt-runtime/${kind}/lib/client.js`), 'utf8')
        expect(client).toContain('/* PERSONAL_TEMPLATE_MANAGER */')
        expect(client).toContain('/* GENERATED_PPT_PREVIEWS */ {}')
      }
    } finally {
      await rm(snapshot, { recursive: true, force: true })
    }
  })

  it('does not track self-built packages, templates, previews, or hash manifests', () => {
    const tracked = execFileSync('git', ['ls-files', ...generatedPatterns], {
      cwd: projectRoot,
      encoding: 'utf8'
    }).trim()
    expect(tracked).toBe('')
  })

  it('bootstraps from local source packages without generated tgz dependencies', async () => {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const lock = await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8')
    expect(manifest.dependencies['dsh-ppt']).toBe('file:packages/ppt-runtime/core')
    expect(manifest.dependencies['dsh-ppt-composer']).toBe('file:packages/ppt-runtime/adapter')
    expect(lock).not.toContain('ppt-bundles')
  })

  it('runs one preparation pipeline before dev, build, test, and package consumers', async () => {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    expect(manifest.scripts['ppt:build']).toBe('node scripts/prepare-ppt-runtime.mjs')
    expect(manifest.scripts.dev).toMatch(/^npm run ppt:build && /u)
    expect(manifest.scripts.build).toMatch(/^npm run ppt:build && /u)
    expect(manifest.scripts.pretest).toBe('npm run ppt:build')
    expect(manifest.scripts['pretest:watch']).toBe('npm run ppt:build')
    for (const name of Object.keys(manifest.scripts).filter(name => name.startsWith('package:'))) {
      expect(manifest.scripts[name]).toContain('npm run build')
    }
  })

  it('packages the current staged directories instead of node_modules links', async () => {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const files = manifest.build.files
    expect(manifest.build.afterPack).toBe('scripts/package-system3-runtime.cjs')
    const afterPack = await readFile(path.join(projectRoot, manifest.build.afterPack), 'utf8')
    expect(afterPack).toContain("require('./verify-packaged-ppt-runtime.cjs')(context)")
    expect(files).toContain('!node_modules/dsh-ppt{,/**}')
    expect(files).toContain('!node_modules/dsh-ppt-composer{,/**}')
    expect(files).toContainEqual(expect.objectContaining({
      from: '.build/ppt-runtime/packages/dsh-ppt',
      to: 'node_modules/dsh-ppt'
    }))
    expect(files).toContainEqual(expect.objectContaining({
      from: '.build/ppt-runtime/packages/dsh-ppt-composer',
      to: 'node_modules/dsh-ppt-composer'
    }))
  })
})
