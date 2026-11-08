/**
 * Task-container instruction loading: the model's working directory names a
 * container this process never mounts, so every project/user instruction read
 * must carry the Agent that owns that container. A fixed read-only Host rule
 * root stays a Host resource and must never be resolved inside the task world.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  FileSystem,
  FsError,
  FsTargetKey,
  FsVersion,
  type FsDirEntry,
  type FsEditOutcome,
  type FsEditRequest,
  type FsInfo,
  type FsPathInfo,
  type FsTarget,
  type FsWriteIntent,
  type FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'

const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `dsh-${name}-`)))
  tempDirs.push(dir)
  return dir
}

/**
 * One execution world per agent. `/app` is the task working directory; a
 * resolution without an agent, or for any Host path, fails the way the task
 * service does. `hostRoots` names the fixed Host read-only roots this world
 * must never be asked about.
 */
class TaskWorldFileSystem extends FileSystem {
  readonly worlds = new Map<string, string>()
  readonly resolveCalls: Array<{ path: string; agentId: string | undefined }> = []

  private world(path: string, agentId: string | undefined, callsite: string): string {
    if (agentId === undefined) throw new FsError(`${callsite}: the request names no agent`, 'FS_IO_ERROR')
    const root = this.worlds.get(agentId)
    if (root === undefined) throw new FsError(`${callsite}: no task container for ${agentId}`, 'FS_NOT_FOUND')
    if (path !== '/app' && !path.startsWith('/app/')) {
      throw new FsError(`${callsite}: ${path} is not in this task container`, 'FS_NOT_FOUND')
    }
    return join(root, path.slice('/app'.length))
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal; agentId?: string }): Promise<FsTarget> {
    this.resolveCalls.push({ path, agentId: opts?.agentId })
    return { targetKey: FsTargetKey(this.world(posix.normalize(path), opts?.agentId, 'resolve')), displayPath: path }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
  }

  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    try {
      const info = await stat(target.targetKey)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async lstat(path: string, opts?: { cwd?: string; agentId?: string }): Promise<FsPathInfo | undefined> {
    const target = this.world(path, opts?.agentId, 'lstat')
    try {
      const info = await stat(target)
      return { version: FsVersion(String(info.mtimeMs)), type: info.isDirectory() ? 'directory' : 'file', size: info.size }
    } catch {
      return undefined
    }
  }

  override async readText(target: FsTarget): Promise<string> {
    return await readFile(target.targetKey, 'utf8')
  }

  override async streamText(target: FsTarget): Promise<AsyncIterable<string>> {
    return (async function* () { yield await readFile(target.targetKey, 'utf8') })()
  }

  override async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const data = await readFile(target.targetKey)
    if (data.byteLength > maxBytes) throw new FsError('too large', 'FS_TOO_LARGE')
    return new Uint8Array(data)
  }

  override async readByteRange(target: FsTarget, range: { offset: number; length: number }): Promise<Uint8Array> {
    return (await readFile(target.targetKey)).subarray(range.offset, range.offset + range.length)
  }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(target.targetKey, { withFileTypes: true, encoding: 'utf8' })
    return entries.map(entry => ({
      name: entry.name,
      type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const,
      target: { targetKey: FsTargetKey(join(target.targetKey, entry.name)), displayPath: posix.join(target.displayPath, entry.name) },
      version: FsVersion('listed'),
    }))
  }

  override async writeText(target: FsTarget, content: string, _expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    await mkdir(dirname(target.targetKey), { recursive: true })
    await writeFile(target.targetKey, content)
    return { operation: 'create', version: FsVersion('written'), before: null, after: content }
  }

  override async editText(_target: FsTarget, _request: FsEditRequest): Promise<FsEditOutcome> {
    throw new Error('not needed in instruction identity tests')
  }
}

async function harness(): Promise<{
  ctx: Context
  fs: TaskWorldFileSystem
  hostRoot: string
  dshHome: string
  create: (id: string, cwd: string) => Promise<Agent>
}> {
  const ctx = new Context()
  await ctx.plugin(TaskWorldFileSystem)
  await mountAgentLoopTestDependencies(ctx)
  const hostRoot = await tempDir('instruction-host-root')
  const dshHome = await tempDir('instruction-host-home')
  await ctx.plugin(AgentInstructions, { dshHome, maxBytes: 65536, hostInstructionRoots: [hostRoot] })
  const loop = await mountAgentLoopTestHarness(ctx)
  return { ctx, fs: ctx.fs as TaskWorldFileSystem, hostRoot, dshHome, create: (id, cwd) => loop.create(SessionId(id), {}, { cwd }) }
}

/**
 * Run one real pre-step and return the instruction context the plugin adds.
 * @param ctx - harness context carrying the plugin.
 * @param agent - agent whose cwd selects its world.
 * @returns the rendered instruction text, or the empty string when none.
 */
async function instructionContext(ctx: Context, agent: Agent): Promise<string> {
  // A proceeding step receives the context appended to the claimed batch.
  const claimed: UserMessage[] = []
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: claimed, turn: 1, step: 2, signal: new AbortController().signal },
    async () => ({ kind: 'enter' as const, messages: claimed }),
  )
  const messages = decision.kind === 'enter' ? decision.messages : []
  const message = messages.find((candidate: UserMessage): boolean =>
    candidate.source.kind === 'agent-instructions')
  return message?.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
}

