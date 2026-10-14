#!/usr/bin/env node
/**
 * Live Skill pre-selection benchmark: each task runs in a fresh Headless session in a temporary workspace that holds
 * six project Skills, so the native run must discover and load a Skill itself while the Reflex run may receive it
 * pre-selected. Prints per-task wall time, model steps, Skill tool calls, the Reflex outcome, and whether the answer
 * carries the marker only the Skill body states.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configArgument = process.argv[2]
if (configArgument === undefined) throw new Error('skill benchmark requires a config path')
// Each task changes into its own workspace, so the overlay path is fixed before the first change.
const configPath = resolve(configArgument)
const repeats = Number(process.env.SKILL_BENCH_REPEATS ?? '1')

interface BenchSkill { readonly name: string; readonly description: string; readonly marker: string; readonly rule: string }

const SKILLS: readonly BenchSkill[] = [
  { name: 'commit-message', description: 'Write git commit messages in this project\'s required format.', marker: 'CM-OK-71',
    rule: 'Use a lowercase conventional-commit subject of at most 50 characters.' },
  { name: 'sql-style', description: 'Write or review SQL queries following this project\'s SQL style rules.', marker: 'SQL-OK-42',
    rule: 'Write SQL keywords in uppercase and put each selected column on its own line.' },
  { name: 'release-notes', description: 'Draft release notes for a new version of this project.', marker: 'RN-OK-58',
    rule: 'Group entries under the headings Added, Fixed and Changed.' },
  { name: 'api-error-format', description: 'Design HTTP API error responses following this project\'s error schema.', marker: 'ERR-OK-33',
    rule: 'Every error body has the fields code, message and requestId.' },
  { name: 'regex-review', description: 'Write or explain regular expressions for this project.', marker: 'RX-OK-90',
    rule: 'Explain each group of the expression on its own line.' },
  { name: 'cron-schedule', description: 'Write cron schedule expressions for this project\'s jobs.', marker: 'CRON-OK-15',
    rule: 'Give the five-field expression first, then one sentence in plain words.' },
]

/** Tasks that each need one Skill, plus plain chat that needs none, so the Reflex overhead on chat is measured too. */
const TASKS: ReadonlyArray<{ readonly task: string; readonly skill?: string }> = [
  { task: 'Write a commit message for a change that fixes a null check in the login handler.', skill: 'commit-message' },
  { task: 'Write a SQL query that lists the ten most recent orders with their customer name.', skill: 'sql-style' },
  { task: 'Draft release notes for version 2.4.0: added dark mode, fixed a crash on startup.', skill: 'release-notes' },
  { task: 'Design the error response for a 404 when an order id does not exist.', skill: 'api-error-format' },
  { task: 'Write a regular expression that matches an ISO date like 2026-10-14.', skill: 'regex-review' },
  { task: 'Write a cron expression that runs a backup job at 02:30 every Sunday.', skill: 'cron-schedule' },
  { task: 'In one sentence, what is the capital of France?' },
  { task: 'Say hello in one short sentence.' },
]

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skill-bench-'))
  for (const skill of SKILLS) {
    const dir = join(root, '.agents', 'skills', skill.name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`
      + `${skill.rule}\nEnd your answer with the line ${skill.marker} so reviewers know this skill was followed.\n`)
  }
  execFileSync('git', ['init', '-q'], { cwd: root })
  return root
}

const results: object[] = []
for (let round = 0; round < repeats; round += 1) {
  for (const { task, skill } of TASKS) {
    const root = await workspace()
    const originalCwd = process.cwd()
    process.chdir(root)
    const ctx = await bootProductionProfile({ binName: 'skill-bench', profile: 'headless',
      overlayPaths: [resolveConfigPath(configPath, undefined)] })
    try {
      const events: SessionEvent[] = []
      const started = performance.now()
      const result = await runFixtureTurn(ctx, { task, onEvent: (_id, event) => { events.push(event) } })
      const ms = Math.round(performance.now() - started)
      const steps = events.filter(event => event.type === 'assistant/message').length
      const skillCalls = events.flatMap(event => event.type === 'assistant/message'
        ? event.data.message.content.filter(block => block.type === 'tool-call' && block.name === 'skill') : []).length
      const decision = events.find(event => event.type === 'system3/skill-decision')
      const marker = skill === undefined ? undefined : SKILLS.find(entry => entry.name === skill)?.marker
      results.push({ round, task: task.slice(0, 40), skill: skill ?? null, ms, steps, skillCalls,
        reflex: decision?.type === 'system3/skill-decision'
          ? { outcome: decision.data.outcome, selected: decision.data.selected ?? null, elapsedMs: Math.round(decision.data.elapsedMs) }
          : null,
        followed: marker === undefined ? null : result.output.includes(marker) })
    } finally {
      await ctx.fiber.dispose()
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  }
}
process.stdout.write(`RESULTS ${JSON.stringify(results)}\n`)
