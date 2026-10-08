/** Completion review through Loader, native goal tools, and reopened JSONL Sessions. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { completionRefusal } from '../src/completion-review.ts'
import System3 from '../src/index.ts'

let root: string | undefined
let context: Context | undefined
let server: Server | undefined
let releaseVerification: (() => void) | undefined

afterEach(async () => {
  releaseVerification?.()
  releaseVerification = undefined
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

const OBJECTIVE = '读取 acceptance.txt 并确认内容为 approved'
const REFUSAL = completionRefusal(OBJECTIVE, [])

interface ChatRequest {
  readonly model: string
  readonly messages: readonly { readonly role: string; readonly content: string | null }[]
}

/** Emit one OpenAI-compatible tool call or final answer through the real HTTP adapter. */
function sendAssistant(response: ServerResponse, call?: { readonly id: string; readonly name: string; readonly arguments: object }): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const delta = call === undefined ? { content: 'verified and complete' } : {
    tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }],
  }
  for (const event of [
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: call === undefined ? 'stop' : 'tool_calls' }],
      usage: { prompt_tokens: 3, completion_tokens: 1 } },
  ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
  response.end('data: [DONE]\n\n')
}

it('refuses a native completion until evidence arrives and preserves its decisions when JSONL is reopened', { timeout: 60_000 }, async () => {
  vi.stubEnv('SYSTEM3_COMPLETION_LLM_KEY', 'external-http-fixture')
  root = await mkdtemp(join(tmpdir(), 'dsh-system3-completion-'))
  const workspace = root
  await writeFile(join(workspace, 'acceptance.txt'), 'approved\n')
  const verification = Promise.withResolvers<undefined>()
  const refusalSeen = Promise.withResolvers<undefined>()
  releaseVerification = () => { verification.resolve(undefined) }
  const requests: ChatRequest[] = []
  const fixtureErrors: unknown[] = []
  let jevRequests = 0
  let goal: { readonly id: string; readonly revision: number } | undefined
  server = createServer((request, response) => {
    void (async () => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      if (request.url === '/v1/systemone') {
        const query = JSON.parse(body) as { readonly state: { readonly evidence: string }; readonly questions: Record<string, object> }
        expect(Object.keys(query.questions)).toEqual(['goal'])
        jevRequests += 1
        const readApproved = query.state.evidence.includes('- read: acceptance.txt')
          && query.state.evidence.includes('结果：approved')
        expect(readApproved).toBe(jevRequests === 2)
        expect(query.state.evidence).not.toContain('update_goal')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ model: 'APUS-OpenJev-fixture', answers: { goal: { type: 'noul', noul: readApproved ? 0.9 : 0.1 } } }))
        return
      }
      expect(request.url).toBe('/v1/chat/completions')
      const query = JSON.parse(body) as ChatRequest
      requests.push(query)
      if (requests.length === 1) {
        sendAssistant(response, { id: 'create-goal', name: 'create_goal', arguments: { objective: OBJECTIVE } })
        return
      }
      if (requests.length === 2) {
        const created = query.messages.findLast(message => message.role === 'tool')?.content
        if (typeof created !== 'string') throw new Error('native create_goal did not return its goal')
        goal = (JSON.parse(created) as { readonly goal: { readonly id: string; readonly revision: number } }).goal
        sendAssistant(response, { id: 'premature-completion', name: 'update_goal',
          arguments: { goal_id: goal.id, revision: goal.revision, action: 'complete' } })
        return
      }
      if (requests.length === 3) {
        expect(query.messages.findLast(message => message.role === 'tool')?.content).toContain(REFUSAL)
        refusalSeen.resolve(undefined)
        await verification.promise
        sendAssistant(response, { id: 'read-evidence', name: 'read', arguments: { path: 'acceptance.txt' } })
        return
      }
      if (requests.length === 4) {
        expect(query.messages.findLast(message => message.role === 'tool')?.content).toBe('approved\n')
        if (goal === undefined) throw new Error('native goal id is missing')
        sendAssistant(response, { id: 'verified-completion', name: 'update_goal',
          arguments: { goal_id: goal.id, revision: goal.revision, action: 'complete' } })
        return
      }
      expect(requests).toHaveLength(5)
      sendAssistant(response)
    })().catch((error: unknown) => {
      fixtureErrors.push(error)
      refusalSeen.reject(error)
      if (!response.headersSent) response.writeHead(500)
      response.end('completion fixture failed')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture has no TCP port')
  const endpoint = `http://127.0.0.1:${address.port}`
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-goal', GoalService],
    ['@deepseek-ai/dsh-tool-goal', ToolGoal],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
    ['@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin', Jev],
    ['@deepseek-ai/dsh-experimental-system3', System3],
    ['completion-workspace-fixture', {
      name: 'completion-workspace-fixture', inject: ['tools'],
      apply(ctx: Context) {
        ctx.effect(() => ctx.tools.register(defineTool({
          name: 'read', description: 'Read the acceptance file.',
          parameters: { path: { type: 'string', required: true } },
          output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] },
          async execute(args) {
            expect(args.path).toBe('acceptance.txt')
            return readFile(join(workspace, 'acceptance.txt'), 'utf8')
          },
        })))
      },
    }],
  ])
  const configPath = join(workspace, 'cordis.yml')
  await writeFile(configPath, [...modules.keys()].flatMap(name => [
    `- name: '${name}'`,
    ...name === '@deepseek-ai/dsh-session-persistence-jsonl' ? [
      '  config:', `    root: ${JSON.stringify(join(workspace, 'sessions'))}`, '    compression: none',
    ] : [],
    ...name === '@deepseek-ai/dsh-llm-pi-ai' ? [
      '  config:', '    providers:', '      completion-fixture:',
      '        api: openai-completions', `        baseURL: ${endpoint}/v1`,
      '        apiKeyEnv: SYSTEM3_COMPLETION_LLM_KEY', '        models:',
      '          - id: completion-model', '            contextWindow: 128000', '            maxTokens: 4096', '            input: [text]',
    ] : [],
    ...name === '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin' ? [
      '  config:', `    endpoint: ${endpoint}`, '    model: APUS-OpenJev-fixture', '    effort: low', '    timeoutMs: 5000',
    ] : [],
    ...name === '@deepseek-ai/dsh-experimental-system3' ? [
      '  config:', '    privacyMode: local-only', '    jevExecutionDomain: local',
      '    taskFrame:', '      mode: active', '      yes: 0.7', '      no: 0.3', '      deadlineMs: 5000',
      '      sessionDataClasses: [workspace]', '      maxItems: 8', '      maxMessageChars: 600',
      '    completionReview:', '      mode: active', '      yes: 0.7', '      no: 0.3', '      deadlineMs: 5000',
      '      sessionDataClasses: [workspace]', '      maxRefusals: 2', '      evidenceCalls: 20', '      resultChars: 300',
    ] : [],
  ]).join('\n') + '\n')
  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(workspace).href + '/'
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

  const id = SessionId('completion-loader-replay')
  const agent = await ctx.agentLoop.create(id, { provider: 'completion-fixture', model: 'completion-model' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: OBJECTIVE }], source: { kind: 'user' } }))
  await refusalSeen.promise
  expect(ctx.goals.get(agent)).toMatchObject({ phase: 'active', objective: OBJECTIVE, revision: 1 })
  expect(agent.session.snapshotEvents().filter(event => event.type === 'goal/change' && event.data.operation === 'complete')).toEqual([])
  expect(agent.session.snapshotEvents().filter(event => event.type === 'system3/completion-review').map(event => event.data))
    .toEqual([{ version: 1, goalId: goal?.id, decision: 'incomplete', unmet: [], goalUnmet: true, refused: true }])
  verification.resolve(undefined)
  await agent.whenIdle()
  expect(fixtureErrors).toEqual([])
  expect(jevRequests).toBe(2)
  expect(requests).toHaveLength(5)
  expect(ctx.goals.get(agent)).toMatchObject({ phase: 'complete', objective: OBJECTIVE, revision: 2 })
  const events = agent.session.snapshotEvents()
  expect(events.filter(event => event.type === 'system3/completion-review').map(event => event.data))
    .toEqual([
      { version: 1, goalId: goal?.id, decision: 'incomplete', unmet: [], goalUnmet: true, refused: true },
      { version: 1, goalId: goal?.id, decision: 'complete', unmet: [], goalUnmet: false, refused: false },
    ])
  const denied = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'premature-completion')
  expect(denied?.type === 'tool/result' ? denied.data.message.isError : undefined).toBe(true)
  expect(denied?.type === 'tool/result' ? JSON.stringify(denied.data.message.content) : undefined).toContain(JSON.stringify(REFUSAL).slice(1, -1))
  await ctx.sessions.flush(agent.session)

  const stored = await ctx.sessionPersistence.open(id, 'read')
  try {
    const persisted = await stored.read()
    expect(persisted.events).toEqual(events)
  } finally {
    await stored.close()
  }
  const reopened = await ctx.sessionPersistence.open(id, 'read')
  try {
    const persisted = await reopened.read()
    expect(persisted.events).toEqual(events)
    const restored = Session.fromRestore(id, persisted.events, reopened.header, reopened.inheritedEventCount, persisted.eventState)
    expect(restored.deriveMessages()).toEqual(agent.session.deriveMessages())
  } finally {
    await reopened.close()
  }
})
