import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { converse, live, ofType } from './fixtures/continuum-live-conversation.ts'
import { SWEEP_SCENARIOS } from './fixtures/reflex-sweep-scenarios.ts'

const template = fileURLToPath(new URL('./fixtures/reflex-sweep-live.patch.yml', import.meta.url))
const runs = Number(process.env.REFLEX_SWEEP_RUNS ?? '1')
const report = process.env.REFLEX_SWEEP_REPORT
const cases = SWEEP_SCENARIOS.flatMap(scenario => ['active', 'off'].flatMap(mode =>
  Array.from({ length: runs }, (_, run) => ({ scenario, mode, run }))))

describe.skipIf(!live).concurrent('Reflex compaction sweep A/B over everyday and terminal scenarios', () => {
  it.each(cases)('$scenario.name sweep=$mode run=$run', async ({ scenario, mode, run }) => {
    const { events, elapsed } = await converse(scenario.turns, { REFLEX_SWEEP_MODE: mode }, template)
    const answer = ofType(events, 'assistant/message').at(-1)?.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
    const usage = ofType(events, 'assistant/message').map(event => event.data.usage?.inputTokens ?? 0)
    const sweeps = ofType(events, 'system3/judgement').filter(event => event.data.decision === 'reflex.context-sweep')
    const calls = ofType(events, 'assistant/message').flatMap(event => event.data.message.content)
      .flatMap(block => block.type === 'tool-call' ? [block.name] : [])
    const row = {
      scenario: scenario.name, mode, run, correct: scenario.expect.every(group => group.some(text => answer.includes(text))),
      missing: scenario.expect.filter(group => !group.some(text => answer.includes(text))).map(group => group[0]),
      elapsedMs: elapsed.reduce((sum, value) => sum + value, 0), summaries: ofType(events, 'compaction/summary').length,
      hidden: ofType(events, 'reflex/context-projection').reduce((count, event) =>
        count + event.data.targets.reduce((sum, target) => sum + target.hidden.length, 0), 0),
      sweepRequests: sweeps.length, sweepMs: sweeps.reduce((sum, event) => sum + event.data.elapsedMs, 0),
      peakInputTokens: Math.max(0, ...usage), totalInputTokens: usage.reduce((sum, value) => sum + value, 0),
      bashCalls: calls.filter(name => name === 'bash').length, recallCalls: calls.filter(name => name !== 'bash').length,
      answer: answer.slice(0, 300),
    }
    process.stdout.write(`SWEEP ${JSON.stringify(row)}\n`)
    if (report !== undefined) await appendFile(report, `${JSON.stringify(row)}\n`)
    if (mode === 'off') expect(sweeps).toEqual([])
    expect(answer.length).toBeGreaterThan(0)
  }, 1_800_000)
})
