import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { SCENARIOS, type EvalQuestion, type EvalScenario } from './fixtures/continuum-eval-scenarios.ts'
import { compactedHuman, converse, indexedMemories, live, ofType, turnAnswer, turnRecall } from './fixtures/continuum-live-conversation.ts'

/** Opt-in: the evaluation runs every scenario with and without Continuum on real endpoints. */
const enabled = live && process.env.CONTINUUM_EVAL === '1'
const reps = Number(process.env.CONTINUUM_EVAL_REPS ?? '1')
const concurrency = Number(process.env.CONTINUUM_EVAL_CONCURRENCY ?? '6')
const only = process.env.CONTINUUM_EVAL_ONLY?.split(',')

type Mode = 'memory' | 'baseline'

interface QuestionResult {
  readonly ask: string
  readonly pass: boolean
  readonly matched: number
  readonly groups: number
  readonly recallHit: boolean | null
  readonly recalled: number
  readonly ms: number
  readonly answer: string
}

interface RunResult {
  readonly scenario: string
  readonly mode: Mode
  readonly rep: number
  readonly compactions: number
  readonly compacted: number
  readonly records: number
  /** Leading characters of each indexed message with its tags. */
  readonly tags: string[]
  /** Settled admission batches as `admitted/candidates` with their failure, if any. */
  readonly admissions: string[]
  /** Leading characters of each compacted human message. */
  readonly compactedTexts: string[]
  readonly questions: QuestionResult[]
}

function grade(question: EvalQuestion, answer: string): { matched: number; pass: boolean } {
  const text = answer.toLowerCase()
  const matched = question.expect.filter(group => group.some(option => text.includes(option.toLowerCase()))).length
  return { matched, pass: matched >= (question.minGroups ?? question.expect.length) }
}

async function run(scenario: EvalScenario, mode: Mode, rep: number): Promise<RunResult> {
  const turns = [...scenario.history, ...scenario.questions.map(question => question.ask)]
  const { events, elapsed } = await converse(turns, { CONTINUUM_LIVE_JEV_MODE: mode === 'memory' ? 'active' : 'off' })
  const questions = scenario.questions.map((question, index) => {
    const turn = scenario.history.length + index
    const answer = turnAnswer(events, turn)
    const recall = turnRecall(events, turn)
    const recallHit = mode === 'baseline' ? null
      : question.unrelated === true ? recall === ''
        : question.recallHint === undefined ? null : recall.includes(question.recallHint)
    return {
      ask: question.ask, ...grade(question, answer), groups: question.expect.length, recallHit,
      recalled: recall.split('\n').filter(line => line.startsWith('[memory:')).length, ms: elapsed[turn] ?? 0, answer,
    }
  })
  return {
    scenario: scenario.id, mode, rep, compactions: ofType(events, 'compaction/summary').length,
    compacted: compactedHuman(events).length, records: indexedMemories(events).length,
    tags: indexedMemories(events).map(memory => `${memory.text.slice(0, 12)}→${memory.tags.join('+')}`),
    admissions: ofType(events, 'continuum/memory-admission').filter(event => event.data.phase === 'settled')
      .map(({ data }) => `${String(data.admittedIds.length)}/${String(data.candidateIds.length)}${data.failure === undefined ? '' : ` ${data.failure}`}`),
    compactedTexts: compactedHuman(events).map(text => text.slice(0, 20)),
    questions,
  }
}

/** Run tasks with at most `limit` in flight, preserving result order. */
async function pool<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

describe.skipIf(!enabled)('Continuum personal-agent memory A/B on real endpoints', () => {
  it('answers every scenario with and without Continuum and reports the difference', async () => {
    const scenarios = SCENARIOS.filter(scenario => only === undefined || only.includes(scenario.id))
    const tasks = scenarios.flatMap(scenario => Array.from({ length: reps }, (_, rep) =>
      (['memory', 'baseline'] as const).map(mode => () => run(scenario, mode, rep))).flat())
    const results = await pool(tasks, concurrency)
    const summary = (['memory', 'baseline'] as const).map((mode) => {
      const questions = results.filter(result => result.mode === mode).flatMap(result => result.questions)
      const hits = questions.filter(question => question.recallHit !== null)
      return {
        mode, passed: questions.filter(question => question.pass).length, total: questions.length,
        recallHits: hits.filter(question => question.recallHit === true).length, recallChecked: hits.length,
        meanQuestionMs: Math.round(questions.reduce((sum, question) => sum + question.ms, 0) / Math.max(1, questions.length)),
      }
    })
    const report = { generatedAt: new Date().toISOString(), reps, summary, results }
    const path = process.env.CONTINUUM_EVAL_REPORT
    if (path !== undefined) await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`EVAL ${JSON.stringify(summary)}\n`)
    expect(results).toHaveLength(tasks.length)
  }, 7_200_000)
})
