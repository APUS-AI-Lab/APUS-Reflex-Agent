import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigSourceOwnershipViolations } from './verify-config-source-ownership.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('configuration source ownership gate', () => {
  const referenceSelection = 'apiKeyEnv: !!js \'process.env.JEV_API_KEY_ENV?.trim() || (process.env.JEV_API_KEY ? "JEV_API_KEY" : undefined)\''

  it.each([
    ['apus-dsh-jev-plugin', referenceSelection, false],
    ['other-provider', referenceSelection, true],
    ['apus-dsh-jev-plugin', 'apiKeyEnv: !!js process.env.JEV_API_KEY', true],
    ['apus-dsh-jev-plugin', referenceSelection.replace('"JEV_API_KEY"', 'process.env.JEV_API_KEY'), true],
    ['apus-dsh-jev-plugin', 'apiKey: !!js process.env.JEV_API_KEY', true],
    ['apus-dsh-jev-plugin', 'baseURL: !!js process.env.JEV_ENDPOINT', true],
  ] as const)('limits reference selection to its reviewed owner and expression: %s / %s', (owner, line, rejected) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-config-source-ownership-'))
    roots.push(root)
    const directory = join(root, 'packages/experimental', owner)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'cordis.patch.yml'), `config:\n  ${line}\n`)

    expect(collectConfigSourceOwnershipViolations(root)).toHaveLength(rejected ? 1 : 0)
  })

  it('rejects inline endpoints in shipped bundle patches', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-config-source-ownership-'))
    roots.push(root)
    const directory = join(root, 'packages/subagent/subagent-claude-code')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'cordis.patch.yml'),
      'config:\n  baseURL: !!js process.env.DEEPSEEK_SEARCH_BASE_URL\n',
    )

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([
      'packages/subagent/subagent-claude-code/cordis.patch.yml:2: inlines a credential or endpoint from the environment.'
      + ' The adapter resolves apiKeyEnv through ctx.credentials and the endpoint through the'
      + ' environment snapshot; inlining here bypasses both ladders.',
    ])
  })
})
