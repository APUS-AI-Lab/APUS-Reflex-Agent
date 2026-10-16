import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import LlmRuntime, {
  createMessage,
  createToolResultMessage,
  createUserMessage,
  LlmAdapter,
  ToolCallId,
  type ContentBlock,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine, {
  type SessionEventSearchPage,
  type SessionSearchHit,
  type SessionSearchPage,
} from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as HistoryRecall from '@deepseek-ai/dsh-tool-history-recall'

const MODEL = 'test-model'
const SIGNAL = new AbortController().signal
const activeContexts: Context[] = []

afterEach(async () => {
  for (const ctx of activeContexts.splice(0)) await ctx.fiber.dispose()
})

class WindowAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class LiveOnlyQuery extends SessionQueryEngine {
  override searchSessions(): Promise<SessionSearchPage<SessionSearchHit>> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(): Promise<SessionEventSearchPage> {
    throw new Error('history recall does not use full-text search')
  }
}

class FixedSummaryEngine extends BasicCompactionEngine {
  inputs: SummarizationInput[] = []

  override summarize(input: SummarizationInput): Promise<{ summary: ContentBlock[]; provider: string; model: string }> {
    this.inputs.push(input)
    return Promise.resolve({ summary: [{ type: 'text', text: `summary ${this.inputs.length}` }], provider: MODEL, model: MODEL })
  }
}

interface Mounted {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly compaction: FixedSummaryEngine
  call(name: string, args: unknown, agent?: Agent): Promise<ToolExecutionResult>
}

async function mount(config: HistoryRecall.Config = {}): Promise<Mounted> {
  const ctx = new Context()
  activeContexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(TokenMeter)
  ctx.llm.registerAdapter([MODEL], new WindowAdapter())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LiveOnlyQuery)
  await ctx.plugin(HistoryRecall, config)
  const compaction = new FixedSummaryEngine(ctx, { auto: false, headroomTokens: 0, maxTokens: 512, recallFooter: true })
  const session = ctx.sessions.create(SessionId('recall'), { meta: { createdAt: 1, cwd: '/work' } })
  const agent = { id: session.id, session, options: { provider: MODEL, model: MODEL } } as Agent
  let calls = 0
  return {
    ctx,
    session,
    agent,
    compaction,
    call: (name, args, caller = agent) => ctx.tools.execute({
      name,
      arguments: args,
      callId: ToolCallId(`call-${++calls}`),
      signal: new AbortController().signal,
      agent: caller,
    }),
  }
}

