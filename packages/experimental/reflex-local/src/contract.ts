/**
 * Prompt rendering and answer math of the APUS Reflex training contract, pinned to model repository
 * `apus-ailab/APUS-Reflex-4B-GGUF` revision `191bfcb721ec6d44352c622a30d290ae6afbabc8` (`openjev_contracts.py`
 * and the `CHAT` wrapper of `examples/openjev_local.py`). `tests/fixtures/contract-golden.json` fixes the bytes.
 */
import { assertNever, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JevQuestion } from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'

/** Candidate labels in contract order; each is one token at the answer position. */
export const CANDIDATE_LABELS = 'ABCDEFGHIJKLMNOP'
/** Largest candidate count the contract renders. */
export const MAX_CONTRACT_CANDIDATES = CANDIDATE_LABELS.length
/** Instructions rendered for a Choice or Score question that omits them; the contract requires nonempty instructions. */
export const DEFAULT_CHOICE_INSTRUCTIONS = 'Choose the best candidate.'
/** Instructions rendered for a Noul question that omits them. */
export const DEFAULT_NOUL_INSTRUCTIONS = 'Judge whether the proposition in the shared state is true.'
/** Canonical Noul candidate descriptions, in label order `yes`, `no`; caller `criteria.true/false` text is never rendered. */
export const NOUL_DESCRIPTIONS: readonly string[] = ['The stated proposition is true.', 'The stated proposition is false.']

/** Contract primitive of a rendered question; Score questions render as `choice`. */
export type ContractPrimitive = 'choice' | 'noul'

/** One Jev question resolved to the contract's candidate list. */
export interface ContractQuestion {
  readonly primitive: ContractPrimitive
  readonly instructions: string
  /** Answer keys in label order: Choice criteria keys in insertion order, Score level indexes, or `yes`, `no`. */
  readonly keys: readonly string[]
  /** Candidate descriptions aligned with `keys`. */
  readonly descriptions: readonly string[]
}

/**
 * Resolve a Jev question to the rendered primitive, instructions, and candidates.
 * @param question - Validated Jev question.
 * @returns Candidates in label order with explicit default instructions.
 */
export function contractQuestion(question: JevQuestion): ContractQuestion {
  switch (question.type) {
    case 'choice':
      return {
        primitive: 'choice', instructions: question.instructions ?? DEFAULT_CHOICE_INSTRUCTIONS,
        keys: Object.keys(question.criteria), descriptions: Object.values(question.criteria),
      }
    case 'score':
      return {
        primitive: 'choice', instructions: question.instructions ?? DEFAULT_CHOICE_INSTRUCTIONS,
        keys: question.criteria.map((_, index) => String(index)), descriptions: question.criteria,
      }
    case 'noul':
      return { primitive: 'noul', instructions: question.instructions ?? DEFAULT_NOUL_INSTRUCTIONS, keys: ['yes', 'no'], descriptions: NOUL_DESCRIPTIONS }
    /* v8 ignore next -- closed-union exhaustiveness guard; validateJevRequest admits only these three types. */
    default: return assertNever(question, 'Jev question type')
  }
}

const STRING_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f',
}

