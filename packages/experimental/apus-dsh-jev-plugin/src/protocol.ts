/** Validation for the Jev System One wire contract. */
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  JevAnswer,
  JevChoiceAnswer,
  JevChoiceQuestion,
  JevNoulAnswer,
  JevNoulQuestion,
  JevRequest,
  JevResponse,
  JevScoreAnswer,
  JevScoreQuestion,
  JevUsage,
} from './types.ts'

/** Maximum questions permitted by the System One contract. */
export const MAX_JEV_QUESTIONS = 16
/** Maximum Choice candidates permitted by the System One contract. */
export const MAX_JEV_CHOICES = 255
const PROBABILITY_TOLERANCE = 0.001

/** Error raised when a request or response violates the typed protocol. */
export class JevProtocolError extends Error {
  override name = 'JevProtocolError'
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new JevProtocolError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new JevProtocolError(`${name} must be a non-empty string`)
  return value
}

function finiteProbability(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new JevProtocolError(`${name} must be a finite number in [0, 1]`)
  }
  return value
}

function probabilityMap(value: unknown, keys: readonly string[], name: string): Record<string, number> {
  const source = record(value, name)
  const actual = Object.keys(source).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new JevProtocolError(`${name} must contain exactly the candidate keys`)
  }
  const result = new Map<string, number>()
  let sum = 0
  for (const key of keys) {
    const probability = finiteProbability(source[key], `${name}.${key}`)
    result.set(key, probability)
    sum += probability
  }
  if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) throw new JevProtocolError(`${name} must sum to 1`)
  return Object.fromEntries(result)
}

function confidence(value: unknown, name: string): number {
  return finiteProbability(value, name)
}

function validateChoiceQuestion(value: unknown, name: string): JevChoiceQuestion {
  const source = record(value, name)
  if (source.type !== 'choice') throw new JevProtocolError(`${name}.type must be choice`)
  const criteria = record(source.criteria, `${name}.criteria`)
  const keys = Object.keys(criteria)
  if (keys.length === 0 || keys.length > MAX_JEV_CHOICES) throw new JevProtocolError(`${name}.criteria must contain 1-${MAX_JEV_CHOICES} choices`)
  const normalized = new Map<string, string>()
  for (const key of keys) normalized.set(text(key, `${name}.criteria key`), text(criteria[key], `${name}.criteria.${key}`))
  return { type: 'choice', criteria: Object.fromEntries(normalized), ...source.instructions === undefined ? {} : { instructions: text(source.instructions, `${name}.instructions`) } }
}

function validateScoreQuestion(value: unknown, name: string): JevScoreQuestion {
  const source = record(value, name)
  if (source.type !== 'score') throw new JevProtocolError(`${name}.type must be score`)
  if (!Array.isArray(source.criteria) || source.criteria.length < 2 || source.criteria.length > 10) throw new JevProtocolError(`${name}.criteria must contain 2-10 levels`)
  const criteria = source.criteria.map((entry, index) => text(entry, `${name}.criteria[${index}]`))
  return { type: 'score', criteria, ...source.instructions === undefined ? {} : { instructions: text(source.instructions, `${name}.instructions`) } }
}

function validateNoulQuestion(value: unknown, name: string): JevNoulQuestion {
  const source = record(value, name)
  if (source.type !== 'noul') throw new JevProtocolError(`${name}.type must be noul`)
  const criteria = source.criteria === undefined ? undefined : record(source.criteria, `${name}.criteria`)
  return {
    type: 'noul',
    ...criteria === undefined ? {} : { criteria: {
      true: text(criteria.true, `${name}.criteria.true`), false: text(criteria.false, `${name}.criteria.false`),
    } },
    ...source.instructions === undefined ? {} : { instructions: text(source.instructions, `${name}.instructions`) },
  }
}

function validateQuestion(value: unknown, name: string): JevRequest['questions'][string] {
  const source = record(value, name)
  if (source.type === 'choice') return validateChoiceQuestion(source, name)
  if (source.type === 'score') return validateScoreQuestion(source, name)
  if (source.type === 'noul') return validateNoulQuestion(source, name)
  throw new JevProtocolError(`${name}.type must be choice, score, or noul`)
}

/**
 * Validate and normalize a request before it crosses the network.
 * @param value - Host request containing JSON state and typed questions.
 * @returns A detached request with every question normalized.
 */