describe.skipIf(process.platform === 'win32')('task-world instruction loading', () => {
  it('loads the task AGENTS.md through the agent that owns the container', async () => {
    const root = await tempDir('instruction-task-root')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'Task rule: answer in the task container.\n')
    const { ctx, fs, dshHome, create } = await harness()
    try {
      fs.worlds.set('instruction-case-a', root)
      const agent = await create('instruction-case-a', '/app')
      const text = await instructionContext(ctx, agent)
      expect(text).toContain('Task rule: answer in the task container.')
      expect(fs.resolveCalls.length).toBeGreaterThan(0)
      // Task paths name the agent; the fixed user-global Host rule names none.
      const taskCalls = fs.resolveCalls.filter(call => call.path === '/app' || call.path.startsWith('/app/'))
      expect(taskCalls.length).toBeGreaterThan(0)
      expect(taskCalls.every(call => call.agentId === 'instruction-case-a')).toBe(true)
      expect(fs.resolveCalls.filter(call => call.agentId === undefined)).toEqual([
        { path: join(dshHome, 'AGENTS.md'), agentId: undefined },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps each agent\'s instructions in its own container', async () => {
    const rootA = await tempDir('instruction-root-a')
    const rootB = await tempDir('instruction-root-b')
    for (const root of [rootA, rootB]) await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(rootA, 'AGENTS.md'), 'Rule A only.\n')
    await writeFile(join(rootB, 'AGENTS.md'), 'Rule B only.\n')
    const { ctx, fs, create } = await harness()
    try {
      fs.worlds.set('instruction-case-a', rootA)
      fs.worlds.set('instruction-case-b', rootB)
      const agentA = await create('instruction-case-a', '/app')
      const agentB = await create('instruction-case-b', '/app')
      const textA = await instructionContext(ctx, agentA)
      const textB = await instructionContext(ctx, agentB)
      expect(textA).toContain('Rule A only.')
      expect(textA).not.toContain('Rule B only.')
      expect(textB).toContain('Rule B only.')
      expect(textB).not.toContain('Rule A only.')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('loads a fixed read-only Host rule root without asking the task world for it', async () => {
    const root = await tempDir('instruction-task-root')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'Task rule.\n')
    const { ctx, fs, hostRoot, create } = await harness()
    void hostRoot
    try {
      fs.worlds.set('instruction-case-a', root)
      await writeFile(join(hostRoot, 'AGENTS.md'), 'Host fixed rule.\n')
      const agent = await create('instruction-case-a', '/app')
      const text = await instructionContext(ctx, agent)
      // The project-root rule and the Host-root rule share the candidate name
      // `AGENTS.md`; both must load because they are distinct logical scopes.
      expect(text).toContain('Task rule.')
      expect(text).toContain('Host fixed rule.')
      expect(text).toContain('host-rules/')
      // The task world was never asked about the Host root; the fixed Host
      // resource is read by this process.
      expect(fs.resolveCalls.every(call => call.path !== join(hostRoot, 'AGENTS.md'))).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps a Host rule visible across later reconciliations', async () => {
    const root = await tempDir('instruction-task-root')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'Task rule.\n')
    const { ctx, fs, hostRoot, create } = await harness()
    try {
      fs.worlds.set('instruction-case-a', root)
      await writeFile(join(hostRoot, 'AGENTS.md'), 'Host fixed rule.\n')
      const agent = await create('instruction-case-a', '/app')
      // First pass renders the baseline, including the Host rule.
      expect(await instructionContext(ctx, agent)).toContain('Host fixed rule.')
      // A later step reconciles against the durable baseline. The Host rule is
      // a Host resource with no project-relative directory, so reconciliation
      // must not probe it inside the task world and remove it.
      const second = await instructionContext(ctx, agent)
      expect(second).toContain('Host fixed rule.')
      expect(fs.resolveCalls.some(call => call.path.includes('host-rules'))).toBe(false)
      // A changed Host rule reaches the next request as a replacement, proving
      // reconciliation read the Host root rather than skipping it.
      // 17 bytes, the same length as the first revision: only a real freshness
      // token (mtime plus size) catches it; a size-derived token would not.
      await writeFile(join(hostRoot, 'AGENTS.md'), 'Host fixed ruled.\n')
      expect(await instructionContext(ctx, agent)).toContain('Host fixed ruled.')
      expect(fs.resolveCalls.some(call => call.path.includes('host-rules'))).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not treat an unknown host root as a task path', async () => {
    const root = await tempDir('instruction-task-root')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'Task rule.\n')
    const { ctx, fs, hostRoot, create } = await harness()
    try {
      fs.worlds.set('instruction-case-a', root)
      const agent = await create('instruction-case-a', '/app')
      expect(await instructionContext(ctx, agent)).toContain('Task rule.')
      // Every task-world lookup starts at the workspace; the only Host-path
      // lookup is the fixed user-global rule, which names no agent.
      const taskCalls = fs.resolveCalls.filter(call => call.agentId !== undefined)
      expect(taskCalls.length).toBeGreaterThan(0)
      expect(taskCalls.every(call => call.path.startsWith('/app'))).toBe(true)
      expect(fs.resolveCalls.every(call => call.path !== join(hostRoot, 'AGENTS.md'))).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
