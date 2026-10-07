/**
 * Lossless folding of repeated shell output: a run of lines that repeats earlier kept
 * lines byte for byte becomes one back-reference marker. The rule follows mu's
 * test-log admission (MIT, github.com/qybaihe/mu, `kyrn-judge/src/admission/test-log.ts`).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import { commandOf } from './process-supervision.ts'

/** Which shell results are folded and how large a repeat must be; deployment-owned. */
export interface System3OutputFoldingConfig {
  /** `shadow` records what folding would save without changing results; `active` also replaces the model-visible text. */
  readonly mode: 'shadow' | 'active'
  /** Shell tools whose single-text results are inspected. */
  readonly shellTools: readonly string[]
  /** Case-insensitive regular expression a command must match, such as test runners and builds. */
  readonly commandPattern: string
  /** Fewest consecutive repeated lines worth one marker. */
  readonly minLines: number
  /** Fewest repeated characters worth one marker. */
  readonly minChars: number
  /** Folding applies only when it saves at least this many characters ... */
  readonly minNetChars: number
  /** ... and at least this share of the original text. */
  readonly minNetShare: number
}

/** One folded or would-be-folded shell result, recorded in the Session of the calling Agent. */
export interface System3OutputFold {
  readonly version: 1
  readonly tool: string
  /** Original lines replaced by markers. */
  readonly foldedLines: number
  /** Characters the folded text is shorter than the original. */
  readonly savedChars: number
  /** Whether the model saw the folded text; `false` in shadow mode. */
  readonly applied: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A shell result was folded, or would have been in shadow mode; the folded text itself is the logged tool result. */
    'system3/output-fold': System3OutputFold
  }
}

/** The thresholds {@link foldRepeatedLines} applies. */
export type System3FoldLimits = Pick<System3OutputFoldingConfig, 'minLines' | 'minChars' | 'minNetChars' | 'minNetShare'>

/** A folded text and what it saved. */
export interface System3FoldedText {
  readonly text: string
  readonly foldedLines: number
  readonly savedChars: number
}

/** Earlier occurrences of one window tried per line, so text of identical lines stays linear. */
const MAX_SOURCES = 16
/** Characters of the repeated block's first line quoted in a marker, so a person can find it without line numbers. */
const OPENING_CHARS = 60

interface Repeat {
  readonly start: number
  readonly end: number
  /** First line of the kept run it repeats, as an index into the original lines. */
  readonly source: number
}

/** Runs repeating earlier kept lines; a source never contains a folded line, so expansion always succeeds. */
function findRepeats(lines: readonly string[], limits: System3FoldLimits): Repeat[] {
  const windows = new Map<string, number[]>()
  const kept: boolean[] = []
  const found: Repeat[] = []
  let streak = 0
  let line = 0
  while (line < lines.length) {
    let best = 0
    let source = -1
    for (const start of (windows.get(lines.slice(line, line + limits.minLines).join('')) ?? []).slice(-MAX_SOURCES)) {
      let length = 0
      while (start + length < line && kept[start + length] === true && line + length < lines.length
        && lines[start + length] === lines[line + length]) length++
      if (length > best) { best = length; source = start }
    }
    const chars = lines.slice(line, line + best).reduce((sum, text) => sum + text.length, 0)
    if (best >= limits.minLines && chars >= limits.minChars) {
      found.push({ start: line, end: line + best, source })
      streak = 0
      line += best
      continue
    }
    kept[line] = true
    // A window becomes a source only once all of its lines are known to stay.
    if (++streak >= limits.minLines) {
      const start = line - limits.minLines + 1
      const key = lines.slice(start, line + 1).join('')
      windows.set(key, [...windows.get(key) ?? [], start])
    }
    line++
  }
  return found
}

/**
 * Fold runs of lines that repeat earlier kept lines byte for byte. Each marker names the
 * lines of the returned text it repeats, in order and with counts, so expanding every
 * marker restores the original exactly, and quotes the first line of the first repeated
 * block, shortened to 60 characters, for readers without line numbers.
 * @param text - Shell output; line endings are compared and kept as they are.
 * @param limits - Smallest repeat worth a marker and smallest saving worth folding.
 * @returns The folded text, or `undefined` when nothing repeats or the saving is too small.
 */
