/** Desktop and Web product Skill selection and workspace prefetch exercised through the actual profile Loader. */
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { boot, initProfile, loadOverlayPatches, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ShellExecRequest } from '@deepseek-ai/dsh-shell'
import Skills from '@deepseek-ai/dsh-skill'
import { expect, it, onTestFinished, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import System3 from '../src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

it.each(['Desktop', 'Web'].flatMap(surface => [false, true].map(configured => ({ surface, configured }))))('loads $surface Skill advice through a profile, provider configured=$configured', async ({ surface, configured }) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-skill-profile-')))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const patch = join(home, 'product.patch.yml')
  if (surface === 'Desktop') {
    const generator = pathToFileURL(resolve('frontend/scripts/generate-system3-patch.mjs')).href
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
      `import { generateSystem3Patch } from ${JSON.stringify(generator)}; await generateSystem3Patch(${JSON.stringify(home)});`])
    writeFileSync(patch, readFileSync(join(home, 'desktop.patch.yml')))
  } else {
    const collector = pathToFileURL(resolve('scripts/product-web-package.mjs')).href
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
      `import { webProfilePatch } from ${JSON.stringify(collector)}; process.stdout.write(webProfilePatch);`])
    writeFileSync(patch, stdout)
  }
  const operations = loadOverlayPatches('test', patch)
  const selector = operations.flatMap(operation => operation.insert ?? []).find(plugin => plugin.id === 'system3')
  if (selector === undefined) throw new Error(`${surface} did not include Skill selection`)
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"desktop-skill-test"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'jev', name: 'cordis:jev', config: configured ? { endpoint: 'http://localhost:1', model: 'fixture' } : {} }, { ...selector, name: 'cordis:system3' },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const ctx: Context = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    ctx.provide('profileContext', profile)
    Object.assign(ctx.loader.builtins, { jev: Jev, system3: System3 })
  })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Skills)
  // Prefetch reads the README through the real filesystem; the shell stands in for the sandboxed discovery and search.
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'README.md'), 'Inbox rule: mail from the bank is always actionable.\n')
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  ctx.provide('shell', {
    resolve: (request: ShellExecRequest) => request,
    execute: (spec: ShellExecRequest) => Promise.resolve({ result: () => Promise.resolve({ exitCode: 0, signal: null, timedOut: false,
      aborted: false, timeoutMs: 1000, stdout: { text: spec.command.includes('rev-parse') ? 'git=0\nfiles=1\nreadme=README.md\n' : 'README.md\n',
        truncated: false }, stderr: { text: '', truncated: false } }) }),
  })
  ctx.effect(() => ctx.skills.register({ name: 'inbox-review', description: 'Classify inbox messages using saved preferences.',
    source: 'runtime', content: 'Read the provided messages and identify actionable items.' }))
  const decide = vi.spyOn(ctx.jev, 'decide')
  // Skill questions select inbox-review; prefetch questions (p0, p1, …) need only the README.
  if (configured) decide.mockImplementation(async query => ({ kind: 'ok', spec: ctx.jev.resolve(query), response: { model: 'fixture', answers: {
    intent: { type: 'choice', choice: 'action', confidence: 1, probabilities: { action: 1 } },
    skill: { type: 'choice', choice: 'skill-0', confidence: 1, probabilities: { 'skill-0': 1, abstain: 0 } },
    'skill-0': { type: 'noul', noul: 1 },
    ...Object.fromEntries(Object.entries(query.questions).filter(([key]) => /^p\d+$/u.test(key))
      .map(([key, question]) => [key, { type: 'noul' as const, noul: question.instructions?.includes('README.md') === true ? 0.9 : 0.05 }])),
  } } }))
  const adapter = new MockAdapter([textResponse('Native reply')])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const agent = await ctx.agentLoop.create(SessionId('desktop-skill-profile'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
  const ask = async () => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Organize my inbox.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  await ask()
  expect(ctx.sessionProjections.stateOf(agent.session, 'system3Runtime')?.skill).toMatchObject({
    outcome: configured ? 'selected' : 'provider-unavailable', injected: configured,
    ...configured ? { intent: 'action' } : {},
  })
  expect(agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(true)
  const shown = (request: GenerateOptions | undefined): string => (request?.messages ?? [])
    .filter(message => message.role === 'user' && message.source?.kind === 'system3-prefetch')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
  expect(shown(adapter.requests[0])).toEqual(configured ? expect.stringContaining('Inbox rule: mail from the bank is always actionable.') : '')
  const product = new Set(['skillSelection', 'workspacePrefetch'])
  expect(ctx.jev.readStatus().capabilities.filter(item => product.has(item.id)).every(item => item.implemented && item.enabled)).toBe(true)
  expect(ctx.jev.readStatus().capabilities.filter(item => !product.has(item.id)).every(item => !item.enabled)).toBe(true)
  expect(agent.session.deriveMessages().some(message => message.source.kind === 'skill-invocation' && message.source.name === 'inbox-review')).toBe(configured)
  expect(decide).toHaveBeenCalledTimes(configured ? 2 : 0)
})
