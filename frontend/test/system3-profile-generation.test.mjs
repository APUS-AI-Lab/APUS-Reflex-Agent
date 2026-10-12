import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { generateSystem3Patch } from '../scripts/generate-system3-patch.mjs'

describe('Desktop default profile', () => {
  it.each(['deployed', 'workspace'])('starts with user model settings and no production services in %s mode', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'apus-profile-'))
    try {
      await mkdir(join(root, 'deploy/system3'), { recursive: true })
      await writeFile(join(root, 'deploy/system3/runtime.patch.yml'), '- id: jev\n  config:\n    endpoint: https://private.example.invalid\n')
      await generateSystem3Patch(root, { sourceRoot: root, mode })
      const output = await readFile(join(root, 'desktop.patch.yml'), 'utf8')
      const operations = parse(output, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
      expect(operations.find(operation => operation.id === 'session-log-deepseek')).toEqual({ id: 'session-log-deepseek', config: { enabled: false } })
      expect(operations.flatMap(operation => operation.insert ?? []).map(plugin => plugin.id)).toContain('dsh-desktop-onboarding')
      expect(operations.filter(operation => /^(llm-|agent-default-model)/.test(operation.id ?? ''))).toEqual([])
      expect(output).not.toMatch(/private\.example|JEV_API_KEY|SYSTEM3_LITELLM_API_KEY|jev|fidoo|proxy\.runpod\.net/i)
      expect(operations.flatMap(operation => operation.insert ?? []).map(plugin => plugin.id)).not.toContain('system3')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('does not require a server deployment file to prepare a desktop runtime', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'apus-profile-empty-'))
    try {
      await generateSystem3Patch(stage, { sourceRoot: stage, mode: 'deployed' })
      expect(await readFile(join(stage, 'desktop.patch.yml'), 'utf8')).toContain('dsh-desktop-onboarding')
    } finally { await rm(stage, { recursive: true, force: true }) }
  })
})
