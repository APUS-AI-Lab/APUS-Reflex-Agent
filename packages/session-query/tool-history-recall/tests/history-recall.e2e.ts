import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/history-recall.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

function blocksText(content: readonly { type: string; text?: string }[]): string {
  return content.map(block => block.text ?? '').join('\n')
}

describe('history recall through the production headless profile', () => {
  it('recovers a detail that compaction removed from the model context', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'history-recall headless smoke',
      tempDirPrefix: 'history-recall-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).not.toContain('UNHANDLED')
    const eventsLine = stdout.split('\n').find(line => line.startsWith('EVENTS '))
    const events = JSON.parse(eventsLine!.slice('EVENTS '.length)) as SessionEvent[]

    const summaries = events.filter(event => event.type === 'compaction/summary')
    expect(summaries.length).toBeGreaterThan(0)
    const checkpoint = events.find((event): event is SessionEvent<'user/message'> => event.type === 'user/message'
      && blocksText(event.data.content).includes('originals retrievable via history_read'))
    expect(blocksText(checkpoint!.data.content)).toMatch(/\[checkpoint c\d+: shadows conversation events #\d+–#\d+;/u)
    expect(blocksText(checkpoint!.data.content)).not.toContain('ALPHA-7731')

    const recall = events.find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result'
      && blocksText(event.data.message.content).includes('ALPHA-7731'))
    expect(blocksText(recall!.data.message.content)).toMatch(/- c\d+ offset \d+: ….*ALPHA-7731/u)
    expect(stdout).toContain('ANSWER "The code is ALPHA-7731."')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
