/** Shared runner for live Continuum conversations through the shipped headless CLI, one process per turn. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL('../../../../../src/bin.ts', import.meta.url))
const patchTemplatePath = fileURLToPath(new URL('./continuum-lossless-live.patch.yml', import.meta.url))
const packagesRoot = fileURLToPath(new URL('../../../../../../../packages/', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../../tsconfig.json', import.meta.url))

/** Whether both live credentials are present. */
export const live = process.env.DEEPSEEK_API_KEY !== undefined && process.env.APUS_JEV_API_KEY !== undefined

/** Complete persisted log and per-turn wall time of one conversation. */
export interface Conversation {
  readonly events: SessionEvent[]
  readonly elapsed: number[]
}

/**
 * Run every turn as its own headless process on the persisted Session, then read the complete log.
 * @param turns - user inputs in order.
 * @param env - extra environment, such as the Reflex mode.
 * @param template - profile patch whose package paths are rewritten for the temporary directory.
 * @returns the persisted events and per-turn wall time in milliseconds.
 */
export async function converse(
  turns: readonly string[], env: Record<string, string> = {}, template = patchTemplatePath,
): Promise<Conversation> {
  const cwd = await mkdtemp(join(tmpdir(), 'continuum-lossless-live-'))
  try {
    const patchPath = join(cwd, 'continuum-lossless-live.patch.yml')
    await writeFile(patchPath, (await readFile(template, 'utf8')).replaceAll('../../../../../../../packages/', packagesRoot))
    let sessionId: string | undefined
    const elapsed: number[] = []
    for (const task of turns) {
      const started = Date.now()
      const result = await runLoaderSmoke({
        processTimeoutMs: 300_000, label: 'Continuum lossless live', mode: 'src', sourceImport: 'tsx/esm',
        cwd, binScript, tsconfigPath, configPath: patchPath,
        binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', ...(sessionId === undefined ? [] : ['--session-id', sessionId]), task],
        env: { DSH_TELEMETRY_DISABLED: '1', ...env },
      })
      elapsed.push(Date.now() - started)
      sessionId ??= (JSON.parse(result.stdout.split('\n')[0] ?? '{}') as { sessionId: string }).sessionId
    }
    const sessionsDir = join(cwd, '.dsh', 'sessions')
    const file = (await readdir(sessionsDir, { recursive: true })).find(path => path.split(sep).includes(sessionId!) && path.endsWith('.jsonl'))!
    const events = (await readFile(join(sessionsDir, file), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as SessionEvent | { type: 'session' }).filter((event): event is SessionEvent => event.type !== 'session')
    return { events, elapsed }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/**
 * Events of one type, narrowed.
 * @param events - Session events.
 * @param type - event type to keep.
 * @returns the matching events.
 */
export const ofType = <T extends SessionEvent['type']>(events: readonly SessionEvent[], type: T): SessionEvent<T>[] =>
  events.filter((event): event is SessionEvent<T> => event.type === type)

/**
 * Text blocks of a message joined.
 * @param event - a user message event.
 * @returns its text.
 */
export const textOf = (event: SessionEvent<'user/message'>): string =>
  event.data.content.map(block => block.type === 'text' ? block.text : '').join('')

/**
 * Events of one turn, by its position in the conversation.
 * @param events - Session events.
 * @param turn - zero-based turn position.
 * @returns the turn's events.
 */
export function turnEvents(events: readonly SessionEvent[], turn: number): SessionEvent[] {
  const starts = events.flatMap((event, index) => event.type === 'turn/start' ? [index] : [])
  return events.slice(starts[turn], starts[turn + 1])
}

/**
 * Continuum recall text injected during one turn.
 * @param events - Session events.
 * @param turn - zero-based turn position.
 * @returns the joined recall text, empty without recall.
 */
export const turnRecall = (events: readonly SessionEvent[], turn: number): string => ofType(turnEvents(events, turn), 'user/message')
  .filter(event => event.data.source.kind === 'continuum-memory').map(textOf).join('\n')

/**
 * Final assistant text of one turn.
 * @param events - Session events.
 * @param turn - zero-based turn position.
 * @returns the answer text.
 */
export const turnAnswer = (events: readonly SessionEvent[], turn: number): string => {
  const message = ofType(turnEvents(events, turn), 'assistant/message').at(-1)
  return message?.data.message.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
}

/**
 * Texts of the human messages that a compaction checkpoint replaced.
 * @param events - Session events.
 * @returns compacted human texts in order.
 */
export function compactedHuman(events: readonly SessionEvent[]): string[] {
  const shadowed = new Set(ofType(events, 'compaction/summary').flatMap(event => event.data.shadowedSeqs.map(Number)))
  return ofType(events, 'user/message').filter(event => event.data.source.kind === 'user' && shadowed.has(Number(event.seq))).map(textOf)
}

/**
 * A long everyday article the user pastes; nothing in it is worth remembering.
 * @param turn - distinct article number.
 * @returns the pasted text.
 */
export function lifePadding(turn: number): string {
  const topics = ['阳台养花', '衣柜收纳', '居家健身', '手冲咖啡', '旧物改造', '早餐搭配', '整理书架', '城市骑行']
  const lines = Array.from({ length: 160 }, (_, index) =>
    `第${String(turn)}篇第${String(index + 1)}段：${topics[(turn + index) % topics.length]!}的小技巧，属于随手转发的生活文章。`)
  return `转给你一篇文章，看完只回复“收到”，不要调用任何工具。\n${lines.join('\n')}`
}

/** One L1 index entry with the text of the L2 event it points at. */
export interface IndexedMemory {
  readonly tags: readonly string[]
  readonly text: string
}

/**
 * L1 index entries resolved against the L2 log; the entries themselves hold only tags and a pointer.
 * @param events - Session events.
 * @returns each entry's tags and source text, in index order.
 */
export function indexedMemories(events: readonly SessionEvent[]): IndexedMemory[] {
  return ofType(events, 'continuum/memory-index').map(({ data: { entry } }) => {
    const source = events.find(event => event.seq === entry.source.eventSeq)
    return { tags: entry.tags, text: source?.type === 'user/message' ? textOf(source) : '' }
  })
}
