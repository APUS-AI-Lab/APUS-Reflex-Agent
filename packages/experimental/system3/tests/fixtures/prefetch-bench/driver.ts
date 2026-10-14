#!/usr/bin/env node
/**
 * Live prefetch benchmark: each task runs in a fresh Headless session over a small project workspace and needs facts
 * from the workspace to answer. PREFETCH_MODE=oracle appends the exact read-only results the task needs to the input,
 * which bounds what Reflex prefetch can save; the default lets the model gather them with its own tools. Prints wall
 * time, model steps, tool calls, and whether the answer contains the expected fact.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '../../../src/index.ts'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configArgument = process.argv[2]
if (configArgument === undefined) throw new Error('prefetch benchmark requires a config path')
// Each task changes into its own workspace, so the overlay path is fixed before the first change.
const configPath = resolve(configArgument)
const repeats = Number(process.env.PREFETCH_BENCH_REPEATS ?? '1')
const oracle = process.env.PREFETCH_MODE === 'oracle'

const FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify({ name: 'orders-service', version: '3.7.2', type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'README.md': '# orders-service\n\nKeeps customer orders. Orders above the review limit of 2500 EUR wait for a manual approval '
    + 'before they ship. Refunds are allowed for 30 days.\n',
  'src/pricing.ts': 'export const VAT_RATE = 0.19\n\nexport function totalWithVat(net: number): number {\n  return Math.round(net * (1 + VAT_RATE) * 100) / 100\n}\n',
  'src/orders.ts': 'import { totalWithVat } from \'./pricing.ts\'\n\nexport const MAX_ITEMS_PER_ORDER = 40\n\n'
    + 'export function orderTotal(lines: { net: number }[]): number {\n  return totalWithVat(lines.reduce((sum, line) => sum + line.net, 0))\n}\n',
  'src/shipping.ts': 'export function shippingDays(country: string): number {\n  return country === \'DE\' ? 2 : 5\n}\n',
}

/** The staged change the commit task describes. */
const STAGED = { path: 'src/shipping.ts', text: 'export function shippingDays(country: string): number {\n  return country === \'DE\' || country === \'AT\' ? 2 : 5\n}\n' }

interface PrefetchTask {
  readonly id: string
  readonly task: string
  /** A fact the answer must contain. */
  readonly expect: RegExp
  /** Read-only commands whose output the oracle appends, as the model would see them. */
  readonly oracle: ReadonlyArray<{ readonly label: string; readonly run: (root: string) => Promise<string> }>
}

const read = (path: string) => ({ label: `read ${path}`, run: (root: string) => readFile(join(root, path), 'utf8') })
const git = (...args: string[]) => ({ label: `git ${args.join(' ')}`, run: (root: string) => Promise.resolve(execFileSync('git', args, { cwd: root, encoding: 'utf8' })) })

const TASKS: readonly PrefetchTask[] = [
  { id: 'version', task: 'What version is this project at? Answer with the version only.', expect: /3\.7\.2/u, oracle: [read('package.json')] },
  { id: 'vat', task: 'What VAT rate does the pricing code use? Answer in one sentence.', expect: /0?\.19|19 ?%/u, oracle: [read('src/pricing.ts')] },
  { id: 'max-items', task: 'How many items can one order have at most? Answer in one sentence.', expect: /\b40\b/u,
    oracle: [git('grep', '-n', 'MAX_ITEMS'), read('src/orders.ts')] },
  { id: 'review-limit', task: 'Above which amount does an order need manual approval? Answer in one sentence.', expect: /2500|2,500/u,
    oracle: [read('README.md')] },
  { id: 'files', task: 'List the source files of this project, one per line, nothing else.', expect: /shipping\.ts/u,
    oracle: [git('ls-files')] },
  { id: 'commit', task: 'Write a one-line commit message for my staged changes. Output only the message.', expect: /\bAT\b|austria/iu,
    oracle: [git('diff', '--staged')] },
  { id: 'chat-capital', task: 'In one sentence, what is the capital of France?', expect: /Paris/u, oracle: [] },
  { id: 'chat-hello', task: 'Say hello in one short sentence.', expect: /\w/u, oracle: [] },
]

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prefetch-bench-'))
  for (const [path, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root })
  run('init', '-q')
  run('-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'add', '.')
  run('-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'commit', '-qm', 'initial')
  await writeFile(join(root, STAGED.path), STAGED.text)
  run('add', STAGED.path)
  return root
}

const results: object[] = []
for (let round = 0; round < repeats; round += 1) {
  for (const entry of TASKS.filter(task => process.env.PREFETCH_BENCH_ONLY === undefined || task.id === process.env.PREFETCH_BENCH_ONLY)) {
    const root = await workspace()
    const originalCwd = process.cwd()
    process.chdir(root)
    const ctx = await bootProductionProfile({ binName: 'prefetch-bench', profile: 'headless', overlayPaths: [resolveConfigPath(configPath, undefined)] })
    try {
      const events: SessionEvent[] = []
      const started = performance.now()
      let task = entry.task
      if (oracle && entry.oracle.length > 0) {
        const outputs = await Promise.all(entry.oracle.map(async step => `$ ${step.label}\n${await step.run(root)}`))
        task = `${task}\n\nWorkspace facts already gathered for this request:\n${outputs.join('\n')}`
      }
      const result = await runFixtureTurn(ctx, { task, onEvent: (_id, event) => { events.push(event) } })
      const ms = Math.round(performance.now() - started)
      const tools = events.flatMap(event => event.type === 'assistant/message'
        ? event.data.message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []) : [])
      const judgement = events.find(event => event.type === 'system3/judgement' && event.data.decision === 'prefetch')
      const skillDecision = events.find(event => event.type === 'system3/skill-decision')
      const injected = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'system3-prefetch'
        ? [event.data.source.items] : [])
      results.push({ round, id: entry.id, ms, steps: events.filter(event => event.type === 'assistant/message').length, tools,
        reflex: judgement?.type === 'system3/judgement'
          ? { outcome: judgement.data.outcome, reason: judgement.data.reason, elapsedMs: judgement.data.elapsedMs,
            items: injected[0] ?? [],
            skillMs: skillDecision?.type === 'system3/skill-decision' ? Math.round(skillDecision.data.elapsedMs) : null }
          : null,
        correct: entry.expect.test(result.output), output: result.output.trim().slice(0, 80) })
    } finally {
      await ctx.fiber.dispose()
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  }
}
process.stdout.write(`RESULTS ${JSON.stringify(results)}\n`)
