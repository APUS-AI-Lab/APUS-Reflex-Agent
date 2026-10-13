/** Durable vocabulary for explicitly authorized cross-session tasks. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { MemoryId } from './records.ts'

/** Stable task identity inside one memory domain. */
export type MemoryTaskId = Branded<'MemoryTaskId'>
/** Stable identity of one independently authorized memory domain. */
export type MemoryDomainId = Branded<'MemoryDomainId'>
/** Host-bound principal; model-supplied strings never confer authority. */
export type MemoryPrincipalId = Branded<'MemoryPrincipalId'>

/** Brand a nonempty task identifier.
 * @param value - Host-admitted task identifier.
 * @returns The branded identifier.
 */
export function MemoryTaskId(value: string): MemoryTaskId {
  if (value.length === 0) throw new TypeError('task id must not be empty')
  return brandString<MemoryTaskId>(value)
}

/** Brand a nonempty domain identifier.
 * @param value - Host-admitted domain identifier.
 * @returns The branded identifier.
 */
export function MemoryDomainId(value: string): MemoryDomainId {
  if (value.length === 0) throw new TypeError('domain id must not be empty')
  return brandString<MemoryDomainId>(value)
}

/** Brand a nonempty principal identifier.
 * @param value - Identity supplied by the trusted host.
 * @returns The branded identifier.
 */
export function MemoryPrincipalId(value: string): MemoryPrincipalId {
  if (value.length === 0) throw new TypeError('principal id must not be empty')
  return brandString<MemoryPrincipalId>(value)
}

/** Immutable authorization identity of one journal; callers validate canonical workspace membership. */
export interface TaskDomainIdentity {
  readonly domainId: MemoryDomainId
  readonly principalId: MemoryPrincipalId
  readonly workspace: string
}

/** Exact original text block, verified and durably saved by the calling service before admission. */
export interface TaskEntrySource {
  readonly sessionId: SessionId
  readonly eventSeq: SessionSeq
  readonly blockIndex: number
  readonly digest: string
}

/** Complete source text; storage imposes no display or item-count truncation. */
export interface TaskEntry {
  readonly id: MemoryId
  readonly role: 'input' | 'progress'
  readonly text: string
  readonly source: TaskEntrySource
}

/** Latest state of an entry, including retired evidence retained for audit. */
export interface TaskStoredEntry extends TaskEntry {
  readonly status: 'active' | 'superseded' | 'deactivated'
  readonly supersedes?: MemoryId
}

/** One explicit task operation; ambiguous corrections never imply supersession. */
export type TaskCommand =
  | { readonly kind: 'create'; readonly taskId: MemoryTaskId; readonly entry: TaskEntry }
  | { readonly kind: 'append'; readonly taskId: MemoryTaskId; readonly entry: TaskEntry }
  | { readonly kind: 'supersede'; readonly taskId: MemoryTaskId; readonly predecessor: MemoryId; readonly entry: TaskEntry }
  | { readonly kind: 'deactivate'; readonly taskId: MemoryTaskId; readonly entryId: MemoryId }

/** Request identity covers the original expected revision and the entire operation. */
export interface TaskCommitRequest {
  readonly requestId: string
  readonly expectedRevision: number
  readonly command: TaskCommand
}

/** Returned only after the exact operation has crossed the durability barrier and been read back. */
export interface TaskReceipt {
  readonly revision: number
  readonly taskId: MemoryTaskId
  readonly requestId: string
}

/** Immutable task projection; revision is the domain revision of its latest change. */
export interface TaskSnapshot {
  readonly id: MemoryTaskId
  readonly revision: number
  readonly entries: readonly TaskStoredEntry[]
}

/** Metadata available without copying task input text. */
export type TaskMetadata = Pick<TaskSnapshot, 'id' | 'revision'>

/** Authoritative domain log vocabulary; initialization precedes all commits. */
export type TaskOperationData =
  | { readonly version: 1; readonly kind: 'init'; readonly identity: TaskDomainIdentity }
  | { readonly version: 1; readonly kind: 'commit'; readonly request: TaskCommitRequest; readonly digest: string; readonly receipt: TaskReceipt }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Ordered task-domain operation in an isolated journal; not model-visible. */
    'continuum/task-operation': TaskOperationData
  }
}
