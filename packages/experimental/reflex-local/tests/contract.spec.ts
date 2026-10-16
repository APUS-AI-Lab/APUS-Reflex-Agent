import { readFileSync } from 'node:fs'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DEFAULT_CHOICE_INSTRUCTIONS, DEFAULT_NOUL_INSTRUCTIONS, NOUL_DESCRIPTIONS, contractQuestion, distributionConfidence,
  normalizeLogprobs, pythonJson, renderPrompt, type ContractPrimitive,
} from '../src/contract.ts'

const GoldenCases = z.array(z.object({
  name: z.string(),
  // JSON.parse output is JSON data; isJsonValue would reject the -0 golden value, which JSON text can carry.
  state: z.custom<JsonValue>(value => value !== undefined),
  primitive: z.enum(['choice', 'noul']) satisfies z.ZodType<ContractPrimitive>,
  instructions: z.string(),
  descriptions: z.array(z.string()),
  prompt: z.string(),
}))

// Written by tests/fixtures/generate-contract-golden.py from the model repository's Python renderer.
const golden = GoldenCases.parse(JSON.parse(readFileSync(new URL('fixtures/contract-golden.json', import.meta.url), 'utf8')))

describe('contract prompt rendering', () => {
  it('covers every golden case', () => {
    expect(golden.map(entry => entry.name)).toEqual([
      'official-support-731', 'string-state-verbatim', 'object-text-escapes', 'astral-key-order', 'nested-values', 'numbers',
      'scalar-null', 'scalar-bool', 'scalar-float', 'array-state-two-candidates', 'choice-sixteen', 'noul-canonical', 'score-levels',
    ])
  })

  it.each(golden.map(entry => [entry.name, entry] as const))('matches the Python contract byte for byte: %s', (_name, entry) => {
    const prompt = renderPrompt(entry.state, entry.primitive, entry.instructions, entry.descriptions)
    expect(Buffer.from(prompt, 'utf8').equals(Buffer.from(entry.prompt, 'utf8'))).toBe(true)
    expect(prompt).toBe(entry.prompt)
  })

  it('wraps the official example in the no-thinking chat turn', () => {
    expect(renderPrompt('Order delivered.', 'choice', 'Pick.', ['Close.', 'Escalate.'])).toBe(
      '<|im_start|>user\nShared state:\nOrder delivered.\n\n'
      + '{"criteria": [{"description": "Close.", "label": "A"}, {"description": "Escalate.", "label": "B"}], "instructions": "Pick.", "primitive": "choice"}'
      + '\nReturn only the selected letter: A, B.\nAnswer:<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n',
    )
  })

  it('rejects candidate counts the contract cannot render', () => {
    expect(() => renderPrompt('s', 'choice', 'i', ['only'])).toThrow(RangeError)
    expect(() => renderPrompt('s', 'choice', 'i', Array.from({ length: 17 }, (_, index) => `c${index}`))).toThrow('2-16 candidates')
  })
})

describe('pythonJson', () => {
  it('renders scalars and containers with Python separators', () => {
    expect(pythonJson(null)).toBe('null')
    expect(pythonJson(false)).toBe('false')
    expect(pythonJson([])).toBe('[]')
    expect(pythonJson({})).toBe('{}')
    expect(pythonJson({ b: [1, { d: null, c: true }], a: 'x' })).toBe('{"a": "x", "b": [1, {"c": true, "d": null}]}')
  })

  it('escapes only control characters, quotes, and backslashes with lowercase hex', () => {
    expect(pythonJson('\u0000\u001f\u007f"\\\b\f\n\r\t中😀 ')).toBe('"\\u0000\\u001f\u007f\\"\\\\\\b\\f\\n\\r\\t中😀 "')
  })

  it('renders numbers as Python ints or float repr', () => {
    const values = [0, -0, 42, -7, Number.MAX_SAFE_INTEGER, 2 ** 53, 0.5, 1e-7, 1e16, 123456.789, 1e-5, 0.0001, -2.5e-10, 1e21, 1.5e300]
    expect(pythonJson(values)).toBe(
      '[0, -0.0, 42, -7, 9007199254740991, 9007199254740992.0, 0.5, 1e-07, 1e+16, 123456.789, 1e-05, 0.0001, -2.5e-10, 1e+21, 1.5e+300]',
    )
  })

  it('rejects non-finite numbers', () => {
    expect(() => pythonJson(Number.NaN)).toThrow(RangeError)
    expect(() => pythonJson([Number.POSITIVE_INFINITY])).toThrow('finite')
  })

  it('orders keys by code point rather than UTF-16 code unit', () => {
    expect(pythonJson({ '😀': 1, '￿': 2, 'a': 3, '': 4, 'aa': 5 })).toBe('{"": 4, "a": 3, "aa": 5, "￿": 2, "😀": 1}')
  })
})

describe('contractQuestion', () => {
  it('maps Choice criteria in insertion order with default instructions', () => {
    expect(contractQuestion({ type: 'choice', criteria: { keep: 'Keep it.', drop: 'Drop it.' } })).toEqual({
      primitive: 'choice', instructions: DEFAULT_CHOICE_INSTRUCTIONS, keys: ['keep', 'drop'], descriptions: ['Keep it.', 'Drop it.'],
    })
  })

  it('renders Score levels as Choice candidates keyed by index', () => {
    expect(contractQuestion({ type: 'score', instructions: 'Rate.', criteria: ['low', 'mid', 'high'] })).toEqual({
      primitive: 'choice', instructions: 'Rate.', keys: ['0', '1', '2'], descriptions: ['low', 'mid', 'high'],
    })
  })

  it('renders Noul with canonical candidates and ignores caller criteria text', () => {
    expect(contractQuestion({ type: 'noul', criteria: { true: 'Fixed', false: 'Broken' } })).toEqual({
      primitive: 'noul', instructions: DEFAULT_NOUL_INSTRUCTIONS, keys: ['yes', 'no'], descriptions: NOUL_DESCRIPTIONS,
    })
    expect(contractQuestion({ type: 'noul', instructions: 'Is it fixed?' }).instructions).toBe('Is it fixed?')
  })
})

describe('answer math', () => {
  it('normalizes log probabilities over the candidates only', () => {
    const [[firstKey, first], [, second]] = normalizeLogprobs([['a', Math.log(0.3)], ['b', Math.log(0.1)]]) as [[string, number], [string, number]]
    expect(firstKey).toBe('a')
    expect(first).toBeCloseTo(0.75, 12)
    expect(second).toBeCloseTo(0.25, 12)
  })

  it('stays finite for very negative log probabilities', () => {
    expect(normalizeLogprobs([['a', -2000], ['b', -2000]])).toEqual([['a', 0.5], ['b', 0.5]])
  })

  it('computes 1 - H(p)/ln(n) as recorded by the cloud provider', () => {
    expect(distributionConfidence([0.9971, 0.0015, 0.00055, 0.0008])).toBeCloseTo(0.9838, 4)
    expect(distributionConfidence([1, 0])).toBe(1)
    expect(distributionConfidence([1])).toBe(1)
    expect(distributionConfidence([0.25, 0.25, 0.25, 0.25])).toBe(0)
  })
})
