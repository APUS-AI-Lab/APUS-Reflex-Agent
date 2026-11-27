/**
 * C09A: TypeScript SDK client exposure of recorded dispatch facts and
 * read-only request views. The client only transports the runtime's answer;
 * it never reconstructs a projection of its own.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { SDK_REQUEST_VIEW_CAPABILITY } from '@deepseek-ai/dsh-sdk-protocol'
import {
  DeepSeekHarness,
  JsonRpcResponseError,
} from '../src/index.ts'
import { createProcessDeepSeekHarness } from '../src/api.ts'
import type { RuntimeProcessOptions } from '../src/launch.ts'

const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function fakeLaunch(env: Record<string, string> = {}): RuntimeProcessOptions {
  return {
    command: process.execPath,
    args: [fakeRuntime],
    environment: () => ({ ...process.env as Record<string, string>, ...env }),
    description: 'scripted fake runtime',
    initializeTimeoutMs: 5_000,
  }
}

function harnessWith(env: Record<string, string> = {}): DeepSeekHarness {
  const harness = createProcessDeepSeekHarness(fakeLaunch(env))
  cleanups.push(() => harness.close())
  return harness
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const SCRIPTED_VIEW = {
  sessionId: 's',
  dispatchSeq: 4,
  prefixEnd: 9,
  turn: 1,
  step: 1,
  header: { config: { provider: 'p', model: 'm' } },
  messages: [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }],
  toolHistory: { tools: [], updates: [] },
  projectionTypes: ['image/offload'],
}

describe('SDK client request views', () => {
  it('reports the request-view capability from the handshake', async () => {
    const dir = await tempDir('dsh-client-capability-')
    const script = join(dir, 'views.json')
    await writeFile(script, JSON.stringify({ dispatches: {}, views: {} }))
    const harness = harnessWith({ FAKE_REQUEST_VIEW: script })
    await harness.start()
    expect(harness.capabilities).toContain(SDK_REQUEST_VIEW_CAPABILITY)
  })

  it('reports no capability against a runtime that omits it', async () => {
    const harness = harnessWith()
    await harness.start()
    expect(harness.capabilities).toEqual([])
  })

  it('lists recorded dispatches and fetches one request view verbatim', async () => {
    const dir = await tempDir('dsh-client-views-')
    const script = join(dir, 'views.json')
    await writeFile(script, JSON.stringify({
      dispatches: { s: [{ dispatchSeq: 4, prefixEnd: 9, turn: 1, step: 1, settlementSeq: 12 }] },
      views: { 's:4': SCRIPTED_VIEW },
    }))
    const harness = harnessWith({ FAKE_REQUEST_VIEW: script })
    await harness.start()

    const dispatches = await harness.client.dispatches('s')
    expect(dispatches).toEqual({
      sessionId: 's',
      dispatches: [{ dispatchSeq: 4, prefixEnd: 9, turn: 1, step: 1, settlementSeq: 12 }],
    })

    const view = await harness.client.requestView('s', 4)
    expect(view).toEqual(SCRIPTED_VIEW)
    // The client transports the runtime's projection list; it never computes one.
    expect(view.projectionTypes).toEqual(['image/offload'])
  })

  it('surfaces a typed unsupported-projection refusal instead of approximating', async () => {
    const dir = await tempDir('dsh-client-refusal-')
    const script = join(dir, 'views.json')
    await writeFile(script, JSON.stringify({ dispatches: {}, views: {} }))
    const harness = harnessWith({ FAKE_REQUEST_VIEW: script })
    await harness.start()

    const failure = await harness.client.requestView('s', 4).then(
      () => { throw new Error('request view unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(JsonRpcResponseError)
    expect(failure).toMatchObject({ data: { code: 'DISPATCH_NOT_FOUND' } })
  })

  it('refuses both methods by name against a runtime without the capability', async () => {
    const harness = harnessWith()
    await harness.start()
    await expect(harness.client.dispatches('s')).rejects.toThrow(/session\/dispatches/)
    await expect(harness.client.requestView('s', 0)).rejects.toThrow(/session\/request-view/)
  })

  it('rejects malformed dispatchSeq values before sending', async () => {
    const dir = await tempDir('dsh-client-params-')
    const script = join(dir, 'views.json')
    await writeFile(script, JSON.stringify({ dispatches: {}, views: {} }))
    const harness = harnessWith({ FAKE_REQUEST_VIEW: script })
    await harness.start()
    for (const dispatchSeq of [-1, 1.5, Number.NaN]) {
      await expect(harness.client.requestView('s', dispatchSeq)).rejects.toThrow(/dispatchSeq/)
    }
    await expect(harness.client.requestView('', 0)).rejects.toThrow(/sessionId/)
  })
})