export function validateJevRequest(value: JevRequest): JevRequest {
  if (!isJsonValue(value.state)) throw new JevProtocolError('state must be JSON data')
  const questions = record(value.questions, 'questions')
  const names = Object.keys(questions)
  if (names.length === 0 || names.length > MAX_JEV_QUESTIONS) throw new JevProtocolError(`questions must contain 1-${MAX_JEV_QUESTIONS} entries`)
  const normalized = new Map<string, JevRequest['questions'][string]>()
  for (const name of names) normalized.set(text(name, 'question name'), validateQuestion(questions[name], `questions.${name}`))
  if (value.providerId !== undefined) text(value.providerId, 'providerId')
  if (value.model !== undefined) text(value.model, 'model')
  return {
    ...value.providerId === undefined ? {} : { providerId: value.providerId },
    state: structuredClone(value.state), questions: Object.fromEntries(normalized),
    ...value.model === undefined ? {} : { model: value.model },
    ...value.effort === undefined ? {} : { effort: value.effort },
  }
}

function parseChoiceAnswer(value: unknown, question: JevChoiceQuestion, name: string): JevChoiceAnswer {
  const source = record(value, name)
  if (source.type !== 'choice') throw new JevProtocolError(`${name}.type must be choice`)
  const choice = text(source.choice, `${name}.choice`)
  if (!Object.hasOwn(question.criteria, choice)) throw new JevProtocolError(`${name}.choice is not in criteria`)
  return { type: 'choice', choice, probabilities: probabilityMap(source.probabilities, Object.keys(question.criteria), `${name}.probabilities`), confidence: confidence(source.confidence, `${name}.confidence`) }
}

function parseScoreAnswer(value: unknown, question: JevScoreQuestion, name: string): JevScoreAnswer {
  const source = record(value, name)
  if (source.type !== 'score') throw new JevProtocolError(`${name}.type must be score`)
  if (typeof source.score !== 'number' || !Number.isFinite(source.score)) throw new JevProtocolError(`${name}.score must be finite`)
  const keys = question.criteria.map((_, index) => String(index))
  const probabilities = probabilityMap(source.probabilities, keys, `${name}.probabilities`)
  const expectedScore = keys.reduce((sum, key) => sum + Number(key) * (probabilities[key] ?? 0), 0)
  if (Math.abs(source.score - expectedScore) > PROBABILITY_TOLERANCE) throw new JevProtocolError(`${name}.score does not match probabilities`)
  const legend = record(source.legend, `${name}.legend`)
  const normalizedLegend = new Map<string, string>()
  for (const key of keys) normalizedLegend.set(key, text(legend[key], `${name}.legend.${key}`))
  return { type: 'score', score: source.score, legend: Object.fromEntries(normalizedLegend), probabilities, confidence: confidence(source.confidence, `${name}.confidence`) }
}

function parseNoulAnswer(value: unknown, name: string): JevNoulAnswer {
  const source = record(value, name)
  if (source.type !== 'noul') throw new JevProtocolError(`${name}.type must be noul`)
  return { type: 'noul', noul: finiteProbability(source.noul, `${name}.noul`) }
}

function parseAnswer(value: unknown, question: JevRequest['questions'][string], name: string): JevAnswer {
  if (question.type === 'choice') return parseChoiceAnswer(value, question, name)
  if (question.type === 'score') return parseScoreAnswer(value, question, name)
  return parseNoulAnswer(value, name)
}

function parseUsage(value: unknown): JevUsage | undefined {
  if (value === undefined) return undefined
  const source = record(value, 'usage')
  const usage = new Map<string, number>()
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new JevProtocolError(`usage.${key} must be finite`)
    usage.set(key, entry)
  }
  return Object.fromEntries(usage)
}

/**
 * Validate a provider response against the exact request question set.
 * @param value - Untrusted JSON returned by the provider.
 * @param request - Validated questions that determine permitted answers.
 * @returns Complete answers and optional provider usage.
 */
export function parseJevResponse(value: unknown, request: JevRequest): JevResponse {
  const source = record(value, 'response')
  const model = text(source.model, 'response.model')
  const answers = record(source.answers, 'response.answers')
  const names = Object.keys(request.questions)
  const actual = Object.keys(answers).sort()
  const expected = [...names].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) throw new JevProtocolError('response.answers must match request.questions')
  const normalized = new Map<string, JevAnswer>()
  for (const name of names) {
    const question = request.questions[name]
    if (question === undefined) throw new JevProtocolError(`request question ${name} is missing`)
    normalized.set(name, parseAnswer(answers[name], question, `response.answers.${name}`))
  }
  const usage = parseUsage(source.usage)
  return { model, answers: Object.fromEntries(normalized), ...usage === undefined ? {} : { usage } }
}
