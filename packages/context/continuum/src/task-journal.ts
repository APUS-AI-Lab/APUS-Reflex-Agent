/** Single-writer task journal over an isolated native Session persistence handle. */
import { createHash } from 'node:crypto'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { MemoryId } from './records.ts'
import { MemoryDomainId, MemoryPrincipalId, MemoryTaskId } from './task-types.ts'
import type {
  TaskCommand, TaskCommitRequest, TaskDomainIdentity, TaskEntry, TaskMetadata, TaskOperationData,
  TaskReceipt, TaskSnapshot, TaskStoredEntry,
} from './task-types.ts'

/** Stable journal refusal categories. */
export type TaskJournalErrorCode = 'TASK_CLOSED' | 'TASK_POISONED' | 'TASK_REVISION_CONFLICT'
  | 'TASK_REQUEST_CONFLICT' | 'TASK_NOT_FOUND' | 'TASK_ENTRY_CONFLICT' | 'TASK_ENTRY_INACTIVE'
  | 'TASK_IDENTITY_MISMATCH' | 'TASK_CORRUPT' | 'TASK_READ_ONLY'

/** Explicit journal error without source text in the diagnostic. */
export class TaskJournalError extends Error {
  /**
   * @param code - Stable refusal category.
   * @param message - Diagnostic without original task text.
   * @param options - Original persistence error when available.
   */
  constructor(readonly code: TaskJournalErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TaskJournalError'
  }
}

interface AcceptedRequest {
  readonly digest: string
  readonly receipt: TaskReceipt
}

/**
 * One leased authority for a memory domain. The caller authorizes identities
 * and source membership, verifies source bytes, and supplies an isolated write
 * handle. This journal never reads other Sessions or grants source access.
 * Initialization replays once; successful commits update only the affected task.
 */
export class TaskJournal {
  private readonly tasks = new Map<MemoryTaskId, TaskSnapshot>()
  private readonly accepted = new Map<string, AcceptedRequest>()
  private currentRevision = 0
  private nextSeq = 0
  private tail: Promise<void> = Promise.resolve()
  private poisoned = false
  private closing?: Promise<void>

  private constructor(private readonly handle: SessionHandle) {}

  /**
   * Take ownership of a write handle, initialize or verify its immutable domain
   * identity, and restore every committed transition. Failure closes the handle.
   * @param handle - Exclusively owned isolated domain log.
   * @param identity - Host-authorized principal, domain and canonical workspace.
   * @returns The restored single-writer authority.
   */
  static async open(handle: SessionHandle, identity: TaskDomainIdentity): Promise<TaskJournal> {
    const journal = new TaskJournal(handle)
    const expectedIdentity = { domainId: identity.domainId, principalId: identity.principalId, workspace: identity.workspace }
    try {
      if (handle.access !== 'write') throw new TaskJournalError('TASK_READ_ONLY', 'task journal requires write ownership')
      const { events } = await handle.read()
      if (events.length === 0) {
        await journal.persist({ version: 1, kind: 'init', identity: expectedIdentity })
      } else {
        for (const event of events) journal.restore(event, expectedIdentity)
      }
      return journal
    } catch (error) {
      await handle.close()
      throw error
    }
  }

  /** Latest durably committed domain revision; uncertain persistence requires reopen before any read. */
  get revision(): number { this.assertReadable(); return this.currentRevision }

  /** Read a frozen projection, including retired original entries.
   * @param taskId - Task within this authorized domain.
   * @returns The current task, or undefined when absent.
   */
  snapshot(taskId: MemoryTaskId): TaskSnapshot | undefined { this.assertReadable(); return this.tasks.get(taskId) }

  /** List immutable metadata in task creation order.
   * @returns Task identifiers and their last committed domain revisions.
   */
  list(): readonly TaskMetadata[] {
    this.assertReadable()
    return Object.freeze([...this.tasks.values()].map(({ id, revision }) => Object.freeze({ id, revision })))
  }

