#!/usr/bin/env node
/**
 * Summarize scenario benchmark runs: one Markdown table of native against Reflex runs per category, Jev decision
 * times, prefetch and Skill outcomes, failures, and per-task times. Runs longer than the stall limit are listed and left
 * out of every total, because a main-model call that hangs without an error says nothing about either arm.
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** One run line written by the suite runner: the driver's RUN object plus its arm and round. */
export interface ScenarioRun {
  readonly arm: string
  readonly pass: number
  readonly id: string
  readonly suite: string
  readonly category: string
  readonly ms: number
  readonly success: boolean
  readonly steps: number
  readonly tools: readonly string[]
  readonly reflex: { readonly outcome: string; readonly ms: number } | null
  readonly prefetched: readonly string[]
  readonly skill: { readonly outcome: string; readonly selected: string | null; readonly ms: number } | null
  readonly error: string | null
  readonly answer: string
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length === 0 ? Number.NaN : sorted.length % 2 === 1 ? sorted[middle] ?? Number.NaN
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)
const seconds = (ms: number): string => (ms / 1000).toFixed(1)

/** Ratio of mean durations, so arms with different run counts still compare; a missing arm gives no ratio. */
const speedup = (native: readonly number[], reflex: readonly number[]): string => native.length === 0 || reflex.length === 0 ? '—'
  : `**${((sum(native) / native.length) / (sum(reflex) / reflex.length)).toFixed(2)}×**`

const row = (label: string, native: readonly ScenarioRun[], reflex: readonly ScenarioRun[]): string => {
  const a = native.map(run => run.ms)
  const b = reflex.map(run => run.ms)
  const steps = (runs: readonly ScenarioRun[]): number => sum(runs.map(run => run.steps))
  const ok = (runs: readonly ScenarioRun[]): string => `${String(runs.filter(run => run.success).length)}/${String(runs.length)}`
  return `| ${label} | ${String(native.length)}/${String(reflex.length)} | ${seconds(sum(a))} s → ${seconds(sum(b))} s `
    + `| ${seconds(median(a))} → ${seconds(median(b))} s | ${speedup(a, b)} | ${String(steps(native))} → ${String(steps(reflex))} `
    + `| ${ok(native)} → ${ok(reflex)} |`
}

/**
 * Render the summary of benchmark runs.
 * @param runs - Runs of any arms, in the order they ran.
 * @param stallMs - Runs at or above this duration are reported as stalled and excluded.
 * @returns Markdown text.
 */
export function summarize(runs: readonly ScenarioRun[], stallMs: number): string {
  const stalled = runs.filter(run => run.ms >= stallMs)
  const kept = runs.filter(run => run.ms < stallMs)
  const of = (arm: string, category?: string): ScenarioRun[] =>
    kept.filter(run => run.arm === arm && (category === undefined || run.category === category))
  const categories = [...new Set(kept.map(run => run.category))]
  const lines = ['| Category | Runs native/Reflex | Total | Median | Speedup (mean) | Main-model steps | Success |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...categories.map(category => row(category, of('native', category), of('reflex', category))),
    row('all', of('native'), of('reflex')),
    row('all but small talk', of('native').filter(run => !run.category.endsWith('chat')), of('reflex').filter(run => !run.category.endsWith('chat')))]
  const reflex = of('reflex')
  const jev = reflex.flatMap(run => [run.reflex?.ms, run.skill?.ms].filter((ms): ms is number => ms !== undefined))
  lines.push('', `Jev decision: median ${String(median(jev))} ms, max ${String(Math.max(...jev))} ms`)
  lines.push('', 'Prefetch:', ...reflex.map(run => `- ${run.id}: ${run.reflex?.outcome ?? '-'} ${run.prefetched.join('+')}`))
  lines.push('', 'Skill:', ...reflex.map(run => `- ${run.id}: ${run.skill?.outcome ?? '-'}${run.skill?.selected ? ` = ${run.skill.selected}` : ''}`))
  const failures = kept.filter(run => !run.success)
  lines.push('', `Failures: ${failures.length === 0 ? 'none' : ''}`, ...failures.map(run =>
    `- ${run.arm}/${run.id} (${String(run.steps)} steps, ${seconds(run.ms)} s${run.error ? `, ${run.error}` : ''}): ${run.answer.slice(0, 80)}`))
  lines.push('', `Stalled (≥ ${seconds(stallMs)} s, excluded): ${stalled.length === 0 ? 'none' : ''}`,
    ...stalled.map(run => `- ${run.arm}/${run.id} round ${String(run.pass)}: ${seconds(run.ms)} s`))
  lines.push('', 'Per task (native ms / Reflex ms):')
  for (const id of new Set(kept.map(run => run.id))) {
    const a = kept.filter(run => run.id === id && run.arm === 'native').map(run => run.ms)
    const b = kept.filter(run => run.id === id && run.arm === 'reflex').map(run => run.ms)
    lines.push(`- ${id} ${JSON.stringify(a)} ${JSON.stringify(b)} ${speedup(a, b)}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Read run lines from JSON Lines files.
 * @param paths - Files written by the suite runner.
 * @returns Runs in file order.
 */
export function readRuns(paths: readonly string[]): ScenarioRun[] {
  return paths.flatMap(path => readFileSync(path, 'utf8').split('\n').filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as ScenarioRun))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2)
  if (paths.length === 0) throw new Error('usage: analyze.ts <runs.jsonl>... (SCENARIO_STALL_MS sets the stall limit)')
  process.stdout.write(summarize(readRuns(paths), Number(process.env.SCENARIO_STALL_MS ?? '300000')))
}
