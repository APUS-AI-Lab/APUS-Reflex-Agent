import { describe, expect, it } from 'vitest'
import { parseLiveAnswer, verifyLiveTrial } from './fixtures/continuum-live-verifier.ts'
import type { LiveEvent, LiveFact, LiveSnapshot, LiveTrial } from './fixtures/continuum-live-verifier.ts'

const facts: LiveFact[] = [{ id: 'ALPHA123', value: 'random-42', sourceSeq: 1, recordId: 's:1' }]
const source: LiveEvent = { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'ALPHA123 = random-42' }] } }
const memory: LiveEvent = { type: 'continuum/memory-record', seq: 2, data: { record: { id: 's:1', sourceRefs: [{ sessionId: 's', eventSeq: 1 }] } } }
const seed: LiveSnapshot = { pid: 1, sessionId: 's', events: [source, memory], messages: [] }

function trial(arm: LiveTrial['arm'] = 'reflex'): LiveTrial {
  const request = { model: 'reflex', questions: { m0: { type: 'noul' } }, state: { candidates: [{ id: 's:1', question: 'm0', excerpt: 'random-42' }] } }
  const prepared: LiveEvent = { type: 'continuum/memory-decision', seq: 3, data: { evaluation: { phase: 'prepared', request } } }
  const settled: LiveEvent = { type: 'continuum/memory-decision', seq: 4, data: { outcome: 'jev', selectedIds: ['s:1'], baselineIds: ['s:1'],
    evaluation: { phase: 'settled', preparedSeq: 3, request, response: { model: 'reflex', answers: { m0: { type: 'noul', noul: 0.03 } } } } } }
  const completion: LiveEvent[] = [
    { type: 'assistant/message', seq: 5, data: { message: { role: 'assistant', source: { kind: 'model', provider: 'deepseek-official', model: 'flash' }, content: [{ type: 'text', text: arm === 'off' ? '{"ALPHA123":"UNKNOWN"}' : '{"ALPHA123":"random-42"}' }] }, stream: [{ type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } }] } },
    { type: 'turn/end', seq: 6, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const events = arm === 'reflex' ? [prepared, settled, ...completion] : arm === 'baseline'
    ? [{ type: 'continuum/memory-decision', seq: 3, data: { mode: 'off', outcome: 'off' } }, ...completion] : completion
  return structuredClone({ arm, events, finalResponse: arm === 'off' ? '{"ALPHA123":"UNKNOWN"}' : '{"ALPHA123":"random-42"}',
    requests: [{ pid: 2, sessionId: 's', provider: 'deepseek-official', model: 'flash', purpose: null, reconstructionMatches: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ALPHA123' }], source: { kind: 'user' } },
        ...arm === 'off' ? [] : [{ role: 'user', source: { kind: 'continuum-memory', recordIds: ['s:1'] }, content: [{ type: 'text', text: 'random-42' }] }]] }],
    snapshot: { pid: 2, sessionId: 's', messages: [], events: [...seed.events, ...events] },
  })
}

