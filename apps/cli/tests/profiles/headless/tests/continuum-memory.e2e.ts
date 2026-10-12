import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { MemoryRecord } from '@deepseek-ai/dsh-continuum'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'

const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const patchTemplatePath = fileURLToPath(new URL('./fixtures/continuum-memory.patch.yml', import.meta.url))
const recordingFixturePath = fileURLToPath(new URL('./fixtures/continuum-recording-llm.ts', import.meta.url))
const jevLibPath = fileURLToPath(new URL('../../../../../../packages/experimental/apus-dsh-jev-plugin/lib/index.js', import.meta.url))
const continuumLibPath = fileURLToPath(new URL('../../../../../../packages/context/continuum/lib/index.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
// Per-process budget for two-process functional acceptance; measure the startup SLA separately.
const PROCESS_TIMEOUT_MS = 60_000
const fact = 'The release candidate has the unique release code MERIDIAN-731.'
const recallQuery = 'What release code was recorded earlier?'
const canary = 'MERIDIAN-731'
type RecordedMessage = { source?: { kind?: string; recordIds?: string[] }; content?: Array<{ text?: string }> }

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

async function recordedRequests(path: string): Promise<RecordedMessage[][]> {
  const rows = (await readFile(path, 'utf8')).trim().split('\n')
    .map(line => JSON.parse(line) as RecordedMessage[] | { diagnostic?: unknown })
  return rows.filter((row): row is RecordedMessage[] => Array.isArray(row))
}

function messageText(message: RecordedMessage): string {
  return message.content?.map(block => block.text ?? '').join('\n') ?? ''
}

async function persistedSeed(cwd: string, sessionId: string): Promise<MemoryRecord> {
  const sessionsDir = join(cwd, '.dsh', 'sessions')
  const files = (await readdir(sessionsDir, { recursive: true }))
    .filter(file => file.split(sep).includes(sessionId) && file.endsWith('.jsonl.zstd'))
  expect(files).toHaveLength(1)
  const compressed = await readFile(join(sessionsDir, files[0]!))
  const { frames, tornStart } = scanZstdFrames(compressed)
  expect(tornStart).toBeUndefined()
  const events = frames.flatMap(({ start, end }) =>
    zstdDecompressSync(compressed.subarray(start, end)).toString().trim().split('\n'))
    .map(line => JSON.parse(line) as SessionEvent | { type: 'session' })
  const source = events.find(event => event.type === 'user/message' && event.data.source.kind === 'user'
    && event.data.content.some(block => block.type === 'text' && block.text === fact))
  expect(source).toBeDefined()
  if (source?.type !== 'user/message') throw new Error('seed Session has no persisted user fact')
  const memory = events.find(event => event.type === 'continuum/memory-record'
    && event.data.operation === 'create' && event.data.record.content === fact)
  expect(memory).toBeDefined()
  if (memory?.type !== 'continuum/memory-record') throw new Error('seed Session has no persisted memory record')
  expect(memory.data.record.sourceRefs).toEqual([{ sessionId, eventSeq: source.seq }])
  expect(memory.data.record.id).toBe(`${sessionId}:${source.seq}`)
  return memory.data.record
}

describe('shipped headless Continuum profile', () => {
  it.each(['src', 'lib'] as const)('admits, persists, resumes, and injects memory in %s mode', { timeout: 120_000, retry: 0 }, async (mode) => {
    const cwd = await mkdtemp(join(tmpdir(), `continuum-headless-${mode}-`))
    try {
      const patchPath = join(cwd, 'continuum-memory.patch.yml')
      await writeFile(patchPath, patchForMode(await readFile(patchTemplatePath, 'utf8'), mode))
      const env = { CONTINUUM_REQUEST_LOG: join(cwd, 'first-requests.jsonl'), DSH_TELEMETRY_DISABLED: '1' }
      const first = await runLoaderSmoke({
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        label: `Continuum headless first ${mode} wake`, mode, ...(mode === 'src' ? { sourceImport: 'tsx/esm' as const } : {}), cwd, binScript, tsconfigPath,
        configPath: patchPath, binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', fact], env,
      })
      const sessionId = sessionIdOf(first.stdout)
      const admitted = await persistedSeed(cwd, sessionId)
      const resumed = await runLoaderSmoke({
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        label: `Continuum headless resumed ${mode} wake`, mode, ...(mode === 'src' ? { sourceImport: 'tsx/esm' as const } : {}), cwd, binScript, tsconfigPath,
        configPath: patchPath,
        binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', '--session-id', sessionId, recallQuery],
        env: { ...env, CONTINUUM_REQUEST_LOG: join(cwd, 'resumed-requests.jsonl') },
      })
      const requests = await recordedRequests(join(cwd, 'resumed-requests.jsonl'))
      expect(requests.length).toBeGreaterThan(0)
      const recall = requests.flat().find(message => message.source?.kind === 'continuum-memory')
      expect(recall, `resumed process requests: ${JSON.stringify(requests)}; stderr: ${resumed.stderr}`).toBeDefined()
      expect(recall === undefined ? '' : messageText(recall)).toContain(fact)
      expect(recall?.source?.recordIds).toEqual(expect.arrayContaining([admitted.id]))
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
      const env = { CONTINUUM_REQUEST_LOG: join(cwd, 'first-requests.jsonl'), DSH_TELEMETRY_DISABLED: '1' }
      const first = await runLoaderSmoke({
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        label: `Continuum headless ${scenario} first wake`, mode: 'lib', cwd, binScript, tsconfigPath,
        configPath: patchPath, binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', fact], env,
      })
      const sessionId = sessionIdOf(first.stdout)
      await runLoaderSmoke({
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        label: `Continuum headless ${scenario} resumed wake`, mode: 'lib', cwd, binScript, tsconfigPath,
        configPath: patchPath,
        binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', '--session-id', sessionId, recallQuery],
        env: { ...env, CONTINUUM_REQUEST_LOG: join(cwd, 'resumed-requests.jsonl') },
      })
      for (const filename of ['first-requests.jsonl', 'resumed-requests.jsonl']) {
        const requests = await recordedRequests(join(cwd, filename))
        expect(requests.length).toBeGreaterThan(0)
        expect(requests.flat().some(message => message.source?.kind === 'continuum-memory')).toBe(false)
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('does not recall an earlier Session when starting a new Session in the same workspace', { timeout: 120_000, retry: 0 }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'continuum-headless-new-session-'))
    try {
      const patchPath = join(cwd, 'continuum-memory.patch.yml')
      await writeFile(patchPath, patchForMode(await readFile(patchTemplatePath, 'utf8'), 'lib'))
      const env = { CONTINUUM_REQUEST_LOG: join(cwd, 'first-requests.jsonl'), DSH_TELEMETRY_DISABLED: '1' }
      const first = await runLoaderSmoke({
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        label: 'Continuum headless seed Session', mode: 'lib', cwd, binScript, tsconfigPath,
        configPath: patchPath, binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', fact], env,
      })
      await persistedSeed(cwd, sessionIdOf(first.stdout))
      const fresh = await runLoaderSmoke({
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        label: 'Continuum headless new Session', mode: 'lib', cwd, binScript, tsconfigPath,
        configPath: patchPath, binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', recallQuery],
        env: { ...env, CONTINUUM_REQUEST_LOG: join(cwd, 'fresh-requests.jsonl') },
      })
      expect(sessionIdOf(fresh.stdout)).not.toBe(sessionIdOf(first.stdout))
      const freshRequests = await recordedRequests(join(cwd, 'fresh-requests.jsonl'))
      expect(freshRequests.length).toBeGreaterThan(0)
      expect(freshRequests.flat().map(messageText).join('\n')).not.toContain(canary)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
