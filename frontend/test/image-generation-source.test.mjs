import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

it('loads the image plugin and its writer from a clean tracked-source snapshot', async () => {
  const packagePath = 'packages/dsh-image-generation'
  const files = execFileSync('git', ['ls-files', '-z', '--', packagePath], {
    cwd: projectRoot, encoding: 'utf8'
  }).split('\0').filter(Boolean)
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], {
    cwd: projectRoot, encoding: 'utf8'
  }).trim()
  const snapshot = await mkdtemp(path.join(tmpdir(), 'image-clean-source-'))
  try {
    // Read the index so ignored local runtime files cannot make a missing-source check pass.
    for (const file of files) {
      const target = path.join(snapshot, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, execFileSync('git', ['show', `:${prefix}${file}`], { cwd: projectRoot }))
    }
    await symlink(path.join(projectRoot, 'node_modules'), path.join(snapshot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir')
    const entry = pathToFileURL(path.join(snapshot, packagePath, 'index.js')).href
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `const plugin = await import(${JSON.stringify(entry)}); console.log(plugin.name);`
    ], { cwd: snapshot, encoding: 'utf8', timeout: 30_000 })
    expect(output.trim()).toBe('dsh-image-generation')

    // The asset writer is a subprocess entry, not a static import of the plugin.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVqsAAAAASUVORK5CYII=', 'base64')
    const result = JSON.parse(execFileSync(process.execPath, [path.join(snapshot, packagePath, 'lib/writer.js')], {
      cwd: snapshot, input: png.toString('base64'), encoding: 'utf8', timeout: 30_000
    }))
    expect(result.workspace_path).toMatch(/^\.workbuddy\/generated-images\/[a-f0-9]{64}\.png$/)
    expect(await readFile(path.join(snapshot, result.workspace_path))).toEqual(png)
  } finally {
    await rm(snapshot, { recursive: true, force: true })
  }
})
