/** Public bundle configuration through the real startup loader and a recording HTTP endpoint. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import Jev from '../src/index.ts'

beforeEach(() => {
  for (const key of ['JEV_ENDPOINT', 'JEV_MODEL', 'JEV_API_KEY', 'JEV_API_KEY_ENV']) vi.stubEnv(key, undefined)
})
afterEach(() => { vi.unstubAllEnvs() })

async function start(override?: { disabled?: boolean; config?: Record<string, unknown> }) {
  const root = mkdtempSync(join(tmpdir(), 'jev-public-bundle-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const path = join(root, 'cordis.yml')
  writeFileSync(path, '[]\n')
  const patches = loadOptionalPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))) ?? []
  // Resolve the shipped plugin name to its source without changing shipped settings or expressions.
  for (const patch of patches) for (const entry of patch.insert ?? []) entry.name = 'cordis:jev'
  const ctx = await boot('test', path, [...patches, ...override === undefined ? [] : [{ id: 'jev', ...override }]], (ctx) => {
    ctx.loader.builtins.jev = Jev
  })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return ctx
}

it.each([undefined, '', '   '])('keeps first-run Reflex settings available when both fields are %j', async (value) => {
  vi.stubEnv('JEV_ENDPOINT', value)
  vi.stubEnv('JEV_MODEL', value)
  const ctx = await start()
  expect(ctx.jev.readStatus().provider).toBeNull()
  expect(ctx.jev.listProviders()).toEqual([])
  expect([...ctx.loader.entries()].find(entry => entry.options.id === 'jev')?.disabled).toBe(false)
  await expect(ctx.jev.decide({ state: null, questions: { q: { type: 'noul' } } })).rejects.toThrow('Jev is not configured')
  expect(await ctx.jev.warm()).toBe(false)
})

it.each([
  ['http://127.0.0.1:1', undefined], [undefined, 'fixture'],
  ['http://127.0.0.1:1', ' '], [' ', 'fixture'], ['ftp://invalid.test', 'fixture'],
])('rejects incomplete or malformed enabled configuration', async (endpoint, model) => {
  vi.stubEnv('JEV_ENDPOINT', endpoint)
  vi.stubEnv('JEV_MODEL', model)
  await expect(start()).rejects.toThrow()
})

it.each([undefined, false])('preserves a user provider with disabled=%j and no deployment environment', async (disabled) => {
  const ctx = await start({ ...disabled === undefined ? {} : { disabled }, config: { endpoint: 'http://127.0.0.1:1', model: 'user-model' } })
  expect(ctx.jev.readStatus().provider).toMatchObject({ endpoint: 'http://127.0.0.1:1', model: 'user-model' })
})

it('honors explicit disable even with a configured user provider', async () => {
  const ctx = await start({ disabled: true, config: { endpoint: 'http://127.0.0.1:1', model: 'user-model' } })
  expect(ctx.get('jev')).toBeUndefined()
})

it('resolves user profile expressions before deciding whether Reflex is enabled', async () => {
  const ctx = await start({ config: { endpoint: { __jsExpr: '"http://127.0.0.1:1"' }, model: { __jsExpr: '"user-model"' } } })
  expect(ctx.jev.readStatus().provider).toMatchObject({ endpoint: 'http://127.0.0.1:1', model: 'user-model' })
})

it.each(['anonymous', 'authenticated', 'missing-credential'] as const)('dispatches only the configured model and credentials: %s', async (mode) => {
  const requests: { path: string | undefined; auth: string | undefined; body: Record<string, unknown> }[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push({ path: request.url, auth: request.headers.authorization, body: JSON.parse(body) as Record<string, unknown> })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: 'user-reflex', answers: { decision: { type: 'choice', choice: 'keep', probabilities: { keep: 1 }, confidence: 1 } } }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind')
  vi.stubEnv('JEV_ENDPOINT', ` http://127.0.0.1:${address.port} `)
  vi.stubEnv('JEV_MODEL', ' user-reflex ')
  if (mode === 'authenticated') vi.stubEnv('JEV_API_KEY', 'public-test-fixture-key')
  if (mode === 'missing-credential') vi.stubEnv('JEV_API_KEY_ENV', 'JEV_PUBLIC_TEST_MISSING_KEY')
  vi.stubEnv('JEV_PUBLIC_TEST_MISSING_KEY', undefined)
  const ctx = await start()
  expect(requests).toHaveLength(0)
  const outcome = await ctx.jev.decide({ state: { publicFixture: true }, questions: { decision: { type: 'choice', criteria: { keep: 'Keep' } } } })
  if (mode === 'missing-credential') {
    expect(outcome).toMatchObject({ kind: 'unknown', failure: { code: 'missing-credential' } })
    expect(requests).toHaveLength(0)
  } else {
    expect(outcome.kind).toBe('ok')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: '/v1/systemone', body: { model: 'user-reflex', effort: 'high' } })
    expect(requests[0]?.auth).toBe(mode === 'authenticated' ? 'Bearer public-test-fixture-key' : undefined)
  }
})
