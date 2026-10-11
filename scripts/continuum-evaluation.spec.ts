import { describe, expect, it } from 'vitest'
import { authorizedMemoryIds, evaluateVariant, type Task } from './continuum-evaluation.ts'

const task = (id: string, expected: string, source = `fixture:${id}`): Task => ({
  id, input: id, expected, source, authorizedScopes: ['workspace'],
})

describe('continuum evaluation assertions', () => {
  it('filters private records before the Jev candidate list', () => {
    expect(authorizedMemoryIds(task('scope-denial', 'no private record injected'))).not.toContain('private')
  })

  it('scores scope denial only when no candidate is selected and the model denies access', () => {
    const result = evaluateVariant('C', task('scope-denial', 'no private record injected'), { ids: [], baselineIds: [] }, 'no private record injected')
    expect(result).toEqual({ status: 'pass', reason: 'private scope was excluded before Jev and model injection' })
  })

  it('does not score controls as factual-recall failures', () => {
    const exact = task('exact-fact', 'INV-42', 'fixture:invoice')
    expect(evaluateVariant('A0', exact, { ids: [], baselineIds: [] }, '')).toMatchObject({ status: 'not-applicable' })
    expect(evaluateVariant('U', exact, { ids: [], baselineIds: [] }, '')).toMatchObject({ status: 'not-applicable' })
    expect(evaluateVariant('A1', task('scope-denial', 'no private record injected'), { ids: [], baselineIds: [] }, '')).toMatchObject({ status: 'not-applicable' })
  })
})
