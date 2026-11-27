import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ModuleLoader } from '@deepseek-ai/cordis-plugin-loader'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as AgentRegistry from '@deepseek-ai/dsh-agent'
import * as AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as SessionStore from '@deepseek-ai/dsh-session'
import * as Projections from '@deepseek-ai/dsh-session-projection'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as Tools from '@deepseek-ai/dsh-tools'
import * as LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LocalFs from '@deepseek-ai/dsh-fs-local'
import * as LocalShell from '@deepseek-ai/dsh-bash-local'
import * as LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import * as Presets from '@deepseek-ai/dsh-agent-preset-registry'
import * as Preset from '@deepseek-ai/dsh-agent-preset'
import * as RemoteFs from '@deepseek-ai/dsh-fs-remote'
import * as RemoteShell from '@deepseek-ai/dsh-bash-remote'
import * as RemoteSubprocess from '@deepseek-ai/dsh-subprocess-remote'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import * as SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

const execute = promisify(execFile)

it.skipIf(process.platform === 'win32')('keeps Host I/O local and routes task tools through the isolated deployed preset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-preset-io-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const host = join(directory, 'host')
  const task = join(directory, 'task')
  await mkdir(host)
  await mkdir(task)
  await writeFile(join(host, 'host.txt'), 'Host state stays local\n')
  await writeFile(join(task, 'task.txt'), 'Task input belongs to the benchmark\n')
  const calls: string[] = []
  const taskService = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        calls.push(request.url ?? '')
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { command: string; workdir?: string }
        try {
          const result = await execute('sh', ['-c', body.command], { cwd: body.workdir ?? task })
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ stdout: result.stdout, stderr: result.stderr, return_code: 0 }))
        } catch (error) {
          response.writeHead(500)
          response.end(String(error))
        }
      })()
    })
  })
  onTestFinished(async () => {
    taskService.closeAllConnections()
    await new Promise<void>((resolve) => { taskService.close(() => { resolve() }) })
  })
  await new Promise<void>(resolve => taskService.listen(0, '127.0.0.1', resolve))
  const address = taskService.address()
  if (address === null || typeof address === 'string') throw new Error('Expected task service port')
  vi.stubEnv('PIPELINE_EXEC_ENDPOINT', `http://127.0.0.1:${address.port}`)
  onTestFinished(() => { vi.unstubAllEnvs() })

  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry], ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-session', SessionStore], ['@deepseek-ai/dsh-session-projection', Projections],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', Tools],
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-fs-local', LocalFs],
    ['@deepseek-ai/dsh-bash-local', LocalShell], ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
    ['@deepseek-ai/dsh-shell-env', ShellEnv], ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['@deepseek-ai/dsh-tool-fs-search', ToolSearch], ['@deepseek-ai/dsh-tool-bash', ToolBash],
    ['@deepseek-ai/dsh-agent-instructions', AgentInstructions],
    ['@deepseek-ai/dsh-skill', SkillRegistry], ['@deepseek-ai/dsh-skill-filesystem', SkillFileSystem],
    ['file:///workspace/packages/preset/agent-preset-registry/lib/index.js', Presets],
    ['file:///workspace/packages/preset/agent-preset/lib/index.js', Preset],
    ['file:///workspace/packages/fs/fs-remote/lib/index.js', RemoteFs],
    ['file:///workspace/packages/shell/bash-remote/lib/index.js', RemoteShell],
    ['file:///workspace/packages/subprocess/subprocess-remote/lib/index.js', RemoteSubprocess],
  ])
  for (const [name, module] of [...modules]) {
    if (name.startsWith('file:')) modules.set(fileURLToPath(name), module)
  }
  const config = join(directory, 'cordis.yml')
  await writeFile(config, JSON.stringify([
    { id: 'llm', name: '@deepseek-ai/dsh-llm' },
    { id: 'sessions', name: '@deepseek-ai/dsh-session' },
    { id: 'projections', name: '@deepseek-ai/dsh-session-projection' },
    { id: 'prompts', name: '@deepseek-ai/dsh-system-prompt' },
    { id: 'tools', name: '@deepseek-ai/dsh-tools' },
    { id: 'agents', name: '@deepseek-ai/dsh-agent' },
    { id: 'loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
    // The deployed profile's `skill` row lives on the Host plane; the preset
    // group provides the task-world provider inside the Agent's realm.
    { id: 'skill', name: '@deepseek-ai/dsh-skill' },
    { id: 'local-fs', name: '@deepseek-ai/dsh-fs-local', config: { cwd: host } },
    { id: 'local-process', name: '@deepseek-ai/dsh-subprocess-local' },
    { id: 'local-shell', name: '@deepseek-ai/dsh-bash-local', config: { cwd: host } },
    { id: 'shell-env', name: '@deepseek-ai/dsh-shell-env', config: { dshHome: directory } },
  ]))
  const patches = loadOverlayPatches('sdk-preset-test', fileURLToPath(new URL('../../../../deploy/evaluation.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert === undefined ? [] : [{ insert: patch.insert.filter(row => row.id === 'agent-preset-registry' || row.id === 'preset-benchmark-task') }])
  const native = ModuleLoader.fromInternal()
  if (native === undefined) throw new Error('This Loader test requires supported Node internals')
  const ctx = await boot('sdk-preset-test', config, patches, (root) => {
    root.loader.internal = {
      ...native,
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    }
  })
  onTestFinished(() => ctx.fiber.dispose())
  const entries = [...ctx.loader.entries()]
  for (const entry of entries) {
    if (!entry.disabled) await entry.fiber?.await()
  }
  expect((await ctx.agentPresets.resolve('benchmark-task')).broken).toBeUndefined()
  expect(ctx.fs).toBeInstanceOf(LocalFs.default)
  expect(ctx.shell).toBeInstanceOf(LocalShell.default)
  expect(ctx.subprocess).toBeInstanceOf(LocalSubprocess.default)

  const handle = await ctx.agents.create({
    sessionId: SessionStore.SessionId('task-owner'), meta: { cwd: task, agentPreset: 'benchmark-task' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'benchmark-task') },
  })
  onTestFinished(() => handle.dispose())
  expect(ctx.agentPresets.serviceFor(handle.agent, 'fs')).toBeInstanceOf(RemoteFs.default)
  expect(ctx.agentPresets.serviceFor(handle.agent, 'shell')).toBeInstanceOf(RemoteShell.default)
  const remoteProcesses = ctx.agentPresets.serviceFor(handle.agent, 'subprocess')
  if (!(remoteProcesses instanceof RemoteSubprocess.default)) throw new TypeError('task subprocess provider is not remote')
  expect(remoteProcesses.config).not.toHaveProperty('timeoutSec')
  expect(remoteProcesses.config.requestTimeoutMs).toBe(5000)
  const result = await ctx.tools.execute({
    name: 'read', arguments: { file_path: join(task, 'task.txt') },
    callId: ToolCallId('read-task-file'), signal: new AbortController().signal, agent: handle.agent,
  })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result)).toContain('Task input belongs to the benchmark')
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(path => path === '/jobs/by-session/task-owner/exec')).toBe(true)

  // The deployed preset's own task-context rows read through the Agent-scoped
  // filesystem: a rule file and a skill written only in the task world resolve
  // through the remote provider, not through this process.
  const taskRule = 'Composed evaluation task rule.\n'
  await writeFile(join(task, 'AGENTS.md'), taskRule)
  await mkdir(join(task, '.agents/skills/task-preset-skill'), { recursive: true })
  await writeFile(join(task, '.agents/skills/task-preset-skill/SKILL.md'),
    '---\nname: task-preset-skill\ndescription: Task preset skill\n---\n\nSkill body.\n')
  const instructionText = await (async (): Promise<string> => {
    const decision = await agentEvents(ctx, handle.agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 2, signal: new AbortController().signal },
      async () => ({ kind: 'enter' as const, messages: [] }),
    )
    const messages = decision.kind === 'enter' ? decision.messages : []
    const message = messages.find((candidate: UserMessage): boolean =>
      candidate.source.kind === 'agent-instructions')
    return message?.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
  })()
  expect(instructionText).toContain('Composed evaluation task rule.')
  // The viewing scope is the Agent: the preset's own provider layer (and with
  // it the task-world roots) is only visible to a lookup made for that Agent.
  const catalog = await handle.agent.ctx.get('skills')!.snapshot({
    cwd: task, agentId: 'task-owner', scope: handle.agent,
  })
  expect(catalog.skills.map(skill => skill.name)).toContain('task-preset-skill')

  // Every read the task rows made carried the Agent identity, so none of them
  // could have reached a Host path through this process.
  const before = calls.length
  const localTarget = await ctx.fs.resolve(join(host, 'host.txt'))
  expect(await ctx.fs.readText(localTarget)).toBe('Host state stays local\n')
  expect(calls.slice(before)).toEqual([])
})
