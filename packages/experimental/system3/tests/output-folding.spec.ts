import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type PostToolDecision, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { foldRepeatedLines, installSystem3OutputFolding, type System3FoldLimits, type System3OutputFoldingConfig } from '../src/output-folding.ts'

const LIMITS: System3FoldLimits = { minLines: 6, minChars: 200, minNetChars: 300, minNetShare: 0.1 }

/** A Vitest-style failure log where every failing test prints the same diff, as real runs do. */
function failureLog(failures: number, eol = '\n'): string {
  const diff = [
    '- Expected', '+ Received', '', '  Array [', '    Object {', '-     "role": "assistant",', '+     "role": "user",',
    '      "content": "the parser keeps the last token when the input ends without a newline",', '    },', '  ]',
    '', ' ❯ tests/parser.spec.ts:42:18',
  ]
  const lines = [' RUN  v4.1.9 /work', '', ` ❯ tests/parser.spec.ts (${String(failures)} tests | ${String(failures)} failed) 31ms`]
  for (let index = 1; index <= failures; index++) {
    lines.push(` FAIL  tests/parser.spec.ts > parser > case ${String(index)}`, `AssertionError: expected messages to match case ${String(index)}`, ...diff)
  }
  lines.push(' Test Files  1 failed (1)', `      Tests  ${String(failures)} failed (${String(failures)})`, '')
  return lines.join(eol)
}

/** Expand every marker from the lines of the folded text it names; the result must be the original. */
function expand(folded: string): string {
  const shown = folded.split(/(?<=\n)/u)
  return shown.map((line) => {
    const marker = /^\[System3 已折叠 \d+ 行：与上文(.+?)逐字相同(?:，开头是 ".*")?\]\r?\n$/u.exec(line)
    if (marker === null) return line
    return (marker[1] as string).split('、').map((ref) => {
      const [, first, last, times] = /^第 (\d+)-(\d+) 行(?: ×(\d+))?$/u.exec(ref) as RegExpExecArray
      return shown.slice(Number(first) - 1, Number(last)).join('').repeat(Number(times ?? 1))
    }).join('')
  }).join('')
}

it('folds a diff printed again for each failure into back-references that restore the log exactly', () => {
  const log = failureLog(5)
  const folded = foldRepeatedLines(log, LIMITS)
  expect(folded).toBeDefined()
  const text = folded?.text ?? ''
  expect(expand(text)).toBe(log)
  expect(folded?.savedChars).toBe(log.length - text.length)
  expect(folded?.foldedLines).toBe(48)
  // Each failure keeps its own title and message; only the shared diff is folded.
  for (let index = 1; index <= 5; index++) expect(text).toContain(`AssertionError: expected messages to match case ${String(index)}`)
  expect(text).toContain('[System3 已折叠 12 行：与上文第 6-17 行逐字相同，开头是 "- Expected"]\n')
  expect(text).toContain('Tests  5 failed (5)')
})

it('keeps CRLF line endings and still restores the log byte for byte', () => {
  const log = failureLog(4, '\r\n')
  const folded = foldRepeatedLines(log, LIMITS)
  expect(folded?.text).toContain('开头是 "- Expected"]\r\n')
  expect(expand(folded?.text ?? '')).toBe(log)
})

it('merges adjacent repeats of one block into a counted reference to its first copy', () => {
  const block = Array.from({ length: 8 }, (_, index) => `    at Object.<anonymous> (/work/node_modules/vitest/dist/runner.js:${String(100 + index)}:7)\n`).join('')
  const log = `start\n${block.repeat(5)}end\n`
  const folded = foldRepeatedLines(log, LIMITS)
  expect(folded?.text).toBe(`start\n${block}[System3 已折叠 32 行：与上文第 2-9 行 ×4逐字相同，开头是 "at Object.<anonymous> (/work/node_modules/vitest/dist/runner…"]\nend\n`)
  expect(folded?.foldedLines).toBe(32)
  expect(expand(folded?.text ?? '')).toBe(log)
})

