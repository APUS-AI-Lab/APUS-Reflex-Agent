import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-remote'
import { RemoteBashExecutor } from '../src/index.ts'
import { processService } from '../../../subprocess/subprocess-remote/tests/process-service.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop() })

async function fixture() {
  const service = await processService()
  cleanup.push(() => service.close())
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(RemoteSubprocessRuntime, {
    endpoint: service.endpoint, pollIntervalMs: 5, requestTimeoutMs: 500, maxRecoveryMs: 1000,
  })
  await ctx.plugin(RemoteBashExecutor, { cwd: process.cwd(), timeoutMs: 1000, maxTimeoutMs: 5000, graceMs: 100 })
  return { service, ctx, bash: ctx.shell as RemoteBashExecutor }
}

describe.skipIf(process.platform === 'win32')('remote Bash over native execution handles', () => {
  it('keeps complete stdout, stderr and a nonzero command exit', async () => {
    const { bash, service } = await fixture()
    const execution = await bash.execute(bash.resolve({ command: 'printf out; printf err >&2; exit 3', agentId: 'case-shell' }))
    const result = await execution.result()
    expect(result.exitCode).toBe(3)
    expect(result.stdout.text).toBe('out')
    expect(result.stderr.text).toBe('err')
    expect(service.requests.filter(r => r.body.op === 'spawn')).toHaveLength(1)
    expect(service.requests[0]!.path).toBe('/jobs/by-session/case-shell/process')
  })

  it('supports native background execution and a real kill handle', async () => {
    const { bash } = await fixture()
    const execution = await bash.execute(bash.resolve({
      command: 'printf started; exec sleep 60', agentId: 'case-background', onExpiry: 'none',
    }))
    expect(execution.status).toBe('running')
    expect(execution.kill()).toBe(true)
    await execution.done
    expect(execution.status).toBe('killed')
    expect(execution.kill()).toBe(false)
    expect((await execution.result()).aborted).toBe(false)
  })

  it('retains caller timeout classification instead of timing out a whole task', async () => {
    const { bash } = await fixture()
    const execution = await bash.execute(bash.resolve({
      command: 'exec sleep 60', agentId: 'case-timeout', timeoutMs: 30,
    }))
    const result = await execution.result()
    expect(result.timedOut).toBe(true)
    expect(result.aborted).toBe(false)
  })

  it('passes explicit environment and batch stdin through the native executor', async () => {
    const { bash } = await fixture()
    const execution = await bash.execute(bash.resolve({
      command: 'cat; printf "$REMOTE_TEST"', agentId: 'case-input', stdin: 'hello ', env: { REMOTE_TEST: '中文🙂' },
    }))
    expect((await execution.result()).stdout.text).toBe('hello 中文🙂')
  })

  it('requires the owning agent before resolving a command', async () => {
    const { bash, service } = await fixture()
    expect(() => bash.resolve({ command: 'pwd' })).toThrow(/names no agent/)
    expect(service.requests).toEqual([])
  })
})
