/** Authorized durable human input reads for the configured single-principal task domain. */
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionHeader, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'

/** Exact text block in a durable human message. */
export interface TaskSourceInput {
  readonly sessionId: SessionId
  readonly eventSeq: SessionSeq
  readonly blockIndex: number
}

/** Verbatim source and its UTF-8 SHA-256 digest. */
export interface TaskSourceRead {
  readonly text: string
  readonly source: TaskSourceInput & { readonly digest: string }
}

async function authorizeHeader(header: SessionHeader, id: SessionId, workspace: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (header.id !== id || header.cwd === undefined) throw new Error('task source workspace access denied')
  let canonical: string
  try {
    canonical = await realpath(header.cwd)
  } catch (error: unknown) {
    // Filesystem details are not part of the model-visible authorization failure.
    void error
    throw new Error('task source workspace is unavailable')
  }
  signal?.throwIfAborted()
  if (canonical !== workspace) throw new Error('task source workspace access denied')
}

/**
 * Read one durable human text block within the host-authorized canonical workspace.
 * Live source Sessions are flushed before reading. Cold sources require an exclusive
 * write lease and exact readback after flush; a foreign writer prevents admission.
 * The caller owns task authorization and compares returned text with any previously captured input.
 * @param ctx - Host context with Sessions and Session persistence.
 * @param agent - Calling Agent whose workspace must match the configured domain.
 * @param workspace - Existing canonical workspace fixed by the domain configuration.
 * @param source - Exact source Session, event sequence, and text block index.
 * @param signal - Cancellation checked across filesystem and persistence reads.
 * @returns Unmodified text and its exact source reference with a UTF-8 digest.
 * @throws When workspace access, durable source identity, or human text validation fails.
 */
export async function readTaskSource(
  ctx: Context,
  agent: Agent,
  workspace: string,
  source: TaskSourceInput,
  signal?: AbortSignal,
): Promise<TaskSourceRead> {
  await authorizeHeader(agent.session.header, agent.session.id, workspace, signal)
  if (!Number.isSafeInteger(source.blockIndex) || source.blockIndex < 0) throw new Error('task source text block is invalid')
  const options = signal === undefined ? undefined : { signal }
  const live = ctx.sessions.get(source.sessionId)
  if (live !== undefined) {
    await authorizeHeader(live.header, source.sessionId, workspace, signal)
    if (!await ctx.sessions.flush(live)) throw new Error('task source has no durability listener')
    signal?.throwIfAborted()
  }
  const observed = await ctx.sessionPersistence.stat(source.sessionId, options)
  signal?.throwIfAborted()
  if (observed === undefined) throw new Error('task source session was not found')
  await authorizeHeader(observed.header, source.sessionId, workspace, signal)
  const handle = await ctx.sessionPersistence.open(source.sessionId, live === undefined ? 'write' : 'read', options)
  let result: TaskSourceRead
  try {
    if (handle.id !== source.sessionId) throw new Error('task source session identity changed')
    await authorizeHeader(handle.header, source.sessionId, workspace, signal)
    const { events } = await handle.read(source.eventSeq, 1, options)
    await authorizeHeader(handle.header, source.sessionId, workspace, signal)
    await authorizeHeader(agent.session.header, agent.session.id, workspace, signal)
    if (live === undefined) {
      await handle.flush(options)
      signal?.throwIfAborted()
      const readback = await handle.read(source.eventSeq, 1, options)
      await authorizeHeader(handle.header, source.sessionId, workspace, signal)
      await authorizeHeader(agent.session.header, agent.session.id, workspace, signal)
      if (!isDeepStrictEqual(readback.events, events)) throw new Error('task source changed during durable readback')
    }
    const event = events[0]
    if (events.length !== 1 || event === undefined || event.seq !== source.eventSeq
      || event.type !== 'user/message' || event.data.source.kind !== 'user') {
      throw new Error('task source is not the requested durable human message')
    }
    const block = event.data.content[source.blockIndex]
    if (block?.type !== 'text') throw new Error('task source text block was not found')
    result = { text: block.text, source: { ...source, digest: createHash('sha256').update(block.text, 'utf8').digest('hex') } }
  } finally {
    await handle.close()
  }
  signal?.throwIfAborted()
  return result
}
