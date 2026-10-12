/** Built deployment preparation preserves profile edits across repeated starts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../prepare-profile.mjs', import.meta.url))
test('prepares an editable bundle once and preserves user patches', () => {
  const home = mkdtempSync(join(tmpdir(), 'reflex-deployment-profile-'))
  try {
    const run = () => execFileSync(process.execPath, [script], { env: { ...process.env, DSH_HOME: home } })
    run()
    const dir = join(home, 'profiles', 'web')
    const patch = '- id: jev\n  config:\n    effort: low\n'
    writeFileSync(join(dir, 'cordis.patch.yml'), patch)
    run()
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(manifest.dsh.profile.bundles.filter(name => name === '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin').length, 1)
    assert.equal(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'), patch)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
