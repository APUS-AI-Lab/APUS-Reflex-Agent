/** Built Web RPC persistence receipts survive an ungraceful process exit before model admission. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionPromptValue } from '@deepseek-ai/dsh-api-session-controller/types'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { expect, it } from 'vitest'
import type { TestContext } from 'vitest'
import { webGet, webRequest } from './default-web-process.ts'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
async function launchWeb(test: TestContext, root: string, patch: string) {
  const launch = resolveExampleLaunch({
    srcBin: join(repoRoot, 'apps/cli/src/bin.ts'), mode: 'lib',
    configArgs: ['--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'],
    env: { NODE_OPTIONS: undefined, NODE_PATH: undefined, TSX_TSCONFIG_PATH: undefined,
      DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, '.agents'), DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: 'keyless-input-no-call', NODE_NO_WARNINGS: '1' },
  })
  const child = spawn(launch.command, ['--no-experimental-strip-types', ...launch.args], {
    cwd: root, env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  const completion = Promise.withResolvers<NodeJS.Signals | null>()
  let exited = false
  child.once('error', (error) => { exited = true; completion.reject(error) })
  child.once('close', (_code, signal) => { exited = true; completion.resolve(signal) })
  const kill = async () => {
    if (!exited) child.kill('SIGKILL')
    return completion.promise
  }
  test.onTestFinished(async () => { await kill() })
  await expect.poll(() => {
    if (exited) throw new Error(`Web exited before readiness\n${stdout}\n${stderr}`)
    return /dsh web: (http:\/\/[^\s]+)/u.exec(stdout)?.[1]
  }, { timeout: 30_000 }).toBeDefined()
  const url = /dsh web: (http:\/\/[^\s]+)/u.exec(stdout)![1]!
  const auth = await webGet(url, test.signal)
  const cookie = auth.headers['set-cookie']?.[0]?.split(';', 1)[0]
  expect(cookie, auth.text).toBeDefined()
  const rpc = async (method: string, request: object) => {
    const rpcId = randomUUID()
    const response = await webRequest(new URL(`/api/${method}`, url), test.signal, {
      method: 'POST', headers: { cookie: cookie!, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { request } } }),
    })
    expect(response.status, response.text).toBe(200)
    const envelope = JSON.parse(response.text) as {
      type?: string
      rpcId?: string
      result: { ok: boolean; value?: SessionPromptValue; error?: { code: string } }
    }
    expect(envelope).toMatchObject({ type: 'server-response', rpcId })
    return envelope.result
  }
  return { rpc, kill }
}

async function readEvents(storage: string, sessionId: SessionId) {
  const reader = new Context()
  try {
    await reader.plugin(JsonlSessionPersistence, { root: storage, compression: 'none' })
    const handle = await reader.sessionPersistence.open(sessionId, 'read')
    try { return (await handle.read()).events } finally { await handle.close() }
  } finally { await reader.fiber.dispose() }
}

it('confirms saved over Web RPC, survives SIGKILL, and deduplicates late retry on the restarted profile', { timeout: 120_000, retry: 0 }, async (test) => {
  const root = await mkdtemp(join(tmpdir(), 'apus-input-receipt-web-'))
  test.onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const storage = join(root, 'sessions')
  const patch = join(root, 'receipt.patch.yml')
  await writeFile(patch, JSON.stringify([
    { id: 'session-persistence-jsonl', config: { root: storage, compression: 'none' } },
    { insert: [{ id: 'block-input-step', name: new URL('./fixtures/block-input-step.mjs', import.meta.url).href }] },
  ]))
  const first = await launchWeb(test, root, patch)
  const sessionId = SessionId('saved-web-input')
  expect(await first.rpc('session/create', { sessionId, cwd: root })).toMatchObject({ ok: true, value: { sessionId } })
  const text = '  exact 😀\r\n输入\n'.repeat(8192) + ' trailing  '
  const request = { sessionId, requestId: 'saved-request', mode: 'queue', content: [{ type: 'text', text }] }
  const saved = await first.rpc('session/prompt', request)
  expect(saved).toMatchObject({ ok: true, value: { accepted: true, storage: { state: 'saved', source: { sessionId } } } })
  expect(typeof saved.value?.storage?.messageId).toBe('string')
  expect(Number.isSafeInteger(saved.value?.storage?.source?.eventSeq)).toBe(true)
  expect(await first.kill()).toBe('SIGKILL')

  const events = await readEvents(storage, sessionId)
  expect(events.some(event => event.type === 'user/message')).toBe(false)
  const source = events.find(event => event.seq === saved.value!.storage!.source!.eventSeq)
  expect(source).toMatchObject({
    type: 'agent/inbox/spliced', data: { inserted: [{ id: saved.value!.storage!.messageId, content: request.content }] },
  })

  const second = await launchWeb(test, root, patch)
  expect(await second.rpc('session/prompt', request)).toEqual(saved)
  expect(await second.rpc('session/prompt', { ...request, content: [{ type: 'text', text: 'changed' }] }))
    .toMatchObject({ ok: false, error: { code: 'session/request-conflict' } })
  expect(await second.kill()).toBe('SIGKILL')
  const restored = await readEvents(storage, sessionId)
  const inserted = restored.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
  expect(inserted).toHaveLength(1)
  expect(inserted[0]?.content).toEqual(request.content)
})
