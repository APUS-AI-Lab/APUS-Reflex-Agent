/** Explicit single-host task memory across distinct business Sessions. */
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isAgentLoopRequest, type GenerateOptions, type MessageId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SESSION_FORMAT_VERSION, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MemoryId } from './records.ts'
import { TaskJournal } from './task-journal.ts'
import { MemoryDomainId, MemoryPrincipalId, MemoryTaskId, type TaskDomainIdentity, type TaskReceipt, type TaskSnapshot } from './task-types.ts'
import { readTaskSource, type TaskSourceInput } from './task-source.ts'
import { renderTaskPage, type TaskPageOptions } from './task-pages.ts'
import type { TaskBinding } from './task-binding.ts'
import type {} from './task-guard.ts'
export type { TaskBinding } from './task-binding.ts'

/** Host-owned opt-in binding; model arguments cannot select an identity or workspace. */
export interface ContinuumTaskConfig {
  readonly root: string
  readonly workspace: string
  readonly domainId: string
  readonly principalId: string
  readonly taskId: string
  readonly maxContextBytes: number
  readonly maxPageBytes: number
}

/** Validated deployment configuration for a single task attachment. */
export const ContinuumTaskConfig: Schema<ContinuumTaskConfig> = Schema.object({
  root: Schema.string().required(),
  workspace: Schema.string().required(),
  domainId: Schema.string().required(),
  principalId: Schema.string().required(),
  taskId: Schema.string().required(),
  maxContextBytes: Schema.number().step(1).min(1024).default(8192),
  maxPageBytes: Schema.number().step(1).min(1024).default(8192),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Explicitly mounted, host-authorized cross-session task service. */
    continuumTasks: ContinuumTasks
  }
}

/**
 * Durable tasks with complete text admission and bounded model context. One host
 * identity and exact workspace are authorized by configuration. Sources stay in
 * business Sessions; the leased authority log uses a separate storage root.
 * Retiring an entry refuses already-bound Sessions because their prior model
 * outputs or summaries may still contain it; a fresh Session can use the new state.
 */
