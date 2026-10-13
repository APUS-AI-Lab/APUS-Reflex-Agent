/** Real Loader, JSONL persistence, System One HTTP and main-model composition. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ContinuumMemory, { MemoryId } from '@deepseek-ai/dsh-continuum'
import Jev, { validateJevRequest, type JevRequest } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import ContinuumJev from '../src/index.ts'
import { expect, it, vi } from 'vitest'

it.each([['openjev', 'rank'], ['typesafe', 'rank'], ['openjev', 'invalidate'], ['openjev', 'missing'], ['openjev', 'mismatch'], ['openjev', 'read-error'], ['openjev', 'flush-error']] as const)('prepares %s evidence durably with %s', async (protocol, scenario) => {
  const invalidate = scenario === 'invalidate'
  const root = await mkdtemp(join(tmpdir(), 'continuum-relevance-profile-'))
  let ctx: Context | undefined
  const requests: JevRequest[] = []
  const failures: unknown[] = []
  const sessionId = SessionId('relevance-profile')
  const server = createServer((request, response) => {
    void (async () => {
      expect(request.url).toBe('/v1/systemone')
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        const bytes: unknown = chunk
        if (!(bytes instanceof Uint8Array)) throw new TypeError('HTTP body chunk must be bytes')
        chunks.push(Buffer.from(bytes))
      }
      const input = validateJevRequest(JSON.parse(Buffer.concat(chunks).toString()) as JevRequest)
      requests.push(input)
      if (ctx === undefined) throw new Error('profile not started')
      await using handle = await ctx.sessionPersistence.open(sessionId, 'read')
      const stored = await handle.read()
      const prepared = stored.events.findLast(event => event.type === 'continuum/memory-decision')
      expect(prepared).toMatchObject({ data: { outcome: 'unknown', evaluation: {
        phase: 'prepared', request: { providerId: 'fixture-provider', model: 'fixture-model', effort: 'high' },
      } } })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ model: 'fixture-model', answers: {
        m0: { type: 'noul', noul: 0.05 }, m1: { type: 'noul', noul: 0.95 },
      } }))
    })().catch((error: unknown) => {
      failures.push(error)
      response.statusCode = 500
      response.end('{}')
    })
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test HTTP server has no TCP address')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { id: 'projection', name: 'cordis:projection' }, { id: 'llm', name: 'cordis:llm' },
      { id: 'sessions', name: 'cordis:sessions' },
      { id: 'persistence', name: 'cordis:persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
      { id: 'prompt', name: 'cordis:prompt', config: { personaPrefix: '', personaSuffix: '', includeHarnessIdentity: false, includeRuntimeContext: false } },
      { id: 'tools', name: 'cordis:tools' }, { id: 'agents', name: 'cordis:agents' },
      { id: 'loop', name: 'cordis:loop', config: { agents: [] } },
      { id: 'jev', name: 'cordis:jev', config: {
        endpoint: `http://127.0.0.1:${address.port}`, providerId: 'fixture-provider', model: 'fixture-model', protocol, effort: 'high',
      } },
      { id: 'continuum-jev', name: 'cordis:relevance', config: {
        mode: 'active', timeoutMs: 5000, maxRequestBytes: 32768, sessionDataClasses: ['workspace'],
        privacyPolicy: { mode: 'controlled', approvedRemoteIds: ['fixture-provider'], approvedRemoteDataClasses: ['workspace'] },
      } },
      { id: 'continuum-memory', name: 'cordis:memory', config: {
        enabled: true, mode: 'active', admission: 'explicit', scopes: ['workspace'], maxCandidates: 8, maxExcerptBytes: 200, maxTotalBytes: 2048,
      } },
    ]))
    ctx = await boot('test', configPath, [], (context) => {
      Object.assign(context.loader.builtins, {
        projection: SessionProjectionRegistry, llm: LlmRuntime, sessions: SessionStore, persistence: JsonlSessionPersistence,
        prompt: SystemPrompt, tools: ToolRuntime, agents: AgentRegistry, loop: AgentLoop,
        jev: Jev, relevance: ContinuumJev, memory: ContinuumMemory,
      })
    })
    const adapter = new MockAdapter([textResponse('saved'), textResponse('PIN 7319; Friday')])
    ctx.llm.registerAdapter(['recording'], adapter)
    const agent = await ctx.agentLoop.create(sessionId, { provider: 'recording', model: 'recording' })
    const sourceText = 'Release PIN is 7319. Release date is Friday.'
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: sourceText }] }))
    await agent.whenIdle()
    const source = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (source === undefined) throw new Error('seed input was not logged')
    for (const [id, content] of [['a', 'Release PIN is 7319.'], ['b', 'Release date is Friday.']] as const) {
      ctx.continuumMemory.create(agent, { id: MemoryId(id), kind: 'fact', scope: 'workspace', content,
        sourceRefs: [{ sessionId, eventSeq: source.seq }] })
    }
    const originalOpen = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
    const open = ['missing', 'mismatch', 'read-error'].includes(scenario) ? vi.spyOn(ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      if (args[1] !== 'read') return originalOpen(...args)
      if (scenario === 'missing') throw new SessionPersistenceNotFoundError(sessionId)
      if (scenario === 'read-error') throw new Error('durable read failed')
      const handle = await originalOpen(...args)
      const originalRead = handle.read.bind(handle)
      vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => ({ ...await originalRead(...readArgs), events: [] }))
      return handle
    }) : undefined
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    const flush = invalidate || scenario === 'flush-error' ? vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (scenario === 'flush-error') throw new Error('durable flush failed')
      entered.resolve(undefined)
      await release.promise
      return originalFlush(session)
    }) : undefined
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'What are the release PIN and date?' }] }))
    if (invalidate) {
      try {
        await entered.promise
        ctx.continuumMemory.controller(agent).setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
      } finally {
        release.resolve(undefined)
      }
    }
    await agent.whenIdle()
    flush?.mockRestore()
    open?.mockRestore()
    expect(failures).toEqual([])
    if (scenario !== 'rank') {
      expect(requests).toEqual([])
      const recalls = adapter.requests[1]?.messages.filter(message => message.source?.kind === 'continuum-memory') ?? []
      if (invalidate) expect(recalls).toEqual([])
      else expect(recalls[0]?.source).toMatchObject({ recordIds: ['a', 'b'] })
      const receipts = agent.session.snapshotEvents().filter(event => event.type === 'continuum/memory-decision')
      expect(receipts.map(event => event.data.evaluation?.phase)).toEqual(['prepared', 'settled'])
      expect(receipts[1]?.data).toMatchObject({ failure: invalidate ? 'invalidated' : 'persistence-unavailable', selectedIds: ['a', 'b'] })
      return
    }
    const diagnostics = agent.session.snapshotEvents().slice(-5)
    expect(requests, JSON.stringify(diagnostics)).toHaveLength(1)
    expect(Object.keys(requests[0]!.questions)).toEqual(['m0', 'm1'])
    expect(requests[0]!.effort).toBe(protocol === 'openjev' ? 'high' : undefined)
    const recall = adapter.requests[1]?.messages.find(message => message.source?.kind === 'continuum-memory')
    expect(recall?.source).toMatchObject({ recordIds: ['b', 'a'] })
    const text = recall?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(text).toContain('Release date is Friday.')
    expect(text).toContain('Release PIN is 7319.')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2048)
    const receipts = agent.session.snapshotEvents().flatMap(event => event.type === 'continuum/memory-decision' ? [event] : [])
    expect(receipts.map(event => event.data.evaluation?.phase)).toEqual(['prepared', 'settled'])
    expect(receipts[1]?.data.evaluation?.preparedSeq).toBe(receipts[0]?.seq)
    expect(receipts[1]?.data.selectedIds).toEqual(['b', 'a'])
    await ctx.sessions.flush(agent.session)
    await using persisted = await ctx.sessionPersistence.open(sessionId, 'read')
    const replay = await persisted.read()
    expect(replay.events.filter(event => event.type === 'continuum/memory-decision')).toEqual(receipts)
    expect(requests).toHaveLength(1)
  } finally {
    await ctx?.fiber.dispose()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
      server.closeAllConnections()
    })
    await rm(root, { recursive: true, force: true })
  }
})
