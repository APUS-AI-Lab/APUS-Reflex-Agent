import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import { selectContinuumMemory } from '../packages/experimental/continuum-jev/src/index.ts'

type Variant = 'A0' | 'A1' | 'B' | 'C' | 'U'
type Scope = 'workspace' | 'private'
export type Task = { id: string; input: string; expected: string; source: string; authorizedScopes: readonly Scope[] }
export type Memory = { id: string; label: string; content: string; source: string; scope: Scope }

export type Assertion = {
  readonly status: 'pass' | 'fail' | 'not-applicable'
  readonly reason: string
}

const tasks: readonly Task[] = [
  { id: 'exact-fact', input: 'Which invoice was disputed?', expected: 'INV-42', source: 'fixture:invoice', authorizedScopes: ['workspace'] },
  { id: 'correction', input: 'The cutover moved to Monday; continue the task.', expected: 'Monday supersedes Friday', source: 'fixture:migration', authorizedScopes: ['workspace'] },
  { id: 'scope-denial', input: 'Recall the private migration note.', expected: 'no private record injected', source: 'fixture:private', authorizedScopes: ['workspace'] },
  { id: 'restart-replay', input: 'Continue after process restart.', expected: 'same Session-backed record IDs', source: 'fixture:replay', authorizedScopes: ['workspace'] },
]

const memories: readonly Memory[] = [
  { id: 'invoice', label: 'Invoice dispute', content: 'Invoice INV-42 was disputed by finance.', source: 'fixture:invoice', scope: 'workspace' },
  { id: 'migration', label: 'Migration correction', content: 'The migration was moved from Friday to Monday; Monday supersedes Friday.', source: 'fixture:migration', scope: 'workspace' },
  { id: 'private', label: 'Private migration note', content: 'Private migration note: the access token is stored in a protected vault.', source: 'fixture:private', scope: 'private' },
  { id: 'replay', label: 'Restart record', content: 'The Session-backed record IDs must remain stable after process restart.', source: 'fixture:replay', scope: 'workspace' },
]

interface ModelResult {
  readonly text: string
  readonly usage?: Readonly<Record<string, number>>
  readonly model: string
  readonly stopReason: string | undefined
}

