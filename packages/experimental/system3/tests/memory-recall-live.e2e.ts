import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/memory-live/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/memory-live/memory-live.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const LIVE_TIMEOUT_MS = 600_000

function line(stdout: string, prefix: string): unknown {
  const found = stdout.split('\n').find(candidate => candidate.startsWith(`${prefix} `))
  if (found === undefined) throw new Error(`driver printed no ${prefix} line`)
  return JSON.parse(found.slice(prefix.length + 1))
}

interface Brief {
  readonly type: string
  readonly decision?: string
  readonly applied?: boolean
  readonly reason?: string
  readonly elapsedMs?: number
  readonly data?: { readonly items: ReadonlyArray<{ readonly text: string }> }
}

// Real endpoints: DeepSeek's official API generates and the deployed APUS Reflex (Jev) endpoint judges. Both keys are
// required; without them the case skips.
describe.skipIf(process.env.DEEPSEEK_API_KEY === undefined || process.env.APUS_JEV_API_KEY === undefined)(
  'System3 memory recall on real DeepSeek and APUS Reflex endpoints', () => {
    it('keeps a compacted constraint and recalls it verbatim for the question that needs it', async () => {
      const { stdout, stderr } = await runLoaderSmoke({
        label: 'system3 memory recall live smoke',
        tempDirPrefix: 'system3-memory-live-e2e-',
        binScript: driver,
        libBinScript: driver,
        configPath,
        tsconfigPath: repoTsconfig,
        processTimeoutMs: LIVE_TIMEOUT_MS,
      })
      expect(stderr).not.toContain('UNHANDLED')
      const events = line(stdout, 'EVENTS') as Brief[]
      expect(events.some(event => event.type === 'compaction/summary')).toBe(true)

      const constraint = '金额阈值是 100 美元'
      const scores = events.filter(event => event.type === 'system3/memory-score')
      expect(scores.flatMap(event => event.data?.items ?? []).some(item => item.text.includes(constraint))).toBe(true)

      // Each recall answers one input: the threshold question, the region question, then an unrelated input that clears it.
      const recalls = events.filter(event => event.type === 'system3/memory-recall')
      const texts = (index: number): string[] => (recalls.at(index)?.data?.items ?? []).map(item => item.text)
      expect(recalls.length).toBeGreaterThanOrEqual(3)
      expect(texts(-3).some(text => text.includes(constraint))).toBe(true)
      expect(texts(-3).some(text => text.includes('us-east-1'))).toBe(false)
      expect(texts(-2).some(text => text.includes('us-east-1'))).toBe(true)
      expect(texts(-2).some(text => text.includes(constraint))).toBe(false)
      expect(texts(-1)).toEqual([])
      const judged = events.filter(event => event.type === 'system3/judgement' && event.decision === 'memory.recall')
      expect(judged.every(event => event.applied === true && event.reason === 'judged')).toBe(true)
      expect(judged.every(event => (event.elapsedMs ?? Infinity) < 5000)).toBe(true)

      expect(line(stdout, 'LAST_CONTEXT') as string).not.toContain('[System3 记忆召回]')
      expect(line(stdout, 'ANSWER') as string).toContain('100')
      expect(line(stdout, 'REGION') as string).toContain('us-east-1')
    }, LIVE_TIMEOUT_MS + 30_000)
  })
