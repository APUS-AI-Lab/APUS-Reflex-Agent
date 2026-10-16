import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { generateSystem3Patch } from '../scripts/generate-system3-patch.mjs'

describe('Desktop default profile', () => {
  it.each(['deployed', 'workspace'])('installs bounded Skill advice without changing model routes in %s mode', async mode => {
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
      expect(output).not.toMatch(/private\.example|JEV_API_KEY|SYSTEM3_LITELLM_API_KEY|fidoo|proxy\.runpod\.net/i)
      const inserted = operations.flatMap(operation => operation.insert ?? [])
      expect(inserted.find(plugin => plugin.id === 'ui-system3').name)
        .toBe(mode === 'deployed' ? '@deepseek-ai/dsh-experimental-client-ui-system3' : join(root, 'packages/experimental/client-ui-system3/lib/index.js'))
      // A command-line overlay row would shadow every settings write, so the System3 profile bundle owns `system3`.
      expect(operations.some(operation => operation.id === 'system3' || operation.insert?.some(plugin => plugin.id === 'system3'))).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('takes the editable System3 product defaults from the System3 profile bundle', async () => {
    const bundle = parse(await readFile(new URL('../../packages/experimental/system3/cordis.patch.yml', import.meta.url), 'utf8'))
    const system3 = bundle.flatMap(operation => operation.insert ?? []).find(plugin => plugin.id === 'system3')
    expect(system3.name).toBe('./lib/index.js')
    expect(system3.config).toEqual({ privacyMode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'],
      jevRouteId: 'jev', jevExecutionDomain: 'network', skillSelection: {
        sessionDataClasses: ['workspace'], minConfidence: 0.5, maxInputBytes: 16000, maxContentBytes: 12000,
        maxCandidates: 15, deadlineMs: 3000,
      } })
  })

  it('keeps Skill selection out of the safe-mode overlay', async () => {
    const safe = await readFile(new URL('../build/dsh-desktop-safe.patch.yml', import.meta.url), 'utf8')
    expect(safe).not.toMatch(/experimental-system3|id: system3|skillSelection/)
  })

  it('does not require a server deployment file to prepare a desktop runtime', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'apus-profile-empty-'))
    try {
      await generateSystem3Patch(stage, { sourceRoot: stage, mode: 'deployed' })
      expect(await readFile(join(stage, 'desktop.patch.yml'), 'utf8')).toContain('dsh-desktop-onboarding')
    } finally { await rm(stage, { recursive: true, force: true }) }
  })
})
