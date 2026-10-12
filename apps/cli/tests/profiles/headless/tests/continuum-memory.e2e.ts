import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const patchTemplatePath = fileURLToPath(new URL('./fixtures/continuum-memory.patch.yml', import.meta.url))
const recordingFixturePath = fileURLToPath(new URL('./fixtures/continuum-recording-llm.ts', import.meta.url))
const jevLibPath = fileURLToPath(new URL('../../../../../../packages/experimental/apus-dsh-jev-plugin/lib/index.js', import.meta.url))
const continuumLibPath = fileURLToPath(new URL('../../../../../../packages/context/continuum/lib/index.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const fact = 'The release candidate stores the canonical integration fact in Continuum.'
type RecordedMessage = { source?: { kind?: string }; content?: Array<{ text?: string }> }

function patchForMode(template: string, mode: 'src' | 'lib'): string {
  const plugins = template
    .replaceAll('./continuum-recording-llm.ts', recordingFixturePath)
    .replaceAll('../../../../../../../packages/experimental/apus-dsh-jev-plugin/lib/index.js', jevLibPath)
    .replaceAll('../../../../../../../packages/context/continuum/lib/index.js', continuumLibPath)
  return mode === 'src'
    ? plugins.replaceAll(jevLibPath, jevLibPath.replace('/lib/index.js', '/src/index.ts')).replaceAll(continuumLibPath, continuumLibPath.replace('/lib/index.js', '/src/index.ts'))
    : plugins
}

function patchForScenario(template: string, scenario: 'no-reflex' | 'disabled'): string {
  if (scenario === 'no-reflex') return template.replace(/\n    - id: jev[\s\S]*?        apiKeyEnv: JEV_API_KEY\n/, '\n')
  return template.replace('        enabled: true', '        enabled: false')
}

function sessionIdOf(stdout: string): string {
  const value = JSON.parse(stdout.split('\n')[0] ?? '{}') as { sessionId?: string }
  if (value.sessionId === undefined) throw new Error('headless profile did not emit a session id')
  return value.sessionId
}

describe('shipped headless Continuum profile', () => {
  it.each(['src', 'lib'] as const)('admits, persists, resumes, and injects memory in %s mode', { timeout: 120_000, retry: 0 }, async (mode) => {
    const cwd = await mkdtemp(join(tmpdir(), `continuum-headless-${mode}-`))
    try {
      const patchPath = join(cwd, 'continuum-memory.patch.yml')
      await writeFile(patchPath, patchForMode(await readFile(patchTemplatePath, 'utf8'), mode))
      const env = { CONTINUUM_REQUEST_LOG: join(cwd, 'requests.jsonl'), DSH_TELEMETRY_DISABLED: '1' }
      const first = await runLoaderSmoke({
        label: `Continuum headless first ${mode} wake`, mode, ...(mode === 'src' ? { sourceImport: 'tsx/esm' as const } : {}), cwd, binScript, tsconfigPath,
        configPath: patchPath, binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', fact], env,
      })
      const sessionId = sessionIdOf(first.stdout)
      const resumed = await runLoaderSmoke({
        label: `Continuum headless resumed ${mode} wake`, mode, ...(mode === 'src' ? { sourceImport: 'tsx/esm' as const } : {}), cwd, binScript, tsconfigPath,
        configPath: patchPath,
        binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', '--session-id', sessionId, 'Recall the canonical integration fact.'], env,
      })
      const rows = (await readFile(join(cwd, 'requests.jsonl'), 'utf8')).trim().split('\n')
        .map(line => JSON.parse(line) as Array<RecordedMessage> | { diagnostic?: unknown })
      const requests = rows.filter((row): row is Array<RecordedMessage> => Array.isArray(row))
      const recall = requests.flatMap(messages => messages).find(message => message.source?.kind === 'continuum-memory')
      const requestSummary = requests.map(messages => messages.map(message => ({ source: message.source?.kind, text: message.content?.flatMap(block => block.text ?? []).join(' ').slice(0, 160) })))
      expect(recall, `recorded model requests: ${requests.length}; requests: ${JSON.stringify(requestSummary)}; diagnostics: ${JSON.stringify(rows.filter(row => !Array.isArray(row)))}; stderr: ${resumed.stderr}`).toBeDefined()
      expect(recall?.content?.[0]?.text ?? '').toContain('canonical integration fact')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it.each(['no-reflex', 'disabled'] as const)('keeps the original path for %s', { timeout: 120_000, retry: 0 }, async (scenario) => {
    const cwd = await mkdtemp(join(tmpdir(), `continuum-headless-${scenario}-`))
    try {
      const patchPath = join(cwd, 'continuum-memory.patch.yml')
      const template = await readFile(patchTemplatePath, 'utf8')
      await writeFile(patchPath, patchForScenario(patchForMode(template, 'lib'), scenario))
      const env = { CONTINUUM_REQUEST_LOG: join(cwd, 'requests.jsonl'), DSH_TELEMETRY_DISABLED: '1' }
      const first = await runLoaderSmoke({
        label: `Continuum headless ${scenario} first wake`, mode: 'lib', cwd, binScript, tsconfigPath,
        configPath: patchPath, binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', fact], env,
      })
      const sessionId = sessionIdOf(first.stdout)
      await runLoaderSmoke({
        label: `Continuum headless ${scenario} resumed wake`, mode: 'lib', cwd, binScript, tsconfigPath,
        configPath: patchPath,
        binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', '--session-id', sessionId, 'Recall the canonical integration fact.'], env,
      })
      const rows = (await readFile(join(cwd, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Array<RecordedMessage>)
      expect(rows.flatMap(messages => messages).some(message => message.source?.kind === 'continuum-memory')).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
