import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { RuntimeContextProjection } from '../src/runtime-context.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test-compaction': { kind: 'test-compaction' } & ContextFormed
  }
}

const SOURCE = 'runtime-context'

function contextMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: SOURCE },
  })
}

describe('RuntimeContextProjection', () => {
  it('restores the latest visible owned snapshot and ignores other sessions', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-context-replay'))
    const retained = session.append('user/message', contextMessage('retained'), { surfaceOp: 'append' })
    const shadowed = session.append('user/message', contextMessage('shadowed'), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', startSeq: shadowed.seq, endSeq: shadowed.seq },
      sourceEventSeqs: [shadowed.seq],
    })

    const projection = new RuntimeContextProjection(ctx, session)
    expect(session.surface.nodes).toContain(retained.seq)
    expect(projection.project('retained', [])).toBeUndefined()
    // A snapshot that replaces a retained one records what moved, so the
    // durable log explains why this text replaced the last.
    expect(projection.project('next', [{ name: 'sandbox:policy', text: 'policy' }])?.source).toEqual({
      kind: SOURCE,
      form: 'snapshot',
      sections: [{ name: 'sandbox:policy', text: 'policy' }],
      change: {
        fromSeq: retained.seq,
        sections: [{ name: 'sandbox:policy', kind: 'added' }],
      },
    })

    const other = ctx.sessions.create(SessionId('runtime-context-other'))
    other.append('user/message', contextMessage('other'), { surfaceOp: 'append' })
    expect(projection.project('retained', [])).toBeUndefined()
  })

  it('records no change on the first snapshot, which has no predecessor', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-context-first'))
    const projection = new RuntimeContextProjection(ctx, session)

    const source = projection.project('first', [{ name: 'sandbox:policy', text: 'policy' }])?.source

    // There is nothing this text replaced, so claiming a delta would be a
    // fabricated cause.
    expect(source).toEqual({
      kind: SOURCE,
      form: 'snapshot',
      sections: [{ name: 'sandbox:policy', text: 'policy' }],
    })
  })

  it('names updated and removed contributions as well as added ones', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-context-delta'))
    const projection = new RuntimeContextProjection(ctx, session)
    projection.project('first', [
      { name: 'sandbox:policy', text: 'old' },
      { name: 'approval:policy', text: 'ask' },
    ])
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'first' }],
        source: {
          kind: SOURCE,
          form: 'snapshot',
          sections: [
            { name: 'sandbox:policy', text: 'old' },
            { name: 'approval:policy', text: 'ask' },
          ],
        },
      }),
      { surfaceOp: 'append' },
    )

    const source = projection.project('second', [
      { name: 'sandbox:policy', text: 'new' },
      { name: 'network:policy', text: 'deny' },
    ])

    expect(source?.source).toMatchObject({
      change: {
        sections: [
          { name: 'sandbox:policy', kind: 'updated' },
          { name: 'network:policy', kind: 'added' },
          { name: 'approval:policy', kind: 'removed' },
        ],
      },
    })
  })
})
