/** Completion review with live generation and Jev, production Goal/filesystem tools, and reopened JSONL. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import { afterEach, describe, expect, it } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import System3 from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const OBJECTIVE = '读取 acceptance.txt，确认它的内容为 approved，并把 acceptance-copy.txt 写成完全相同的内容，再读取副本核验'
const hasKeys = Boolean(process.env.JEV_ENDPOINT?.trim() && process.env.JEV_MODEL?.trim() && process.env.DEEPSEEK_API_KEY)

describe.skipIf(!hasKeys)('System3 completion review through live model execution', { retry: 0 }, () => {
  it.each([
    { id: 'goal', objective: OBJECTIVE, filename: 'acceptance-copy.txt', requirement: undefined },
    { id: 'requirement', objective: '读取 acceptance.txt，确认内容为 approved，写一份内容完全相同的副本，文件名遵循用户要求，并读取副本核验',
      filename: 'approved-copy.txt', requirement: '副本文件名必须为 approved-copy.txt。' },
  ])('rejects an unverified $id, completes actual file work, and reopens the same log', { timeout: 180_000 }, async (sample) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-system3-live-completion-'))
    const sourceFiles = ['completion-review.ts', 'task-frame.ts', 'decision-kernel.ts', 'index.ts']
    const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [
      file, createHash('sha256').update(await readFile(new URL(`../src/${file}`, import.meta.url))).digest('hex'),
    ] as const)))
    await writeFile(join(root, 'acceptance.txt'), 'approved\n')
    const ctx = context = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(GoalService)
    await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(ToolFs)
    await ctx.plugin(ToolGoal)
    const model = process.env.SYSTEM3_COMPLETION_LIVE_MODEL ?? 'deepseek-flash'
    await ctx.plugin(LlmPiAi, { providers: {
      'completion-live': {
        api: 'openai-completions',
        baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        compat: { thinkingFormat: 'deepseek' },
        models: [{ id: model, contextWindow: 131072, maxTokens: 8192, input: ['text'],
          reasoningEfforts: { low: 'low' } }],
      },
    } })
    await ctx.plugin(Jev, {
      endpoint: process.env.JEV_ENDPOINT?.trim() ?? '',
      model: process.env.JEV_MODEL?.trim() ?? '',
      ...(process.env.JEV_API_KEY_ENV || process.env.JEV_API_KEY ? { apiKeyEnv: process.env.JEV_API_KEY_ENV || 'JEV_API_KEY' } : {}), effort: 'high', timeoutMs: 15000,
    })
    await ctx.plugin(System3, {
      privacyMode: 'controlled', approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace'],
      jevRouteId: 'jev', jevExecutionDomain: 'network', jevEffort: 'high',
      taskFrame: { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 8000,
        sessionDataClasses: ['workspace'], maxItems: 8, maxMessageChars: 600 },
      completionReview: { mode: 'active', yes: 0.5, no: 0.3, deadlineMs: 15000,
        sessionDataClasses: ['workspace'], maxRefusals: 2, evidenceCalls: 20, resultChars: 300 },
    })
    const id = SessionId('completion-live-product')
    const agent = await ctx.agentLoop.create(id, { provider: 'completion-live', model, reasoningEffort: ReasoningEffortId('low') }, { cwd: root })
    // The user explicitly asks for a premature application to exercise the negative path with a real model.
    const probe = '在读取或写入任何文件前，先尝试一次 update_goal(action=complete)，使用返回的 goal_id 和 revision。'
      + '如果工具拒绝完成，就执行目标里的真实读取、写入与副本核验，再次调用 update_goal(action=complete)。最后简短报告。'
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
      `这是完成核验系统的验收，请先 create_goal，objective 原文必须是「${sample.objective}」。`
      + (sample.requirement === undefined ? `创建后，${probe}`
        : `创建后只调用 get_goal 确认目标状态，并简短报告准备就绪，结束这一轮，等待我给出副本文件名。收到文件名后，${probe}`),
    }] }))
    await agent.whenIdle()
    if (sample.requirement !== undefined) {
      expect(ctx.goals.get(agent)).toMatchObject({ phase: 'active', objective: sample.objective })
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: sample.requirement }] }))
      await agent.whenIdle()
    }
    const events = agent.session.snapshotEvents()
    const names = new Map(events.filter(event => event.type === 'tool/call').map(event => [event.data.callId, event.data.name]))
    const reviews = events.filter(event => event.type === 'system3/completion-review').map(event => event.data)
    const judgements = events.filter(event => event.type === 'system3/judgement')
      .filter(event => event.data.decision === 'completion.review')
    const goal = ctx.goals.get(agent)
    const artifact = await readFile(join(root, sample.filename), 'utf8').catch(() => '')
    const report = {
      version: 1, model, jevModel: process.env.JEV_MODEL?.trim() ?? '',
      caseId: sample.id,
      recordedAt: new Date().toISOString(), execution: 'in-process-production-services', sourceHashes,
      passed: false, reopened: false,
      reviews, judgementReasons: judgements.map(event => event.data.reason),
      elapsedMs: judgements.map(event => event.data.elapsedMs),
      toolCalls: events.filter(event => event.type === 'tool/result').map(event => ({
        name: names.get(event.data.message.toolCallId), isError: event.data.message.isError,
      })),
      phase: goal?.phase, revision: goal?.revision, artifact,
      sessionEvents: events,
    }
    const reportPath = process.env.SYSTEM3_COMPLETION_LIVE_REPORT?.replace(/\.json$/u,
      sample.requirement === undefined ? '.json' : '-requirement.json')
    if (reportPath !== undefined) {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    }
    expect(reviews.length).toBeGreaterThanOrEqual(2)
    expect(reviews[0]?.refused).toBe(true)
    expect(reviews[0]?.decision).not.toBe('complete')
    expect(reviews.at(-1)).toMatchObject({ decision: 'complete', refused: false })
    expect(judgements.every(event => event.data.reason === 'judged')).toBe(true)
    expect(report.toolCalls.filter(call => call.name === 'read').length).toBeGreaterThanOrEqual(2)
    expect(report.toolCalls.some(call => call.name === 'write' && !call.isError)).toBe(true)
    expect(events.some(event => event.type === 'tool/result' && names.get(event.data.message.toolCallId) === 'update_goal'
      && event.data.message.isError && JSON.stringify(event.data.message.content).includes('[System3 完成核验]'))).toBe(true)
    expect(goal).toMatchObject({ phase: 'complete', revision: 2, objective: sample.objective })
    expect(artifact).toBe('approved\n')
    if (sample.requirement !== undefined) {
      expect(events.some(event => event.type === 'system3/task-frame'
        && event.data.items.some(item => item.text === sample.requirement))).toBe(true)
      expect(judgements.some(event => event.data.request !== null
        && JSON.stringify(event.data.request.questions).includes(sample.requirement))).toBe(true)
    }
    await ctx.sessions.flush(agent.session)
    const reopened = await ctx.sessionPersistence.open(id, 'read')
    try {
      const stored = await reopened.read()
      expect(stored.events).toEqual(events)
      const restored = Session.fromRestore(id, stored.events, reopened.header, reopened.inheritedEventCount, stored.eventState)
      expect(restored.deriveMessages()).toEqual(agent.session.deriveMessages())
    } finally {
      await reopened.close()
    }
    report.passed = true
    report.reopened = true
    if (reportPath !== undefined) {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    }
  })
})
