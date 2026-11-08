/**
 * Task-container skill discovery: one provider serves several agents whose
 * roots live in different execution worlds, so every provider call must carry
 * the calling Agent's identity. The fixture below refuses a request that names
 * no agent and refuses every Host path, which is how a task container behaves.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
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
  type FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import * as SkillFileSystem from '../src/index.ts'

const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `dsh-${name}-`)))
  tempDirs.push(dir)
  return dir
}

async function writeSkill(root: string, name: string, description: string, body = 'Use the skill.'): Promise<void> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

/**
 * A remote filesystem whose execution world is one task container per agent.
 * `/app` is the container's working directory; every other absolute path is a
 * Host path this world cannot reach. `listDir`/`readText` receive targets that
 * `resolve` produced, so the recorded identity is what `resolve` was given.
 */
class TaskWorldFileSystem extends FileSystem {
  /** agentId → Host directory standing in for that agent's `/app`. */
  readonly worlds = new Map<string, string>()
  readonly resolveCalls: Array<{ path: string; agentId: string | undefined }> = []
  readonly deniedAgents = new Set<string>()

  private world(path: string, agentId: string | undefined, callsite: string): FsTarget {
    if (agentId === undefined) {
      throw new FsError(`${callsite}: the request names no agent`, 'FS_IO_ERROR')
    }
    if (this.deniedAgents.has(agentId)) {
      throw new FsError(`${callsite}: permission denied in the task container`, 'FS_PERMISSION_DENIED')
    }
    const root = this.worlds.get(agentId)
    if (root === undefined) throw new FsError(`${callsite}: no task container for ${agentId}`, 'FS_NOT_FOUND')
    if (path !== '/app' && !path.startsWith('/app/')) {
      throw new FsError(`${callsite}: ${path} is not in this task container`, 'FS_NOT_FOUND')
    }
    return { targetKey: FsTargetKey(join(root, path.slice('/app'.length))), displayPath: path }
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal; agentId?: string }): Promise<FsTarget> {
    this.resolveCalls.push({ path, agentId: opts?.agentId })
    return this.world(posix.normalize(path), opts?.agentId, 'resolve')
  }

  override processPath(target: FsTarget): string { return target.targetKey }

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
      const info = await stat(target.targetKey)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isDirectory() ? 'directory' : 'file',
        size: info.size,
      }
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
    const data = await readFile(target.targetKey)
    return new Uint8Array(data.subarray(range.offset, range.offset + range.length))
  }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const entries = await readdir(target.targetKey, { withFileTypes: true, encoding: 'utf8' })
    const result: FsDirEntry[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = await stat(join(target.targetKey, entry.name))
      result.push({
        name: entry.name,
        type: child.isFile() ? 'file' : child.isDirectory() ? 'directory' : 'other',
        target: {
          targetKey: FsTargetKey(join(target.targetKey, entry.name)),
          displayPath: posix.join(target.displayPath, entry.name),
        },
        version: FsVersion(String(child.mtimeMs)),
        ...child.isFile() ? { size: child.size } : {},
      })
    }
    return result
  }

  override async writeText(target: FsTarget, content: string): Promise<FsWriteOutcome> {
    await writeFile(target.targetKey, content)
    return { operation: 'create', version: FsVersion('written'), before: null, after: content }
  }

  override async editText(_target: FsTarget, _request: FsEditRequest): Promise<FsEditOutcome> {
    throw new Error('not needed in identity tests')
  }
}

async function taskContext(): Promise<{ ctx: Context; fs: TaskWorldFileSystem; home: string }> {
  const ctx = new Context()
  await ctx.plugin(TaskWorldFileSystem)
  await ctx.plugin(SkillRegistry)
  const home = await tempDir('skill-world-home')
  return { ctx, fs: ctx.fs as TaskWorldFileSystem, home }
}