export function foldRepeatedLines(text: string, limits: System3FoldLimits): System3FoldedText | undefined {
  const lines = text.split(/(?<=\n)/u)
  const repeats = findRepeats(lines, limits)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  /** The line number in the returned text of each kept original line. */
  const shown = new Map<number, number>()
  let output = ''
  let count = 0
  let foldedLines = 0
  const emit = (from: number, to: number): void => {
    for (let index = from; index < to; index++) { shown.set(index, ++count); output += lines[index] as string }
  }
  let line = 0
  let next = 0
  while (line < lines.length) {
    if (next >= repeats.length || (repeats[next] as Repeat).start > line) {
      const until = next < repeats.length ? (repeats[next] as Repeat).start : lines.length
      emit(line, until)
      line = until
      continue
    }
    // Adjacent repeats share one marker.
    const run: Repeat[] = []
    while (next < repeats.length && (repeats[next] as Repeat).start === line) {
      const repeat = repeats[next++] as Repeat
      run.push(repeat)
      line = repeat.end
    }
    const refs: { range: string; times: number }[] = []
    for (const repeat of run) {
      const first = shown.get(repeat.source) as number
      const range = `${String(first)}-${String(first + repeat.end - repeat.start - 1)}`
      const last = refs.at(-1)
      if (last?.range === range) last.times++
      else refs.push({ range, times: 1 })
    }
    const total = line - (run[0] as Repeat).start
    const list = refs.map(ref => ref.times > 1 ? `第 ${ref.range} 行 ×${String(ref.times)}` : `第 ${ref.range} 行`).join('、')
    const opening = (lines[(run[0] as Repeat).source] as string).trim()
    const quoted = opening.length > OPENING_CHARS ? `${opening.slice(0, OPENING_CHARS)}…` : opening
    const marker = `[System3 已折叠 ${String(total)} 行：与上文${list}逐字相同${quoted === '' ? '' : `，开头是 "${quoted}"`}]${eol}`
    const original = lines.slice((run[0] as Repeat).start, line).join('')
    // A run shorter than its own marker stays as it is.
    if (original.length > marker.length) {
      output += marker
      count++
      foldedLines += total
    } else emit((run[0] as Repeat).start, line)
  }
  const savedChars = text.length - output.length
  if (foldedLines === 0 || savedChars < Math.max(limits.minNetChars, text.length * limits.minNetShare)) return undefined
  return { text: output, foldedLines, savedChars }
}

/**
 * Fold repeated lines in matching shell results of every Agent on this context and record each fold.
 * @param ctx - Plugin context; the listener is disposed with it.
 * @param config - Which results to inspect, the repeat thresholds, and whether to apply the fold.
 */
export function installSystem3OutputFolding(ctx: Context, config: System3OutputFoldingConfig): void {
  for (const key of ['minLines', 'minChars', 'minNetChars'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`outputFolding ${key} must be a positive integer`)
  }
  if (!(config.minNetShare >= 0 && config.minNetShare < 1)) throw new Error('outputFolding minNetShare must be at least 0 and below 1')
  let command: RegExp
  try {
    command = new RegExp(config.commandPattern, 'iu')
  } catch (error) {
    throw new Error(`outputFolding commandPattern is not a valid regular expression: ${config.commandPattern}`, { cause: error })
  }
  const active = config.mode === 'active'

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    const agent = exec.agent
    if (agent === undefined || exec.parent !== undefined || decision.kind !== 'accept' || Object.hasOwn(decision, 'value') || result.isError
      || !config.shellTools.includes(exec.name) || !command.test(commandOf(exec))) return decision
    const content = decision.content ?? result.content
    const block = content.length === 1 ? content[0] : undefined
    if (block?.type !== 'text') return decision
    const folded = foldRepeatedLines(block.text, config)
    if (folded === undefined) return decision
    agent.session.append('system3/output-fold', {
      version: 1, tool: exec.name, foldedLines: folded.foldedLines, savedChars: folded.savedChars, applied: active })
    if (!active) return decision
    const contexts = decision.additionalContexts
    return { kind: 'accept', content: [{ type: 'text', text: folded.text }], ...contexts === undefined ? {} : { additionalContexts: contexts } }
  })
}
