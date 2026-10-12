import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ContinuumSettingsController } from '../src/client/continuum-settings-controller.ts'

function acceptWrites(host: StubConfigForm<{ enabled?: boolean }>): void {
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...host.scope.getSnapshot().value }
    for (const op of ops) if (op.op === 'set' && op.path[0] === 'enabled') value.enabled = op.value === true
    host.publish({ status: 'ready', writable: true, value })
    return Promise.resolve(true)
  })
}

describe('ContinuumSettingsController', () => {
  it('writes the Reflex switch through the served Host namespace', async () => {
    const host = stubConfigForm<{ enabled?: boolean }>()
    acceptWrites(host)
    host.publish({ status: 'ready', writable: true, value: { enabled: false } })
    const controller = new ContinuumSettingsController(host.scope)
    await controller.setEnabled(true)
    expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enabled'], value: true }], undefined)
    expect(controller.inject().hooks.continuumSettings.getSnapshot()).toMatchObject({ available: true, enabled: true, failed: false })
    controller.dispose()
  })

  it('does not write when the namespace is read-only and reports rejected writes', async () => {
    const host = stubConfigForm<{ enabled?: boolean }>()
    host.publish({ status: 'ready', writable: false, value: { enabled: false } })
    const controller = new ContinuumSettingsController(host.scope)
    await controller.setEnabled(true)
    expect(host.mutate).not.toHaveBeenCalled()
    expect(controller.inject().hooks.continuumSettings.getSnapshot().writable).toBe(false)
    controller.dispose()

    const accepted = stubConfigForm<{ enabled?: boolean }>()
    accepted.publish({ status: 'ready', writable: true, value: { enabled: false } })
    accepted.mutate.mockRejectedValue(new Error('write failed'))
    const failed = new ContinuumSettingsController(accepted.scope)
    await failed.setEnabled(true)
    await vi.waitFor(() => { expect(failed.inject().hooks.continuumSettings.getSnapshot().failed).toBe(true) })
    failed.dispose()
  })
})
