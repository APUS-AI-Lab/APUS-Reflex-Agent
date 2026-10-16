import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { renderCheckpoint } from '../src/transcript.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface ContentBlockMap {
    'test:vendor': { type: 'test:vendor' }
  }
}

describe('checkpoint transcript rendering', () => {
  it('renders attachments and unknown blocks by tag, and skips system messages, non-messages, and missing events', () => {
    const session = Session.create(SessionId('transcript'))
    session.append('turn/start', { turn: 1 })
    session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('system rules') }, { surfaceOp: 'append' })
    const user = session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [
        { type: 'text', text: 'see attached' },
        { type: 'image', attachment: { attachmentId: AttachmentId(`sha256:${'1'.repeat(64)}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
        { type: 'file', attachment: { attachmentId: AttachmentId(`sha256:${'2'.repeat(64)}`), name: 'notes.txt', bytes: 1 } },
        { type: 'test:vendor' },
      ],
    }), { surfaceOp: 'append' })
    const events = session.snapshotEvents()
    const text = renderCheckpoint(events, {
      id: SessionSeq(99), start: SessionSeq(0), end: user.seq,
      shadowedSeqs: [SessionSeq(0), SessionSeq(1), user.seq, SessionSeq(500)],
    })
    expect(text).toBe(`#${user.seq} User: see attached\n[image]\n[file]\n[test:vendor]`)
  })
})
