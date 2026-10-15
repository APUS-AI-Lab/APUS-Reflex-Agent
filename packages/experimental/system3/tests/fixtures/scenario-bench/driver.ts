#!/usr/bin/env node
/**
 * Live scenario benchmark: seven task categories over a medium JavaScript service (more tracked files than prefetch's
 * small-project limit) and personal-assistant tasks over a personal folder that is not a repository (SCENARIO_ONLY
 * selects tasks by id, category or suite), each task in a fresh Headless session, natively or with Reflex pre-decisions depending on the
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

/** A personal folder, not a repository: notes, a calendar, expenses, todos, mail, contacts and documents, mostly in Chinese. */
function personalFiles(): Record<string, string> {
  return {
    'notes/2026-10-07-项目会议.md': '# 项目会议 2026-10-07\n\n参加：我、王磊、Alice\n\n## 决定\n- 预算定为 12 万元\n- 上线截止日期 11 月 15 日\n'
      + '- 测试由王磊负责\n\n## 待办\n- 我：周五前把季度报告发给 Alice\n',
    'notes/reading-list.md': '# 想读的书\n\n- 《置身事内》\n- Thinking in Systems\n',
    'todo.md': '# 待办（今天是 2026-10-14）\n\n- [ ] 交季度报告 截止 2026-10-17\n- [ ] 续签健身卡 截止 2026-10-10\n'
      + '- [ ] 给妈妈买生日礼物 截止 2026-10-12\n- [x] 交物业费 截止 2026-10-05\n- [ ] 预约体检 截止 2026-11-01\n',
    'calendar/2026-10.json': `${JSON.stringify([
      { date: '2026-10-15', time: '10:00', title: '周会' },
      { date: '2026-10-15', time: '15:00', title: '看牙医（仁爱诊所）' },
      { date: '2026-10-16', time: '08:30', title: '飞上海 MU5101 浦东' },
      { date: '2026-10-18', time: '19:00', title: '和老同学吃饭' },
    ], null, 2)}\n`,
    'expenses/2026-09.csv': 'date,category,amount,note\n2026-09-03,餐饮,38.50,午饭\n2026-09-05,交通,22.00,地铁\n'
      + '2026-09-08,餐饮,126.00,聚餐\n2026-09-12,购物,299.00,鞋\n2026-09-15,餐饮,64.20,外卖\n2026-09-21,餐饮,210.00,家庭聚餐\n'
      + '2026-09-25,交通,45.00,打车\n2026-09-28,餐饮,45.80,咖啡\n',
    'contacts.json': `${JSON.stringify({ Alice: { email: 'alice.chen@example.com', phone: '138-0000-1234' },
      王磊: { email: 'wanglei@example.com' } }, null, 2)}\n`,
    'inbox/2026-10-13-alice.txt': 'From: alice.chen@example.com\nSubject: 季度报告\n\n你好，季度报告这周能发给我吗？最好周五之前。谢谢！\nAlice\n',
    'documents/证件.md': '# 证件\n\n- 护照：E12345678，有效期至 2027-03-02\n- 驾照：有效期至 2031-06-30\n',
    'journal/2026-10-12.md': '今天带妈妈去公园散步，天气很好。\n',
  }
}

/** The staged change the change-related tasks describe. */
const STAGED = { path: 'src/modules/payments/service.js', text: 'export function calculateRefund(total, daysSinceDelivery) {\n'
  + '  if (daysSinceDelivery > 30) return 0\n  return Math.round(total * 100) / 100\n}\n' }

