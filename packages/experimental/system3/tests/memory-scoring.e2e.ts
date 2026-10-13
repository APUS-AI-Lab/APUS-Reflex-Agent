import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/memory/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/memory/memory.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

function line(stdout: string, prefix: string): unknown {
  const found = stdout.split('\n').find(candidate => candidate.startsWith(`${prefix} `))
  if (found === undefined) throw new Error(`driver printed no ${prefix} line`)
  return JSON.parse(found.slice(prefix.length + 1))
}

describe('System3 memory scoring through the production headless profile', () => {
  it('scores compacted messages over the System One wire and hands the kept one back to the model', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'system3 memory headless smoke',
      tempDirPrefix: 'system3-memory-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).not.toContain('UNHANDLED')
    const events = line(stdout, 'EVENTS') as SessionEvent[]
    const jev = line(stdout, 'JEV') as Array<{ url: string; body: { questions: Record<string, { instructions: string }> } }>

    expect(jev.length).toBeGreaterThan(0)
    expect(jev[0]?.url).toBe('/v1/systemone')
    const asked = Object.values(jev[0]!.body.questions).map(question => question.instructions)
    expect(asked.some(text => text.includes('「Remember the access code ALPHA-7731 for later.」'))).toBe(true)

    const scores = events.filter((event): event is SessionEvent<'system3/memory-score'> => event.type === 'system3/memory-score')
    expect(scores).toHaveLength(1)
    expect(scores[0]!.data.items.map(item => item.text)).toEqual(['Remember the access code ALPHA-7731 for later.'])
    expect(scores[0]!.data.scanned).toBeGreaterThan(1)
    const summary = events.find(event => event.type === 'compaction/summary')
    expect(scores[0]!.data.checkpoint).toBe(summary?.seq)
    const judgement = events.find(event => event.type === 'system3/judgement' && event.data.decision === 'memory.score')
    expect(judgement?.data).toMatchObject({ applied: true, reason: 'judged', mode: 'active' })

    expect(stdout).toContain('ANSWER "From memory: the code is ALPHA-7731."')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
