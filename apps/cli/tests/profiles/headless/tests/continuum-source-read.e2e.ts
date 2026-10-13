import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const binScript = join(root, 'apps/cli/src/bin.ts')
const sourceOverlay = join(root, 'apps/cli/config/examples/continuum/source-read.cordis.yml')
const original = `  原始输入。🌿\n${'历史背景保持完整。😀\n'.repeat(360)}Quartzlaunch exact tail MERIDIAN-731.\n`
interface ObservedMessage { role: string; toolCallId?: string; isError?: boolean; content: Array<{ type: string; text?: string }> }
interface SourcePage { content: string; offset: number; end: number; total: number; next_offset: number | null; sha256: string }

function textOf(message: ObservedMessage): string {
  return message.content.map(block => block.text ?? '').join('\n')
}

async function sourceEvents(home: string, id: string): Promise<SessionEvent[]> {
  const base = join(home, 'sessions')
  const files = (await readdir(base, { recursive: true })).filter(path => path.includes(id) && path.endsWith('.jsonl.zstd'))
  expect(files).toHaveLength(1)
  const bytes = await readFile(join(base, files[0]!))
  const frames = scanZstdFrames(bytes)
  expect(frames.tornStart).toBeUndefined()
  return frames.frames.flatMap(({ start, end }) => zstdDecompressSync(bytes.subarray(start, end)).toString().trim().split('\n'))
    .map(line => JSON.parse(line) as SessionEvent | { type: 'session' }).filter((event): event is SessionEvent => event.type !== 'session')
}

async function createPatch(path: string): Promise<void> {
  await writeFile(path, `- id: agent-default-model
  config:
    provider: continuum-source
    model: continuum-source
- insert:
    - id: continuum-source-llm
      name: ${JSON.stringify(join(root, 'apps/cli/tests/profiles/headless/tests/fixtures/continuum-source-llm.mjs'))}
    - id: jev
      name: ${JSON.stringify(join(root, 'packages/experimental/apus-dsh-jev-plugin/lib/index.js'))}
      config:
        endpoint: http://127.0.0.1:1
        model: unused
    - id: continuum-memory
      name: ${JSON.stringify(join(root, 'packages/context/continuum/lib/index.js'))}
      config:
        enabled: true
        mode: active
        admission: user-message
        scopes: [workspace]
`)
}

describe('Continuum source pages through shipped Headless tools', () => {
  it.each(['read', 'bad-hash', 'foreign'] as const)('preserves the source and handles %s through actual model requests', { timeout: 120_000, retry: 0 }, async (scenario) => {
    const base = await mkdtemp(join(tmpdir(), 'continuum-source-flow-'))
    try {
      const home = join(base, '.dsh')
      const workspace = join(base, 'workspace')
      await mkdir(workspace)
      const patch = join(base, 'model.patch.yml')
      await createPatch(patch)
      const invoke = (cwd: string, task: string, env: Record<string, string>, sessionId?: string) => runLoaderSmoke({
        label: `Continuum source ${scenario}`, mode: 'lib', cwd, binScript, tsconfigPath: join(root, 'tsconfig.json'),
        processTimeoutMs: 60_000, configPath: patch,
        binArgs: ['--profile', 'headless', '--patch', patch, '--patch', sourceOverlay, '--json', ...(sessionId ? ['--session-id', sessionId] : []), task],
        env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ...env },
      })
      const seed = await invoke(workspace, original, { CONTINUUM_SOURCE_SCENARIO: 'seed' })
      const sessionId = (JSON.parse(seed.stdout.split('\n')[0]!) as { sessionId: string }).sessionId
      const before = await sourceEvents(home, sessionId)
      const source = before.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
      expect(source?.type).toBe('user/message')
      if (source?.type !== 'user/message') throw new Error('seed lacks original user event')
      expect(source.data.content).toEqual([{ type: 'text', text: original }])
      const requestLog = join(base, 'requests.jsonl')
      const target = scenario === 'foreign' ? join(base, 'foreign-workspace') : workspace
      if (scenario === 'foreign') await mkdir(target)
      const resumed = await invoke(target, 'Quartzlaunch: retrieve the complete original input.', {
        CONTINUUM_SOURCE_SCENARIO: scenario, CONTINUUM_REQUEST_LOG: requestLog,
        CONTINUUM_TARGET_SESSION: sessionId, CONTINUUM_TARGET_SEQ: String(source.seq),
      }, scenario === 'foreign' ? undefined : sessionId)
      const requests = (await readFile(requestLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as ObservedMessage[])
      const last = requests.at(-1)!
      const toolMessages = last.filter(message => message.role === 'tool' && message.toolCallId?.startsWith('source-page-'))
      expect(toolMessages.length).toBeGreaterThan(0)
      if (scenario === 'read') {
        const pages = toolMessages.map((message) => {
          expect(message.isError).not.toBe(true)
          expect(Buffer.byteLength(textOf(message))).toBeLessThanOrEqual(8192)
          return JSON.parse(textOf(message)) as SourcePage
        })
        expect(pages.length).toBeGreaterThan(1)
        expect(pages.map(page => page.content).join('')).toBe(original)
        expect(pages.at(-1)?.next_offset).toBeNull()
        expect(new Set(pages.map(page => page.sha256))).toEqual(new Set([createHash('sha256').update(JSON.stringify(source, null, 2)).digest('hex')]))
        expect(resumed.stdout).toContain('SOURCE_RECONSTRUCTED')
      } else {
        expect(toolMessages.at(-1)?.isError).toBe(true)
        expect(resumed.stdout).toContain(scenario === 'foreign' ? 'SOURCE_DENIED' : 'SOURCE_CHANGE_REJECTED')
        if (scenario === 'foreign') expect(JSON.stringify(requests)).not.toContain('MERIDIAN-731')
      }
      const after = await sourceEvents(home, sessionId)
      expect(after.find(event => event.seq === source.seq)).toEqual(source)
      if (scenario !== 'foreign') {
        const persisted = after.filter(event => event.type === 'tool/result')
        expect(persisted).toHaveLength(toolMessages.length)
        expect(persisted.map(event => event.type === 'tool/result' ? event.data.message : undefined)).toEqual(toolMessages)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