describe('task-world skill discovery', () => {
  it('loads each agent\'s task skills through the identity that owns the container', async () => {
    const rootA = await tempDir('skill-world-a')
    const rootB = await tempDir('skill-world-b')
    await mkdir(join(rootA, '.git'), { recursive: true })
    await mkdir(join(rootB, '.git'), { recursive: true })
    await writeSkill(join(rootA, '.agents/skills'), 'task-skill-a', 'Skill for the first case')
    await writeSkill(join(rootB, '.agents/skills'), 'task-skill-b', 'Skill for the second case')
    const bundled = await tempDir('skill-world-bundled')
    await writeSkill(bundled, 'host-bundled', 'Bundled Host skill')
    const { ctx, fs, home } = await taskContext()
    fs.worlds.set('case-a', rootA)
    fs.worlds.set('case-b', rootB)
    // Empty Host user roots: the only Host resource in play is the bundled
    // root, exactly as a task deployment mounts it.
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      bundledSkillDir: bundled,
      watch: false,
    })

    expect((await ctx.skills.list({ cwd: '/app', agentId: 'case-a' })).map(skill => skill.name)).toEqual([
      'host-bundled',
      'task-skill-a',
    ])
    expect((await ctx.skills.list({ cwd: '/app', agentId: 'case-b' })).map(skill => skill.name)).toEqual([
      'host-bundled',
      'task-skill-b',
    ])

    const loaded = await ctx.skills.get('task-skill-a', { cwd: '/app', agentId: 'case-a' })
    expect(loaded?.content).toBe('Use the skill.')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: '/app/.agents/skills/task-skill-a' })
    // The second case cannot load the first case's skill body.
    expect(await ctx.skills.get('task-skill-a', { cwd: '/app', agentId: 'case-b' })).toBeUndefined()

    // Every task-world resolution named the agent; Host user roots are Host
    // locations and are never asked of a task container, and no bundled path
    // crosses into it either.
    expect(fs.resolveCalls.length).toBeGreaterThan(0)
    expect(fs.resolveCalls.every(call => call.agentId === 'case-a' || call.agentId === 'case-b')).toBe(true)
    expect(fs.resolveCalls.filter(call => call.path === bundled || call.path.startsWith(`${bundled}/`))).toEqual([])
    expect(fs.resolveCalls.filter(call => !call.path.startsWith('/app'))).toEqual([])
    // The bundled Host root is a fixed read-only Host resource: it is read by
    // the Host directly, never through the task world.
    expect((await ctx.skills.get('host-bundled', { cwd: '/app', agentId: 'case-a' }))?.resourceBase)
      .toEqual({ kind: 'directory', path: join(bundled, 'host-bundled') })
  })

  it('loads a listed skill from the world that discovered it', async () => {
    const rootA = await tempDir('skill-world-loader-a')
    const rootB = await tempDir('skill-world-loader-b')
    for (const root of [rootA, rootB]) await mkdir(join(root, '.git'), { recursive: true })
    await writeSkill(join(rootA, '.agents/skills'), 'listed-skill', 'Listed in A', 'Body from A.')
    const { ctx, fs, home } = await taskContext()
    fs.worlds.set('case-a', rootA)
    fs.worlds.set('case-b', rootB)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    const listed = await ctx.skills.list({ cwd: '/app', agentId: 'case-a' })
    expect(listed.map(skill => skill.name)).toContain('listed-skill')
    // Loading through another caller identity still reads the world that
    // produced the candidate; the body cannot be confused with B's container.
    const parsed = await fs.resolve('/app/.agents/skills/listed-skill/SKILL.md', { agentId: 'case-a' })
    expect(await fs.readText(parsed)).toContain('Body from A.')
    // The same-name lookup in B's world does not find A's skill at all.
    expect(await ctx.skills.get('listed-skill', { cwd: '/app', agentId: 'case-b' })).toBeUndefined()
  })

  it('records a missing task root as absent instead of inventing skills', async () => {
    const empty = await tempDir('skill-world-empty')
    await mkdir(join(empty, '.git'), { recursive: true })
    const { ctx, fs, home } = await taskContext()
    fs.worlds.set('case-empty', empty)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    expect(await ctx.skills.snapshot({ cwd: '/app', agentId: 'case-empty' }))
      .toEqual({ skills: [], complete: true })
    expect(fs.resolveCalls.every(call => call.agentId === 'case-empty')).toBe(true)
  })

  it('reports an unauthorized task read as an incomplete catalog', async () => {
    const root = await tempDir('skill-world-denied')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeSkill(join(root, '.agents/skills'), 'hidden-skill', 'Not readable')
    const { ctx, fs, home } = await taskContext()
    fs.worlds.set('case-denied', root)
    fs.deniedAgents.add('case-denied')
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    expect(await ctx.skills.snapshot({ cwd: '/app', agentId: 'case-denied' }))
      .toEqual({ skills: [], complete: false })
  })

  it('reports a lookup without an agent identity as incomplete rather than reading the Host', async () => {
    const root = await tempDir('skill-world-anonymous')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeSkill(join(root, '.agents/skills'), 'anonymous-skill', 'Only reachable through an agent')
    const { ctx, fs, home } = await taskContext()
    fs.worlds.set('case-a', root)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    expect(await ctx.skills.snapshot({ cwd: '/app' })).toEqual({ skills: [], complete: false })
  })
})
