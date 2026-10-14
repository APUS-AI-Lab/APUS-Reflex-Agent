/** Product memory defaults remain editable and preserve Session facts across restart. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, loadOverlayPatches, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionQueryEngine, { type SessionEventSearchPage, type SessionSearchHit, type SessionSearchPage } from '@deepseek-ai/dsh-session-query'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { ContinuumConfig } from '../../../context/continuum/src/service.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import ContinuumJevPlugin from '../src/index.ts'
import ProductContinuumMemory from '../src/product-memory.ts'
import { expect, it, onTestFinished, vi } from 'vitest'

const packageName = '@deepseek-ai/dsh-experimental-continuum-jev'

/** Exact Session reads for the history tools; full-text search stays disabled as in shipped profiles. */
class ReadOnlyQuery extends SessionQueryEngine {
  override searchSessions(): Promise<SessionSearchPage<SessionSearchHit>> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(): Promise<SessionEventSearchPage> {
    throw new Error('history tools never search event text')
  }
}
const { editionPatch } = createRequire(import.meta.url)('../../../../frontend/scripts/product-edition.cjs') as { editionPatch: (edition: 'full' | 'lite') => string }
const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

async function fixture(edition: 'full' | 'lite', existing: boolean | string = false, reflex = true) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'continuum-product-bundle-')))
  const contexts: Context[] = []
  onTestFinished(async () => {
    await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
    rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle', packageName])
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  const core = join(dir, 'node_modules', 'test-bundle')
  const memory = join(dir, 'node_modules', packageName)
  for (const root of [core, memory]) mkdirSync(root, { recursive: true })
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(core, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'projection', name: 'cordis:projection' }, { id: 'llm', name: 'cordis:llm' }, { id: 'sessions', name: 'cordis:sessions' },
    { id: 'persistence', name: 'cordis:persistence', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'system-prompt', name: 'cordis:prompt', config: { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false } },
    { id: 'tools', name: 'cordis:tools' }, { id: 'agents', name: 'cordis:agents' }, { id: 'session-query', name: 'cordis:query' },
    { id: 'agent-loop', name: 'cordis:loop', config: { agents: [] } },
    { id: 'office-to-pdf', name: 'cordis:office' },
    ...reflex ? [{ id: 'jev', name: 'cordis:jev', config: {} }] : [],
  ] }]))
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  writeFileSync(join(memory, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(memory, 'cordis.patch.yml'), readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    .replace('./lib/index.js', 'cordis:selector').replace('./lib/product-memory.js', 'cordis:memory'))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const editionPath = join(home, 'product-edition.patch.yml')
  writeFileSync(editionPath, editionPatch(edition))
  if (existing !== false) {
    const admission = typeof existing === 'string' ? `\n    admission: ${existing}` : ''
    writeFileSync(join(dir, 'cordis.patch.yml'), `- id: continuum-memory\n  config:\n    maxCandidates: 3${admission}\n`)
  }
  const open = async () => {
    const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle', packageName], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: loadOverlayPatches('test', editionPath), telemetryDisabledEnv: undefined }
    const patches = readProfilePatches('test', profile)
    const ctx = await boot('test', join(dir, 'cordis.yml'), patches, (ctx) => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, projection: SessionProjectionRegistry,
        llm: LlmRuntime, sessions: SessionStore, persistence: JsonlSessionPersistence, prompt: SystemPrompt, tools: ToolRuntime,
        agents: AgentRegistry, loop: AgentLoop, jev: Jev, memory: ProductContinuumMemory,
        selector: ContinuumJevPlugin, query: ReadOnlyQuery, office: { apply() {} } })
    })
    contexts.push(ctx)
    const adapter = new MockAdapter(Array.from({ length: 6 }, () => textResponse('ack')))
    ctx.llm.registerAdapter(['recording'], adapter)
    return { ctx, adapter, profile }
  }
  return { home, open, contexts }
}

const toolNames = (adapter: MockAdapter): string[] => adapter.requests.at(-1)?.tools?.map(tool => tool.name) ?? []