interface Scenario {
  readonly id: string
  /** Project tasks run in the service repository; personal tasks run in a personal folder. */
  readonly suite: 'project' | 'personal'
  readonly category: string
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
  { suite: 'project', id: 'chat-capital', category: 'chat', task: 'In one sentence, what is the capital of Japan?', check: has(/Tokyo/u) },
  { suite: 'project', id: 'chat-joke', category: 'chat', task: 'Tell me a one-line joke about coffee.', check: has(/\w{3}/u) },
  { suite: 'project', id: 'facts-version', category: 'facts', task: 'What version is this service at? Answer with the version only.', check: has(/4\.12\.3/u) },
  { suite: 'project', id: 'facts-refund', category: 'facts', task: 'Within how many days can customers ask for a refund? One sentence.', check: has(/\b21\b/u) },
  { suite: 'project', id: 'facts-pool', category: 'facts', task: 'How big is the database connection pool by default? One sentence.', check: has(/\b12\b/u) },
  { suite: 'project', id: 'locate-refund', category: 'locate', task: 'Which file defines calculateRefund? Answer with the path only.',
    check: has(/src\/modules\/payments\/service\.js/u) },
  { suite: 'project', id: 'locate-page-size', category: 'locate', task: 'What page size does the orders list use by default? One sentence.', check: has(/\b25\b/u) },
  { suite: 'project', id: 'locate-stock', category: 'locate', task: 'Which module throws INSUFFICIENT_STOCK? Answer with the module name only.', check: has(/inventory/iu) },
  { suite: 'project', id: 'changes-commit', category: 'changes', task: 'Write a one-line commit message for my staged changes. Output only the message.',
    check: has(/\b30\b|refund/iu) },
  { suite: 'project', id: 'changes-review', category: 'changes', task: 'Review my staged change in two sentences: what behaviour does it change?',
    check: has(/\b30\b/u) },
  { suite: 'project', id: 'skill-commit', category: 'skill', task: 'Write a commit message for a fix that stops double-charging coupons.',
    check: has(/Signed-off-by: shop-bot/u) },
  { suite: 'project', id: 'skill-changelog', category: 'skill', task: 'Write the changelog entry for version 4.13.0: added gift cards, fixed slow search.',
    check: has(/## \[4\.13\.0\] - unreleased/u) },
  { suite: 'project', id: 'edit-page-size', category: 'edit', clean: true, task: 'Change the default page size of the orders list to 50, then run the tests.',
    check: async (_answer, root) => /DEFAULT_PAGE_SIZE = 50\b/u.test(await readFile(join(root, 'src/modules/orders/routes.js'), 'utf8')) && testsPass(root) },
  { suite: 'project', id: 'edit-refund-window', category: 'edit', clean: true, task: 'Customers should now get refunds for 28 days. Update the code and its tests, then run the tests.',
    check: async (_answer, root) => /> 28\b/u.test(await readFile(join(root, 'src/modules/payments/service.js'), 'utf8')) && testsPass(root) },
  { suite: 'project', id: 'zh-version', category: 'chinese', task: '这个服务现在是什么版本？只回答版本号。', check: has(/4\.12\.3/u) },
  { suite: 'project', id: 'zh-refund', category: 'chinese', task: '客户在收货后多少天内可以申请退款？一句话回答。', check: has(/21/u) },
  { suite: 'personal', id: 'p-chat', category: 'p-chat', task: '早上好，给我一句鼓励的话。', check: has(/\p{Script=Han}{4}/u) },
  { suite: 'personal', id: 'p-calendar', category: 'p-schedule', task: '我周四下午有什么安排？', check: has(/牙医|dentist/iu) },
  { suite: 'personal', id: 'p-flight', category: 'p-schedule', task: '我去上海的航班几点起飞？一句话回答。', check: has(/8[:：]30|八点半/u) },
  { suite: 'personal', id: 'p-expense', category: 'p-finance', task: '九月我在餐饮上一共花了多少钱？', check: has(/484\.5/u) },
  { suite: 'personal', id: 'p-overdue', category: 'p-todo', task: '截至今天，我有哪些待办已经过期了？',
    check: answer => Promise.resolve(/健身/u.test(answer) && /生日/u.test(answer) && !/物业.{0,6}(过期|逾期)/u.test(answer)) },
  { suite: 'personal', id: 'p-reply', category: 'p-mail', task: '帮我起草一封回复 Alice 的邮件，告诉她季度报告周五前发给她。只输出邮件正文。',
    check: has(/报告/u) },
  { suite: 'personal', id: 'p-meeting', category: 'p-notes', task: '上周的项目会议定了哪些决定？',
    check: answer => Promise.resolve(/12\s*万/u.test(answer) && /11\s*月\s*15|11-15/u.test(answer)) },
  { suite: 'personal', id: 'p-contact', category: 'p-lookup', task: 'Alice 的邮箱是多少？只回答邮箱。', check: has(/alice\.chen@example\.com/u) },
  { suite: 'personal', id: 'p-passport', category: 'p-lookup', task: '我的护照什么时候过期？', check: has(/2027\D{0,3}0?3\D{0,3}0?2/u) },
  { suite: 'personal', id: 'p-add-todo', category: 'p-edit', task: '把“周四下午三点看牙医”加到我的待办清单里。',
    check: async (_answer, root) => /牙医/u.test(await readFile(join(root, 'todo.md'), 'utf8')) },
]

async function workspace(clean: boolean, suite: Scenario['suite']): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'scenario-bench-'))
  if (suite === 'personal') {
    for (const [path, text] of Object.entries(personalFiles())) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), text)
    }
    return root
  }
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
  for (const scenario of SCENARIOS.filter(entry => only === undefined || only.includes(entry.id) || only.includes(entry.category)
    || only.includes(entry.suite))) {
    const root = await workspace(scenario.clean === true, scenario.suite)
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
      // Per step: main-model time from step start to its message, then tool time until the next step starts.
      const stepTimes = events.flatMap((event, index) => {
        if (event.type !== 'step/start') return []
        const message = events.slice(index).find(next => next.type === 'assistant/message')
        const next = events.slice(index + 1).find(later => later.type === 'step/start') ?? events.at(-1)
        if (message === undefined || next === undefined) return []
        return [{ llm: message.time - event.time, tools: Math.max(0, next.time - message.time) }]
      })
      const success = error === undefined && await scenario.check(answer, root)
      process.stdout.write(`RUN ${JSON.stringify({ round, id: scenario.id, suite: scenario.suite, category: scenario.category, ms, success,
        steps: events.filter(event => event.type === 'assistant/message').length, tools, reflex: reflex ?? null, prefetched,
        skill: skill ?? null, stepTimes, error: error ?? null, answer: answer.trim().slice(0, 100) })}\n`)
    } finally {
      await ctx.fiber.dispose()
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  }
}
