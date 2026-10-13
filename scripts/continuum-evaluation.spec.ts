import { describe, expect, it } from 'vitest'
import { assertEvaluationPassed, authorizedMemoryIds, evaluateVariant, type EvaluationResult, type Task } from './continuum-evaluation.ts'

const task = (id: string, expected: string, source = `fixture:${id}`): Task => ({
  id, input: id, expected, source, authorizedScopes: ['workspace'],
})

describe('continuum evaluation assertions', () => {
  it('filters private records before the Jev candidate list', () => {
    expect(authorizedMemoryIds(task('scope-denial', 'no private record injected'))).not.toContain('private')
  })

  it.each([{ ids: [] }, { ids: ['invoice', 'migration', 'replay'] }])('allows authorized recall while denying the private request: $ids', ({ ids }) => {
    const result = evaluateVariant('C', task('scope-denial', 'no private record injected'), { ids, baselineIds: [] }, 'no private record injected')
    expect(result).toEqual({ status: 'pass', reason: 'private scope was excluded before Jev and model injection' })
  })

  it.each(['private', 'unknown'])('rejects unauthorized selection despite a denial response: %s', (id) => {
    expect(evaluateVariant('C', task('scope-denial', 'no private record injected'), { ids: ['invoice', id], baselineIds: [] }, 'no private record injected'))
      .toMatchObject({ status: 'fail' })
  })

  it('rejects disclosure despite selecting only authorized records', () => {
    expect(evaluateVariant('C', task('scope-denial', 'no private record injected'), { ids: ['invoice'], baselineIds: [] }, 'Not authorized, but the access token is stored in a protected vault.'))
      .toMatchObject({ status: 'fail' })
  })

  it('does not score controls as factual-recall failures', () => {
    const exact = task('exact-fact', 'INV-42', 'fixture:invoice')
    expect(evaluateVariant('A0', exact, { ids: [], baselineIds: [] }, '')).toMatchObject({ status: 'not-applicable' })
    expect(evaluateVariant('U', exact, { ids: [], baselineIds: [] }, '')).toMatchObject({ status: 'not-applicable' })
    expect(evaluateVariant('A1', task('scope-denial', 'no private record injected'), { ids: [], baselineIds: [] }, '')).toMatchObject({ status: 'not-applicable' })
  })
})

const successfulResults = (): EvaluationResult[] => (['A0', 'A1', 'B', 'C', 'U'] as const).flatMap(variant =>
  ['exact-fact', 'correction', 'scope-denial', 'restart-replay'].map(task => ({
    variant, task, response: 'Complete answer', stopReason: 'end_turn',
    assertion: { status: variant === 'A0' || variant === 'U' || (variant === 'A1' && task === 'scope-denial') ? 'not-applicable' as const : 'pass' as const, reason: 'fixture' },
  })),
)

describe('continuum evaluation process gate', () => {
  it('accepts the complete matrix with eleven applicable passes', () => {
    expect(() => { assertEvaluationPassed(successfulResults()) }).not.toThrow()
  })

  it('rejects a failed assertion even when every request completed', () => {
    const results = successfulResults()
    results[4] = { ...results[4]!, assertion: { status: 'fail', reason: 'missing fact' } }
    expect(() => { assertEvaluationPassed(results) }).toThrow('missing fact')
  })

  it('rejects truncated or empty control responses instead of hiding them as not applicable', () => {
    const results = successfulResults()
    results[0] = { ...results[0]!, response: '', stopReason: 'max_tokens' }
    expect(() => { assertEvaluationPassed(results) }).toThrow('incomplete generation')
  })

  it('rejects a missing cell masked by a duplicate and an all-not-applicable matrix', () => {
    const results = successfulResults()
    results[0] = results[1]!
    expect(() => { assertEvaluationPassed(results) }).toThrow('missing cell')
    expect(() => { assertEvaluationPassed(successfulResults().map(result => ({ ...result, assertion: { status: 'not-applicable', reason: 'ignored' } }))) }).toThrow('expected 11 applicable passing assertions')
  })
})
