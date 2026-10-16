import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { converse, live, ofType } from './fixtures/continuum-live-conversation.ts'

const template = fileURLToPath(new URL('./fixtures/reflex-sweep-live.patch.yml', import.meta.url))

/** Terminal-style commands: progress logs and unrelated lookups surround the three facts the final answer needs. */
const COMMANDS = [
  'for i in $(seq 1 110); do echo "Downloading package_number_$i-1.0.$i-py3-none-any.whl (1.$i MB)"; done',
  String.raw`printf 'service:\n  name: orders-api\n  port: 8443\n  database: orders_v2\n'`,
  'for i in $(seq 1 90); do echo "Weather report for city number $i: sunny, $((i%30)) degrees, wind $((i%9)) km/h"; done',
  'for i in $(seq 1 100); do echo "Get:$i http://deb.debian.org/debian bookworm/main amd64 libexample$i amd64 1.$i [$i kB]"; done',
  String.raw`printf 'FAILED tests/test_api.py::test_timeout - AssertionError: expected retry_limit 3, got 7\nsrc/settings.py:12: RETRY_LIMIT = 7\n'`,
  'for i in $(seq 1 90); do echo "News headline $i: the city council discussed park benches and bicycle lanes on Tuesday"; done',
  'for i in $(seq 1 100); do echo "npm WARN deprecated some-old-package-$i@1.0.$i: This module is no longer supported"; done',
  'for i in $(seq 1 90); do echo "Sports score $i: home team $((i%5)) - away team $((i%4)), attendance $((i*100))"; done',
]
const TASK = '你在排查 orders-api 服务的问题。请用 bash 工具依次运行下面 8 条命令，每条单独调用一次，不要合并也不要跳过。'
  + '全部运行完以后，用三句话告诉我：服务端口和数据库名是什么、测试为什么失败、下一步该改哪个文件的哪一行。\n'
  + COMMANDS.map((command, index) => `${String(index + 1)}. ${command}`).join('\n')

describe.skipIf(!live)('Reflex compaction sweep on DeepSeek and the deployed APUS Reflex endpoint', () => {
  it.each(['active', 'off'])('answers from early tool output after compaction with the sweep %s', async (mode) => {
    const { events, elapsed } = await converse([TASK], { REFLEX_SWEEP_MODE: mode }, template)
    const sweeps = ofType(events, 'system3/judgement').filter(event => event.data.decision === 'reflex.context-sweep')
    const projections = ofType(events, 'reflex/context-projection')
    const summaries = ofType(events, 'compaction/summary')
    const calls = ofType(events, 'tool/result').length
    const answer = ofType(events, 'assistant/message').at(-1)?.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
    const usage = ofType(events, 'assistant/message').map(event => event.data.usage?.inputTokens ?? 0)
    process.stdout.write(`SWEEP ${JSON.stringify({
      mode, elapsed, calls, summaries: summaries.length, summaryInputTokens: summaries.map(event => event.data.shadowedTokenCount),
      sweepRequests: sweeps.length, sweepMs: sweeps.map(event => event.data.elapsedMs),
      hiddenRanges: projections.reduce((count, event) =>
        count + event.data.targets.reduce((sum, target) => sum + target.hidden.length, 0), 0),
      peakInputTokens: Math.max(...usage), answer,
    })}\n`)
    expect(calls).toBeGreaterThanOrEqual(COMMANDS.length)
    expect(answer).toContain('8443')
    expect(answer).toContain('orders_v2')
    expect(answer).toMatch(/RETRY_LIMIT|retry_limit/u)
    if (mode === 'active') {
      expect(sweeps.length).toBeGreaterThan(0)
      expect(projections.length).toBeGreaterThan(0)
    } else {
      expect(sweeps).toEqual([])
      expect(projections).toEqual([])
    }
  }, 900_000)
})
