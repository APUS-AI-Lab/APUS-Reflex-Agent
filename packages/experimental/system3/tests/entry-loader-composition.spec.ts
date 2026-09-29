/** Real Loader composition with external HTTP fixtures and JSONL receipt replay. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import System3 from '../src/index.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import type { SessionRequestId } from '../../../api/session-controller/src/types.ts'

let root: string | undefined
let context: Context | undefined
let server: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (server !== undefined) {
    const current = server
    await new Promise<void>((resolve, reject) => current.close((error) => {
      if (error) reject(error)
      else resolve()
    }))
  }
  server = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

it('routes an API prompt through Loader-mounted Jev and records the actual HTTP model', { timeout: 60_000 }, async () => {
  vi.stubEnv('SYSTEM3_COMPOSITION_LLM_KEY', 'external-http-fixture')
  const requests: { path: string; body: Record<string, unknown> }[] = []
  let jevRequests = 0
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      const path = request.url ?? ''
      requests.push({ path, body: JSON.parse(body) as Record<string, unknown> })
      if (path === '/v1/systemone') {
        jevRequests += 1
        if (jevRequests === 2) {
          response.writeHead(503, { 'content-type': 'application/json' })
          response.end('{"error":"external fixture unavailable"}')
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          model: 'APUS-OpenJev-fixture',
          answers: { route: { type: 'choice', choice: 'expert', confidence: 0.95, probabilities: { expert: 0.95, abstain: 0.05 } } },
          usage: { prompt_tokens: 8, completion_tokens: 1 },
        }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of [
        '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
        '{"choices":[{"delta":{"content":"entry routed answer"},"index":0,"finish_reason":null}]}',
        '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
        '[DONE]',
      ]) response.write(`data: ${event}\n\n`)
      response.end()
    })
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture has no TCP port')
  const endpoint = `http://127.0.0.1:${address.port}`

  root = await mkdtemp(join(tmpdir(), 'dsh-system3-composition-'))
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
    ['@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin', Jev],
    ['@deepseek-ai/dsh-experimental-system3', System3],
    ['fixture-api-host', {
      inject: ['agents', 'sessions', 'sessionProjections', 'llm'],
      apply(host: Context) {
        host.provide('workspaceRegistry', { get: () => undefined, list: () => [], archivedSessionIds: [] } as never)
        createSessionTestController(host, {
          cwd: root!, defaultModelSelection: () => ({ provider: 'fidoo-fixture', model: 'deepseek-v4-flash' }),
        })
      },
    }],
  ])
  await writeFile(configPath, [...modules.keys()].flatMap(name => [
    `- name: '${name}'`,
    ...name === '@deepseek-ai/dsh-session-persistence-jsonl' ? [
      '  config:', `    root: ${JSON.stringify(join(root!, 'sessions'))}`, '    compression: none',
    ] : [],
    ...name === '@deepseek-ai/dsh-llm-pi-ai' ? [
      '  config:', '    providers:', '      fidoo-fixture:',
      '        api: openai-completions', `        baseURL: ${endpoint}/v1`,
      '        apiKeyEnv: SYSTEM3_COMPOSITION_LLM_KEY', '        models:',
      '          - id: deepseek-v4-flash', '            contextWindow: 128000', '            maxTokens: 4096', '            input: [text]',
      '          - id: expert-fixture', '            contextWindow: 128000', '            maxTokens: 4096', '            input: [text]',
    ] : [],
    ...name === '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin' ? [
      '  config:', `    endpoint: ${endpoint}`, '    model: APUS-OpenJev-fixture', '    effort: low', '    timeoutMs: 2000',
    ] : [],
    ...name === '@deepseek-ai/dsh-experimental-system3' ? [
      '  config:', '    privacyMode: local-only', '    jevExecutionDomain: local', '    observeAgentLoop: true',
      '    entryRouting:', '      minConfidence: 0.5', '      maxInputBytes: 16000', '      sessionDataClasses: [public]',
      '      candidates:', '        - id: expert', '          description: Specialized reasoning',
      '          provider: fidoo-fixture', '          model: expert-fixture', '          executionDomain: local', '          dataClasses: [public]',
    ] : [],
  ]).join('\n') + '\n')
  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const internal: ModuleLoaderV2 = {
    version: 'v2', loadCache: new Map(),
    import: async (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])

  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error instanceof Error ? error.stack : error) })
  const id = SessionId('system3-entry-loader')
  const agent = await ctx.agentLoop.create(id, { provider: 'fidoo-fixture', model: 'deepseek-v4-flash' })
  await ctx.sessionController.prompt({ sessionId: id, requestId: 'entry-first' as SessionRequestId,
    content: [{ type: 'text', text: 'Check this reasoning problem' }], mode: 'queue' }, new AbortController().signal)
  await agent.whenIdle()
  await ctx.sessionController.prompt({ sessionId: id, requestId: 'entry-second' as SessionRequestId,
    content: [{ type: 'text', text: 'Check a second problem' }], mode: 'queue' }, new AbortController().signal)
  await agent.whenIdle()
  await ctx.sessions.flush(agent.session)
  expect(errors).toEqual([])
  const generation = requests.filter(request => request.path === '/v1/chat/completions')
  expect(generation.map(request => request.body.model)).toEqual(['expert-fixture', 'deepseek-v4-flash'])
  expect(jevRequests).toBe(2)
  const events = agent.session.snapshotEvents()
  const recommendations = events.flatMap(event => event.type === 'system3/entry-decision' ? [event.data] : [])
  expect(recommendations).toHaveLength(2)
  expect(events.filter(event => event.type === 'model/automatic-selection').map(event => event.data)).toMatchObject([
    { requestId: 'entry-first', selection: { model: 'expert-fixture' }, baseline: { model: 'deepseek-v4-flash' } },
    { requestId: 'entry-second', selection: { model: 'deepseek-v4-flash' }, baseline: { model: 'deepseek-v4-flash' } },
  ])
  expect(events.flatMap(event => event.type === 'request/header' ? [event.data.header.config.model] : []))
    .toEqual(['expert-fixture', 'deepseek-v4-flash'])
  expect(JSON.stringify(generation)).not.toContain('probabilities')
  const stored = await ctx.sessionPersistence.open(id, 'read')
  const persisted = await stored.read()
  const restored = Session.fromRestore(id, persisted.events, stored.header, stored.inheritedEventCount, persisted.eventState)
  await stored.close()
  const count = requests.length
  expect(restored.deriveMessages()).toEqual(agent.session.deriveMessages())
  expect(persisted.events.filter(event => event.type === 'system3/entry-decision').map(event => event.data)).toEqual(recommendations)
  expect(ctx.sessionProjections.stateOf(restored, 'modelSelection')?.automaticBaseline?.model).toBe('deepseek-v4-flash')
  expect(requests).toHaveLength(count)
})
