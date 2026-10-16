#!/usr/bin/env node
/**
 * Run the scenario benchmark in interleaved rounds: each round runs every named arm once over the selected tasks, so
 * both arms meet the same provider load. Appends one JSON line per run to the output file, then prints the summary.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { readRuns, summarize } from './analyze.ts'

const [out, rounds, ...arms] = process.argv.slice(2)
if (out === undefined || rounds === undefined || arms.length === 0 || !Number.isInteger(Number(rounds))) {
  throw new Error('usage: suite.ts <out.jsonl> <rounds> <arm>... (arms name <arm>.patch.yml beside the driver)')
}
const driver = fileURLToPath(new URL('./driver.ts', import.meta.url))

/** Run the driver once for one arm and append its RUN lines, tagged with the arm and round. */
const runArm = (arm: string, pass: number): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx/esm', driver, fileURLToPath(new URL(`./${arm}.patch.yml`, import.meta.url))],
    { stdio: ['ignore', 'pipe', 'inherit'] })
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith('RUN ')) return
    appendFileSync(out, `${JSON.stringify({ arm, pass, ...JSON.parse(line.slice(4)) as object })}\n`)
  })
  child.on('error', reject)
  child.on('close', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`${arm} round ${String(pass)} exited with ${String(code)}`))
  })
})

writeFileSync(out, '')
for (let pass = 1; pass <= Number(rounds); pass += 1) {
  for (const arm of arms) {
    await runArm(arm, pass)
    process.stderr.write(`round ${String(pass)} ${arm} done\n`)
  }
}
process.stdout.write(summarize(readRuns([out]), Number(process.env.SCENARIO_STALL_MS ?? '300000')))
