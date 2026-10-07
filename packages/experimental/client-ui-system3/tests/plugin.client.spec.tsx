// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, TestSessions, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { System3Dock, type System3Actions } from '../src/client/System3Dock.tsx'
import { zh } from '../src/client/locales.ts'

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
  new TestRemote(ctx, { session: { resetModelSelection, cancel } })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({ name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' }, 'conversation.chat.turnHead': { kind: 'list', scope: 'session' } } } as never, () => null)
  const fiber = ctx.plugin({ inject, apply }); await fiber.await()
  const entry = ctx.slots.entries('conversation.input.dock')[0]!
  expect(ctx.slots.entries('conversation.chat.turnHead')).toHaveLength(1)
  const actions = entry.inject!('root' as never)
  const onAutomatic = actions.onAutomatic as System3Actions['onAutomatic']
  const onStop = actions.onStop as System3Actions['onStop']
  expect(actions.available).toBe(true)
  await onAutomatic()
  expect(resetModelSelection).toHaveBeenCalledWith({ sessionId: 'root' })
  await onStop()
  expect(cancel).toHaveBeenCalledWith({ sessionId: 'root' })
  reject = true
  await expect(onAutomatic()).rejects.toBe(failure)
  await expect(onStop()).rejects.toBe(failure)
  await fiber.dispose()
  expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
  expect(ctx.slots.entries('conversation.chat.turnHead')).toHaveLength(0)
  expect(() => { hostApply() }).not.toThrow()
})
it('subscribes the dock to pending input and restored native projections', () => {
  const snapshot: SessionSnapshot = { sessionId: 'root' as SessionId, pendingSubmissions: [], running: false,
    subagent: null, removed: false, openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: true, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: true }
  const props: Parameters<typeof System3Dock>[0] = { sessionId: snapshot.sessionId,
    useSession: select => select(snapshot), useProjection: () => undefined,
    available: true, onAutomatic: () => Promise.resolve(), onStop: () => Promise.resolve(), t: makeTranslate(zh, commonZh) }
  const result = render(<System3Dock {...props} />)
  expect(screen.getByRole('status').textContent).toBe('已接收，正在准备')
  result.rerender(<System3Dock {...props} useSession={select => select({ ...snapshot, openState: 'loading' })} />)
  expect(screen.getByRole('status').textContent).toBe('正在恢复记录')
})
