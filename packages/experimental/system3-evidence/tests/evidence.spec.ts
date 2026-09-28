import { describe, expect, it } from 'vitest'
import { selectSystem3Evidence } from '../src/index.ts'

describe('System3 evidence selection', () => {
  it('returns a full span and no omission when output fits', () => {
    expect(selectSystem3Evidence({ artifactRef: 'tool:1', text: 'ok', maxChars: 10 })).toEqual({
      artifactRef: 'tool:1', retainedSpans: [{ start: 0, end: 2, reason: 'full' }], omittedRanges: [],
      retainedChars: 2, omittedChars: 0, truncated: false,
    })
  })

  it('retains required evidence before head and tail fallbacks', () => {
    const text = 'HEAD '.repeat(4) + 'ERROR database unavailable ' + 'BODY '.repeat(20) + 'TAIL'
    const result = selectSystem3Evidence({ artifactRef: 'tool:2', text, maxChars: 70, requiredTerms: ['error'], contextChars: 5, headChars: 10, tailChars: 10 })

    expect(result.truncated).toBe(true)
    expect(result.retainedSpans.some(span => span.reason === 'match' && span.matchedTerms?.includes('error'))).toBe(true)
    expect(result.retainedChars).toBeLessThanOrEqual(70)
    expect(result.omittedChars + result.retainedChars).toBe(text.length)
  })

  it('matches terms case-insensitively and de-duplicates overlapping windows', () => {
    const result = selectSystem3Evidence({ artifactRef: 'tool:3', text: 'prefix WARNING: retry WARNING: retry suffix', maxChars: 100, requiredTerms: ['warning', 'WARNING'] })
    expect(result.truncated).toBe(false)
    expect(result.retainedSpans[0]?.reason).toBe('full')
  })

  it('reports explicit omitted ranges for a bounded artifact', () => {
    const text = '0123456789'.repeat(20)
    const result = selectSystem3Evidence({ artifactRef: 'tool:4', text, maxChars: 20, headChars: 8, tailChars: 8 })
    expect(result.omittedRanges.length).toBeGreaterThan(0)
    expect(result.omittedRanges.every(range => range.start < range.end)).toBe(true)
    expect(result.retainedSpans.every(span => span.start < span.end)).toBe(true)
  })

  it('rejects empty references and invalid limits', () => {
    expect(() => selectSystem3Evidence({ artifactRef: ' ', text: 'x', maxChars: 1 })).toThrow('artifactRef')
    expect(() => selectSystem3Evidence({ artifactRef: 'tool:5', text: 'x', maxChars: -1 })).toThrow('maxChars')
  })
})
