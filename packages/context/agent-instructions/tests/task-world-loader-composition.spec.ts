/**
 * Real Loader composition: a task preset mounts the task-world filesystem,
 * the skill registry and the skill loader inside its own `fs` realm, while the
 * Host plane keeps the instruction loader. The YAML below is the shipped shape
 * (a preset group with `isolate: { fs: true }`), so this pins export unwrapping,
 * entry activation order, and realm routing — not a hand-built plugin tree.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import SessionStore, { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as SkillRegistry from '@deepseek-ai/dsh-skill'
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

const roots: string[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `dsh-${name}-`)))
  roots.push(dir)
  return dir
}

/** One execution world per agent; `/app` is its working directory. */
class TaskWorldFileSystem extends FileSystem {
  readonly worlds = new Map<string, string>()
  readonly resolveCalls: Array<{ path: string; agentId: string | undefined }> = []

  private world(path: string, agentId: string | undefined, callsite: string): FsTarget {
    if (agentId === undefined) throw new FsError(`${callsite}: the request names no agent`, 'FS_IO_ERROR')
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
      const info = await stat(target.targetKey)
      return { version: FsVersion(String(info.mtimeMs)), type: info.isDirectory() ? 'directory' : 'file', size: info.size }
    } catch {
      return undefined
    }
  }
  override async readText(target: FsTarget): Promise<string> { return await readFile(target.targetKey, 'utf8') }
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
    return entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => ({
      name: entry.name,
      type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const,
      target: {
        targetKey: FsTargetKey(join(target.targetKey, entry.name)),
        displayPath: posix.join(target.displayPath, entry.name),
      },
      version: FsVersion('listed'),
    }))
  }
  override async writeText(target: FsTarget, content: string, _expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    await mkdir(join(target.targetKey, '..'), { recursive: true })
    await writeFile(target.targetKey, content)
    return { operation: 'create', version: FsVersion('written'), before: null, after: content }
  }
  override async editText(_target: FsTarget, _request: FsEditRequest): Promise<FsEditOutcome> {
    throw new Error('not needed in composition tests')
  }
}

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true })
  await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nSkill body.\n`)
}

describe.skipIf(process.platform === 'win32')('real Loader composition of task rules and skills', () => {
  it('reads task rules and task skills through the agent identity, with the bundled Host skill', { timeout: 60_000 }, async () => {
    const root = await tempDir('loader-composition')
    const taskRoot = await tempDir('loader-task-world')
    const bundled = await tempDir('loader-bundled-skills')
    const dshHome = await tempDir('loader-host-home')
    await mkdir(join(taskRoot, '.git'), { recursive: true })
    await writeFile(join(taskRoot, 'AGENTS.md'), 'Composed task rule.\n')
    await writeSkill(join(taskRoot, '.agents/skills'), 'task-composed-skill', 'Task composed skill')
    await writeSkill(bundled, 'host-bundled-skill', 'Bundled Host skill')

    const modules = new Map<string, unknown>([
      ['fixture-host', {
        name: 'fixture-host',
        apply(ctx: Context) {
          ctx.provide('sessionQuery', { observeSession: () => Promise.reject(new Error('unused')) } as never)
        },
      }],
      ['@deepseek-ai/dsh-llm', await import('@deepseek-ai/dsh-llm')],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-agent-loop', AgentLoop],
      // The Loader unwraps a namespace plugin to `{ name, inject, Config, apply }`;
      // hand it the same plain object so the test pins wiring, not interop luck.
      ['@deepseek-ai/dsh-agent-instructions', {
        name: AgentInstructions.name,
        inject: AgentInstructions.inject,
        Config: AgentInstructions.Config,
        apply: AgentInstructions.apply,
      }],
      ['@deepseek-ai/dsh-skill', SkillRegistry],
      ['@deepseek-ai/dsh-skill-filesystem', SkillFileSystem],
      ['@deepseek-ai/dsh-tool-skill', {
        name: ToolSkill.name,
        inject: ToolSkill.inject,
        Config: ToolSkill.Config,
        apply: ToolSkill.apply,
      }],
      ['fixture-task-fs', TaskWorldFileSystem],
    ])

    await writeFile(join(root, 'cordis.yml'), JSON.stringify([
      { id: 'llm', name: '@deepseek-ai/dsh-llm' },
      { id: 'sessions', name: '@deepseek-ai/dsh-session' },
      { id: 'projections', name: '@deepseek-ai/dsh-session-projection' },
      { id: 'prompts', name: '@deepseek-ai/dsh-system-prompt' },
      { id: 'tools', name: '@deepseek-ai/dsh-tools' },
      { id: 'agents', name: '@deepseek-ai/dsh-agent' },
      {
        id: 'agent-instructions',
        name: '@deepseek-ai/dsh-agent-instructions',
        config: { dshHome, maxBytes: 65536, instructionFileCandidates: ['AGENTS.md'] },
      },
      { id: 'skills', name: '@deepseek-ai/dsh-skill' },
      // The task plane serves every agent from one process; the agent identity
      // in each call selects the container, so no per-agent realm is needed.
      { id: 'task-fs', name: 'fixture-task-fs' },
      {
        id: 'skill-filesystem',
        name: '@deepseek-ai/dsh-skill-filesystem',
        config: { dshHome: join(dshHome, '.dsh'), agentsHome: join(dshHome, '.agents'), bundledSkillDir: bundled, watch: false },
      },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
    ]))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.builtins.group = Group
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(join(root, 'cordis.yml')).href },
    })
    // `loader.await()` finishes before every root entry has started; the shipped
    // launchers run the tree to quiescence, so drive the same loop here.
    for (let round = 0; round < 20; round += 1) {
      await context.loader.await()
      const unstarted = [...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
      if (unstarted.length === 0) break
      await Promise.all(unstarted.map(entry => entry.refresh()))
    }
    const failed: string[] = []
    for (const entry of context.loader.entries()) {
      if (entry.fiber === undefined && !entry.disabled) failed.push(entry.options.id)
    }
    expect(failed).toEqual([])

    // A preset mounts its plane into the Agent's scope, exactly as the shipped
    // `standard` preset does; the agent's services then resolve inside it.
    const taskFs = context.get('fs') as TaskWorldFileSystem
    expect(taskFs).toBeInstanceOf(TaskWorldFileSystem)
    taskFs.worlds.set('composition-agent', taskRoot)
    const agentSkills = context.get('skills')
    expect(agentSkills).toBeDefined()
    const agent = await context.agentLoop.create(SessionId('composition-agent'), {}, { cwd: '/app' })
    try {

      const text = await (async (): Promise<string> => {
        const decision = await agentEvents(context!, agent).waterfall(
          'agent/pre-step',
          { messages: [], turn: 1, step: 2, signal: new AbortController().signal },
          async () => ({ kind: 'enter' as const, messages: [] }),
        )
        const messages = decision.kind === 'enter' ? decision.messages : []
        const message = messages.find((candidate: UserMessage): boolean =>
          candidate.source.kind === 'agent-instructions')
        return message?.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
      })()
      expect(text).toContain('Composed task rule.')

      const catalog = await agentSkills!.snapshot({ cwd: '/app', agentId: 'composition-agent' })
      expect(catalog.skills.map(skill => skill.name).sort()).toEqual(['host-bundled-skill', 'task-composed-skill'])
      const loaded = await agentSkills!.get('task-composed-skill', { cwd: '/app', agentId: 'composition-agent' })
      expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: '/app/.agents/skills/task-composed-skill' })
      // Every task lookup names the agent; the fixed Host resources (the
      // user-global rule and the bundled skill root) never enter that world.
      const taskCalls = taskFs.resolveCalls.filter(call => call.path === '/app' || call.path.startsWith('/app/'))
      expect(taskCalls.length).toBeGreaterThan(0)
      expect(taskCalls.every(call => call.agentId === 'composition-agent')).toBe(true)
      // No Host path is resolved under an agent identity: a Host root reached
      // through the task world would be a cross-boundary read, and the fixture
      // rejects it. The unauthenticated user-global rule is the Host's own read.
      expect(taskFs.resolveCalls.filter(call => call.agentId !== undefined
        && call.path !== '/app' && !call.path.startsWith('/app/'))).toEqual([])
    } finally {
      await agent.ctx.fiber.dispose()
    }
  })
})