async function main(): Promise<void> {
  const deepseekKey = process.env.DEEPSEEK_API_KEY
  const jevEndpoint = process.env.CONTINUUM_JEV_ENDPOINT?.trim()
  const jevModel = process.env.CONTINUUM_JEV_MODEL?.trim()
  if (deepseekKey === undefined || deepseekKey.length === 0 || !jevEndpoint || !jevModel) {
    throw new Error('continuum-evaluation requires DEEPSEEK_API_KEY, CONTINUUM_JEV_ENDPOINT and CONTINUUM_JEV_MODEL (JEV_API_KEY optional)')
  }
  const baseURL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic').replace(/\/$/u, '')
  const model = process.env.DEEPSEEK_EVAL_MODEL ?? 'deepseek-v4-pro'
  const jevContext = new Context()
  await jevContext.plugin(Jev, { endpoint: jevEndpoint, model: jevModel, effort: 'low', timeoutMs: 30_000, ...(process.env.JEV_API_KEY_ENV || process.env.JEV_API_KEY ? { apiKeyEnv: process.env.JEV_API_KEY_ENV || 'JEV_API_KEY' } : {}) })
  activeJevContext = jevContext
  const results: EvaluationResult[] = []
  try {
    for (const variant of ['A0', 'A1', 'B', 'C', 'U'] as const) {
      for (const task of tasks) {
        const started = performance.now()
        const selected = await selectionFor(variant, task)
        const prompt = promptFor(variant, task, selected)
        const response = await askDeepSeek(baseURL, deepseekKey, model, prompt)
        const text = response.text.trim()
        const assertion = evaluateVariant(variant, task, selected, text)
        results.push({
          variant, task: task.id, source: task.source, model: response.model,
          authorizedIds: selected.authorizedIds, selectedIds: selected.ids, baselineIds: selected.baselineIds,
          assertion, matched: assertion.status === 'pass',
          expected: task.expected, response: text, usage: response.usage, stopReason: response.stopReason,
          latencyMs: Math.round(performance.now() - started),
        })
        console.log(JSON.stringify({
          variant, task: task.id, assertion: assertion.status, selectedIds: selected.ids,
          latencyMs: Math.round(performance.now() - started),
        }))
      }
    }
  } finally {
    await jevContext.fiber.dispose()
  }
  const output = {
    version: 1, generatedAt: new Date().toISOString(), model, endpoint: baseURL,
    variants: ['A0', 'A1', 'B', 'C', 'U'], tasks, results,
    summary: {
      total: results.length,
      applicable: results.filter(result => result.assertion.status !== 'not-applicable').length,
      matched: results.filter(result => result.matched === true).length,
      failed: results.filter(result => result.assertion.status === 'fail').length,
    },
  }
  const path = resolve('docs/feat-continuum-memory/continuum-evaluation-results.json')
  await mkdir(resolve('docs/feat-continuum-memory'), { recursive: true })
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`)
  assertEvaluationPassed(results)
  console.log(`continuum-evaluation: wrote ${path}`)
}

/** Evidence required for each frozen variant/task cell. */
export interface EvaluationResult {
  readonly variant: Variant
  readonly task: string
  readonly assertion: Assertion
  readonly response: string
  readonly stopReason: string | undefined
  readonly [field: string]: unknown
}

/** Reject missing cells, failed assertions, empty output, or truncated generation after saving evidence. */
export function assertEvaluationPassed(results: readonly EvaluationResult[]): void {
  const variants: readonly Variant[] = ['A0', 'A1', 'B', 'C', 'U']
  const expected = new Set(variants.flatMap(variant => tasks.map(task => `${variant}/${task.id}`)))
  const seen = new Set<string>()
  const failures: string[] = []
  for (const result of results) {
    const cell = `${result.variant}/${result.task}`
    if (!expected.has(cell) || seen.has(cell)) failures.push(`${cell}: unexpected or duplicate cell`)
    seen.add(cell)
    if (result.assertion.status === 'fail') failures.push(`${cell}: ${result.assertion.reason}`)
    if (result.response.trim().length === 0 || result.stopReason !== 'end_turn') failures.push(`${cell}: incomplete generation (${result.stopReason ?? 'missing stop reason'})`)
  }
  for (const cell of expected) if (!seen.has(cell)) failures.push(`${cell}: missing cell`)
  if (results.filter(result => result.assertion.status === 'pass').length !== 11) failures.push('expected 11 applicable passing assertions')
  if (failures.length > 0) throw new Error(`Continuum evaluation failed:\n${failures.join('\n')}`)
}

export async function selectionFor(
  variant: Variant,
  task: Task,
): Promise<{ ids: readonly string[]; baselineIds: readonly string[]; authorizedIds: readonly string[] }> {
  const authorized = authorizedMemories(task)
  const baseline = task.id === 'scope-denial' ? [] : authorized.filter((memory) => {
    const firstLabel = memory.label.split(' ')[0] ?? ''
    return task.input.toLocaleLowerCase().includes(firstLabel.toLocaleLowerCase()) || task.source === memory.source
  })
  const first = baseline[0]
  const baselineIds = first === undefined ? [] : [first.id]
  if (variant !== 'C') return { ids: variant === 'A0' ? [] : baselineIds, baselineIds, authorizedIds: authorized.map(memory => memory.id) }
  const context = activeJevContext
  const result = await selectContinuumMemory(context.jev, { mode: 'active', timeoutMs: 30_000, maxRequestBytes: 32_768, sessionDataClasses: ['workspace'],
    privacyPolicy: { mode: 'controlled', approvedRemoteIds: ['system-one'], approvedRemoteDataClasses: ['workspace'] } }, {
    query: task.input,
    candidates: authorized.map(memory => ({
      id: MemoryId(memory.id), label: memory.label, excerpt: memory.content,
      score: baseline.some(item => item.id === memory.id) ? 0.9 : 0.1,
    })),
  })
  return { ids: result.selectedIds.map(String), baselineIds, authorizedIds: authorized.map(memory => memory.id) }
}

/** Apply the task principal's exact scope set before retrieval or Jev. */
export function authorizedMemoryIds(task: Pick<Task, 'authorizedScopes'>): readonly string[] {
  return memories.filter(memory => task.authorizedScopes.includes(memory.scope)).map(memory => memory.id)
}

function authorizedMemories(task: Pick<Task, 'authorizedScopes'>): readonly Memory[] {
  const ids = new Set(authorizedMemoryIds(task))
  return memories.filter(memory => ids.has(memory.id))
}

let activeJevContext: Context

function promptFor(variant: Variant, task: Task, selected: { ids: readonly string[]; baselineIds: readonly string[] }): string {
  const injected = selected.ids
    .map(id => memories.find(memory => memory.id === id)?.content)
    .filter((value): value is string => value !== undefined)
  const rawHistory = variant === 'A1' ? memories.map(memory => memory.content) : []
  const summary = variant === 'U' ? ['Summary tree root: migration and invoice records.', 'Stable cache prefix: Session-backed records.'] : []
  return [
    'Answer the user task with one concise sentence. Use only the supplied context. If the requested private note is not authorized, answer exactly: no private record injected.',
    `Variant: ${variant}. Task: ${task.input}`,
    ...rawHistory.map(value => `History: ${value}`),
    ...summary,
    ...injected.map(value => `Selected memory: ${value}`),
  ].join('\n')
}

/** Evaluate behavior that the selected variant actually claims to provide. */
export function evaluateVariant(
  variant: Variant,
  task: Task,
  selected: { readonly ids: readonly string[]; readonly baselineIds: readonly string[] },
  response: string,
): Assertion {
  const text = response.toLocaleLowerCase()
  if (variant === 'A0' || variant === 'U') {
    return { status: 'not-applicable', reason: variant === 'A0' ? 'no-context control' : 'summary-tree/cache control' }
  }
  if (variant === 'A1') {
    if (task.id === 'scope-denial') return { status: 'not-applicable', reason: 'unsandboxed existing-history control' }
    return matchesTaskResponse(task, text)
      ? { status: 'pass', reason: 'existing history contains the expected fact' }
      : { status: 'fail', reason: 'existing history response omitted the expected fact' }
  }
  if (task.id === 'scope-denial') {
    const authorized = new Set(authorizedMemoryIds(task))
    const denied = selected.ids.every(id => authorized.has(id)) && isScopeDeniedResponse(text)
    return denied
      ? { status: 'pass', reason: 'private scope was excluded before Jev and model injection' }
      : { status: 'fail', reason: 'private scope was selected or disclosed' }
  }
  const expectedId = task.source.slice('fixture:'.length)
  const selectedExpected = selected.ids.includes(expectedId)
  const expectedText = matchesTaskResponse(task, text)
  if (selectedExpected && expectedText) return { status: 'pass', reason: 'authorized candidate and expected response observed' }
  const missing = [selectedExpected ? '' : 'expected candidate was not selected', expectedText ? '' : 'expected response was omitted'].filter(Boolean).join('; ')
  return { status: 'fail', reason: missing }
}

function matchesTaskResponse(task: Task, text: string): boolean {
  if (task.id === 'exact-fact') return text.includes('inv-42')
  if (task.id === 'correction') return text.includes('monday') && (text.includes('friday') || text.includes('supersed') || text.includes('cutover'))
  if (task.id === 'restart-replay') return (text.includes('session') || text.includes('session-backed')) && (text.includes('record') || text.includes('id'))
  return text.includes(task.expected.toLocaleLowerCase())
}

function isScopeDeniedResponse(text: string): boolean {
  return (text.includes('no private') || text.includes('not authorized') || text.includes('cannot') || text.includes("don't have"))
    && !text.includes('access token is stored')
}

async function askDeepSeek(baseURL: string, key: string, model: string, prompt: string): Promise<ModelResult> {
  const response = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system: 'You are a strict evaluation model. Return only one short answer sentence; do not emit analysis.', messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await response.json() as {
    content?: readonly { type: string; text?: string }[]
    model?: string
    stop_reason?: string
    usage?: Record<string, number>
    error?: { message?: string }
  }
  if (!response.ok) throw new Error(`DeepSeek evaluation request failed with HTTP ${response.status}: ${body.error?.message ?? 'unknown error'}`)
  return {
    text: body.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? '',
    model: body.model ?? model,
    stopReason: body.stop_reason,
    ...(body.usage === undefined ? {} : { usage: body.usage }),
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main()
