// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, TestSessions, makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { mountSystem3, inject } from '../src/client/mount.ts'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { apply as hostApply } from '../src/index.ts'
import { System3Dock, type System3Actions } from '../src/client/System3Dock.tsx'
import { zh } from '../src/client/locales.ts'

const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin', descriptors: [] }
afterEach(cleanup)
it('registers and disposes the native dock and calls the live Session reset RPC', async () => {
  const ctx = new Context()
  const sessions = new TestSessions(async (action) => { await action() }, ctx)
  onTestFinished(async () => { await sessions.disposeScopes(); await ctx.fiber.dispose() })
  await sessions.add({ id: 'root' }); ctx.provide('sessions', sessions)
  const failure = new Error('offline')
  let reject = false
  const resetModelSelection = vi.fn(() => Promise.resolve(reject
    ? { ok: false, error: failure } : { ok: true, value: { selected: { provider: 'fidoo', model: 'generation' } } }))
  const cancel = vi.fn(() => Promise.resolve(reject ? { ok: false, error: failure } : { ok: true, value: { accepted: true } }))
  const steerByParent = vi.fn(() => Promise.resolve(reject ? { ok: false, error: failure } : { ok: true, value: { accepted: true } }))
  const remote = new TestRemote(ctx, { session: { resetModelSelection, cancel }, subagents: { steerByParent },
    reflex: { readStatus: async () => ({ ok: true, value: { capabilities: [] } }) },
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  const unmount = vi.fn(async () => {})
  const mount = vi.spyOn(remote, '$mount').mockResolvedValue(unmount)
  const configForm = stubConfigForm()
  ctx.provide('configForms', { get: () => configForm.scope } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' }, 'conversation.input.dock': { kind: 'list', scope: 'session' }, 'conversation.chat.turnHead': { kind: 'list', scope: 'session' }, 'conversation.input.right': { kind: 'list', scope: 'session' } } } as never, () => null)
  const fiber = ctx.plugin({ inject, apply: (ctx: Context) => mountSystem3(ctx, contribution) }); await fiber.await()
  const entry = ctx.slots.entries('conversation.input.dock')[0]!
  expect(ctx.slots.entries('conversation.chat.turnHead')).toHaveLength(1)
  expect(ctx.slots.entries('conversation.input.right')).toHaveLength(1)
  expect(ctx.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['reflex-model'])
  const settings = ctx.slots.entries('settings.section')[0]!
  expect(typeof settings.options.label === 'function' ? settings.options.label() : settings.options.label).toBe('Reflex model configuration')
  expect(settings.inject!()).toHaveProperty('refresh')
  remote.emit('credentials/reference-updated', ['REFLEX_API_KEY'])
  const actions = entry.inject!('root' as never)
  const onAutomatic = actions.onAutomatic as System3Actions['onAutomatic']
  const onStop = actions.onStop as System3Actions['onStop']
  const onSteer = actions.onSteer as System3Actions['onSteer']
  expect(actions.available).toBe(true)
  await onAutomatic()
  expect(resetModelSelection).toHaveBeenCalledWith({ sessionId: 'root' })
  await onStop()
  expect(cancel).toHaveBeenCalledWith({ sessionId: 'root' })
  await onSteer('run-1', 'skip the README')
  expect(steerByParent).toHaveBeenCalledWith({ runId: 'run-1', parentSessionId: 'root', text: 'skip the README' })
  reject = true
  await expect(onAutomatic()).rejects.toBe(failure)
  await expect(onStop()).rejects.toBe(failure)
  await expect(onSteer('run-1', 'again')).rejects.toBe(failure)
  await fiber.dispose()
  expect(mount).toHaveBeenCalledWith(contribution)
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(ctx.slots.entries('settings.section')).toHaveLength(0)
  expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
  expect(ctx.slots.entries('conversation.chat.turnHead')).toHaveLength(0)
  expect(ctx.slots.entries('conversation.input.right')).toHaveLength(0)
  expect(() => { hostApply() }).not.toThrow()
})
it('subscribes the dock to pending input and restored native projections', () => {
  const snapshot: SessionSnapshot = { sessionId: 'root' as SessionId, pendingSubmissions: [], running: false,
    subagent: null, removed: false, openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: true, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: true }
  const props: Parameters<typeof System3Dock>[0] = { sessionId: snapshot.sessionId,
    useSession: select => select(snapshot), useProjection: () => undefined,
    available: true, onAutomatic: () => Promise.resolve(), onStop: () => Promise.resolve(), onSteer: () => Promise.resolve(),
    t: makeTranslate(zh, commonZh) }
  const result = render(<System3Dock {...props} />)
  expect(screen.getByRole('status').textContent).toBe('已接收，正在准备')
  result.rerender(<System3Dock {...props} useSession={select => select({ ...snapshot, openState: 'loading' })} />)
  expect(screen.getByRole('status').textContent).toBe('正在恢复记录')
})

it('does not register UI when the Reflex Remote mount is refused', async () => {
  const ctx = new Context()
  const remote = new TestRemote(ctx, {})
  const failure = new Error('remote unavailable')
  vi.spyOn(remote, '$mount').mockRejectedValueOnce(failure)
  const injectUi = vi.spyOn(ctx, 'inject')
  try {
    await expect(mountSystem3(ctx, contribution)).rejects.toBe(failure)
    expect(injectUi).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('withdraws the mounted Remote when UI registration fails', async () => {
  const ctx = new Context()
  const sessions = new TestSessions(async (action) => { await action() }, ctx)
  ctx.provide('sessions', sessions)
  const remote = new TestRemote(ctx, {
    session: {}, subagents: {}, reflex: {}, credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  const unmount = vi.fn(async () => {})
  vi.spyOn(remote, '$mount').mockResolvedValue(unmount)
  const configForm = stubConfigForm()
  ctx.provide('configForms', { get: () => configForm.scope } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot registration failed') })
  try {
    await expect(mountSystem3(ctx, contribution)).rejects.toThrow('slot registration failed')
    expect(unmount).toHaveBeenCalledTimes(1)
  } finally { await sessions.disposeScopes(); await ctx.fiber.dispose() }
})
