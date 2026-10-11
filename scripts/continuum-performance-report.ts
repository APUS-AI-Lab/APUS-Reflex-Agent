import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Result = {
  readonly variant: string
  readonly task: string
  readonly selectedIds: readonly string[]
  readonly baselineIds: readonly string[]
  readonly latencyMs: number
  readonly matched: boolean
  readonly assertion: { readonly status: string }
  readonly usage?: Readonly<Record<string, number>>
  readonly stopReason?: string
}

type Evidence = {
  readonly results: readonly Result[]
  readonly summary: { readonly total: number; readonly applicable: number; readonly matched: number; readonly failed: number }
}

export type PerformanceSummary = {
  readonly variant: string
  readonly requests: number
  readonly p50LatencyMs: number
  readonly p95LatencyMs: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly selectedCandidateCount: number
  readonly baselineCandidateCount: number
  readonly candidateAgreement: number
  readonly matched: number
}

export function summarizePerformance(evidence: Evidence): readonly PerformanceSummary[] {
  validateEvidence(evidence)
  return [...new Set(evidence.results.map(result => result.variant))].sort().map((variant) => {
    const rows = evidence.results.filter(result => result.variant === variant)
    const latencies = rows.map(result => result.latencyMs).sort((a, b) => a - b)
    const input = sumUsage(rows, 'input_tokens')
    const output = sumUsage(rows, 'output_tokens')
    const agreement = rows.filter(result => sameIds(result.selectedIds, result.baselineIds)).length
    return Object.freeze({
      variant, requests: rows.length, p50LatencyMs: percentile(latencies, 0.5), p95LatencyMs: percentile(latencies, 0.95),
      inputTokens: input, outputTokens: output,
      selectedCandidateCount: rows.reduce((total, row) => total + row.selectedIds.length, 0),
      baselineCandidateCount: rows.reduce((total, row) => total + row.baselineIds.length, 0),
      candidateAgreement: agreement / rows.length,
      matched: rows.filter(row => row.matched).length,
    })
  })
}

function validateEvidence(evidence: Evidence): void {
  if (evidence.results.length !== 20 || evidence.summary.total !== 20 || evidence.summary.failed !== 0) throw new Error('performance evidence must contain 20 requests and zero failures')
  const cells = new Set<string>()
  for (const result of evidence.results) {
    const cell = `${result.variant}/${result.task}`
    if (cells.has(cell)) throw new Error(`duplicate evidence cell: ${cell}`)
    cells.add(cell)
    if (!Number.isFinite(result.latencyMs) || result.latencyMs < 0) throw new Error(`invalid latency: ${cell}`)
    if (result.stopReason !== 'end_turn' || result.assertion.status === 'fail') throw new Error(`incomplete evidence cell: ${cell}`)
    for (const value of [result.usage?.input_tokens, result.usage?.output_tokens]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`invalid usage: ${cell}`)
  }
}

function sumUsage(rows: readonly Result[], key: 'input_tokens' | 'output_tokens'): number | null {
  const values = rows.map(row => row.usage?.[key]).filter((value): value is number => value !== undefined)
  return values.length === rows.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) throw new Error('cannot calculate percentile of empty data')
  const value = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
  if (value === undefined) throw new Error('percentile index is out of range')
  return value
}

if (process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('continuum-performance-report.ts')) {
  const inputPath = resolve('docs/feat-continuum-memory/continuum-evaluation-results.json')
  const outputPath = resolve('docs/feat-continuum-memory/continuum-performance-report.json')
  const evidence = JSON.parse(await readFile(inputPath, 'utf8')) as Evidence
  const report = { version: 1, generatedAt: new Date().toISOString(), source: 'continuum-evaluation-results.json', semantics: 'provider usage only; Jev/local/cache costs unknown', variants: summarizePerformance(evidence) }
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`continuum-performance-report: wrote ${outputPath}`)
}
