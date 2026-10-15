#!/usr/bin/env node
/**
 * Live scenario benchmark: seven task categories over a medium JavaScript service (more tracked files than prefetch's
 * small-project limit), each task in a fresh Headless session, natively or with Reflex pre-decisions depending on the
 * overlay. Every task has a deterministic success check on the answer or on the workspace after the turn. Prints one
 * JSON line per run.
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
if (configArgument === undefined) throw new Error('scenario benchmark requires a config path')
// Each task changes into its own workspace, so the overlay path is fixed before the first change.
const configPath = resolve(configArgument)
const repeats = Number(process.env.SCENARIO_REPEATS ?? '1')

const MODULES = ['orders', 'payments', 'shipping', 'users', 'inventory', 'invoices', 'coupons', 'reviews']

/** A medium service: eight modules with service, repository and route files, tests, docs, config and two Skills. */
function files(): Record<string, string> {
  const out: Record<string, string> = {
    'package.json': `${JSON.stringify({ name: 'shop-service', version: '4.12.3', type: 'module', engines: { node: '>=22' },
      scripts: { test: 'node --test' } }, null, 2)}\n`,
    'README.md': '# shop-service\n\nBackend for the web shop. Customers can request a refund within 21 days of delivery. '
      + 'Orders over 900 EUR are reviewed by a human before shipping.\n\nRun `npm test` before every commit.\n',
    'docs/architecture.md': '# Architecture\n\nEvery module has a service, a repository and routes. Services never call another '
      + 'module\'s repository directly.\n',
    'config/default.json': `${JSON.stringify({ port: 8080, database: { pool: 12 } }, null, 2)}\n`,
    'src/modules/orders/routes.js': 'export const DEFAULT_PAGE_SIZE = 25\n\nexport function listOrders(repo, page = 1, size = DEFAULT_PAGE_SIZE) {\n'
      + '  return repo.list({ offset: (page - 1) * size, limit: size })\n}\n',
    'src/modules/payments/service.js': 'export function calculateRefund(total, daysSinceDelivery) {\n'
      + '  if (daysSinceDelivery > 21) return 0\n  return Math.round(total * 100) / 100\n}\n',
    'src/modules/inventory/service.js': 'export class StockError extends Error {}\n\nexport function reserve(stock, quantity) {\n'
      + '  if (quantity > stock) throw new StockError(\'INSUFFICIENT_STOCK\')\n  return stock - quantity\n}\n',
    'test/payments.test.js': 'import { test } from \'node:test\'\nimport assert from \'node:assert/strict\'\n'
      + 'import { calculateRefund } from \'../src/modules/payments/service.js\'\n\n'
      + 'test(\'refund within window\', () => { assert.equal(calculateRefund(10, 3), 10) })\n'
      + 'test(\'no refund after window\', () => { assert.equal(calculateRefund(10, 22), 0) })\n',
    'test/orders.test.js': 'import { test } from \'node:test\'\nimport assert from \'node:assert/strict\'\n'
      + 'import { listOrders, DEFAULT_PAGE_SIZE } from \'../src/modules/orders/routes.js\'\n\n'
      + 'test(\'pages by the default size\', () => {\n  const calls = []\n  listOrders({ list: q => calls.push(q) }, 2)\n'
      + '  assert.deepEqual(calls[0], { offset: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE })\n})\n',
    '.agents/skills/commit-message/SKILL.md': '---\nname: commit-message\ndescription: Write git commit messages in this project\'s format.\n---\n\n'
      + 'Use a conventional-commit subject in lowercase, at most 60 characters, and end the message with the line Signed-off-by: shop-bot.\n',
    '.agents/skills/changelog/SKILL.md': '---\nname: changelog\ndescription: Write CHANGELOG entries for a release of this project.\n---\n\n'
      + 'Group entries under Added, Fixed and Changed headings, and start with the line ## [version] - unreleased.\n',
  }
  for (const module of MODULES) {
    for (const part of ['service', 'repository', 'routes', 'types']) {
      const path = `src/modules/${module}/${part}.js`
      out[path] ??= `// ${module} ${part}\nexport const ${module.toUpperCase()}_${part.toUpperCase()}_READY = true\n`
    }
    out[`test/${module}-smoke.test.js`] ??= 'import { test } from \'node:test\'\nimport assert from \'node:assert/strict\'\n'
      + `import { ${module.toUpperCase()}_TYPES_READY } from '../src/modules/${module}/types.js'\n\n`
      + `test('${module} loads', () => { assert.equal(${module.toUpperCase()}_TYPES_READY, true) })\n`
  }
  return out
}

/** The staged change the change-related tasks describe. */
const STAGED = { path: 'src/modules/payments/service.js', text: 'export function calculateRefund(total, daysSinceDelivery) {\n'
  + '  if (daysSinceDelivery > 30) return 0\n  return Math.round(total * 100) / 100\n}\n' }

interface Scenario {
  readonly id: string
  readonly category: 'chat' | 'facts' | 'locate' | 'changes' | 'skill' | 'edit' | 'chinese'
  readonly task: string
  /** Whether the turn succeeded, from its answer and the workspace afterwards. */
  readonly check: (answer: string, root: string) => Promise<boolean>
  /** Leave the payments change unstaged, for tasks that must not see it. */
  readonly clean?: boolean
}

const has = (pattern: RegExp) => (answer: string) => Promise.resolve(pattern.test(answer))
const testsPass = (root: string): boolean => {
  try {
    execFileSync('node', ['--test'], { cwd: root, stdio: 'ignore', timeout: 60_000 })
    return true
  } catch {
    // A failing or hanging test run is the failed outcome this check reports.
    return false
  }
}

