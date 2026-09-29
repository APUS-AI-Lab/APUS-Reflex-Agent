/**
 * @deepseek-ai/dsh-experimental-agui — AG-UI over HTTP for external clients.
 *
 * The plugin mounts `<basePath>/run` (server-sent AG-UI events for one turn),
 * a thread list/rename/archive/history API over persisted Sessions, and
 * approval/question endpoints that answer requests the Agent raises while a
 * run is streaming. A thread id is the Session id. Every request must carry
 * the bearer token named by `tokenEnv`; the composing deployment keeps the
 * listener off the public network.
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { installModelSelection, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-mcp-client'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-title'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { CUSTOM_APPROVAL, CUSTOM_QUESTION, type RunAgentInput, SseWriter, userText } from './agui.ts'
import { HttpError, admitted, json, objectBody, readJson } from './http.ts'
import { DEFAULT_PERSONA, installPersona, type Persona, personaFrom } from './persona.ts'
import { historyMessages } from './projection.ts'
import { type ActiveRun, driveRun, sessionIdOf } from './run.ts'

export type { AguiEvent, AguiMessage, RunAgentInput } from './agui.ts'
export { CUSTOM_APPROVAL, CUSTOM_QUESTION } from './agui.ts'
export { CAPABILITIES_SECTION, CAPABILITY_GROUPS, DEFAULT_PERSONA, personaFrom, personaPrompt, renderCapabilities, type CapabilityGroup, type Persona } from './persona.ts'
export { historyMessages } from './projection.ts'

export const name = 'agui'
// sessionPersistence, sessionQuery, sessionTitle, workspaceRegistry and loader
// are read through ctx.get at request time: each route that needs one answers
// 501 when the composition omits it, so a minimal profile still streams turns.
export const inject = ['agents', 'sessions', 'tools', 'webServer']

export interface Config {
  /** Environment variable holding the bearer token every request must present. */
  readonly tokenEnv: string
  /** Route prefix; absolute, no trailing slash. @default '/agui' */
  readonly basePath: string
  /** Provider and model for Agents this bridge creates or resumes. */
  readonly provider: string
  readonly model: string
  /** Working directory for new Sessions when the client names none. */
  readonly defaultCwd?: string
  /** Largest accepted request body. @default 1 MiB */
  readonly maxBodyBytes: number
  /**
   * MCP servers (by `serverName`) whose tool lists are re-listed before each
   * run, for servers that cannot announce tool changes. @default ['app']
   */
  readonly refreshMcpServers: string[]
  /** Longest a run waits for that re-list before it starts with the cached tools. @default 3000 */
  readonly mcpRefreshTimeoutMs: number
}

export const Config: z<Config> = z.object({
  tokenEnv: z.string().required(),
  basePath: z.string().default('/agui'),
  provider: z.string().required(),
  model: z.string().required(),
  defaultCwd: z.string(),
  maxBodyBytes: z.natural().min(1).default(1024 * 1024),
  refreshMcpServers: z.array(z.string()).default(['app']),
  mcpRefreshTimeoutMs: z.natural().default(3000),
})

/** One thread's summary for the list endpoint. */
export interface ThreadSummary {
  readonly id: string
  readonly title: string | null
  readonly archived: boolean
  readonly cwd: string | null
  readonly createdAt: string
  readonly live: boolean
}

interface Pending<T> {
  readonly threadId: string
  readonly resolve: (value: T) => void
}

/** Narrow a request body to the AG-UI run input fields the bridge reads. */
function runInput(body: Record<string, unknown>): RunAgentInput {
  const { threadId, runId, messages, forwardedProps } = body
  if (typeof threadId !== 'string' || threadId === '' || typeof runId !== 'string') {
    throw new HttpError(400, 'threadId and runId are required')
  }
  if (!Array.isArray(messages) || !messages.every(isMessage)) throw new HttpError(400, 'messages must be an array of messages')
  const props = typeof forwardedProps === 'object' && forwardedProps !== null
    ? forwardedProps as { cwd?: unknown; persona?: unknown }
    : {}
  return {
    threadId,
    runId,
    messages,
    forwardedProps: {
      ...typeof props.cwd === 'string' ? { cwd: props.cwd } : {},
      ...props.persona === undefined ? {} : { persona: props.persona },
    },
  }
}

