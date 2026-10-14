#!/usr/bin/env node
/**
 * Live Skill pre-selection benchmark: each task runs in a fresh Headless session in a temporary workspace that holds
 * six project Skills, so the native run must discover and load a Skill itself while the Reflex run may receive it
 * pre-selected. Prints per-task wall time, model steps, Skill tool calls, the Reflex outcome, and whether the answer
 * carries the marker only the Skill body states.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configArgument = process.argv[2]
if (configArgument === undefined) throw new Error('skill benchmark requires a config path')
// Each task changes into its own workspace, so the overlay path is fixed before the first change.
const configPath = resolve(configArgument)
const repeats = Number(process.env.SKILL_BENCH_REPEATS ?? '1')

interface BenchSkill { readonly name: string; readonly description: string; readonly marker: string; readonly rule: string }

const SKILLS: readonly BenchSkill[] = [
  { name: 'commit-message', description: 'Write git commit messages in this project\'s required format.', marker: 'CM-OK-71',
    rule: 'Use a lowercase conventional-commit subject of at most 50 characters.' },
  { name: 'sql-style', description: 'Write or review SQL queries following this project\'s SQL style rules.', marker: 'SQL-OK-42',
    rule: 'Write SQL keywords in uppercase and put each selected column on its own line.' },
  { name: 'release-notes', description: 'Draft release notes for a new version of this project.', marker: 'RN-OK-58',
    rule: 'Group entries under the headings Added, Fixed and Changed.' },
  { name: 'api-error-format', description: 'Design HTTP API error responses following this project\'s error schema.', marker: 'ERR-OK-33',
    rule: 'Every error body has the fields code, message and requestId.' },
  { name: 'regex-review', description: 'Write or explain regular expressions for this project.', marker: 'RX-OK-90',
    rule: 'Explain each group of the expression on its own line.' },
  { name: 'cron-schedule', description: 'Write cron schedule expressions for this project\'s jobs.', marker: 'CRON-OK-15',
    rule: 'Give the five-field expression first, then one sentence in plain words.' },
]

/** Unrelated project Skills that grow the catalog to a realistic size when SKILL_BENCH_FILLER sets how many. */
const FILLER_TOPICS = ['docker', 'kubernetes', 'terraform', 'ansible', 'nginx', 'redis', 'kafka', 'graphql', 'grpc', 'protobuf',
  'webpack', 'vite', 'eslint', 'prettier', 'jest', 'pytest', 'cypress', 'playwright', 'storybook', 'tailwind',
  'postgres-migration', 'mongodb', 'elasticsearch', 'prometheus', 'grafana', 'sentry', 'oauth', 'jwt', 'csv-import', 'pdf-export',
  'i18n', 'accessibility', 'seo', 'image-resize', 'video-transcode', 'email-template', 'sms-gateway', 'payment-webhook', 'feature-flag',
  'rate-limit', 'cache-policy', 'load-test', 'chaos-test', 'backup-restore', 'log-rotation', 'secret-rotation', 'dependency-upgrade',
  'license-audit', 'changelog-lint', 'design-tokens']
const FILLER_SKILLS: readonly BenchSkill[] = FILLER_TOPICS.flatMap(topic => [
  { name: `${topic}-setup`, description: `Set up and configure ${topic.replaceAll('-', ' ')} for this project.`, marker: '', rule: 'Follow the project conventions.' },
  { name: `${topic}-troubleshoot`, description: `Diagnose and fix ${topic.replaceAll('-', ' ')} problems in this project.`, marker: '', rule: 'Follow the project conventions.' },
])