export default class ContinuumTasks extends Service {
  static Config = ContinuumTaskConfig
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'systemPrompt', 'tools', 'llm', 'continuumTaskGuard']

  private journal!: TaskJournal
  private identity!: TaskDomainIdentity
  private readonly taskId: MemoryTaskId
  private readonly agents = new Map<SessionId, Agent>()
  private readonly prepared = new WeakMap<Agent, { revision: number; retirement: string; admittedMessageIds: Set<MessageId> }>()
  private admissionTail: Promise<void> = Promise.resolve()
  private authorityTail: Promise<void> = Promise.resolve()
  private readonly admissionFailures = new WeakMap<Agent, Error>()
  private active = true

  constructor(ctx: Context, private readonly config: ContinuumTaskConfig) {
    super(ctx, 'continuumTasks')
    this.taskId = MemoryTaskId(config.taskId)
    if (!isAbsolute(config.root) || !isAbsolute(config.workspace)) throw new Error('task root and workspace must be absolute')
  }

  protected async [Service.init](): Promise<void> {
    const { ctx, config } = this
    const workspace = await realpath(config.workspace)
    this.identity = {
      domainId: MemoryDomainId(config.domainId), principalId: MemoryPrincipalId(config.principalId), workspace,
    }
    const isolated = ctx.root.isolate('sessionPersistence')
    const backend = await isolated.plugin(JsonlSessionPersistence, { root: join(config.root, 'task-journals'), compression: 'none' })
    const id = SessionId(createHash('sha256').update(config.domainId).digest('hex'))
    try {
      const existing = await isolated.sessionPersistence.stat(id)
      const handle = existing === undefined
        ? await isolated.sessionPersistence.create({
          id, version: SESSION_FORMAT_VERSION, createdAt: Date.now(), isSeeded: false, cwd: workspace,
        })
        : await isolated.sessionPersistence.open(id, 'write')
      this.journal = await TaskJournal.open(handle, this.identity)
    } catch (error) {
      await backend.dispose()
      throw error
    }
    ctx.effect(() => async () => {
      this.active = false
      for (const agent of this.agents.values()) agent.cancel({ kind: 'disposed' })
      await this.authorityTail
      await this.admissionTail
      await this.journal.close()
      await backend.dispose()
      this.agents.clear()
    }, 'continuumTasks.close')
    ctx.on('agent/created', ({ agent }) => { this.agents.set(agent.session.id, agent) })
    ctx.on('agent/disposed', ({ agent }) => { this.agents.delete(agent.session.id) })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      const agent = this.agents.get(session.id)
      // A delegated child's input is its parent model's prompt, not a task requirement.
      if (agent === undefined || (agent.session.header.delegationDepth ?? 0) !== 0) return
      this.enqueueAdmission(agent, event)
    })
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const result = await next()
      const agent = context.agent
      if (agent === undefined) return result
      await this.settled(agent)
      const snapshot = this.requireJournal().snapshot(this.taskId)
      this.prepared.set(agent, {
        revision: this.requireJournal().revision, retirement: retirementDigest(snapshot), admittedMessageIds: new Set(),
      })
      if (snapshot === undefined) return result
      this.assertBinding(agent, snapshot)
      const page = renderTaskPage(snapshot, { maxBytes: config.maxContextBytes })
      // Variable values are substituted once, so literal {{...}} in source text is preserved.
      return { ...result, contexts: [...result.contexts, { name: 'continuum:task', text: '{{continuum_task}}' }],
        variables: { ...result.variables, continuum_task: page } }
    })
    ctx.on('llm/stream', (options, next) => this.guardRequest(options, next))
    this.installReadTool()
  }

  /**
   * Read the current authorized task without marking its entries processed.
   * @param agent - Live caller in the configured workspace.
   * @returns Immutable complete task or undefined before its first input.
   */
  async snapshot(agent: Agent): Promise<TaskSnapshot | undefined> {
    await this.settled(agent)
    return this.requireJournal().snapshot(this.taskId)
  }

  /**
   * Verify a recovered binding synchronously for the always-mounted dispatch guard.
   * This does not replace source authorization or the request's revision lease.
   * @param session - Exact live Session about to send model context.
   * @param binding - Its immutable recovered task authority and retirement set.
   */
  assertAuthority(session: Session, binding: TaskBinding): void {
    this.assertActive()
    const identity = this.requireIdentity()
    const journal = this.requireJournal()
    if (binding.domainId !== identity.domainId || binding.principalId !== identity.principalId
      || binding.taskId !== this.taskId || binding.workspace !== identity.workspace) {
      throw new Error('Session is bound to a different task authority')
    }
    if (this.agents.get(session.id)?.session !== session) throw new Error('task authority does not own this live Session')
    if (binding.retirementDigest !== retirementDigest(journal.snapshot(this.taskId))) {
      throw new Error('task requirements were retired; open a fresh Session to avoid stale history or summaries')
    }
  }

  /**
   * Read a bounded page of current task inputs. Retired sources remain in the journal.
   * @param agent - Live caller in the configured workspace.
   * @param options - Revision-bound page position; deployment owns the byte budget.
   * @returns JSON with exact text, source references and a continuation cursor.
   */
  async read(agent: Agent, options: Omit<TaskPageOptions, 'maxBytes'> = {}): Promise<string> {
    const snapshot = await this.snapshot(agent)
    if (snapshot === undefined) throw new Error('task has no saved inputs')
    this.assertBinding(agent, snapshot)
    return renderTaskPage(snapshot, { ...options, maxBytes: this.config.maxPageBytes })
  }

  /**
   * Apply an explicit host-authorized correction using exact durable human text.
   * Already-bound Sessions refuse subsequent dispatch until opened anew.
   * @param agent - Caller authorized by the mounted host configuration.
   * @param request - Stable request identity, observed domain revision and source-backed replacement.
   * @returns A receipt after durable commit and exact readback.
   */
  async supersede(agent: Agent, request: {
    readonly requestId: string
    readonly expectedRevision: number
    readonly predecessor: MemoryId
    readonly source: TaskSourceInput
  }): Promise<TaskReceipt> {
    await this.settled(agent)
    const original = await readTaskSource(this.ctx, agent, this.requireIdentity().workspace, request.source)
    this.assertActive()
    return this.commitAuthorized(() => this.requireJournal().commit({
      requestId: request.requestId, expectedRevision: request.expectedRevision,
      command: { kind: 'supersede', taskId: this.taskId, predecessor: request.predecessor,
        entry: { id: MemoryId(`correction:${request.requestId}`), role: 'input', ...original } } }))
  }

  private async * guardRequest(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const agent = options.sessionId === undefined ? undefined : this.agents.get(options.sessionId)
    if (agent === undefined) { yield * next(); return }
    await this.settled(agent)
    const release = await this.claimAuthority()
    try {
      this.assertActive()
      options.signal?.throwIfAborted()
      const snapshot = this.requireJournal().snapshot(this.taskId)
      if (snapshot !== undefined) {
        this.assertBinding(agent, snapshot)
        const prepared = this.prepared.get(agent)
        if (isAgentLoopRequest(options) && prepared !== undefined && (prepared.retirement !== retirementDigest(snapshot)
          || prepared.revision !== this.requireJournal().revision
          || [...prepared.admittedMessageIds].some(id => !options.messages.some(message => message.id === id)))) {
          throw new Error('task requirements changed after request preparation; assemble current requirements again')
        }
      }
      // The lease spans downstream middleware and adapter preparation, so a
      // correction cannot commit while an admitted request is still pending.
      yield * next()
    } finally {
      release()
    }
  }

  private async claimAuthority(): Promise<() => void> {
    const previous = this.authorityTail
    const claimed = Promise.withResolvers<void>()
    this.authorityTail = previous.then(() => claimed.promise)
    await previous
    return () => { claimed.resolve() }
  }

  private async commitAuthorized<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.claimAuthority()
    try {
      this.assertActive()
      return await operation()
    } finally {
      release()
    }
  }

  private enqueueAdmission(agent: Agent, event: SessionEvent<'user/message'>): void {
    const admitted = this.admissionTail.then(async () => {
      this.assertActive()
      const failure = this.admissionFailures.get(agent)
      if (failure !== undefined) throw failure
      await this.authorize(agent)
      this.assertBinding(agent, this.requireJournal().snapshot(this.taskId))
      for (const [blockIndex, block] of event.data.content.entries()) {
        if (block.type !== 'text') continue
        const id = MemoryId(`${agent.session.id}:${event.seq}:${blockIndex}`)
        const journal = this.requireJournal()
        const snapshot = journal.snapshot(this.taskId)
        if (snapshot?.entries.some(entry => entry.id === id) === true) continue
        const original = await readTaskSource(this.ctx, agent, this.requireIdentity().workspace, {
          sessionId: agent.session.id, eventSeq: event.seq, blockIndex,
        })
        if (original.text !== block.text) throw new Error('task input readback differs from committed source')
        this.assertActive()
        await this.commitAuthorized(async () => {
          const previousRevision = journal.revision
          const receipt = await journal.commit({ requestId: `input:${id}`, expectedRevision: previousRevision,
            command: { kind: snapshot === undefined ? 'create' : 'append', taskId: this.taskId,
              entry: { id, role: 'input', ...original } } })
          const prepared = this.prepared.get(agent)
          if (prepared?.revision === previousRevision) {
            prepared.revision = receipt.revision
            prepared.admittedMessageIds.add(event.data.id)
          }
        })
      }
    })
    this.admissionTail = admitted.catch((error: unknown) => {
      this.admissionFailures.set(agent, new Error('task input was not acknowledged; task memory requires recovery', { cause: error }))
    })
  }

  private async settled(agent: Agent): Promise<void> {
    await this.admissionTail
    this.assertActive()
    const failure = this.admissionFailures.get(agent)
    if (failure !== undefined) throw failure
    await this.authorize(agent)
  }

  private async authorize(agent: Agent): Promise<void> {
    this.assertActive()
    if (this.agents.get(agent.session.id) !== agent || agent.session.header.cwd === undefined
      || await realpath(agent.session.header.cwd) !== this.requireIdentity().workspace) {
      throw new Error('Session is outside the explicitly authorized task workspace')
    }
    this.assertActive()
    this.assertAuthorityBinding(agent)
  }

  private assertAuthorityBinding(agent: Agent): void {
    const current = this.ctx.sessionProjections.stateOf(agent.session, 'continuumTaskBinding')
    const identity = this.requireIdentity()
    if (current !== undefined && current !== null && (current.domainId !== identity.domainId
      || current.principalId !== identity.principalId || current.taskId !== this.taskId
      || current.workspace !== identity.workspace)) throw new Error('Session is bound to a different task authority')
  }

  private assertBinding(agent: Agent, snapshot: TaskSnapshot | undefined): void {
    const identity = this.requireIdentity()
    const current = this.ctx.sessionProjections.stateOf(agent.session, 'continuumTaskBinding')
    const retirement = retirementDigest(snapshot)
    if (current !== undefined && current !== null) {
      if (current.retirementDigest !== retirement) throw new Error('task requirements were retired; open a fresh Session to avoid stale history or summaries')
      return
    }
    agent.session.append('continuum/task-binding', { ...identity, taskId: this.taskId, retirementDigest: retirement })
  }

  private installReadTool(): void {
    this.ctx.tools.register(defineTool({
      name: 'read_continuum_task',
      description: 'Read saved inputs and requirements for the attached task. Follow next until pending is false. If revision changed, restart without a cursor. Reading does not mark requirements processed or the task complete.',
      parameters: {
        entry_index: { type: 'number', description: 'Entry position from next; omit for the first page.' },
        text_offset: { type: 'number', description: 'UTF-16 text offset from next; omit for the first page.' },
        revision: { type: 'number', description: 'Task revision from next; required when continuing a page.' },
      },
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error('task reading requires a live Agent')
        return this.read(exec.agent, {
          ...args.entry_index === undefined ? {} : { entryIndex: args.entry_index },
          ...args.text_offset === undefined ? {} : { textOffset: args.text_offset },
          ...args.revision === undefined ? {} : { expectedRevision: args.revision },
        })
      },
      presentCall: args => ({ card: 'generic', title: 'Read task memory', kind: 'read', rawInput: args }),
    }))
  }

  private assertActive(): void { if (!this.active) throw new Error('task memory service is closed') }
  private requireJournal(): TaskJournal {
    return this.journal
  }
  private requireIdentity(): TaskDomainIdentity {
    return this.identity
  }
}

function retirementDigest(snapshot: TaskSnapshot | undefined): string {
  return createHash('sha256').update(JSON.stringify(snapshot?.entries.filter(entry => entry.status !== 'active')
    .map(entry => [entry.id, entry.status, entry.supersedes]) ?? [])).digest('hex')
}
