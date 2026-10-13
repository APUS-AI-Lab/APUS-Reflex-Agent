/** Exact active task text pages bounded by their complete JSON UTF-8 representation. */
import type { TaskSnapshot, TaskStoredEntry } from './task-types.ts'

/** A position within a revisioned task's original entry array and UTF-16 text. */
export interface TaskPageOptions {
  readonly maxBytes: number
  readonly entryIndex?: number
  readonly textOffset?: number
  readonly expectedRevision?: number
}

/** Revision-bound continuation returned only when active task text remains. */
export interface TaskPageCursor {
  readonly entryIndex: number
  readonly textOffset: number
  readonly revision: number
}

/** Exact slice of an active entry, with positions in its complete source text. */
export interface TaskPageEntry {
  readonly id: TaskStoredEntry['id']
  readonly status: 'active'
  readonly role: TaskStoredEntry['role']
  readonly source: TaskStoredEntry['source']
  readonly text: string
  readonly textOffset: number
  readonly nextTextOffset: number
}

/** JSON page; pending reports unread active text, never task execution status. */
export interface TaskPage {
  readonly taskId: TaskSnapshot['id']
  readonly revision: number
  readonly totalEntries: number
  readonly activeEntries: number
  readonly entries: readonly TaskPageEntry[]
  readonly next: TaskPageCursor | null
  readonly pending: boolean
}

/**
 * Render active entries in original order without trimming text or splitting surrogate pairs.
 * Caller owns task authorization. Resuming a page requires its revision to prevent a
 * changed entry list from silently skipping requirements. A page unable to represent
 * metadata and at least one remaining character fails instead of returning a stuck cursor.
 * @param snapshot - immutable task state whose source text has already been verified.
 * @param options - total serialized-byte limit and optional revision-bound starting position.
 * @returns JSON containing exact text slices, source references and a continuation or null.
 */
export function renderTaskPage(snapshot: TaskSnapshot, options: TaskPageOptions): string {
  const entryIndex = options.entryIndex ?? 0
  const textOffset = options.textOffset ?? 0
  assertPosition(snapshot, options, entryIndex, textOffset)
  const entries: TaskPageEntry[] = []
  const activeEntries = snapshot.entries.filter(entry => entry.status === 'active').length
  const serialize = (next: TaskPageCursor | null): string => JSON.stringify({
    taskId: snapshot.id,
    revision: snapshot.revision,
    totalEntries: snapshot.entries.length,
    activeEntries,
    entries,
    next,
    pending: next !== null,
  } satisfies TaskPage)
  let cursor = nextActive(snapshot, entryIndex, textOffset)
  let rendered = serialize(cursor)
  if (Buffer.byteLength(rendered) > options.maxBytes) throw capacityError()

  while (cursor !== null) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- nextActive returns only existing entry indices.
    const entry = snapshot.entries[cursor.entryIndex]!
    const start = cursor.textOffset
    const following = nextActive(snapshot, cursor.entryIndex + 1, 0)
    const pageEntry = (end: number): TaskPageEntry => ({
      id: entry.id,
      status: 'active',
      role: entry.role,
      source: entry.source,
      text: entry.text.slice(start, end),
      textOffset: start,
      nextTextOffset: end,
    })
    entries.push(pageEntry(entry.text.length))
    const complete = serialize(following)
    if (Buffer.byteLength(complete) <= options.maxBytes) {
      rendered = complete
      cursor = following
      continue
    }
    entries.pop()

    // A complete entry can be cheaper than its partial page because it removes a cursor.
    // It was checked above; only incomplete slices participate in this binary search.
    let low = start + 1
    let high = entry.text.length - 1
    let best: string | undefined
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2)
      const end = safeEnd(entry.text, midpoint)
      if (end <= start) {
        low = midpoint + 1
        continue
      }
      entries.push(pageEntry(end))
      const partial = serialize({ ...cursor, textOffset: end })
      entries.pop()
      if (Buffer.byteLength(partial) <= options.maxBytes) {
        best = partial
        low = midpoint + 1
      } else {
        high = midpoint - 1
      }
    }
    if (best !== undefined) return best
    if (entries.length > 0) return rendered
    throw capacityError()
  }
  return rendered
}

function assertPosition(snapshot: TaskSnapshot, options: TaskPageOptions, index: number, offset: number): void {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new RangeError('task page maxBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(index) || index < 0 || index > snapshot.entries.length) {
    throw new RangeError('task page entryIndex is outside the task')
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('task page textOffset must be a nonnegative safe integer')
  }
  if ((index !== 0 || offset !== 0) && options.expectedRevision === undefined) {
    throw new Error('task page continuation requires expectedRevision')
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== snapshot.revision) {
    throw new Error('task page revision conflict; restart at the current task revision')
  }
  const entry = snapshot.entries[index]
  if (entry === undefined || entry.status !== 'active') {
    if (offset !== 0) throw new RangeError('task page textOffset requires an active entry')
  } else if (offset > entry.text.length || safeEnd(entry.text, offset) !== offset) {
    throw new RangeError('task page textOffset must be within text at a surrogate-safe position')
  }
}

function nextActive(snapshot: TaskSnapshot, index: number, textOffset: number): TaskPageCursor | null {
  for (let current = index; current < snapshot.entries.length; current++) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- current is bounded by this immutable array length.
    if (snapshot.entries[current]!.status === 'active') {
      return { entryIndex: current, textOffset: current === index ? textOffset : 0, revision: snapshot.revision }
    }
  }
  return null
}

function safeEnd(text: string, end: number): number {
  const before = text.charCodeAt(end - 1)
  const after = text.charCodeAt(end)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? end - 1 : end
}

function capacityError(): Error {
  return new RangeError('task page maxBytes cannot fit required metadata and the next text character; increase maxBytes')
}
