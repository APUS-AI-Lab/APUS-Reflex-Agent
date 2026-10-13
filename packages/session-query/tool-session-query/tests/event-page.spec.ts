import { describe, expect, it } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { renderEventPage, requestsEventPage, validateEventPageArgs } from '../src/event-page.ts'

function event(text: string): SessionEvent<'user/message'> {
  return { type: 'user/message', seq: SessionSeq(1), time: 1, surfaceOp: 'append',
    data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }) }
}
interface Page {
  content: string
  offset: number
  end: number
  total: number
  sha256: string
  next_offset: number | null
  neighbors_omitted?: boolean
}
const parse = (value: string): Page => JSON.parse(value) as Page
const id = SessionId('source-\n"\\')

describe('exact bounded event pages', () => {
  it.each(['event-json', 'text-block'] as const)('reconstructs %s including whitespace, escapes and Unicode', (view) => {
    const text = ('  中文😀\r\n"\\\ud800\udc00\ud800 end  ').repeat(80)
    const source = event(text)
    let offset = 0
    let sha256: string | undefined
    let result = ''
    let pages = 0
    while (true) {
      const args = { view, ...(view === 'text-block' ? { block: 0 } : {}), offset, ...(sha256 === undefined ? {} : { expected_sha256: sha256 }) }
      validateEventPageArgs(args)
      const rendered = renderEventPage(id, source, args, 400)
      expect(Buffer.byteLength(rendered)).toBeLessThanOrEqual(400)
      const page = parse(rendered)
      expect(page.offset).toBe(offset)
      expect(page.end - page.offset).toBe(page.content.length)
      expect(page.sha256).toBe(sha256 ?? page.sha256)
      sha256 = page.sha256
      result += page.content
      pages++
      if (page.next_offset === null) break
      expect(page.next_offset).toBeGreaterThan(offset)
      offset = page.next_offset
      expect(pages).toBeLessThan(1000)
    }
    expect(pages).toBeGreaterThan(1)
    expect(result).toBe(view === 'text-block' ? text : JSON.stringify(source, null, 2))
  })

  it('includes metadata in exact-fit and one-byte-short budgets and rejects no progress', () => {
    const source = event('😀')
    const args = { view: 'text-block' as const, block: 0 }
    const full = renderEventPage(id, source, args, 1000)
    expect(renderEventPage(id, source, args, Buffer.byteLength(full))).toBe(full)
    expect(() => renderEventPage(id, source, args, Buffer.byteLength(full) - 1)).toThrow('Read budget')
    expect(() => renderEventPage(id, source, args, 1)).toThrow('Read budget')
  })

  it('returns terminal empty pages and binds all views to the complete event', () => {
    const source = event('😀x')
    const first = parse(renderEventPage(id, source, { view: 'text-block', block: 0 }, 1000))
    const last = parse(renderEventPage(id, source, { view: 'text-block', block: 0, offset: 3, expected_sha256: first.sha256 }, 1000))
    expect(last).toMatchObject({ content: '', next_offset: null, total: 3 })
    expect(parse(renderEventPage(id, event(''), { view: 'text-block', block: 0 }, 1000))).toMatchObject({ content: '', next_offset: null })
    expect(() => renderEventPage(id, source, { view: 'text-block', block: 0, offset: 1 }, 1000)).toThrow('splits')
    expect(() => renderEventPage(id, source, { offset: 1e9 }, 1000)).toThrow('outside')
    expect(() => renderEventPage(id, source, { expected_sha256: '0'.repeat(64) }, 1000)).toThrow('changed')
    expect(parse(renderEventPage(id, source, {}, 1000, true)).neighbors_omitted).toBe(true)
  })

  it('refuses non-text blocks and events without message content', () => {
    expect(() => renderEventPage(id, event('x'), { view: 'text-block', block: 1 }, 1000)).toThrow('not text')
    expect(() => renderEventPage(id, event('x'), { view: 'text-block' }, 1000)).toThrow('block index')
    const assistant: SessionEvent<'assistant/message'> = { type: 'assistant/message', seq: SessionSeq(0), time: 1, surfaceOp: 'append',
      data: { turn: 1, step: 1, stream: [], message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'original' }] }) } }
    expect(parse(renderEventPage(id, assistant, { view: 'text-block', block: 0 }, 1000)).content).toBe('original')
    const other: SessionEvent<'turn/start'> = { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } }
    expect(() => renderEventPage(id, other, { view: 'text-block', block: 0 }, 1000)).toThrow('not text')
  })

  it('accepts only valid page selectors and continuations', () => {
    expect(requestsEventPage({})).toBe(false)
    expect(requestsEventPage({ expected_sha256: 'a'.repeat(64) })).toBe(true)
    for (const args of [{}, { view: 'event-json' as const }, { offset: 0, before: 0, after: 0 }, { view: 'text-block' as const, block: 0 }, { offset: 1, expected_sha256: 'a'.repeat(64) }]) {
      expect(() => { validateEventPageArgs(args) }).not.toThrow()
    }
    for (const args of [{ view: 'event-json' as const, before: 1 }, { offset: 0, after: 1 }, { offset: -1 }, { offset: 0.5 }, { offset: 1 }, { block: 0 }, { view: 'text-block' as const }, { view: 'text-block' as const, block: -1 }, { expected_sha256: 'bad' }]) {
      expect(() => { validateEventPageArgs(args) }).toThrow()
    }
  })
})