  /**
   * Commit one authorized operation. Original identical retries return the old
   * receipt before CAS; a reused request ID with different content rejects.
   * Any uncertain persistence failure poisons subsequent writes until reopen.
   * @param request - Host-validated source-backed command and expected revision.
   * @returns The durable original or newly accepted receipt.
   */
  commit(request: TaskCommitRequest): Promise<TaskReceipt> {
    if (this.closing !== undefined) return Promise.reject(new TaskJournalError('TASK_CLOSED', 'task journal is closing'))
    const owned = copyRequest(request)
    const digest = requestDigest(owned)
    const operation = this.tail.then(async () => {
      if (this.poisoned) throw new TaskJournalError('TASK_POISONED', 'task journal needs recovery after uncertain persistence')
      const previous = this.accepted.get(owned.requestId)
      if (previous !== undefined) {
        if (previous.digest !== digest) throw new TaskJournalError('TASK_REQUEST_CONFLICT', 'task request id was reused with different content')
        return previous.receipt
      }
      const { task, receipt } = this.prepare(owned)
      await this.persist({ version: 1, kind: 'commit', request: owned, digest, receipt })
      this.publish(task, receipt, digest)
      return receipt
    })
    // Rejected commands do not block later queue slots; uncertain writes set poisoned.
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  /** Stop admitting operations, drain accepted queue slots and release write ownership.
   * @returns Resolution after the underlying handle closes; repeated calls share settlement.
   */
  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.handle.close())
    return this.closing
  }

  private assertReadable(): void {
    if (this.poisoned) throw new TaskJournalError('TASK_POISONED', 'task journal needs recovery after uncertain persistence')
  }

  private prepare(request: TaskCommitRequest): { task: TaskSnapshot; receipt: TaskReceipt } {
    if (request.requestId.length === 0) throw new TaskJournalError('TASK_REQUEST_CONFLICT', 'task request id must not be empty')
    if (request.expectedRevision !== this.currentRevision || !Number.isSafeInteger(this.currentRevision + 1)) {
      throw new TaskJournalError('TASK_REVISION_CONFLICT', 'task domain revision changed or is exhausted')
    }
    const revision = this.currentRevision + 1
    const task = transition(this.tasks.get(request.command.taskId), request.command, revision)
    const receipt = Object.freeze({ revision, taskId: task.id, requestId: request.requestId })
    return { task, receipt }
  }

  private publish(task: TaskSnapshot, receipt: TaskReceipt, digest: string): void {
    this.tasks.set(task.id, task)
    this.accepted.set(receipt.requestId, { digest, receipt })
    this.currentRevision = receipt.revision
  }

  private async persist(data: TaskOperationData): Promise<void> {
    const event: SessionEvent<'continuum/task-operation'> = {
      type: 'continuum/task-operation', seq: SessionSeq(this.nextSeq), time: Date.now(), data,
    }
    try {
      await this.handle.append([event])
      await this.handle.flush()
      const { events } = await this.handle.read(event.seq, 1)
      if (JSON.stringify(events[0]) !== JSON.stringify(event)) {
        throw new TaskJournalError('TASK_CORRUPT', 'task operation readback differs from the committed event')
      }
      this.nextSeq += 1
    } catch (error) {
      this.poisoned = true
      throw error
    }
  }

  private restore(event: SessionEvent, identity: TaskDomainIdentity): void {
    if (event.type !== 'continuum/task-operation' || event.seq !== this.nextSeq || event.ignorable === true) corrupt()
    const data = parseOperation(event.data)
    if (this.nextSeq === 0) {
      if (data.kind !== 'init') corrupt()
      if (JSON.stringify(data.identity) !== JSON.stringify(identity)) {
        throw new TaskJournalError('TASK_IDENTITY_MISMATCH', 'task domain identity does not match the authorized host')
      }
    } else {
      if (data.kind !== 'commit' || this.accepted.has(data.request.requestId)) corrupt()
      const digest = requestDigest(data.request)
      if (digest !== data.digest) corrupt()
      const { task, receipt } = this.prepare(data.request)
      if (JSON.stringify(receipt) !== JSON.stringify(data.receipt)) corrupt()
      this.publish(task, receipt, digest)
    }
    this.nextSeq += 1
  }
}

function transition(previous: TaskSnapshot | undefined, command: TaskCommand, revision: number): TaskSnapshot {
  if (command.kind === 'create') {
    if (previous !== undefined) throw new TaskJournalError('TASK_ENTRY_CONFLICT', 'task already exists')
    return freezeTask(command.taskId, revision, [freezeEntry(command.entry)])
  }
  if (previous === undefined) throw new TaskJournalError('TASK_NOT_FOUND', 'task does not exist')
  if (command.kind !== 'deactivate' && previous.entries.some(entry => entry.id === command.entry.id)) {
    throw new TaskJournalError('TASK_ENTRY_CONFLICT', 'task entry id has already been used')
  }
  if (command.kind === 'append') return freezeTask(previous.id, revision, [...previous.entries, freezeEntry(command.entry)])
  const targetId = command.kind === 'supersede' ? command.predecessor : command.entryId
  const target = previous.entries.find(entry => entry.id === targetId)
  if (target === undefined) throw new TaskJournalError('TASK_NOT_FOUND', 'task entry does not exist')
  if (target.status !== 'active') throw new TaskJournalError('TASK_ENTRY_INACTIVE', 'task entry is no longer active')
  const entries = previous.entries.map(entry => entry.id === targetId
    ? Object.freeze({ ...entry, status: command.kind === 'supersede' ? 'superseded' as const : 'deactivated' as const })
    : entry)
  if (command.kind === 'supersede') entries.push(Object.freeze({ ...freezeEntry(command.entry), supersedes: targetId }))
  return freezeTask(previous.id, revision, entries)
}

