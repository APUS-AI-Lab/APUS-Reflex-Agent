import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/memory/driver.ts', import.meta.url))
const overlay = (name: string): string => fileURLToPath(new URL(`./fixtures/memory/${name}`, import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const SLOW_TIMEOUT_MS = 180_000
const CODE = 'Remember the access code ALPHA-7731 for later.'

function line(stdout: string, prefix: string): unknown {
  const found = stdout.split('\n').find(candidate => candidate.startsWith(`${prefix} `))
  if (found === undefined) throw new Error(`driver printed no ${prefix} line`)
  return JSON.parse(found.slice(prefix.length + 1))
}

interface Run {
  readonly events: SessionEvent[]
  readonly answer: string
  readonly after: string
  /** Gateway requests whose questions are recall questions. */
  readonly recallRequests: number
}

async function run(config: string, scenario = 'normal', processTimeoutMs?: number): Promise<Run> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `system3 memory recall ${scenario} smoke`,
    tempDirPrefix: 'system3-memory-recall-e2e-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay(config),
    tsconfigPath: repoTsconfig,
    env: { MEMORY_E2E_SCENARIO: scenario },
    ...processTimeoutMs === undefined ? {} : { processTimeoutMs },
  })
  expect(stderr).not.toContain('UNHANDLED')
  const jev = line(stdout, 'JEV') as Array<{ body: { questions: Record<string, { instructions: string }> } }>
  return {
    events: line(stdout, 'EVENTS') as SessionEvent[],
    answer: line(stdout, 'ANSWER') as string,
    after: line(stdout, 'AFTER') as string,
    recallRequests: jev.filter(request => Object.values(request.body.questions)
      .some(question => question.instructions.includes('用户当前输入：「'))).length,
  }
}

const recalls = (events: readonly SessionEvent[]) =>
  events.filter((event): event is SessionEvent<'system3/memory-recall'> => event.type === 'system3/memory-recall')
const recallJudgements = (events: readonly SessionEvent[]) =>
  events.filter((event): event is SessionEvent<'system3/judgement'> => event.type === 'system3/judgement' && event.data.decision === 'memory.recall')
const contexts = (events: readonly SessionEvent[]): string[] => events.flatMap(event =>
  event.type === 'user/message' && event.data.source.kind === 'runtime-context'
    ? [event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : [])
const personIds = (events: readonly SessionEvent[]): string[] => events.flatMap(event =>
  event.type === 'user/message' && event.data.source.kind === 'user' ? [event.data.id] : [])

describe('System3 per-turn memory recall through the production headless profile', () => {
  it('recalls the kept memory only for the question that needs it and clears it on the next unrelated input', async () => {
    const { events, answer, after, recallRequests } = await run('memory-recall.patch.yml')
    expect(recallRequests).toBeGreaterThan(0)
    const recorded = recalls(events)
    expect(recorded).toHaveLength(2)
    expect(recorded[0]!.data.items.map(item => item.text)).toEqual([CODE])
    const ids = personIds(events)
    expect(recorded[0]!.data.messageId).toBe(ids.at(-2))
    expect(recorded[1]!.data).toMatchObject({ messageId: ids.at(-1), items: [] })
    expect(recallJudgements(events).every(event => event.data.mode === 'active')).toBe(true)

    const shown = contexts(events)
    expect(shown.filter(text => text.includes('[System3 记忆召回]'))).toHaveLength(1)
    expect(shown.find(text => text.includes('[System3 记忆召回]'))).toContain(CODE)
    expect(shown.at(-1)).not.toContain('[System3 记忆召回]')
    expect(answer).toBe('From memory: the code is ALPHA-7731.')
    expect(after).not.toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it.each([
    ['recall-timeout', 'deadline'],
    ['recall-invalid', 'invalid-response'],
    ['recall-down', undefined],
  ] as const)('recalls nothing and still answers when the recall decision fails (%s)', async (scenario, reason) => {
    const { events, answer, after } = await run('memory-recall.patch.yml', scenario, SLOW_TIMEOUT_MS)
    expect(recalls(events)).toHaveLength(0)
    const judged = recallJudgements(events)
    expect(judged.length).toBeGreaterThan(0)
    expect(judged.every(event => !event.data.applied && event.data.reason !== 'judged')).toBe(true)
    if (reason !== undefined) expect(judged.every(event => event.data.reason === reason)).toBe(true)
    expect(contexts(events).some(text => text.includes('[System3 记忆召回]'))).toBe(false)
    expect(answer).toContain('ALPHA-7731')
    expect(after).not.toBe('')
  }, SLOW_TIMEOUT_MS + 30_000)

  it('records only shadow judgements and keeps showing the scored memories', async () => {
    const { events, answer } = await run('memory-recall-shadow.patch.yml')
    expect(recalls(events)).toHaveLength(0)
    const judged = recallJudgements(events)
    expect(judged.length).toBeGreaterThan(0)
    expect(judged.every(event => event.data.mode === 'shadow' && !event.data.applied)).toBe(true)
    expect(judged.some(event => event.data.outcome === 'recall')).toBe(true)
    expect(contexts(events).some(text => text.includes('[System3 记忆召回]'))).toBe(false)
    expect(contexts(events).some(text => text.includes('[System3 记忆] ') && text.includes(CODE))).toBe(true)
    expect(answer).toBe('From memory: the code is ALPHA-7731.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('sends no recall question when the privacy policy refuses the data class', async () => {
    const { events, recallRequests, answer } = await run('memory-recall-private.patch.yml')
    expect(recallRequests).toBe(0)
    expect(recalls(events)).toHaveLength(0)
    const judged = recallJudgements(events)
    expect(judged.length).toBeGreaterThan(0)
    expect(judged.every(event => event.data.reason === 'privacy-denied' && event.data.request === null)).toBe(true)
    expect(answer).toContain('ALPHA-7731')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