it.each([
  { edition: 'full', existing: false }, { edition: 'lite', existing: false },
  { edition: 'full', existing: true }, { edition: 'lite', existing: true },
] as const)('keeps $edition memory official in existing=$existing profiles until Reflex is enabled, then retains it across restart', async ({ edition, existing }) => {
  const h = await fixture(edition, existing)
  const first = await h.open()
  expect(first.ctx.settings.describe().find(row => row.ns === 'continuum-memory')).toMatchObject({ value: { enabled: false, mode: 'active' } })
  await expect(first.ctx.settings.mutate('continuum-memory', [{ op: 'set', path: ['enabled'], value: 'invalid' }])).rejects.toThrow()
  expect(first.ctx.continuumMemory.state().enabled).toBe(false)
  const handle = await first.ctx.agents.create({ sessionId: SessionId('product-memory'), agentOptions: { provider: 'recording', model: 'recording' } })
  const agent = handle.agent
  await first.ctx.settings.mutate('jev', [{ op: 'set', path: ['endpoint'], value: 'http://127.0.0.1:1' }, { op: 'set', path: ['model'], value: 'product-fixture' }])
  const decide = vi.spyOn(first.ctx.jev, 'decide')
  await first.ctx.settings.mutate('continuum-memory', [{ op: 'set', path: ['enabled'], value: true }])
  agent.followup(user('The deployment code is MERIDIAN-731.'))
  await agent.whenIdle()
  agent.followup(user('What is the deployment code?'))
  await agent.whenIdle()
  // Reflex relevance is off by default, so the profile keeps the base DSH behavior.
  expect(first.ctx.get('continuumMemoryAdmitter')).toBeUndefined()
  expect(agent.session.snapshotEvents().some(event => event.type.startsWith('continuum/'))).toBe(false)
  expect(first.adapter.requests.flatMap(request => request.messages).some(message => message.source?.kind === 'continuum-memory')).toBe(false)
  expect(toolNames(first.adapter)).not.toContain('history_read')
  expect(decide).not.toHaveBeenCalled()

  const selector = first.ctx.configEditor.entries().find(row => row.options.id === 'continuum-jev')!
  await first.ctx.configEditor.edit(selector, raw => ({ ...raw, mode: 'shadow' }))
  expect(first.ctx.get('continuumMemoryAdmitter')).toBeDefined()
  agent.followup(user('Reflex is enabled now.'))
  await agent.whenIdle()
  expect(toolNames(first.adapter)).toEqual(expect.arrayContaining(['history_read', 'history_search']))
  await first.ctx.sessions.flush(agent.session)
  await first.ctx.fiber.dispose()
  h.contexts.splice(h.contexts.indexOf(first.ctx), 1)
  const restarted = await h.open()
  expect(restarted.ctx.continuumMemory.state()).toEqual({ enabled: true, mode: 'active', reason: 'ready' })
  expect(restarted.ctx.get('continuumMemoryAdmitter')).toBeDefined()
  const resumed = await restarted.ctx.agentLoop.resume(restarted.ctx, { resumeSessionId: agent.session.id, agentOptions: { provider: 'recording', model: 'recording' } })
  resumed.agent.followup(user('After restart, are the history tools still offered?'))
  await resumed.agent.whenIdle()
  expect(toolNames(restarted.adapter)).toContain('history_read')
  await restarted.ctx.configEditor.edit(restarted.ctx.configEditor.entries().find(row => row.options.id === 'continuum-jev')!, raw => ({ ...raw, mode: 'off' }))
  expect(restarted.ctx.get('continuumMemoryAdmitter')).toBeUndefined()
  resumed.agent.followup(user('Reflex is off again.'))
  await resumed.agent.whenIdle()
  expect(toolNames(restarted.adapter)).not.toContain('history_read')
})

it('denies remote relevance even after its mode is enabled without a data-sharing policy', async () => {
  const h = await fixture('lite', 'user-message')
  const { ctx, adapter } = await h.open()
  await ctx.settings.mutate('jev', [{ op: 'set', path: ['endpoint'], value: 'http://127.0.0.1:1' }, { op: 'set', path: ['model'], value: 'product-fixture' }])
  const selector = ctx.configEditor.entries().find(row => row.options.id === 'continuum-jev')!
  await ctx.configEditor.edit(selector, raw => ({ ...raw, mode: 'active' }))
  expect(selector.options.config).toMatchObject({ mode: 'active', privacyPolicy: { mode: 'local-only' } })
  expect(ctx.get('continuumMemorySelector')).toBeDefined()
  const decide = vi.spyOn(ctx.jev, 'decide')
  await ctx.settings.mutate('continuum-memory', [{ op: 'set', path: ['enabled'], value: true }])
  const agent = await ctx.agentLoop.create(SessionId('private-product-memory'), { provider: 'recording', model: 'recording' })
  expect(ctx.continuumMemory.state()).toMatchObject({ enabled: true, mode: 'active' })
  agent.followup(user('The private project code is ORBIT-731.'))
  await agent.whenIdle()
  expect(agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(true)
  agent.followup(user('What is the private project code?'))
  await agent.whenIdle()
  expect(decide).not.toHaveBeenCalled()
  expect(agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-decision').map(event => event.data)).toContainEqual(expect.objectContaining({ failure: 'privacy-denied' }))
  expect(adapter.requests.at(-1)?.messages.some(message => message.source?.kind === 'continuum-memory'
    && message.content.some(block => block.type === 'text' && block.text.includes('ORBIT-731')))).toBe(true)
})

it('keeps Core defaults unchanged and accepts explicit product restrictions', () => {
  expect(ContinuumConfig({}).enabled.get()).toBe(false)
  expect(ContinuumConfig({})).toMatchObject({ scopes: [], admission: 'explicit', candidatePool: 'lexical' })
  expect(ContinuumConfig({}).mode.get()).toBe('off')
  const defaults = ProductContinuumMemory.Config({ enabled: true })
  expect(defaults.mode.get()).toBe('active')
  expect(defaults).toMatchObject({ scopes: ['workspace'], admission: 'compaction', candidatePool: 'all' })
  const restricted = ProductContinuumMemory.Config({ mode: 'off', admission: 'explicit', scopes: [] })
  expect(restricted.mode.get()).toBe('off')
  expect(restricted).toMatchObject({ scopes: [], admission: 'explicit' })
})

it.each(['full', 'lite'] as const)('preserves existing %s settings while keeping missing Reflex unable to admit or recall', async (edition) => {
  const h = await fixture(edition, 'user-message', false)
  const { ctx, adapter } = await h.open()
  expect(ctx.configEditor.entries().find(row => row.options.id === 'continuum-memory')?.options).toMatchObject({ config: { maxCandidates: 3 } })
  await ctx.settings.mutate('continuum-memory', [{ op: 'set', path: ['enabled'], value: true }])
  expect(ctx.continuumMemory.state()).toEqual({ enabled: false, mode: 'off', reason: 'reflex-required' })
  const agent = await ctx.agentLoop.create(SessionId('no-reflex-product'), { provider: 'recording', model: 'recording' })
  agent.followup(user('Do not admit this input without Reflex.'))
  await agent.whenIdle()
  expect(agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(false)
  expect(adapter.requests[0]?.messages.filter(message => message.source?.kind === 'continuum-memory')).toEqual([])
})
