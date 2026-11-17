import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  ToolCallId, createAssistantMessage, createToolResultMessage,
} from '@deepseek-ai/dsh-llm'
import { executionSourceFacts, executionSourceScan } from '../src/persistence.ts'

/** One valid session whose step 1 carries `messages` assistant messages and optional tool text. */
function scannedStep(messages: readonly string[], toolTexts: readonly string[] = []) {
  const session = Session.create(SessionId('execution-scan'))
  session.append('turn/start', { turn: 1 })
  const opened = session.append('step/start', { turn: 1, step: 1 })
  for (const text of messages) {
    session.append('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'test', model: 'test' } }),
    }, { surfaceOp: 'append' })
  }
  toolTexts.forEach((text, index) => {
    const callId = ToolCallId(`call-${String(index)}`)
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'read', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: false }),
    }, { surfaceOp: 'append' })
  })
  const closed = session.append('step/end', { turn: 1, step: 1 })
  return { events: session.snapshotEvents(), start: Number(opened.seq), end: Number(closed.seq) }
}

/** One valid session with a source before, inside, and after a middle step window. */
function neighboringSteps(inside: number) {
  const session = Session.create(SessionId('execution-scan-neighbors'))
  session.append('turn/start', { turn: 1 })
  const assistant = (text: string) => session.append('assistant/message', {
    turn: 1, step: session.snapshotEvents().filter(event => event.type === 'step/end').length + 1, stream: [],
    message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'test', model: 'test' } }),
  }, { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  assistant('before the window')
  session.append('step/end', { turn: 1, step: 1 })
  const opened = session.append('step/start', { turn: 1, step: 2 })
  for (let index = 0; index < inside; index += 1) assistant(`inside ${String(index)}`)
  const closed = session.append('step/end', { turn: 1, step: 2 })
  session.append('step/start', { turn: 1, step: 3 })
  assistant('after the window')
  session.append('step/end', { turn: 1, step: 3 })
  return { events: session.snapshotEvents(), start: Number(opened.seq), end: Number(closed.seq) }
}

describe('execution source scan bounds', () => {
  it('offers every in-window assistant and tool source when under the limit', () => {
    const { events, start, end } = scannedStep(['first fact'], ['tool fact'])
    const scan = executionSourceScan(events, start, end)
    expect(scan.candidates.map(candidate => candidate.content)).toEqual(['first fact', 'tool fact'])
    expect(scan.unexaminedSourceSeqs).toEqual([])
    // The single-source accessor keeps returning just the candidates.
    expect(executionSourceFacts(events, start, end)).toHaveLength(2)
  })

  it('names the in-window sources it stopped before reading', () => {
    const texts = Array.from({ length: 33 }, (_, index) => `fact ${String(index)}`)
    const { events, start, end } = scannedStep(texts)
    const scan = executionSourceScan(events, start, end)
    expect(scan.candidates).toHaveLength(32)
    // The 33rd source is inside the window and was never inspected.
    expect(scan.unexaminedSourceSeqs).toHaveLength(1)
    const lastSeq = Number(events.filter(event => event.type === 'assistant/message').at(-1)?.seq)
    expect(scan.unexaminedSourceSeqs).toEqual([lastSeq])
  })

  it('does not call sources outside the window unexamined', () => {
    const { events, start, end } = neighboringSteps(33)
    // 33 in-window sources, so exactly one is unread; the sources outside are never reported as gaps.
    const scan = executionSourceScan(events, start, end)
    expect(scan.candidates).toHaveLength(32)
    expect(scan.unexaminedSourceSeqs).toHaveLength(1)
    const inside = events.filter(event => event.type === 'assistant/message'
      && Number(event.seq) >= start && Number(event.seq) <= end)
    expect(scan.unexaminedSourceSeqs).toEqual([Number(inside.at(-1)?.seq)])
  })

  it('reports nothing unexamined when the limit lands exactly on the window end', () => {
    const { events, start, end } = neighboringSteps(32)
    const scan = executionSourceScan(events, start, end)
    expect(scan.candidates).toHaveLength(32)
    expect(scan.unexaminedSourceSeqs).toEqual([])
  })
})