describe('live acceptance evidence oracle', () => {
  it.each(['off', 'baseline', 'reflex'] as const)('accepts complete %s evidence including low relevance probability', (arm) => {
    expect(() =>{  verifyLiveTrial(trial(arm), facts, seed, 'flash', 'reflex') }).not.toThrow()
  })
  it('rejects actual recall order that differs from the two-candidate settled selection', () => {
    const value = trial()
    const request = {
      model: 'reflex', questions: { m0: { type: 'noul' }, m1: { type: 'noul' } },
      state: { candidates: [
        { id: 's:1', question: 'm0', excerpt: 'random-42' },
        { id: 's:noise', question: 'm1', excerpt: 'Unrelated inventory annotation.' },
      ] },
    }
    value.events.find(event => event.seq === 3)!.data.evaluation = { phase: 'prepared', request }
    value.events.find(event => event.seq === 4)!.data = {
      outcome: 'jev', selectedIds: ['s:noise', 's:1'], baselineIds: ['s:1', 's:noise'],
      evaluation: { phase: 'settled', preparedSeq: 3, request,
        response: { model: 'reflex', answers: { m0: { type: 'noul', noul: 0.03 }, m1: { type: 'noul', noul: 0.8 } } } },
    }
    const recall = value.requests[0]!.messages.find(message => message.source?.kind === 'continuum-memory')!
    recall.source!.recordIds = ['s:noise', 's:1']
    expect(() => { verifyLiveTrial(value, facts, seed, 'flash', 'reflex') }).not.toThrow()
    recall.source!.recordIds.reverse()
    expect(() => { verifyLiveTrial(value, facts, seed, 'flash', 'reflex') }).toThrow(/actual recall order differs/)
  })
  it('accepts one JSON fence and rejects prose carrying a quoted answer', () => {
    expect(parseLiveAnswer('```json\n{"ALPHA123":"random-42"}\n```')).toEqual({ ALPHA123: 'random-42' })
    expect(() => parseLiveAnswer('The answer is not random-42.')).toThrow()
  })
  it.each([
    ['ordinary history answer leak', (value: LiveTrial) => { value.requests[0]!.messages[0]!.content[0]!.text = 'random-42' }],
    ['request reconstruction mismatch', (value: LiveTrial) => { value.requests[0]!.reconstructionMatches = false }],
    ['missing prepared receipt', (value: LiveTrial) => { value.events.splice(0, 1) }],
    ['source modification', (value: LiveTrial) => { value.snapshot.events[0]!.data = {} }],
    ['unpersisted settled receipt', (value: LiveTrial) => { value.snapshot.events = value.snapshot.events.filter(event => event.seq !== 4) }],
    ['wrong final answer', (value: LiveTrial) => { value.finalResponse = '{"ALPHA123":"UNKNOWN"}' }],
    ['wrong provider', (value: LiveTrial) => { value.requests[0]!.model = 'substitute' }],
    ['tool invocation', (value: LiveTrial) => { value.events.push({ type: 'tool/call', seq: 9, data: {} }) }],
    ['output truncation', (value: LiveTrial) => { value.events.find(event => event.type === 'assistant/message')!.data.stream = [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'length' } } }] }],
    ['candidate dropped', (value: LiveTrial) => { value.events.find(event => event.seq === 4)!.data.selectedIds = [] }],
  ] as const)('rejects %s', (_label, mutate) => {
    const value = trial()
    mutate(value)
    expect(() =>{  verifyLiveTrial(value, facts, seed, 'flash', 'reflex') }).toThrow()
  })
  it('rejects a Reflex response from a different model', () => {
    const value = trial()
    const evaluation = value.events.find(event => event.seq === 4)!.data.evaluation as { response: { model: string } }
    evaluation.response.model = 'substitute-reflex-model'
    expect(() => { verifyLiveTrial(value, facts, seed, 'flash', 'reflex') }).toThrow(/Reflex response model differs/)
  })
  it('rejects a reported correct answer when the persisted model answered UNKNOWN', () => {
    const value = trial()
    value.events.find(event => event.type === 'assistant/message')!.data.message = { role: 'assistant', source: { provider: 'deepseek-official', model: 'flash' }, content: [{ type: 'text', text: '{"ALPHA123":"UNKNOWN"}' }] }
    expect(() => { verifyLiveTrial(value, facts, seed, 'flash', 'reflex') }).toThrow(/differs from actual/)
  })
  it('rejects forged source references', () => {
    const tampered = structuredClone(seed)
    tampered.events[1]!.data.record = { id: 's:1', sourceRefs: [{ sessionId: 'foreign', eventSeq: 1 }] }
    expect(() =>{  verifyLiveTrial(trial(), facts, tampered, 'flash', 'reflex') }).toThrow(/forged/)
  })
  it('rejects a fabricated value in the off arm', () => {
    const value = trial('off')
    value.finalResponse = '{"ALPHA123":"a-different-invented-value"}'
    value.events.find(event => event.type === 'assistant/message')!.data.message = { role: 'assistant', source: { provider: 'deepseek-official', model: 'flash' }, content: [{ type: 'text', text: value.finalResponse }] }
    expect(() => { verifyLiveTrial(value, facts, seed, 'flash', 'reflex') }).toThrow(/fabricated/)
  })
  it('rejects memory injection or hidden-answer guessing in the off arm', () => {
    const value = trial('off')
    value.requests[0]!.messages.push({ role: 'user', content: [], source: { kind: 'continuum-memory' } })
    expect(() =>{  verifyLiveTrial(value, facts, seed, 'flash', 'reflex') }).toThrow(/injected/)
    const guessed = trial('off')
    guessed.finalResponse = '{"ALPHA123":"random-42"}'
    guessed.events.find(event => event.type === 'assistant/message')!.data.message = { role: 'assistant', source: { provider: 'deepseek-official', model: 'flash' }, content: [{ type: 'text', text: guessed.finalResponse }] }
    expect(() =>{  verifyLiveTrial(guessed, facts, seed, 'flash', 'reflex') }).toThrow(/hidden/)
  })
})