function freezeTask(id: MemoryTaskId, revision: number, entries: readonly TaskStoredEntry[]): TaskSnapshot {
  return Object.freeze({ id, revision, entries: Object.freeze(entries) })
}

function freezeEntry(entry: TaskEntry): TaskStoredEntry {
  return Object.freeze({ ...entry, source: Object.freeze({ ...entry.source }), status: 'active' })
}

function copyRequest(request: TaskCommitRequest): TaskCommitRequest {
  const { command } = request
  const common = { requestId: request.requestId, expectedRevision: request.expectedRevision }
  if (command.kind === 'deactivate') return { ...common, command: { kind: command.kind, taskId: command.taskId, entryId: command.entryId } }
  const entry: TaskEntry = { id: command.entry.id, role: command.entry.role, text: command.entry.text, source: {
    sessionId: command.entry.source.sessionId, eventSeq: command.entry.source.eventSeq,
    blockIndex: command.entry.source.blockIndex, digest: command.entry.source.digest,
  } }
  return command.kind === 'supersede'
    ? { ...common, command: { kind: 'supersede', taskId: command.taskId, predecessor: command.predecessor, entry } }
    : { ...common, command: { kind: command.kind, taskId: command.taskId, entry } }
}

function requestDigest(request: TaskCommitRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

function corrupt(): never { throw new TaskJournalError('TASK_CORRUPT', 'invalid task journal operation') }

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) corrupt()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) corrupt()
  return record
}

function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) corrupt()
  return value
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) corrupt()
  return value
}

function digest(value: unknown): string {
  const text = string(value)
  if (!/^[a-f0-9]{64}$/.test(text)) corrupt()
  return text
}

function parseEntry(value: unknown): TaskEntry {
  const entry = fields(value, ['id', 'role', 'text', 'source'])
  const source = fields(entry['source'], ['sessionId', 'eventSeq', 'blockIndex', 'digest'])
  const role = entry['role']
  if (role !== 'input' && role !== 'progress') corrupt()
  if (typeof entry['text'] !== 'string') corrupt()
  return { id: MemoryId(string(entry['id'])), role, text: entry['text'], source: {
    sessionId: SessionId(string(source['sessionId'])), eventSeq: SessionSeq(integer(source['eventSeq'])),
    blockIndex: integer(source['blockIndex']), digest: digest(source['digest']),
  } }
}

function parseCommand(value: unknown): TaskCommand {
  if (typeof value !== 'object' || value === null || !('kind' in value)) corrupt()
  if (value.kind === 'deactivate') {
    const command = fields(value, ['kind', 'taskId', 'entryId'])
    return { kind: 'deactivate', taskId: MemoryTaskId(string(command['taskId'])), entryId: MemoryId(string(command['entryId'])) }
  }
  if (value.kind !== 'create' && value.kind !== 'append' && value.kind !== 'supersede') corrupt()
  const command = fields(value, value.kind === 'supersede' ? ['kind', 'taskId', 'predecessor', 'entry'] : ['kind', 'taskId', 'entry'])
  const taskId = MemoryTaskId(string(command['taskId']))
  const entry = parseEntry(command['entry'])
  return value.kind === 'supersede'
    ? { kind: 'supersede', taskId, predecessor: MemoryId(string(command['predecessor'])), entry }
    : { kind: value.kind, taskId, entry }
}

function parseOperation(value: unknown): TaskOperationData {
  if (typeof value !== 'object' || value === null || !('kind' in value)) corrupt()
  if (value.kind === 'init') {
    const data = fields(value, ['version', 'kind', 'identity'])
    if (data['version'] !== 1) corrupt()
    const identity = fields(data['identity'], ['domainId', 'principalId', 'workspace'])
    return { version: 1, kind: 'init', identity: {
      domainId: MemoryDomainId(string(identity['domainId'])), principalId: MemoryPrincipalId(string(identity['principalId'])),
      workspace: string(identity['workspace']),
    } }
  }
  const data = fields(value, ['version', 'kind', 'request', 'digest', 'receipt'])
  if (data['version'] !== 1 || value.kind !== 'commit') corrupt()
  const request = fields(data['request'], ['requestId', 'expectedRevision', 'command'])
  const receipt = fields(data['receipt'], ['revision', 'taskId', 'requestId'])
  return { version: 1, kind: 'commit', request: copyRequest({
    requestId: string(request['requestId']), expectedRevision: integer(request['expectedRevision']), command: parseCommand(request['command']),
  }), digest: digest(data['digest']), receipt: {
    revision: integer(receipt['revision']), taskId: MemoryTaskId(string(receipt['taskId'])), requestId: string(receipt['requestId']),
  } }
}