it('folds a long run of one repeated line against its first kept copies', () => {
  const log = `${'x'.repeat(60)}\n`.repeat(40)
  const folded = foldRepeatedLines(log, LIMITS)
  // Six kept lines, one marker for the next thirty, and a four-line tail too short to fold.
  expect(folded?.text.split('\n')).toHaveLength(12)
  expect(expand(folded?.text ?? '')).toBe(log)
})

it('points a later copy at the first one when the copy in between was folded', () => {
  const block = (tag: string) => Array.from({ length: 6 }, (_, index) => `${tag} frame ${String(index)} ${'.'.repeat(40)}\n`).join('')
  const log = `${block('A')}one\n${block('A')}two\n${block('A')}${block('B')}three\n`
  const text = foldRepeatedLines(log, LIMITS)?.text ?? ''
  expect(text.match(/与上文第 1-6 行逐字相同，开头是 "A frame 0 \.+"/gu)).toHaveLength(2)
  expect(expand(text)).toBe(log)
})

it('quotes nothing when the repeated block starts with a blank line', () => {
  const block = `\n${Array.from({ length: 7 }, (_, index) => `    at frame ${String(index)} ${'.'.repeat(40)}\n`).join('')}`
  const log = `head\n${block}${block}${block}`
  const text = foldRepeatedLines(log, LIMITS)?.text ?? ''
  expect(text).toBe(`head\n${block}[System3 已折叠 16 行：与上文第 2-9 行 ×2逐字相同]\n`)
  expect(expand(text)).toBe(log)
})

it('leaves output unchanged when repeats are too small or the saving is too small', () => {
  const short = Array.from({ length: 5 }, (_, index) => `line ${String(index)} ${'-'.repeat(60)}\n`).join('')
  expect(foldRepeatedLines(`${short}gap\n${short}`, LIMITS)).toBeUndefined()
  const narrow = Array.from({ length: 6 }, (_, index) => `${String(index)}\n`).join('')
  expect(foldRepeatedLines(`${narrow}gap\n${narrow}`, LIMITS)).toBeUndefined()
  const log = failureLog(2)
  expect(foldRepeatedLines(log, { ...LIMITS, minNetShare: 0.9 })).toBeUndefined()
  expect(foldRepeatedLines(log, { ...LIMITS, minNetChars: log.length })).toBeUndefined()
  // Short repeats stay, so a third copy is compared with two earlier ones.
  expect(foldRepeatedLines(`${narrow}x\n${narrow}y\n${narrow}`, LIMITS)).toBeUndefined()
})

