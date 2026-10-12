/** Pending memory selection follows committed Loader configuration changes. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Jev from '../../../experimental/apus-dsh-jev-plugin/src/index.ts'
import ContinuumMemory from '../src/service.ts'
import type { ContinuumMemorySelection } from '../src/context.ts'
import { expect, it, onTestFinished } from 'vitest'

async function start(isolatedJev = false) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'continuum-disable-race-')))
  const resource: { context?: Context } = {}
  const entered = Promise.withResolvers<readonly string[]>()
  const released = Promise.withResolvers<ContinuumMemorySelection>()
  onTestFinished(async () => {
    released.resolve({ mode: 'active', selectedIds: [], baselineIds: [], outcome: 'jev' })
    await resource.context?.fiber.dispose()
    rmSync(home, { recursive: true, force: true })
  })
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'projection', name: 'cordis:projection' }, { id: 'llm', name: 'cordis:llm' }, { id: 'sessions', name: 'cordis:sessions' },
    { id: 'system-prompt', name: 'cordis:prompt', config: { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false } },
    { id: 'tools', name: 'cordis:tools' }, { id: 'agents', name: 'cordis:agents' },
    { id: 'agent-loop', name: 'cordis:loop', config: { agents: [] } },
    { id: 'jev', name: 'cordis:jev', config: { endpoint: 'http://127.0.0.1:1', model: 'fixture' } },
    ...isolatedJev ? [{ id: 'isolated-jev', name: 'cordis:jev', isolate: { jev: true }, config: { endpoint: 'http://127.0.0.1:1', model: 'isolated-fixture' } }] : [],
    { id: 'continuum-memory', name: 'cordis:memory', config: { enabled: true, mode: 'active', admission: 'user-message', scopes: ['workspace'], maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 8192 } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    ctx.provide('continuumMemorySelector', { select: async (_agent, input) => {
      entered.resolve(input.candidates.map(candidate => candidate.id))
      return released.promise
    } })
    Object.assign(ctx.loader.builtins, {
      projection: SessionProjectionRegistry, editor: ConfigEditor, settings: Settings,
      llm: LlmRuntime, sessions: SessionStore, prompt: SystemPrompt, tools: ToolRuntime,
      agents: AgentRegistry, loop: AgentLoop, jev: Jev, memory: ContinuumMemory,
    })
  })
  resource.context = ctx
  const adapter = new MockAdapter([textResponse('saved'), textResponse('answered'), textResponse('disabled')])
  ctx.llm.registerAdapter(['recording'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId('disable-race'), agentOptions: { provider: 'recording', model: 'recording' } })
  const agent = handle.agent
  const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  agent.followup(user('The release code is MERIDIAN-731.'))
  await agent.whenIdle()
  expect(agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(true)
  const editField = async (field: string, value: unknown) => {
    const revision = ctx.settings.describe().find(row => row.ns === 'continuum-memory')!.revision
    await ctx.settings.mutate('continuum-memory', [{ op: 'set', path: [field], value }], revision)
  }
  return { ctx, profile, entered, released, adapter, agent, handle, user, editField }
}

it.each(['disable', 'disable-reenable', 'mode-off', 'mode-shadow', 'scope', 'invalid', 'unchanged'] as const)('handles pending recall across a %s configuration edit', async (edit) => {
  const { ctx, profile, entered, released, adapter, agent, user, editField } = await start()
  agent.followup(user('What is the release code?'))
  const selectedIds = await entered.promise
  expect(selectedIds.length).toBeGreaterThan(0)
  const before = ctx.settings.describe().find(row => row.ns === 'continuum-memory')
  expect(before?.value).toMatchObject({ enabled: true })
  if (edit === 'scope') {
    const entry = ctx.configEditor.entries().find(row => row.options.id === 'continuum-memory')!
    await ctx.configEditor.edit(entry, raw => ({ ...raw, scopes: ['another-workspace'] }))
  } else if (edit === 'invalid') {
    await expect(editField('enabled', 'invalid-boolean')).rejects.toThrow()
    expect(ctx.continuumMemory.state().enabled).toBe(true)
    expect(ctx.settings.describe().find(row => row.ns === 'continuum-memory')?.value).toMatchObject({ enabled: true })
  } else if (edit === 'unchanged') {
    await editField('enabled', true)
  } else if (edit.startsWith('mode-')) {
    await editField('mode', edit === 'mode-off' ? 'off' : 'shadow')
    expect(ctx.continuumMemory.state().mode).toBe(edit === 'mode-off' ? 'off' : 'shadow')
  } else {
    await editField('enabled', false)
    expect(ctx.continuumMemory.state().enabled).toBe(false)
    expect(ctx.settings.describe().find(row => row.ns === 'continuum-memory')?.value).toMatchObject({ enabled: false })
    expect(readFileSync(profile.patchPath, 'utf8')).toContain('false')
    if (edit === 'disable-reenable') {
      await editField('enabled', true)
      expect(ctx.continuumMemory.state().enabled).toBe(true)
    }
  }
  released.resolve({ mode: 'active', selectedIds, baselineIds: selectedIds, outcome: 'jev' })
  await agent.whenIdle()
  const recall = adapter.requests[1]?.messages.filter(message => message.source?.kind === 'continuum-memory')
  expect(adapter.requests).toHaveLength(2)
  expect(agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record')).toBe(true)
  if (edit === 'invalid' || edit === 'unchanged') {
    expect(recall).toHaveLength(1)
    expect(recall?.[0]?.source).toMatchObject({ recordIds: selectedIds })
  } else expect(recall).toEqual([])
})

it.each(['agent', 'service'] as const)('invalidates controllers when their %s is disposed', async (owner) => {
  const { ctx, agent, handle, editField } = await start()
  const controller = ctx.continuumMemory.controller(agent)
  const ticket = controller.beginRead({ scopes: ['workspace'] })
  if (ticket === undefined) throw new Error('enabled controller did not issue a read ticket')
  expect(controller.isCurrent(ticket)).toBe(true)
  if (owner === 'agent') {
    await handle.dispose()
    expect(ctx.agents.get(agent.session.id)).toBeUndefined()
    await editField('enabled', false)
    await editField('enabled', true)
    expect(ctx.continuumMemory.state().enabled).toBe(true)
  } else {
    const entry = ctx.configEditor.entries().find(row => row.options.id === 'continuum-memory')!
    await entry.fiber!.dispose()
    expect(ctx.get('continuumMemory')).toBeUndefined()
  }
  expect(controller.isCurrent(ticket)).toBe(false)
  expect(controller.state().enabled).toBe(false)
})

it.each(['unload', 'unload-remount', 'isolated-unload'] as const)('handles pending recall across Jev %s', async (change) => {
  const isolated = change === 'isolated-unload'
  const { ctx, entered, released, adapter, agent, user } = await start(isolated)
  const memoryEntry = ctx.configEditor.entries().find(row => row.options.id === 'continuum-memory')!
  const memoryUid = memoryEntry.fiber!.uid
  const observedAvailability: boolean[] = []
  memoryEntry.fiber!.ctx.on('internal/service', (name) => {
    if (name === 'jev') observedAvailability.push(memoryEntry.fiber!.ctx.get('jev') !== undefined)
  })
  const controller = ctx.continuumMemory.controller(agent)
  const ticket = controller.beginRead({ scopes: ['workspace'] })
  if (ticket === undefined) throw new Error('enabled controller did not issue a read ticket')
  agent.followup(user('What is the release code?'))
  const selectedIds = await entered.promise
  expect(selectedIds.length).toBeGreaterThan(0)
  const entry = ctx.configEditor.entries().find(row => row.options.id === (isolated ? 'isolated-jev' : 'jev'))!
  const previous = entry.fiber!
  await entry.update({ disabled: true })
  await previous.dispose()
  expect(entry.ctx.get('jev')).toBeUndefined()
  if (isolated) {
    expect(ctx.get('jev')).toBeDefined()
    expect(observedAvailability).toEqual([])
    expect(ctx.continuumMemory.state().enabled).toBe(true)
  } else {
    expect(ctx.get('jev')).toBeUndefined()
    expect(observedAvailability).toContain(false)
    expect(ctx.continuumMemory.state()).toEqual({ enabled: false, mode: 'off', reason: 'reflex-required' })
  }
  if (change === 'unload-remount') {
    await entry.update({ disabled: false })
    await entry.fiber!.await()
    expect(ctx.get('jev')).toBeDefined()
    expect(ctx.continuumMemory.state().enabled).toBe(true)
  }
  expect(memoryEntry.fiber!.uid).toBe(memoryUid)
  released.resolve({ mode: 'active', selectedIds, baselineIds: selectedIds, outcome: 'jev' })
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  const recall = adapter.requests[1]!.messages.filter(message => message.source?.kind === 'continuum-memory')
  if (isolated) {
    expect(recall).toHaveLength(1)
    expect(controller.isCurrent(ticket)).toBe(true)
  } else {
    expect(recall).toEqual([])
    expect(controller.isCurrent(ticket)).toBe(false)
  }
  agent.followup(user('Recall the release code once more.'))
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(3)
  const nextRecall = adapter.requests[2]!.messages.filter(message => message.source?.kind === 'continuum-memory')
  if (change === 'unload') expect(nextRecall).toEqual([])
  else {
    expect(nextRecall.some(message => message.source?.kind === 'continuum-memory'
      && selectedIds.every(id => message.source.kind === 'continuum-memory' && message.source.recordIds.includes(id))
      && message.content.some(block => block.type === 'text' && block.text.includes('The release code is MERIDIAN-731.')))).toBe(true)
  }
  expect(agent.session.snapshotEvents().some(event => event.type === 'continuum/memory-record'
    && selectedIds.includes(String(event.data.record.id)))).toBe(true)
})