function isMessage(value: unknown): value is RunAgentInput['messages'][number] {
  return typeof value === 'object' && value !== null && typeof (value as { role?: unknown }).role === 'string'
}

/**
 * Mount the AG-UI bridge routes.
 * @param ctx - plugin context with Agent, Session and web server services.
 * @param config - admission, route prefix, model and body limits.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.basePath.startsWith('/') || config.basePath.length < 2 || config.basePath.endsWith('/')) {
    throw new Error(`agui: basePath must be absolute without a trailing slash: ${config.basePath}`)
  }
  const token = process.env[config.tokenEnv]
  if (token === undefined || token.trim() === '') throw new Error(`agui: ${config.tokenEnv} must hold the bearer token`)

  const handles = new Map<string, AgentHandle>()
  /**
   * Re-list the configured MCP servers' tools, so a tool the server added or
   * dropped since the last run is advertised correctly. Bounded by
   * `mcpRefreshTimeoutMs`; a failure is logged and the run uses the cached tools.
   */
  const refreshMcpTools = async (): Promise<void> => {
    if (config.refreshMcpServers.length === 0) return
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, config.mcpRefreshTimeoutMs) })
    try {
      await Promise.race([
        Promise.all(config.refreshMcpServers.map(server => ctx.parallel('mcp-client/refresh-tools', server))),
        timeout,
      ])
    } catch (error: unknown) {
      ctx.logger.warn(`agui: MCP tool refresh failed: ${String(error)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  const personas = new Map<string, { persona: Persona }>()
  const personaOf = (threadId: string): { persona: Persona } => {
    let holder = personas.get(threadId)
    if (holder === undefined) {
      holder = { persona: DEFAULT_PERSONA }
      personas.set(threadId, holder)
    }
    return holder
  }
  const runs = new Map<string, ActiveRun>()
  // Threads with a run starting or streaming. Claimed before the first await so two
  // concurrent requests for one thread cannot both pass the busy check.
  const busy = new Set<string>()
  const resolving = new Map<string, Promise<AgentHandle>>()
  const approvals = new Map<string, Pending<ApprovalOutcome>>()
  const questions = new Map<string, Pending<AskUserQuestionAnswer>>()

  const runOf = (agent: Agent): ActiveRun | undefined => {
    for (const run of runs.values()) if (run.agent === agent) return run
    return undefined
  }

  // Approvals and questions raised during a streaming run become CUSTOM
  // events; the client answers through the matching POST route. Requests from
  // Agents this bridge does not drive pass to the next policy.
  ctx.on('approval/request', (request, next) => {
    const run = runOf(request.agent)
    if (run === undefined) return next()
    const id = randomUUID()
    return new Promise<ApprovalOutcome>((resolve) => {
      approvals.set(id, { threadId: run.threadId, resolve })
      request.signal?.addEventListener('abort', () => {
        if (approvals.delete(id)) resolve('cancelled')
      }, { once: true })
      run.sse.send({
        type: 'CUSTOM',
        name: CUSTOM_APPROVAL,
        value: { id, threadId: run.threadId, toolName: request.toolName, callId: request.callId, reason: request.reason },
      })
    })
  })
  ctx.on('user-questions/request', (request, next) => {
    const run = request.agent === undefined ? undefined : runOf(request.agent)
    if (run === undefined) return next()
    const id = randomUUID()
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      questions.set(id, { threadId: run.threadId, resolve })
      request.signal?.addEventListener('abort', () => {
        if (questions.delete(id)) reject(new Error('question cancelled'))
      }, { once: true })
      run.sse.send({ type: 'CUSTOM', name: CUSTOM_QUESTION, value: { id, threadId: run.threadId, questions: request.questions } })
    })
  })

  /** The Agent for a thread; concurrent callers share one resolution. */
  const resolveAgent = (threadId: string, cwd: string | undefined, create: boolean): Promise<AgentHandle> => {
    const cached = handles.get(threadId)
    if (cached !== undefined) return Promise.resolve(cached)
    let pending = resolving.get(threadId)
    if (pending === undefined) {
      pending = openAgent(threadId, cwd, create).finally(() => { resolving.delete(threadId) })
      resolving.set(threadId, pending)
    }
    return pending
  }

  /** The Agent for a thread: live in this process, resumed from the log, or created. */
  const openAgent = async (threadId: string, cwd: string | undefined, create: boolean): Promise<AgentHandle> => {
    // Loader siblings mount concurrently; a thread must see the complete application.
    await ctx.get('loader')?.await()
    const sessionId = sessionIdOf(threadId)
    if (ctx.agents.get(sessionId) !== undefined) throw new HttpError(409, 'thread is driven by another owner in this process')
    const agentOptions = { provider: config.provider, model: config.model }
    const setup = (agentCtx: Context): void => {
      installModelSelection(agentCtx, { current: agentOptions, assembled: undefined })
      installPersona(agentCtx, personaOf(threadId))
    }
    const persisted = await ctx.get('sessionPersistence')?.stat(sessionId)
    let handle: AgentHandle
    if (persisted !== undefined) {
      if (persisted.header.origin === 'subagent' || persisted.header.parentSession !== undefined) {
        throw new HttpError(404, 'thread is a subagent session')
      }
      handle = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    } else {
      if (!create) throw new HttpError(404, 'thread not found')
      handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: cwd ?? config.defaultCwd ?? process.cwd() },
        agentOptions,
        setup,
      })
    }
    handles.set(threadId, handle)
    return handle
  }

  const listThreads = async (): Promise<ThreadSummary[]> => {
    const query = ctx.get('sessionQuery')
    if (query === undefined) throw new HttpError(501, 'thread listing needs the sessionQuery service')
    const archived = new Set<SessionId>(ctx.get('workspaceRegistry')?.archivedSessionIds ?? [])
    const records = (await query.listSessions()).filter(record =>
      record.header.origin !== 'subagent' && record.header.parentSession === undefined)
    return Promise.all(records.map(async (record): Promise<ThreadSummary> => ({
      id: record.header.id,
      title: (await query.readTitle(record.header.id).catch(() => null))?.title ?? null,
      archived: archived.has(record.header.id),
      cwd: record.header.cwd ?? null,
      createdAt: new Date(record.header.createdAt).toISOString(),
      live: record.live,
    })))
  }

  const handleRun = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = runInput(objectBody(await readJson(req, config.maxBodyBytes)))
    const latest = [...body.messages].reverse().find(message => message.role === 'user')
    const text = latest === undefined ? '' : userText(latest)
    if (text.trim() === '') throw new HttpError(400, 'the run carries no user message')
    if (busy.has(body.threadId)) throw new HttpError(409, 'thread already running')
    busy.add(body.threadId)
    try {
      await streamRun(body, text, res)
    } finally {
      busy.delete(body.threadId)
    }
  }

  const streamRun = async (body: RunAgentInput, text: string, res: ServerResponse): Promise<void> => {
    personaOf(body.threadId).persona = personaFrom(body.forwardedProps?.persona) ?? personaOf(body.threadId).persona
    const handle = await resolveAgent(body.threadId, body.forwardedProps?.cwd, true)
    await refreshMcpTools()
    const sse = new SseWriter(res)
    const run: ActiveRun = { runId: body.runId, threadId: body.threadId, agent: handle.agent, sse }
    runs.set(body.threadId, run)
    // The client left mid-turn. The socket can close during teardown, after the
    // plugin's own dispose already cancelled the run and the context went
    // inactive, so the whole check-and-cancel is logged on failure, never thrown.
    const onClose = (): void => {
      try {
        if (runs.get(body.threadId) !== run || ctx.agents.get(sessionIdOf(body.threadId)) !== handle.agent) return
        handle.agent.cancel({ kind: 'user' })
      } catch (error: unknown) {
        ctx.logger.warn(`agui: cancel after client close failed: ${String(error)}`)
      }
    }
    res.on('close', onClose)
    try {
      await driveRun(ctx, run, text)
    } finally {
      res.off('close', onClose)
      if (runs.get(body.threadId) === run) runs.delete(body.threadId)
      sse.end()
    }
  }

  const handleThreads = async (req: IncomingMessage, res: ServerResponse, rest: string[]): Promise<void> => {
    if (rest.length === 0 && req.method === 'GET') {
      json(res, 200, { threads: await listThreads() })
      return
    }
    if (rest.length === 0 && req.method === 'POST') {
      const body = objectBody(await readJson(req, config.maxBodyBytes))
      const threadId = typeof body.id === 'string' && body.id !== '' ? body.id : randomUUID()
      const cwd = typeof body.cwd === 'string' ? body.cwd : undefined
      const handle = await resolveAgent(threadId, cwd, true)
      await ctx.sessions.flush(handle.agent.session)
      json(res, 201, { id: threadId })
      return
    }
    const [threadId, sub] = rest
    if (threadId === undefined) throw new HttpError(404, 'not found')
    if (sub === undefined && req.method === 'PATCH') {
      const body = objectBody(await readJson(req, config.maxBodyBytes))
      if (typeof body.title === 'string') {
        const titles = ctx.get('sessionTitle')
        if (titles === undefined) throw new HttpError(501, 'renaming needs the sessionTitle service')
        const handle = await resolveAgent(threadId, undefined, false)
        titles.rename(handle.agent.session, body.title)
        await ctx.sessions.flush(handle.agent.session)
      }
      if (typeof body.archived === 'boolean') {
        const workspace = ctx.get('workspaceRegistry')
        if (workspace === undefined) throw new HttpError(501, 'archiving needs the workspaceRegistry service')
        if (body.archived) await workspace.archiveSession(sessionIdOf(threadId), { stopActivity: true })
        else await workspace.unarchiveSession(sessionIdOf(threadId))
      }
      json(res, 200, { id: threadId })
      return
    }
    if (sub === 'messages' && req.method === 'GET') {
      const query = ctx.get('sessionQuery')
      if (query === undefined) throw new HttpError(501, 'history needs the sessionQuery service')
      using observation = await query.observeSession(sessionIdOf(threadId))
      json(res, 200, { messages: historyMessages(observation.events) })
      return
    }
    throw new HttpError(404, 'not found')
  }

  const handleAnswer = async <T>(
    req: IncomingMessage,
    res: ServerResponse,
    id: string | undefined,
    pending: Map<string, Pending<T>>,
    answer: (body: Record<string, unknown>) => T,
  ): Promise<void> => {
    if (req.method !== 'POST' || id === undefined) throw new HttpError(404, 'not found')
    const entry = pending.get(id)
    if (entry === undefined) throw new HttpError(404, 'no such pending request')
    const value = answer(objectBody(await readJson(req, config.maxBodyBytes)))
    if (pending.get(id) !== entry) throw new HttpError(404, 'no such pending request')
    pending.delete(id)
    entry.resolve(value)
    json(res, 204, null)
  }

  const route: WebRoute = {
    kind: 'prefix',
    path: config.basePath,
    handler: async (req, res) => {
      try {
        if (!admitted(req, token)) throw new HttpError(401, 'unauthorized')
        const url = new URL(req.url ?? '/', 'http://localhost')
        const segments = url.pathname.slice(config.basePath.length).split('/').filter(segment => segment !== '')
        const [head, ...rest] = segments
        if (head === 'run' && rest.length === 0 && req.method === 'POST') {
          await handleRun(req, res)
        } else if (head === 'threads') {
          await handleThreads(req, res, rest)
        } else if (head === 'approvals') {
          await handleAnswer(req, res, rest[0], approvals, body => body.decision === 'allow' ? 'allowed-once' : 'rejected')
        } else if (head === 'questions') {
          await handleAnswer(req, res, rest[0], questions, (body) => {
            if (!Array.isArray(body.answers)) throw new HttpError(400, 'answers must be an array')
            return { answers: body.answers as AskUserQuestionAnswer['answers'] }
          })
        } else {
          throw new HttpError(404, 'not found')
        }
      } catch (error: unknown) {
        if (res.headersSent) {
          res.end()
          return
        }
        if (error instanceof HttpError) {
          json(res, error.status, { error: error.message })
          return
        }
        // The bridge admits one trusted front-end, so the failure text is useful, not sensitive.
        const detail = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`agui: request failed: ${detail}`)
        json(res, 500, { error: `request failed: ${detail}` })
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), `agui: ${config.basePath}`)

  ctx.effect(() => () => {
    for (const run of runs.values()) run.agent.cancel({ kind: 'disposed' })
    for (const entry of approvals.values()) entry.resolve('cancelled')
    approvals.clear()
    questions.clear()
    const owned = [...handles.values()]
    handles.clear()
    personas.clear()
    return Promise.all(owned.map(handle => handle.dispose())).then(() => undefined)
  }, 'agui: dispose agents')
}