/** Append closed turns whose texts carry unique literal anchors, then open the next turn. */
function appendTurns(session: Session, from: number, to: number): void {
  for (let turn = from; turn <= to; turn += 1) {
    const callId = ToolCallId(`read-${turn}`)
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `request ${turn}: ${'padding '.repeat(80)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', { header: { config: { provider: MODEL, model: MODEL } }, reason: 'initial' })
    }
    session.append('assistant/message', {
      stream: [],
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: `hidden thought ${turn}` },
          { type: 'text', text: `checking turn ${turn}` },
          { type: 'tool-call', id: callId, name: 'read', arguments: `{"path":"src/file-${turn}.ts"}` },
        ],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn, step: 1, callId, name: 'read', arguments: '{}' })
    session.append('tool/result', {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: `ERR_ANCHOR_${turn} value=${turn * 7} ${'output '.repeat(80)}` }],
        isError: turn === 2,
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn: to + 1 })
}

async function compactHead(mounted: Mounted, nodes: number): Promise<number> {
  const surface = [...mounted.session.surface.nodes]
  const result = await mounted.compaction.compactRegion(surface[0]!, surface[nodes - 1]!, mounted.agent, SIGNAL)
  return result.summarySeq
}

function text(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

function errorCode(result: ToolExecutionResult): string | undefined {
  return result.isError ? result.error.info?.code : undefined
}

function surfaceText(session: Session): string {
  return session.deriveMessages()
    .flatMap(message => message.content)
    .map(block => block.type === 'text' ? block.text : '')
    .join('\n')
}

describe('history recall over compaction checkpoints', () => {
  it('registers the recall guidance and both tools', async () => {
    const mounted = await mount()
    const names = mounted.ctx.tools.schemas().map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['history_read', 'history_search']))
  })

  it('reads back the exact originals a checkpoint replaced, without reasoning blocks', async () => {
    const mounted = await mount()
    appendTurns(mounted.session, 1, 3)
    const checkpoint = await compactHead(mounted, 6)

    expect(surfaceText(mounted.session)).not.toContain('ERR_ANCHOR_1')
    expect(surfaceText(mounted.session)).toContain(`checkpoint c${checkpoint}`)

    const page = text(await mounted.call('history_read', { checkpoint }))
    expect(page).toContain(`Checkpoint c${checkpoint} originals`)
    expect(page).toContain('User: request 1:')
    expect(page).toContain('Assistant: checking turn 1')
    expect(page).toContain('[tool call read] {"path":"src/file-1.ts"}')
    expect(page).toContain('Tool result: ERR_ANCHOR_1 value=7')
    expect(page).toContain('Tool result (error): ERR_ANCHOR_2 value=14')
    expect(page).not.toContain('hidden thought')
    expect(page).toContain('[end of checkpoint]')
  })

  it('pages through a span with a continuation offset that loses no characters', async () => {
    const mounted = await mount({ pageChars: 1_000 })
    appendTurns(mounted.session, 1, 3)
    const checkpoint = await compactHead(mounted, 6)

    let offset = 0
    let joined = ''
    for (let guard = 0; guard < 20; guard += 1) {
      const page = text(await mounted.call('history_read', { checkpoint, offset }))
      const body = page.split('\n\n').slice(1, -1).join('\n\n')
      joined += body
      const next = /offset (\d+)\]$/u.exec(page)
      if (next === null) break
      offset = Number(next[1])
    }
    expect(joined).toContain('ERR_ANCHOR_1')
    expect(joined).toContain('ERR_ANCHOR_2')
    const whole = text(await mounted.call('history_read', { checkpoint }))
    expect(whole.length).toBeLessThan(joined.length + 1_000)
  })

  it('keeps an earlier checkpoint reachable after it is itself compacted', async () => {
    const mounted = await mount()
    appendTurns(mounted.session, 1, 2)
    const first = await compactHead(mounted, 6)
    appendTurns(mounted.session, 3, 5)
    const second = await compactHead(mounted, 4)

    const outer = text(await mounted.call('history_read', { checkpoint: second }))
    expect(outer).toContain(`checkpoint c${first}`)
    const found = text(await mounted.call('history_search', { query: 'err_anchor_1' }))
    expect(found).toContain(`- c${first} offset`)
    expect(found).toMatch(/scanned 2 checkpoint\(s\), matched 1/u)
  })

  it('limits a search to one checkpoint and reports truncation', async () => {
    const mounted = await mount({ maxMatches: 1 })
    appendTurns(mounted.session, 1, 3)
    const checkpoint = await compactHead(mounted, 6)

    const limited = text(await mounted.call('history_search', { query: 'ERR_ANCHOR', checkpoint }))
    expect(limited).toMatch(/scanned 1 checkpoint\(s\), matched 1, truncated/u)
    const none = text(await mounted.call('history_search', { query: 'never-written' }))
    expect(none).toContain('No match (scanned 1 checkpoint(s), matched 0)')
  })

  it('rejects unknown checkpoints, bad offsets, blank queries, and agent-less callers', async () => {
    const mounted = await mount()
    appendTurns(mounted.session, 1, 3)
    const checkpoint = await compactHead(mounted, 6)

    const unknown = await mounted.call('history_read', { checkpoint: 0 })
    expect(errorCode(unknown)).toBe('HISTORY_RECALL_UNKNOWN_CHECKPOINT')
    expect(text(unknown)).toContain(`c${checkpoint}`)
    expect(errorCode(await mounted.call('history_read', { checkpoint, offset: 10_000_000 })))
      .toBe('HISTORY_RECALL_INVALID_OFFSET')
    expect(errorCode(await mounted.call('history_read', { checkpoint, offset: -1 })))
      .toBe('HISTORY_RECALL_INVALID_OFFSET')
    expect(errorCode(await mounted.call('history_search', { query: '   ' }))).toBe('HISTORY_RECALL_INVALID_QUERY')
    const agentless = await mounted.ctx.tools.execute({
      name: 'history_read',
      arguments: { checkpoint },
      callId: ToolCallId('agentless'),
      signal: new AbortController().signal,
    })
    expect(errorCode(agentless)).toBe('HISTORY_RECALL_NO_AGENT')
  })

  it('reads from the message of a recalled source event, and rejects ambiguous or uncompacted targets', async () => {
    const mounted = await mount()
    appendTurns(mounted.session, 1, 3)
    const checkpoint = await compactHead(mounted, 6)
    const second = mounted.session.snapshotEvents()
      .find(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text.startsWith('request 2:')))!
    const page = text(await mounted.call('history_read', { event: second.seq }))
    expect(page).toContain(`Checkpoint c${checkpoint} originals`)
    expect(page.split('\n\n')[1]).toMatch(new RegExp(`^#${second.seq} User: request 2:`, 'u'))
    expect(page).not.toContain('request 1:')
    const later = mounted.session.snapshotEvents().findLast(event => event.type === 'user/message')!
    expect(errorCode(await mounted.call('history_read', { event: later.seq }))).toBe('HISTORY_RECALL_UNKNOWN_EVENT')
    expect(errorCode(await mounted.call('history_read', { event: second.seq, checkpoint }))).toBe('HISTORY_RECALL_INVALID_TARGET')
    expect(errorCode(await mounted.call('history_read', {}))).toBe('HISTORY_RECALL_INVALID_TARGET')
  })

  it('presents each call by its target and marks both tools safe to run concurrently', async () => {
    const mounted = await mount({ snippetRadius: 8 })
    const read = mounted.ctx.tools.get('history_read')
    const search = mounted.ctx.tools.get('history_search')
    expect(read?.presentCall?.({ checkpoint: 7 })).toMatchObject({ kind: 'read', title: 'Recall checkpoint c7' })
    expect(read?.presentCall?.({ event: 12 })).toMatchObject({ kind: 'read', title: 'Recall event #12' })
    expect(search?.presentCall?.({ query: 'ERR' })).toMatchObject({ kind: 'search', title: 'Search compacted history', rawInput: 'ERR' })
    expect(read?.isConcurrencySafe?.({ checkpoint: 7 })).toBe(true)
    expect(search?.isConcurrencySafe?.({ query: 'ERR' })).toBe(true)
    expect(text(await mounted.call('history_read', { checkpoint: 1 }))).toContain('known checkpoints: (none)')
  })

  it('removes both tools when the plugin is disposed', async () => {
    const ctx = new Context()
    activeContexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LiveOnlyQuery)
    const fiber = await ctx.plugin(HistoryRecall, {})
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('history_read')
    await fiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('history_read')
  })
})
