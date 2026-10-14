import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const patchTemplatePath = fileURLToPath(new URL('./fixtures/continuum-lossless.patch.yml', import.meta.url))
const llmFixturePath = fileURLToPath(new URL('./fixtures/continuum-lossless-llm.ts', import.meta.url))
const packagesRoot = fileURLToPath(new URL('../../../../../../packages/', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const PROCESS_TIMEOUT_MS = 60_000
const SCENARIO_TIMEOUT_MS = 600_000
const CODE_INPUT = 'Remember the access code ALPHA-7731 for later.'
const TURNS = [CODE_INPUT, 'Padding request 0.', 'Padding request 1.', 'Padding request 2.', 'Padding request 3.',
  'What was the access code?', 'Padding request after the question.', 'Quote the original access-code message.']

type Mode = 'src' | 'lib'

/** A local Reflex gateway: only the access code is worth keeping, and only a question about a code needs it. */
async function gateway(down: boolean): Promise<{ server: Server; endpoint: string; questions: string[][] }> {
  const questions: string[][] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      const parsed = JSON.parse(body) as { model: string; questions: Record<string, { instructions?: string }> }
      questions.push(Object.values(parsed.questions).map(question => question.instructions ?? ''))
      if (down) {
        response.statusCode = 500
        response.end('{"error":"gateway down"}')
        return
      }
      const answers = Object.fromEntries(Object.entries(parsed.questions).map(([key, question]) => {
        const text = question.instructions ?? ''
        const query = /Query: «(.*?)»\. Candidate/u.exec(text)?.[1]
        const keep = /ALPHA-\d+/u.test(text) && (query === undefined || /code/iu.test(query))
        return [key, { type: 'noul', noul: keep ? 0.93 : 0.04 }]
      }))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ model: parsed.model, answers, usage: { inputTokens: 10, outputTokens: 1 } }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return { server, endpoint: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, questions }
}

function patchFor(template: string, mode: Mode): string {
  const plugins = template
    .replaceAll('./continuum-lossless-llm.ts', llmFixturePath)
    .replaceAll('../../../../../../../packages/', packagesRoot)
  return mode === 'lib' ? plugins : plugins.replaceAll('/lib/index.js', '/src/index.ts').replaceAll('/lib/product-memory.js', '/src/product-memory.ts')
}

function sessionIdOf(stdout: string): string {
  const value = JSON.parse(stdout.split('\n')[0] ?? '{}') as { sessionId?: string }
  if (value.sessionId === undefined) throw new Error('headless profile did not emit a session id')
  return value.sessionId
}

async function persistedEvents(cwd: string, sessionId: string): Promise<SessionEvent[]> {
  const sessionsDir = join(cwd, '.dsh', 'sessions')
  const files = (await readdir(sessionsDir, { recursive: true }))
    .filter(file => file.split(sep).includes(sessionId) && /\.jsonl$/u.test(file))
  expect(files).toHaveLength(1)
  return (await readFile(join(sessionsDir, files[0]!), 'utf8')).trim().split('\n')
    .map(line => JSON.parse(line) as SessionEvent | { type: 'session' })
    .filter((event): event is SessionEvent => event.type !== 'session')
}

interface Run {
  readonly events: SessionEvent[]
  /** Final assistant text of each turn, in order. */
  readonly answers: string[]
  readonly questions: string[][]
}

/** Run every turn as its own headless process that resumes the persisted Session. */
async function run(label: string, mode: Mode, env: Record<string, string>, down = false): Promise<Run> {
  const cwd = await mkdtemp(join(tmpdir(), `continuum-lossless-${label}-`))
  const reflex = await gateway(down)
  try {
    const patchPath = join(cwd, 'continuum-lossless.patch.yml')
    await writeFile(patchPath, patchFor(await readFile(patchTemplatePath, 'utf8'), mode))
    // The JSONL backend writes plain files, so the test reads the log without decompression.
    await writeFile(join(cwd, 'persistence.patch.yml'), '- id: session-persistence-jsonl\n  config:\n    root: !!js dshHomePath(\'sessions\')\n    compression: none\n')
    let sessionId: string | undefined
    for (const task of TURNS) {
      const result = await runLoaderSmoke({
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        label: `Continuum lossless ${label} ${mode}`, mode, ...(mode === 'src' ? { sourceImport: 'tsx/esm' as const } : {}),
        cwd, binScript, tsconfigPath, configPath: patchPath,
        binArgs: ['--profile', 'headless', '--patch', patchPath, '--patch', join(cwd, 'persistence.patch.yml'), '--json',
          ...(sessionId === undefined ? [] : ['--session-id', sessionId]), task],
        env: { DSH_TELEMETRY_DISABLED: '1', LOSSLESS_JEV_ENDPOINT: reflex.endpoint, ...env },
      })
      expect(result.stderr).not.toContain('UNHANDLED')
      sessionId ??= sessionIdOf(result.stdout)
    }
    if (sessionId === undefined) throw new Error('no turn ran')
    const events = await persistedEvents(cwd, sessionId)
    const answers = events.filter(event => event.type === 'turn/end').map((end) => {
      const before = events.slice(0, events.indexOf(end))
      const message = before.findLast(event => event.type === 'assistant/message')
      return message?.type === 'assistant/message'
        ? message.data.message.content.map(block => block.type === 'text' ? block.text : '').join('')
        : ''
    })
    return { events, answers, questions: reflex.questions }
  } finally {
    reflex.server.close()
    await rm(cwd, { recursive: true, force: true })
  }
}

const ofType = <T extends SessionEvent['type']>(events: readonly SessionEvent[], type: T) =>
  events.filter((event): event is SessionEvent<T> => event.type === type)
const records = (events: readonly SessionEvent[]) => ofType(events, 'continuum/memory-record').map(event => event.data.record)
const settled = (events: readonly SessionEvent[]) => ofType(events, 'continuum/memory-admission').filter(event => event.data.phase === 'settled')
const decisions = (events: readonly SessionEvent[]) => ofType(events, 'continuum/memory-decision')
  .filter(event => event.data.evaluation?.phase !== 'prepared')
const recalls = (events: readonly SessionEvent[]) => ofType(events, 'user/message')
  .filter(event => event.data.source.kind === 'continuum-memory')
  .map(event => event.data.content.map(block => block.type === 'text' ? block.text : '').join(''))
/** Events of one turn, by its position in {@link TURNS}. */
function turnEvents(events: readonly SessionEvent[], turn: number): SessionEvent[] {
  const starts = events.flatMap((event, index) => event.type === 'turn/start' ? [index] : [])
  return events.slice(starts[turn], starts[turn + 1])
}
const turnRecalls = (events: readonly SessionEvent[], turn: number): string[] => recalls(turnEvents(events, turn))
/** Seqs of every human input that a compaction checkpoint replaced. */
function compactedHumanSeqs(events: readonly SessionEvent[]): number[] {
  const shadowed = new Set(ofType(events, 'compaction/summary').flatMap(event => event.data.shadowedSeqs.map(Number)))
  return ofType(events, 'user/message').filter(event => event.data.source.kind === 'user' && shadowed.has(Number(event.seq)))
    .map(event => Number(event.seq))
}
const QUESTION = TURNS.indexOf('What was the access code?')
const sourceSeq = (events: readonly SessionEvent[]) => ofType(events, 'user/message').find(event => event.data.source.kind === 'user'
  && event.data.content.some(block => block.type === 'text' && block.text === CODE_INPUT))?.seq

describe('Continuum lossless memory through the shipped headless CLI', () => {
  it.each(['src', 'lib'] as const)('keeps only the compacted input later work needs and recalls it for the question that needs it (%s)', async (mode) => {
    const { events, answers, questions } = await run('active', mode, {})
    expect(ofType(events, 'compaction/summary').length).toBeGreaterThan(0)
    const admissions = settled(events)
    expect(admissions.length).toBeGreaterThan(0)
    expect(admissions.every(event => event.data.outcome === 'jev' && event.data.reason === 'judged' && event.data.preparedSeq !== undefined)).toBe(true)
    expect(admissions.flatMap(event => event.data.candidateIds).length).toBeGreaterThan(1)
    expect(records(events).map(record => record.content)).toEqual([CODE_INPUT])
    // Every compacted human input was judged, although each turn ran in its own process.
    expect(new Set(admissions.flatMap(event => event.data.candidateIds).map(id => Number(id.split(':').at(-1)))))
      .toEqual(new Set(compactedHumanSeqs(events)))
    expect(records(events)[0]?.sourceRefs.map(ref => ref.eventSeq)).toEqual([sourceSeq(events)])

    const shown = turnRecalls(events, QUESTION)
    expect(shown).toHaveLength(1)
    expect(recalls(events.slice(0, events.indexOf(turnEvents(events, QUESTION)[0]!)))).toEqual([])
    expect(shown[0]).toContain(CODE_INPUT)
    expect(shown[0]).toContain(`"eventSeq":${String(sourceSeq(events))}`)
    expect(answers[QUESTION]).toBe('From memory: the code is ALPHA-7731.')
    expect(decisions(turnEvents(events, QUESTION + 1)).at(-1)?.data).toMatchObject({ outcome: 'jev', selectedIds: [] })
    expect(turnRecalls(events, QUESTION + 1)).toEqual([])
    expect(turnRecalls(events, QUESTION + 2).join('\n')).toContain(CODE_INPUT)
    expect(answers[QUESTION + 1]).toContain('Acknowledged.')
    const read = ofType(events, 'tool/call').find(event => event.data.name === 'history_read')
    expect(JSON.parse(read?.data.arguments ?? '{}')).toEqual({ event: sourceSeq(events) })
    const original = ofType(events, 'tool/result').find(event => event.data.message.content
      .some(block => block.type === 'text' && block.text.includes(`#${String(sourceSeq(events))} User: ${CODE_INPUT}`)))
    expect(original).toBeDefined()
    expect(answers[QUESTION + 2]).toBe('From history: the code is ALPHA-7731.')
    expect(questions.some(batch => batch.some(question => question.includes('Compaction removed this user message')))).toBe(true)
    expect(questions.some(batch => batch.some(question => question.includes('Query: «What was the access code?»')))).toBe(true)
  }, SCENARIO_TIMEOUT_MS)

  it.each([
    ['reflex-off', { LOSSLESS_JEV_MODE: 'off' }],
    ['no-reflex', { LOSSLESS_NO_JEV: '1' }],
  ] as const)('behaves as the base profile with %s', async (label, env) => {
    const { events, answers, questions } = await run(label, 'src', env)
    expect(ofType(events, 'compaction/summary').length).toBeGreaterThan(0)
    expect(events.some(event => event.type.startsWith('continuum/'))).toBe(false)
    expect(recalls(events)).toEqual([])
    expect(ofType(events, 'tool/call')).toEqual([])
    expect(questions).toEqual([])
    expect(answers[QUESTION]).toBe('I do not know the code.')
    expect(answers[QUESTION + 2]).toBe('I do not know the code.')
  }, SCENARIO_TIMEOUT_MS)

  it('keeps every compacted input and recalls by shared terms when the Reflex gateway fails', async () => {
    const { events, answers } = await run('jev-down', 'src', {}, true)
    const admissions = settled(events)
    expect(admissions.length).toBeGreaterThan(0)
    expect(admissions.every(event => event.data.reason === 'provider-error')).toBe(true)
    expect(records(events)).toHaveLength(admissions.flatMap(event => event.data.candidateIds).length)
    expect(records(events).map(record => record.content)).toContain(CODE_INPUT)
    expect(decisions(events).every(event => event.data.outcome === 'unknown')).toBe(true)
    const question = turnRecalls(events, QUESTION).join('\n')
    expect(question).toContain(CODE_INPUT)
    expect(question).not.toContain('Padding request 1.')
    expect(answers[QUESTION]).toBe('From memory: the code is ALPHA-7731.')
  }, SCENARIO_TIMEOUT_MS)

  it('records shadow judgements while admitting every compacted input and recalling by shared terms', async () => {
    const { events, answers } = await run('shadow', 'src', { LOSSLESS_JEV_MODE: 'shadow' })
    const admissions = settled(events)
    expect(admissions.length).toBeGreaterThan(0)
    expect(admissions.every(event => event.data.mode === 'shadow' && event.data.outcome === 'jev')).toBe(true)
    expect(records(events)).toHaveLength(admissions.flatMap(event => event.data.candidateIds).length)
    expect(turnRecalls(events, QUESTION).join('\n')).toContain(CODE_INPUT)
    expect(answers[QUESTION]).toBe('From memory: the code is ALPHA-7731.')
  }, SCENARIO_TIMEOUT_MS)
})