/** Tasks that each need one Skill, plus plain chat that needs none, so the Reflex overhead on chat is measured too. */
const TASKS: ReadonlyArray<{ readonly task: string; readonly skill?: string }> = [
  { task: 'Write a commit message for a change that fixes a null check in the login handler.', skill: 'commit-message' },
  { task: 'Write a SQL query that lists the ten most recent orders with their customer name.', skill: 'sql-style' },
  { task: 'Draft release notes for version 2.4.0: added dark mode, fixed a crash on startup.', skill: 'release-notes' },
  { task: 'Design the error response for a 404 when an order id does not exist.', skill: 'api-error-format' },
  { task: 'Write a regular expression that matches an ISO date like 2026-10-14.', skill: 'regex-review' },
  { task: 'Write a cron expression that runs a backup job at 02:30 every Sunday.', skill: 'cron-schedule' },
  { task: 'In one sentence, what is the capital of France?' },
  { task: 'Say hello in one short sentence.' },
]

/** The same tasks in Chinese, while every Skill description stays English, so selection cannot rely on shared words. */
const TASKS_ZH: typeof TASKS = [
  { task: '帮我写一条提交说明：修复了登录处理里的空指针检查。', skill: 'commit-message' },
  { task: '写一个查询，列出最近十个订单及其客户姓名。', skill: 'sql-style' },
  { task: '帮 2.4.0 版本起草发版说明：新增深色模式，修复启动崩溃。', skill: 'release-notes' },
  { task: '订单编号不存在时返回 404，帮我设计这个接口的错误返回。', skill: 'api-error-format' },
  { task: '写一个正则表达式，匹配 2026-10-14 这样的日期。', skill: 'regex-review' },
  { task: '写一个定时表达式，每周日凌晨两点半跑备份任务。', skill: 'cron-schedule' },
  { task: '用一句话回答：法国的首都是哪里？' },
  { task: '用一句话打个招呼。' },
]

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skill-bench-'))
  for (const skill of [...SKILLS, ...FILLER_SKILLS.slice(0, Number(process.env.SKILL_BENCH_FILLER ?? '0'))]) {
    const dir = join(root, '.agents', 'skills', skill.name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`
      + `${skill.rule}\n${skill.marker === '' ? '' : `End your answer with the line ${skill.marker} so reviewers know this skill was followed.\n`}`)
  }
  execFileSync('git', ['init', '-q'], { cwd: root })
  return root
}

const results: object[] = []
for (let round = 0; round < repeats; round += 1) {
  for (const { task, skill } of (process.env.SKILL_BENCH_LANG === 'zh' ? TASKS_ZH : TASKS).filter(entry => process.env.SKILL_BENCH_ONLY === undefined
    || entry.skill === process.env.SKILL_BENCH_ONLY)) {
    const root = await workspace()
    const originalCwd = process.cwd()
    process.chdir(root)
    const ctx = await bootProductionProfile({ binName: 'skill-bench', profile: 'headless',
      overlayPaths: [resolveConfigPath(configPath, undefined)] })
    try {
      const events: SessionEvent[] = []
      const started = performance.now()
      const result = await runFixtureTurn(ctx, { task, onEvent: (_id, event) => { events.push(event) } })
      const ms = Math.round(performance.now() - started)
      const steps = events.filter(event => event.type === 'assistant/message').length
      const tools = events.flatMap(event => event.type === 'assistant/message'
        ? event.data.message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []) : [])
      const skillCalls = tools.filter(name => name === 'skill').length
      const decision = events.find(event => event.type === 'system3/skill-decision')
      const marker = skill === undefined ? undefined : SKILLS.find(entry => entry.name === skill)?.marker
      results.push({ round, task: task.slice(0, 40), skill: skill ?? null, ms, steps, skillCalls, tools,
        reflex: decision?.type === 'system3/skill-decision'
          ? { outcome: decision.data.outcome, selected: decision.data.selected ?? null, elapsedMs: Math.round(decision.data.elapsedMs),
            candidates: decision.data.candidateNames.length,
            requestBytes: Buffer.byteLength(JSON.stringify(decision.data.request ?? null)) }
          : null,
        followed: marker === undefined ? null : result.output.includes(marker) })
    } finally {
      await ctx.fiber.dispose()
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  }
}
process.stdout.write(`RESULTS ${JSON.stringify(results)}\n`)
