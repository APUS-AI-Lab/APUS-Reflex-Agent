import { describe, expect, it } from 'vitest'
import { JevProtocolError, parseJevResponse, validateJevRequest } from '../src/protocol.ts'
import type { JevRequest } from '../src/types.ts'

const request: JevRequest = {
  model: 'APUS-OpenJev-v1-9B-5949',
  state: { scene: 'test', value: 1 },
  questions: {
    team: { type: 'choice', criteria: { local: 'Keep local', remote: 'Escalate' } },
    impact: { type: 'score', criteria: ['low', 'high'] },
    urgent: { type: 'noul' },
  },
}

describe('Jev System One protocol', () => {
  it('validates a typed multi-question request and response', () => {
    const normalized = validateJevRequest(request)
    const response = parseJevResponse({
      model: 'APUS-OpenJev-v1-9B-5949',
      answers: {
        team: { type: 'choice', choice: 'local', probabilities: { local: 0.8, remote: 0.2 }, confidence: 0.9 },
        impact: { type: 'score', score: 0.2, legend: { '0': 'low', '1': 'high' }, probabilities: { '0': 0.8, '1': 0.2 }, confidence: 0.7 },
        urgent: { type: 'noul', noul: 0.1 },
      },
      usage: { input_tokens: 20, output_tokens: 0 },
    }, normalized)
    expect(response.answers.team).toMatchObject({ type: 'choice', choice: 'local' })
    expect(response.answers.impact).toMatchObject({ type: 'score', score: 0.2 })
    expect(response.answers.urgent).toEqual({ type: 'noul', noul: 0.1 })
  })

  it('rejects incomplete probability maps and inconsistent score arithmetic', () => {
    expect(() => parseJevResponse({
      model: 'jev',
      answers: {
        team: { type: 'choice', choice: 'local', probabilities: { local: 1 }, confidence: 1 },
        impact: { type: 'score', score: 0, legend: { '0': 'low', '1': 'high' }, probabilities: { '0': 1, '1': 0 }, confidence: 1 },
        urgent: { type: 'noul', noul: 0 },
      },
    }, request)).toThrow(JevProtocolError)
    expect(() => parseJevResponse({
      model: 'jev',
      answers: {
        team: { type: 'choice', choice: 'local', probabilities: { local: 1, remote: 0 }, confidence: 1 },
        impact: { type: 'score', score: 0.5, legend: { '0': 'low', '1': 'high' }, probabilities: { '0': 1, '1': 0 }, confidence: 1 },
        urgent: { type: 'noul', noul: 0 },
      },
    }, request)).toThrow(/score does not match/)
  })

  it('enforces the question count cap', () => {
    const questions = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`q${index}`, { type: 'noul' as const }]))
    expect(() => validateJevRequest({ state: null, questions })).toThrow(/1-16/)
  })

  it('retains Noul semantics and special question and candidate IDs', () => {
    const query = validateJevRequest({ state: null, questions: Object.fromEntries([
      ['__proto__', { type: 'choice' as const, criteria: Object.fromEntries([['__proto__', 'one']]) }],
      ['normal', { type: 'noul' as const, criteria: { true: 'Pass', false: 'Fail' } }],
    ]) })
    expect(Object.keys(query.questions)).toEqual(['__proto__', 'normal'])
    expect(query.questions.normal).toMatchObject({ criteria: { true: 'Pass', false: 'Fail' } })
    const result = parseJevResponse({ model: 'jev', answers: Object.fromEntries([
      ['__proto__', { type: 'choice', choice: '__proto__', probabilities: Object.fromEntries([['__proto__', 1]]), confidence: 1 }],
      ['normal', { type: 'noul', noul: 0.9 }],
    ]) }, query)
    expect(Object.keys(result.answers)).toEqual(['__proto__', 'normal'])
  })

})