const SCENARIOS: readonly Scenario[] = [
  { id: 'chat-capital', category: 'chat', task: 'In one sentence, what is the capital of Japan?', check: has(/Tokyo/u) },
  { id: 'chat-joke', category: 'chat', task: 'Tell me a one-line joke about coffee.', check: has(/\w{3}/u) },
  { id: 'facts-version', category: 'facts', task: 'What version is this service at? Answer with the version only.', check: has(/4\.12\.3/u) },
  { id: 'facts-refund', category: 'facts', task: 'Within how many days can customers ask for a refund? One sentence.', check: has(/\b21\b/u) },
  { id: 'facts-pool', category: 'facts', task: 'How big is the database connection pool by default? One sentence.', check: has(/\b12\b/u) },
  { id: 'locate-refund', category: 'locate', task: 'Which file defines calculateRefund? Answer with the path only.',
    check: has(/src\/modules\/payments\/service\.js/u) },
  { id: 'locate-page-size', category: 'locate', task: 'What page size does the orders list use by default? One sentence.', check: has(/\b25\b/u) },
  { id: 'locate-stock', category: 'locate', task: 'Which module throws INSUFFICIENT_STOCK? Answer with the module name only.', check: has(/inventory/iu) },
  { id: 'changes-commit', category: 'changes', task: 'Write a one-line commit message for my staged changes. Output only the message.',
    check: has(/\b30\b|refund/iu) },
  { id: 'changes-review', category: 'changes', task: 'Review my staged change in two sentences: what behaviour does it change?',
    check: has(/\b30\b/u) },
  { id: 'skill-commit', category: 'skill', task: 'Write a commit message for a fix that stops double-charging coupons.',
    check: has(/Signed-off-by: shop-bot/u) },
  { id: 'skill-changelog', category: 'skill', task: 'Write the changelog entry for version 4.13.0: added gift cards, fixed slow search.',
    check: has(/## \[4\.13\.0\] - unreleased/u) },
  { id: 'edit-page-size', category: 'edit', clean: true, task: 'Change the default page size of the orders list to 50, then run the tests.',
    check: async (_answer, root) => /DEFAULT_PAGE_SIZE = 50\b/u.test(await readFile(join(root, 'src/modules/orders/routes.js'), 'utf8')) && testsPass(root) },
  { id: 'edit-refund-window', category: 'edit', clean: true, task: 'Customers should now get refunds for 28 days. Update the code and its tests, then run the tests.',
    check: async (_answer, root) => /> 28\b/u.test(await readFile(join(root, 'src/modules/payments/service.js'), 'utf8')) && testsPass(root) },
  { id: 'zh-version', category: 'chinese', task: '这个服务现在是什么版本？只回答版本号。', check: has(/4\.12\.3/u) },
  { id: 'zh-refund', category: 'chinese', task: '客户在收货后多少天内可以申请退款？一句话回答。', check: has(/21/u) },
]

async function workspace(clean: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'scenario-bench-'))
  for (const [path, text] of Object.entries(files())) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=bench@example.com', '-c', 'user.name=bench', ...args], { cwd: root })
  git('init', '-q')
  git('add', '.')
  git('commit', '-qm', 'initial')
  if (!clean) {
    await writeFile(join(root, STAGED.path), STAGED.text)
    git('add', STAGED.path)
  }
  return root
}

const only = process.env.SCENARIO_ONLY?.split(',')
for (let round = 0; round < repeats; round += 1) {
  for (const scenario of SCENARIOS.filter(entry => only === undefined || only.includes(entry.id) || only.includes(entry.category))) {
    const root = await workspace(scenario.clean === true)
    const originalCwd = process.cwd()
    process.chdir(root)
    const ctx = await bootProductionProfile({ binName: 'scenario-bench', profile: 'headless', overlayPaths: [resolveConfigPath(configPath, undefined)] })
    try {
      const events: SessionEvent[] = []
      const started = performance.now()
      let answer = ''
      let error: string | undefined
      try {
        answer = (await runFixtureTurn(ctx, { task: scenario.task, onEvent: (_id, event) => { events.push(event) } })).output
      } catch (failure) {
        error = String(failure).slice(0, 200)
      }
      const ms = Math.round(performance.now() - started)
      const tools = events.flatMap(event => event.type === 'assistant/message'
        ? event.data.message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []) : [])
      const reflex = events.flatMap(event => event.type === 'system3/judgement' && event.data.decision === 'prefetch'
        ? [{ outcome: event.data.outcome, reason: event.data.reason, ms: event.data.elapsedMs }] : [])[0]
      const prefetched = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'system3-prefetch'
        ? event.data.source.items : [])
      const skill = events.flatMap(event => event.type === 'system3/skill-decision'
        ? [{ outcome: event.data.outcome, selected: event.data.selected ?? null, ms: Math.round(event.data.elapsedMs) }] : [])[0]
      const success = error === undefined && await scenario.check(answer, root)
      process.stdout.write(`RUN ${JSON.stringify({ round, id: scenario.id, category: scenario.category, ms, success,
        steps: events.filter(event => event.type === 'assistant/message').length, tools, reflex: reflex ?? null, prefetched,
        skill: skill ?? null, error: error ?? null, answer: answer.trim().slice(0, 100) })}\n`)
    } finally {
      await ctx.fiber.dispose()
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  }
}
