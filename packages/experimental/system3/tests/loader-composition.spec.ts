/** Real Loader composition with external HTTP fixtures and JSONL receipt replay. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import System3, { type System3DecisionRequest } from '../src/index.ts'

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

const input: System3DecisionRequest = {
  dataClasses: ['public'],
  supervisor: {
    currentGoalRevision: 'g1',
    advice: { action: 'continue', goalRevision: 'g1', evidenceRefs: [] },
    requiredChecks: [], availableEvidenceRefs: [], budgetRemaining: 1,
  },
  turn: 1, step: 1,
}

it('loads Jev beside the unchanged main route and replays persisted shadow receipts without HTTP', { timeout: 60_000 }, async () => {
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
          answers: { action: { type: 'choice', choice: 'candidate_done', confidence: 0.9,
            probabilities: { continue: 0.025, retry: 0.025, escalate: 0.025, candidate_done: 0.9, unknown: 0.025 } } },
          usage: { prompt_tokens: 8, completion_tokens: 1 },
        }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of [
        '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
        '{"choices":[{"delta":{"content":"main route unchanged"},"index":0,"finish_reason":null}]}',
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
    ] : [],
    ...name === '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin' ? [
      '  config:', `    endpoint: ${endpoint}`, '    model: APUS-OpenJev-fixture', '    effort: low', '    timeoutMs: 2000',
    ] : [],
    ...name === '@deepseek-ai/dsh-experimental-system3' ? [
      '  config:', '    privacyMode: local-only', '    jevExecutionDomain: local', '    observeAgentLoop: true',
      '    processSupervision:', '      mode: advise', '      repeatedError: 2', '      failedAttempts: 3', '      stalledSteps: 6',
      '      delegateFailures: 3', '      editTools: [edit]', '      delegationTools: []', '      shellTools: [bash]',
      "      verifyPattern: '\\bnpm test\\b'",
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

  const id = SessionId('system3-loader-replay')
  const agent = await ctx.agentLoop.create(id, { provider: 'fidoo-fixture', model: 'deepseek-v4-flash' })
  const first = await ctx.system3.shadowDecision(agent.session, input)
  expect(first.baseline.action).toBe('continue')
  expect(first.advice).toBe('candidate_done')
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run one bounded step' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const second = await ctx.system3.shadowDecision(agent.session, input)
  expect(second.outcome).toEqual({ kind: 'unknown', code: 'http', status: 503 })
  await ctx.sessions.flush(agent.session)

  const main = requests.filter(request => request.path === '/v1/chat/completions')
  expect(main).toHaveLength(1)
  expect(main[0]?.body.model).toBe('deepseek-v4-flash')
  expect(JSON.stringify(main[0]?.body)).not.toContain('currentGoalRevision')
  expect(JSON.stringify(main[0]?.body)).not.toContain('candidate_done')
  expect(requests.filter(request => request.path === '/v1/systemone')).toHaveLength(2)
  expect(requests[0]?.body).toMatchObject({ model: 'APUS-OpenJev-fixture', effort: 'low', state: input.supervisor })
  expect(first.request).toEqual(requests[0]?.body)
  expect(agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'main route unchanged' }])

  const stored = await ctx.sessionPersistence.open(id, 'read')
  const persisted = await stored.read()
  expect(JSON.stringify(persisted.events)).not.toContain('external-http-fixture')
  expect(JSON.stringify(persisted.events)).not.toContain('external fixture unavailable')
  const restored = Session.fromRestore(id, persisted.events, stored.header, stored.inheritedEventCount, persisted.eventState)
  await stored.close()
  const receiptCount = requests.length
  // A text-only turn changes nothing, so supervision leaves no finding and adds nothing to the main request.
  expect(persisted.events.filter(event => event.type === 'system3/process-notice')).toEqual([])
  expect(JSON.stringify(main[0]?.body)).not.toContain('System3 过程监督')
  const replayed = persisted.events.flatMap(event => event.type === 'system3/decision' ? [event.data] : [])
  expect(replayed).toEqual([first, second])
  expect(ctx.system3.lastDecision(restored)).toEqual(second)
  expect(requests).toHaveLength(receiptCount)
  expect(restored.deriveMessages()).toEqual(agent.session.deriveMessages())
  const snapshot = replayed.map(({ id: _id, elapsedMs: _elapsedMs, ...receipt }) => receipt)
  expect(snapshot).toEqual(JSON.parse(await readFile(new URL('./fixtures/shadow-receipts.expected.json', import.meta.url), 'utf8')))
})