it('keeps a repeated run that is shorter than its own marker', () => {
  const tiny = 'a\nb\n'
  expect(foldRepeatedLines(`${tiny}${tiny}${tiny}`, { minLines: 2, minChars: 1, minNetChars: 1, minNetShare: 0 })).toBeUndefined()
})

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const CONFIG: System3OutputFoldingConfig = { mode: 'active', shellTools: ['bash'], commandPattern: '\\b(vitest|pytest|(npm|pnpm) (run )?test)\\b', ...LIMITS }

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], config: Partial<System3OutputFoldingConfig> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  installSystem3OutputFolding(ctx, { ...CONFIG, ...config })
  const adapter = new MockAdapter(script)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  for (const name of ['bash', 'cat']) {
    ctx.tools.register(defineTool({
      name, description: 'Run a command.', parameters: { command: { type: 'string', required: true } },
      output: { schema: { type: 'object', properties: { exitCode: { type: 'integer', required: true }, output: { type: 'string', required: true } }, additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: `${value.output}\nexit ${String(value.exitCode)}` }] },
      execute: args => args.command === 'pnpm test --crash' ? Promise.reject(new Error(failureLog(5))) : Promise.resolve({ exitCode: 1, output: failureLog(5) }),
    }))
  }
  const agent = await ctx.agentLoop.create(SessionId('folded'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fix the parser' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const folds = agent.session.snapshotEvents().filter(event => event.type === 'system3/output-fold').map(event => event.data)
  const seen = (request: GenerateOptions | undefined): string => (request?.messages ?? [])
    .flatMap(message => message.role === 'tool' ? message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('')
  return { ctx, agent, adapter, folds, seen }
}

const run = (id: string, command: string, name = 'bash') => toolCallResponse(id, name, { command })

it('shows the model the folded test output and records the saving', async () => {
  const h = await setup([run('c1', 'pnpm test'), textResponse('found it')])
  const original = `${failureLog(5)}\nexit 1`
  const seen = h.seen(h.adapter.requests[1])
  expect(seen).toContain('[System3 已折叠 12 行')
  expect(expand(seen)).toBe(original)
  expect(h.folds).toEqual([{ version: 1, tool: 'bash', foldedLines: 48, savedChars: original.length - seen.length, applied: true }])
})

it('records the saving in shadow mode but shows the model the original output', async () => {
  const h = await setup([run('c1', 'npx vitest run'), textResponse('found it')], { mode: 'shadow' })
  expect(h.seen(h.adapter.requests[1])).toBe(`${failureLog(5)}\nexit 1`)
  expect(h.folds).toMatchObject([{ applied: false, foldedLines: 48 }])
})

it('leaves other commands, other tools, and failed calls unchanged', async () => {
  const h = await setup([run('c1', 'cat build.log'), run('c2', 'pnpm test', 'cat'), run('c3', 'pnpm test --crash'), textResponse('done')])
  expect(h.seen(h.adapter.requests[1])).toBe(`${failureLog(5)}\nexit 1`)
  expect(h.seen(h.adapter.requests[3])).not.toContain('System3 已折叠')
  expect(h.folds).toEqual([])
})

/** A minimal shell execution for listener-level edge cases. */
function exec(agent: Agent | undefined, parent?: string): ToolExecution {
  return { name: 'bash', arguments: { command: 'pnpm test' }, agent, ...parent === undefined ? {} : { parent } } as never
}

it('folds a downstream replacement and keeps its context, and skips calls it cannot attribute or replace', async () => {
  const h = await setup([textResponse('ready')])
  const log = failureLog(5)
  const result = { content: [{ type: 'text', text: log }], isError: false, value: { exitCode: 1, output: log } } as ToolExecutionResult
  const context = createUserMessage({ content: [{ type: 'text', text: 'note' }], source: { kind: 'user' } })
  const replaced = (): Promise<PostToolDecision> => Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: log }], additionalContexts: [context] })
  const folded = await h.ctx.waterfall('tools/post-execute', exec(h.agent), result, replaced)
  expect(folded).toMatchObject({ kind: 'accept', additionalContexts: [context] })
  expect(folded.kind === 'accept' && expand(folded.content?.[0]?.type === 'text' ? folded.content[0].text : '')).toBe(log)
  const unchanged: (() => Promise<PostToolDecision>)[] = [
    () => Promise.resolve({ kind: 'block', feedback: [{ type: 'text', text: 'denied' }] }),
    () => Promise.resolve({ kind: 'accept', value: { exitCode: 1 } }),
    () => Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: log }, { type: 'text', text: log }] }),
    () => Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: '3 passed' }] }),
  ]
  for (const next of unchanged) expect(await h.ctx.waterfall('tools/post-execute', exec(h.agent), result, next)).toEqual(await next())
  for (const call of [exec(undefined), exec(h.agent, 'outer')]) {
    expect(await h.ctx.waterfall('tools/post-execute', call, result, replaced)).toEqual(await replaced())
  }
  expect(h.folds).toHaveLength(0)
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'system3/output-fold')).toHaveLength(1)
})

it('rejects invalid thresholds and patterns when installed', () => {
  const ctx = new Context()
  expect(() => { installSystem3OutputFolding(ctx, { ...CONFIG, minLines: 0 }) }).toThrow('outputFolding minLines must be a positive integer')
  expect(() => { installSystem3OutputFolding(ctx, { ...CONFIG, minNetShare: 1 }) }).toThrow('outputFolding minNetShare must be at least 0 and below 1')
  expect(() => { installSystem3OutputFolding(ctx, { ...CONFIG, commandPattern: '(' }) }).toThrow('outputFolding commandPattern is not a valid regular expression: (')
})
