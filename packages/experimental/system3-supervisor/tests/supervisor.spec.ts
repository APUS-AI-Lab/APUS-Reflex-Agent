import { describe, expect, it } from 'vitest'
import { compareSystem3Advice, superviseSystem3Advice, sumSystem3CostRecords, validateSystem3CostRecord, type System3CostRecord } from '../src/index.ts'

const base = {
  currentGoalRevision: 'goal:1', availableEvidenceRefs: ['test:1'], budgetRemaining: 10,
  requiredChecks: [{ id: 'tests', status: 'pass' as const, evidenceRefs: ['test:1'] }],
}

describe('System3 completion supervision', () => {
  it('accepts done only after independent checks pass', () => {
    const result = superviseSystem3Advice({ ...base, advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['test:1'] } })
    expect(result).toMatchObject({ action: 'done', accepted: true, reason: 'accepted' })
  })

  it('turns failed or unknown checks into safe follow-up actions', () => {
    const failed = superviseSystem3Advice({ ...base, requiredChecks: [{ id: 'tests', status: 'fail', evidenceRefs: [] }], advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['test:1'] } })
    const unknown = superviseSystem3Advice({ ...base, requiredChecks: [{ id: 'tests', status: 'unknown', evidenceRefs: [] }], advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['test:1'] } })
    expect(failed).toMatchObject({ action: 'retry', reason: 'failed-checks' })
    expect(unknown).toMatchObject({ action: 'escalate', reason: 'unknown-checks' })
  })

  it('rejects stale goals, missing evidence, and exhausted budgets', () => {
    expect(superviseSystem3Advice({ ...base, advice: { action: 'candidate_done', goalRevision: 'goal:0', evidenceRefs: ['test:1'] } }).reason).toBe('stale-goal')
    expect(superviseSystem3Advice({ ...base, advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['missing'] } }).reason).toBe('missing-evidence')
    expect(superviseSystem3Advice({ ...base, budgetRemaining: 0, advice: { action: 'continue', goalRevision: 'goal:1', evidenceRefs: [] } }).reason).toBe('budget-exhausted')
  })

  it('records model disagreement as shadow evidence', () => {
    const baseline = superviseSystem3Advice({ ...base, requiredChecks: [{ id: 'tests', status: 'fail', evidenceRefs: [] }], advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['test:1'] } })
    expect(compareSystem3Advice('candidate_done', baseline)).toMatchObject({ agrees: false, divergence: 'model-premature-done' })
  })
})

describe('System3 usage ledger', () => {
  const record: System3CostRecord = {
    requestId: 'req:1', episodeId: 'ep:1', modelRevision: 'jev:1', inputTokens: 10, outputTokens: 5,
    cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3, source: 'provider', elapsedMs: 25,
  }

  it('validates and sums usage without changing its source label', () => {
    expect(sumSystem3CostRecords([record, { ...record, requestId: 'req:2', inputTokens: 4 }])).toMatchObject({ inputTokens: 14, outputTokens: 10, source: 'provider' })
    expect(validateSystem3CostRecord({ ...record, source: 'estimated' }).source).toBe('estimated')
  })

  it('rejects negative or non-integral usage', () => {
    expect(() => validateSystem3CostRecord({ ...record, outputTokens: -1 })).toThrow('outputTokens')
    expect(() => validateSystem3CostRecord({ ...record, elapsedMs: 1.5 })).toThrow('elapsedMs')
  })
})
