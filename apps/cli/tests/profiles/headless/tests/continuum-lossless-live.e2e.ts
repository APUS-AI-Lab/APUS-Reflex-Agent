import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const patchTemplatePath = fileURLToPath(new URL('./fixtures/continuum-lossless-live.patch.yml', import.meta.url))
const packagesRoot = fileURLToPath(new URL('../../../../../../packages/', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const live = process.env.DEEPSEEK_API_KEY !== undefined && process.env.APUS_JEV_API_KEY !== undefined
const THRESHOLD = '请记住这条要求：订单统计只算已支付订单，金额阈值是 100 美元。只回复“已记住”。'
const REGION = '另外记一下：部署区域是 us-east-1。只回复“好”。'

/** Distinct filler paragraphs, so compaction has real history to replace and nothing in it is worth remembering. */
function padding(turn: number): string {
  const topics = ['城市绿化', '图书馆排架', '咖啡烘焙', '高山徒步', '天文观测', '古籍修复', '海洋潮汐', '城市公交']
  const lines = Array.from({ length: 160 }, (_, index) =>
    `第${String(turn)}段资料第${String(index + 1)}条：关于${topics[(turn + index) % topics.length]!}的背景说明，与当前任务无关，只用于填充上下文。`)
  return `以下是一段背景资料，阅读后只回复“收到”，不要调用任何工具。\n${lines.join('\n')}`
}

const TURNS = [THRESHOLD, REGION, ...Array.from({ length: 6 }, (_, index) => padding(index + 1)),
  '上次说的金额阈值是多少？只用一句话回答。', '部署区域是哪里？只用一句话回答。', '用一句话说说你最喜欢的季节，不要调用任何工具。']
const ASK_THRESHOLD = 8

const ofType = <T extends SessionEvent['type']>(events: readonly SessionEvent[], type: T) =>
  events.filter((event): event is SessionEvent<T> => event.type === type)
const textOf = (event: SessionEvent<'user/message'>) => event.data.content.map(block => block.type === 'text' ? block.text : '').join('')

function turnEvents(events: readonly SessionEvent[], turn: number): SessionEvent[] {
  const starts = events.flatMap((event, index) => event.type === 'turn/start' ? [index] : [])
  return events.slice(starts[turn], starts[turn + 1])
}
const turnRecall = (events: readonly SessionEvent[], turn: number): string => ofType(turnEvents(events, turn), 'user/message')
  .filter(event => event.data.source.kind === 'continuum-memory').map(textOf).join('\n')
const turnAnswer = (events: readonly SessionEvent[], turn: number): string => {
  const message = ofType(turnEvents(events, turn), 'assistant/message').at(-1)
  return message?.data.message.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
}

describe.skipIf(!live)('Continuum lossless memory on DeepSeek and the deployed APUS Reflex endpoint', () => {
  it('keeps the constraints compaction removed and recalls each only for the question that needs it', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'continuum-lossless-live-'))
    try {
      const patchPath = join(cwd, 'continuum-lossless-live.patch.yml')
      await writeFile(patchPath, (await readFile(patchTemplatePath, 'utf8')).replaceAll('../../../../../../../packages/', packagesRoot))
      let sessionId: string | undefined
      const elapsed: number[] = []
      for (const task of TURNS) {
        const started = Date.now()
        const result = await runLoaderSmoke({
          processTimeoutMs: 300_000, label: 'Continuum lossless live', mode: 'src', sourceImport: 'tsx/esm',
          cwd, binScript, tsconfigPath, configPath: patchPath,
          binArgs: ['--profile', 'headless', '--patch', patchPath, '--json', ...(sessionId === undefined ? [] : ['--session-id', sessionId]), task],
          env: { DSH_TELEMETRY_DISABLED: '1' },
        })
        elapsed.push(Date.now() - started)
        sessionId ??= (JSON.parse(result.stdout.split('\n')[0] ?? '{}') as { sessionId: string }).sessionId
      }
      const sessionsDir = join(cwd, '.dsh', 'sessions')
      const file = (await readdir(sessionsDir, { recursive: true })).find(path => path.split(sep).includes(sessionId!) && path.endsWith('.jsonl'))!
      const events = (await readFile(join(sessionsDir, file), 'utf8')).trim().split('\n')
        .map(line => JSON.parse(line) as SessionEvent | { type: 'session' }).filter((event): event is SessionEvent => event.type !== 'session')

      const human = ofType(events, 'user/message').filter(event => event.data.source.kind === 'user')
      const shadowed = new Set(ofType(events, 'compaction/summary').flatMap(event => event.data.shadowedSeqs.map(Number)))
      const compacted = human.filter(event => shadowed.has(Number(event.seq))).map(textOf)
      const records = ofType(events, 'continuum/memory-record').map(event => event.data.record.content)
      const admissions = ofType(events, 'continuum/memory-admission').filter(event => event.data.phase === 'settled')
      const decisions = ofType(events, 'continuum/memory-decision').filter(event => event.data.evaluation?.phase === 'settled')
      process.stdout.write(`LIVE ${JSON.stringify({
        elapsed, compacted: compacted.map(text => text.slice(0, 24)), records: records.map(text => text.slice(0, 24)),
        admissions: admissions.map(({ data }) => ({
          reason: data.reason, candidates: data.candidateIds.length, admitted: data.admittedIds.length,
        })),
        decisions: decisions.map(({ data }) => ({
          reason: data.evaluation?.reason, selected: data.selectedIds.length, baseline: data.baselineIds.length,
        })),
        answers: [ASK_THRESHOLD, ASK_THRESHOLD + 1, ASK_THRESHOLD + 2].map(turn => turnAnswer(events, turn)),
      })}\n`)

      expect(compacted).toEqual(expect.arrayContaining([THRESHOLD, REGION]))
      expect(admissions.length).toBeGreaterThan(0)
      expect(admissions.every(event => event.data.outcome === 'jev')).toBe(true)
      expect(records).toEqual(expect.arrayContaining([THRESHOLD, REGION]))
      expect(records.filter(text => text.startsWith('以下是一段背景资料'))).toEqual([])

      expect(turnRecall(events, ASK_THRESHOLD)).toContain('100 美元')
      expect(turnRecall(events, ASK_THRESHOLD)).not.toContain('us-east-1')
      expect(turnAnswer(events, ASK_THRESHOLD)).toContain('100')
      expect(turnRecall(events, ASK_THRESHOLD + 1)).toContain('us-east-1')
      expect(turnRecall(events, ASK_THRESHOLD + 1)).not.toContain('100 美元')
      expect(turnAnswer(events, ASK_THRESHOLD + 1)).toContain('us-east-1')
      expect(turnRecall(events, ASK_THRESHOLD + 2)).toBe('')
      expect(decisions.every(event => event.data.outcome === 'jev')).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 1_800_000)
})
