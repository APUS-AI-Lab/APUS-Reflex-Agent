import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import { selectContinuumMemory } from '../packages/experimental/continuum-jev/src/index.ts'

type Variant = 'A0' | 'A1' | 'B' | 'C' | 'U'
type Task = { id: string; input: string; expected: string; source: string }
type Memory = { id: string; label: string; content: string; source: string }

const tasks: readonly Task[] = [
  { id: 'exact-fact', input: 'Which invoice was disputed?', expected: 'INV-42', source: 'fixture:invoice' },
  { id: 'correction', input: 'The cutover moved to Monday; continue the task.', expected: 'Monday supersedes Friday', source: 'fixture:migration' },
  { id: 'scope-denial', input: 'Recall the private migration note.', expected: 'no private record injected', source: 'fixture:private' },
  { id: 'restart-replay', input: 'Continue after process restart.', expected: 'same Session-backed record IDs', source: 'fixture:replay' },
]

const memories: readonly Memory[] = [
  { id: 'invoice', label: 'Invoice dispute', content: 'Invoice INV-42 was disputed by finance.', source: 'fixture:invoice' },
  { id: 'migration', label: 'Migration correction', content: 'The migration was moved from Friday to Monday; Monday supersedes Friday.', source: 'fixture:migration' },
  { id: 'private', label: 'Private migration note', content: 'Private migration note: the access token is stored in a protected vault.', source: 'fixture:private' },
  { id: 'replay', label: 'Restart record', content: 'The Session-backed record IDs must remain stable after process restart.', source: 'fixture:replay' },
]

interface ModelResult {
  readonly text: string
  readonly usage?: Readonly<Record<string, number>>
  readonly model: string
}

async function main(): Promise<void> {
  const deepseekKey = process.env.DEEPSEEK_API_KEY
  const jevKey = process.env.JEV_API_KEY
  if (deepseekKey === undefined || deepseekKey.length === 0 || jevKey === undefined || jevKey.length === 0) {
    throw new Error('continuum-evaluation requires protected DEEPSEEK_API_KEY and JEV_API_KEY')
  }
  const baseURL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic').replace(/\/$/u, '')
  const model = process.env.DEEPSEEK_EVAL_MODEL ?? 'deepseek-v4-pro'
  const jevEndpoint = process.env.CONTINUUM_JEV_ENDPOINT ?? 'https://owb1q1vidflfhp-8086.proxy.runpod.net'
  const jevModel = process.env.CONTINUUM_JEV_MODEL ?? 'APUS-OpenJev-v1-9B-5949'
  const jevContext = new Context()
  await jevContext.plugin(Jev, { endpoint: jevEndpoint, model: jevModel, effort: 'low', timeoutMs: 30_000, apiKeyEnv: 'JEV_API_KEY' })
  activeJevContext = jevContext
  const results: Array<Record<string, unknown>> = []
  try {
    for (const variant of ['A0', 'A1', 'B', 'C', 'U'] as const) {
      for (const task of tasks) {
        const started = performance.now()
        const selected = await selectionFor(variant, task)
        const prompt = promptFor(variant, task, selected)
        const response = await askDeepSeek(baseURL, deepseekKey, model, prompt)
        const text = response.text.trim()
        const matched = text.toLocaleLowerCase().includes(task.expected.toLocaleLowerCase())
        results.push({
          variant, task: task.id, source: task.source, model: response.model,
          selectedIds: selected.ids, baselineIds: selected.baselineIds, matched,
          expected: task.expected, response: text, usage: response.usage,
          latencyMs: Math.round(performance.now() - started),
        })
        console.log(JSON.stringify({
          variant, task: task.id, matched, selectedIds: selected.ids,
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
    summary: { total: results.length, matched: results.filter(result => result.matched === true).length },
  }
  const path = resolve('docs/feat-continuum-memory/continuum-evaluation-results.json')
  await mkdir(resolve('docs/feat-continuum-memory'), { recursive: true })
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`)
  if (results.length !== 20) throw new Error(`expected 20 variant/task results, got ${results.length}`)
  console.log(`continuum-evaluation: wrote ${path}`)
}

async function selectionFor(variant: Variant, task: Task): Promise<{ ids: readonly string[]; baselineIds: readonly string[] }> {
  const baseline = task.id === 'scope-denial'
    ? []
    : memories.filter((memory) => {
      const firstLabel = memory.label.split(' ')[0] ?? ''
      return task.input.toLocaleLowerCase().includes(firstLabel.toLocaleLowerCase()) || task.id === memory.source.slice('fixture:'.length)
    })
  const first = baseline[0]
  const baselineIds = first === undefined ? [] : [first.id]
  if (variant !== 'C') return { ids: variant === 'A0' ? [] : baselineIds, baselineIds }
  const context = activeJevContext
  const result = await selectContinuumMemory(context.jev, { mode: 'active', minConfidence: 0.5 }, {
    query: task.input,
    candidates: memories.map(memory => ({
      id: MemoryId(memory.id), label: memory.label, excerpt: memory.content,
      score: baseline.some(item => item.id === memory.id) ? 0.9 : 0.1,
    })),
  })
  return { ids: result.selectedIds.map(String), baselineIds }
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

async function askDeepSeek(baseURL: string, key: string, model: string, prompt: string): Promise<ModelResult> {
  const response = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 256, system: 'You are a strict evaluation model.', messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await response.json() as {
    content?: readonly { type: string; text?: string }[]
    model?: string
    usage?: Record<string, number>
    error?: { message?: string }
  }
  if (!response.ok) throw new Error(`DeepSeek evaluation request failed with HTTP ${response.status}: ${body.error?.message ?? 'unknown error'}`)
  return {
    text: body.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? '',
    model: body.model ?? model,
    ...(body.usage === undefined ? {} : { usage: body.usage }),
  }
}

await main()