function pythonString(value: string): string {
  // Python json escapes exactly U+0000-U+001F, quote, and backslash.
  const escaped = value.replace(/[\u0000-\u001f"\\]/g, char => STRING_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `"${escaped}"`
}

function pythonNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('JSON numbers must be finite')
  // JavaScript numbers carry no int/float distinction: -0 exists only as a float, safe integers render as Python ints.
  if (Object.is(value, -0)) return '-0.0'
  if (Number.isSafeInteger(value)) return String(value)
  const exponential = Math.abs(value).toExponential()
  const marker = exponential.indexOf('e')
  const digits = exponential.slice(0, marker).replace('.', '')
  const exponent = Number(exponential.slice(marker + 1))
  const sign = value < 0 ? '-' : ''
  // Python float repr: shortest round-trip digits; scientific when the decimal point position is <= -4 or > 16.
  const point = exponent + 1
  if (point <= -4 || point > 16) {
    const mantissa = digits.length > 1 ? `${digits.slice(0, 1)}.${digits.slice(1)}` : digits
    return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/** Fixed-width decimal code points, so string order of keys equals Python's code-point order of `str`. */
function codePointSortKey(value: string): string {
  return Array.from(value, char => String(char.codePointAt(0)).padStart(7, '0')).join('')
}

/**
 * Render JSON exactly as Python `json.dumps(value, ensure_ascii=False, sort_keys=True)`.
 * Integer-valued safe numbers render as Python ints and other numbers as Python float `repr`.
 * @param value - JSON data with finite numbers.
 * @returns Python-compatible JSON text with keys sorted by Unicode code point.
 */
export function pythonJson(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return pythonNumber(value)
  if (typeof value === 'string') return pythonString(value)
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`
  // Object keys are distinct, so sort keys never compare equal.
  const entries = Object.entries(value).map(([key, entry]) => [codePointSortKey(key), key, entry] as const)
    .sort(([left], [right]) => left < right ? -1 : 1)
  return `{${entries.map(([, key, entry]) => `${pythonString(key)}: ${pythonJson(entry)}`).join(', ')}}`
}

/**
 * Render the complete no-thinking chat prompt for one contract question.
 * @param state - Shared state; a string renders verbatim and other JSON through {@link pythonJson}.
 * @param primitive - Contract primitive.
 * @param instructions - Nonempty question instructions.
 * @param descriptions - Two to sixteen candidate descriptions in label order.
 * @returns Prompt text whose next token is the selected label.
 */
export function renderPrompt(
  state: JsonValue, primitive: ContractPrimitive, instructions: string, descriptions: readonly string[],
): string {
  if (descriptions.length < 2 || descriptions.length > MAX_CONTRACT_CANDIDATES) {
    throw new RangeError(`contract prompts require 2-${MAX_CONTRACT_CANDIDATES} candidates`)
  }
  const labels = Array.from(CANDIDATE_LABELS.slice(0, descriptions.length))
  const task = {
    primitive, instructions,
    criteria: descriptions.map((description, index) => ({ label: CANDIDATE_LABELS.charAt(index), description })),
  }
  const shared = typeof state === 'string' ? state : pythonJson(state)
  const prompt = `Shared state:\n${shared}\n\n${pythonJson(task)}\nReturn only the selected letter: ${labels.join(', ')}.\nAnswer:`
  return `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`
}

/** Candidate answer keys paired with numeric weights, in label order. */
export type CandidateWeights = ReadonlyArray<readonly [key: string, weight: number]>

/**
 * Normalize candidate log probabilities to a distribution over the candidates only.
 * @param logprobs - Answer keys with natural-log probabilities, in label order.
 * @returns The same keys with probabilities summing to 1.
 */
export function normalizeLogprobs(logprobs: CandidateWeights): Array<[key: string, probability: number]> {
  const peak = Math.max(...logprobs.map(([, logprob]) => logprob))
  const weights = logprobs.map(([key, logprob]) => [key, Math.exp(logprob - peak)] as const)
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  return weights.map(([key, weight]) => [key, weight / total])
}

/**
 * Compute `1 - H(p) / ln(n)` with the natural-log entropy `H`, clamped to [0, 1].
 * @param probabilities - Candidate distribution.
 * @returns 1 for fewer than two candidates; otherwise the normalized certainty.
 */
export function distributionConfidence(probabilities: readonly number[]): number {
  if (probabilities.length < 2) return 1
  const entropy = probabilities.reduce((sum, probability) => probability > 0 ? sum - probability * Math.log(probability) : sum, 0)
  return Math.min(1, Math.max(0, 1 - entropy / Math.log(probabilities.length)))
}
