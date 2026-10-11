import { describe, expect, it } from 'vitest'
import { summarizePerformance, type PerformanceSummary } from './continuum-performance-report.ts'

type Evidence = Parameters<typeof summarizePerformance>[0]
const row = (variant: string, task: string, latencyMs: number, selectedIds = ['invoice'], baselineIds = ['invoice']): Evidence['results'][number] => ({
  variant, task, latencyMs, selectedIds, baselineIds, matched: true, assertion: { status: 'pass' }, stopReason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 },
})
const evidence = (results: Evidence['results']): Evidence => ({ results, summary: { total: 20, applicable: 11, matched: 11, failed: 0 } })
const complete = (): Evidence => evidence(['A0', 'A1', 'B', 'C', 'U'].flatMap(variant => ['a', 'b', 'c', 'd'].map((task, index) => row(variant, task, index + 1))))

describe('continuum performance evidence', () => {
  it('computes nearest-rank latency and usage totals per variant', () => {
    const report = summarizePerformance(complete())
    expect(report).toHaveLength(5)
    expect(report[0]).toMatchObject<Partial<PerformanceSummary>>({ variant: 'A0', p50LatencyMs: 2, p95LatencyMs: 4, inputTokens: 8, outputTokens: 12, candidateAgreement: 1 })
  })

  it('rejects duplicate, failed, truncated, and incomplete evidence', () => {
    expect(() => summarizePerformance(evidence([...complete().results.slice(0, 19), complete().results[0]!]))).toThrow('duplicate')
    expect(() => summarizePerformance(evidence(complete().results.map(result => ({ ...result, assertion: { status: 'fail' } }))))).toThrow('incomplete')
    expect(() => summarizePerformance(evidence(complete().results.map(result => ({ ...result, stopReason: 'max_tokens' }))))).toThrow('incomplete')
  })
})
