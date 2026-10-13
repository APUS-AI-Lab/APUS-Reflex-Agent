/** Cross-process task recovery through shipped profiles with a controlled keyless model. */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-continuum/tasks'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const taskPatch = join(repoRoot, 'apps/cli/config/examples/continuum-task.patch.yml')
const adapter = fileURLToPath(new URL('./fixtures/continuum-task-observer.mjs', import.meta.url))
const query = 'Continue the attached saved task in this new Session. Read all task pages and create continued-task.json with the exact prior inputs.'

interface RecordedMessage {
  readonly role: string
  readonly source?: { readonly kind?: string }
  readonly content: readonly { readonly type: string; readonly text?: string }[]
}

interface RecordedRequest {
  readonly sessionId: string
  readonly purpose?: 'compaction' | 'session-title'
  readonly messages: readonly RecordedMessage[]
}

function textOf(message: RecordedMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

function sessionIdOf(stdout: string): string {
  const first = JSON.parse(stdout.split('\n')[0] ?? '{}') as { sessionId?: string }
  if (first.sessionId === undefined) throw new Error('headless profile did not emit a Session id')
  return first.sessionId
}

async function requests(path: string): Promise<RecordedRequest[]> {
  return (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as RecordedRequest)
}

async function sourceEvents(root: string, sessionId: string): Promise<SessionEvent[]> {
  const paths = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.jsonl'))
  for (const path of paths) {
    const lines = (await readFile(join(root, path), 'utf8')).trim().split('\n')
    const header = JSON.parse(lines[0]!) as { id?: string }
    if (header.id === sessionId) return lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
  }
  throw new Error(`persisted Session ${sessionId} was not found`)
}

describe('shipped headless cross-session task memory', () => {
  it.each(['src', 'lib'] as const)('recovers exact source in a new process and writes an independently verified artifact (%s)', { timeout: 150_000, retry: 0 }, async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'continuum-task-profile-'))
    const cwd = join(root, 'workspace')
    await mkdir(cwd)
    try {
      const patch = join(root, 'keyless.patch.yml')
      await writeFile(patch, JSON.stringify([
        { id: 'agent-default-model', config: { provider: 'continuum-task-test', model: 'continuum-task-test' } },
        { id: 'llm-deepseek', disabled: true },
        { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
        { insert: [{ id: 'continuum-task-observer', name: adapter }] },
      ]))
      const firstRequirement = `  Earliest requirement: ${randomBytes(16).toString('hex')}.\n`
      const lastRequirement = `Final exact value: ${randomBytes(16).toString('hex')} 🌈\n`
      const seed = firstRequirement + Array.from({ length: 120 }, (_, index) =>
        `Requirement ${index}: preserve the entire source, including 漢字, quotes " and spacing.\n`).join('') + lastRequirement
      expect(Buffer.byteLength(seed)).toBeGreaterThan(8192)
      const environment = {
        DSH_TELEMETRY_DISABLED: '1', DSH_TOOLS_MODE: 'native',
        APUS_TASK_ROOT: join(root, 'memory'), APUS_TASK_DOMAIN: 'profile-domain',
        APUS_TASK_PRINCIPAL: 'profile-principal', APUS_TASK_ID: 'task-42',
      }
      const launch = (phase: string, input: string) => runLoaderSmoke({
        label: `cross-session task ${phase} ${mode}`, mode, ...(mode === 'src' ? { sourceImport: 'tsx/esm' as const } : {}),
        processTimeoutMs: 60_000, cwd, binScript, tsconfigPath, configPath: taskPatch,
        binArgs: ['--profile', 'headless', '--patch', taskPatch, '--patch', patch, '--json', input],
        env: { ...environment, CONTINUUM_TASK_PHASE: phase, CONTINUUM_TASK_REQUEST_LOG: join(root, `${phase}.requests.jsonl`) },
      })
      const first = await launch('seed', seed)
      const seedId = sessionIdOf(first.stdout)
      const saved = await sourceEvents(join(root, 'sessions'), seedId)
      const source = saved.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
      if (source?.type !== 'user/message') throw new Error('writer Session has no human source')
      expect(source.data.content).toEqual([{ type: 'text', text: seed }])
      const sourceBefore = JSON.stringify(saved)
      const second = await launch('continue', query)
      const nextId = sessionIdOf(second.stdout)
      expect(nextId).not.toBe(seedId)
      const actualRequests = await requests(join(root, 'continue.requests.jsonl'))
      expect(actualRequests.every(request => request.sessionId === nextId)).toBe(true)
      const mainRequests = actualRequests.filter(request => request.purpose === undefined)
      expect(mainRequests.length).toBeGreaterThan(3)
      const initial = mainRequests[0]!
      const human = initial.messages.filter(message => message.source?.kind === 'user').map(textOf)
      expect(human).toEqual([query])
      const taskContext = initial.messages.filter(message => message.source?.kind === 'runtime-context').map(textOf).join('\n')
      expect(taskContext).toContain(firstRequirement.trim())
      expect(taskContext).toContain(seedId)
      expect(taskContext).toContain('"pending":true')
      expect(taskContext).toContain('"revision":')
      const digest = createHash('sha256').update(seed, 'utf8').digest('hex')
      expect(taskContext).toContain(digest)
      const artifact = JSON.parse(await readFile(join(cwd, 'continued-task.json'), 'utf8')) as {
        revision: number
        inputs: { text: string; source: { sessionId: string; eventSeq: number; blockIndex: number; digest: string } }[]
      }
      expect(artifact.revision).toBe(2)
      expect(artifact.inputs).toEqual([{ text: seed, source: { sessionId: seedId, eventSeq: source.seq, blockIndex: 0, digest } }])
      expect(JSON.stringify(await sourceEvents(join(root, 'sessions'), seedId))).toBe(sourceBefore)
      const continued = await sourceEvents(join(root, 'sessions'), nextId)
      expect(continued.filter(event => event.type === 'continuum/task-binding')).toHaveLength(1)
      const calls = continued.filter(event => event.type === 'tool/call').map(event => event.data.name)
      expect(calls.filter(name => name === 'read_continuum_task').length).toBeGreaterThan(1)
      expect(calls.at(-1)).toBe('write')
      const final = continued.findLast(event => event.type === 'assistant/message')
      expect(final?.type === 'assistant/message' ? final.data.message.content : []).toEqual([{ type: 'text', text: 'TASK_ARTIFACT_WRITTEN' }])
      const refusedLog = join(root, 'without-authority.requests.jsonl')
      const refused = await runLoaderSmoke({
        label: `cross-session task authority removed ${mode}`, mode,
        ...(mode === 'src' ? { sourceImport: 'tsx/esm' as const } : {}),
        processTimeoutMs: 60_000, cwd, binScript, tsconfigPath, configPath: patch,
        binArgs: ['--profile', 'headless', '--patch', patch, '--json', '--session-id', nextId, 'Continue without the task plugin.'],
        expectedExitCode: 1,
        env: { ...environment, CONTINUUM_TASK_PHASE: 'continue', CONTINUUM_TASK_REQUEST_LOG: refusedLog },
      })
      expect(refused.stderr).toContain('task-bound Session requires its configured Continuum task authority')
      expect(existsSync(refusedLog), 'a bound Session cannot dispatch through a baseline profile without its authority').toBe(false)

    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
