/** Independent checks for retained live acceptance evidence. */
import assert from 'node:assert/strict'

/** One public synthetic fact selected before any trial call. */
export interface LiveFact { id: string; value: string; sourceSeq: number; recordId: string }
/** Minimal persisted event fields consumed by the independent oracle. */
export interface LiveEvent { type: string; seq: number; data: Record<string, unknown> }
/** Model message fields needed to distinguish ordinary context and recall. */
export interface LiveMessage {
  role: string
  content: Array<{ type: string; text?: string }>
  source?: { kind: string; recordIds?: string[] }
}
/** Read-only dispatch observation from the shipped process. */
export interface LiveRequest {
  pid: number
  sessionId: string
  provider: string
  model: string
  purpose: string | null
  messages: LiveMessage[]
  reconstructionMatches: boolean | null
}
/** Durable snapshot exported after a targeted persistence flush. */
export interface LiveSnapshot { pid: number; sessionId: string; events: LiveEvent[]; messages: LiveMessage[] }
/** A complete trial's public artifacts. */
export interface LiveTrial {
  arm: 'off' | 'baseline' | 'reflex'
  events: LiveEvent[]
  requests: LiveRequest[]
  finalResponse: string
  snapshot: LiveSnapshot
}

/** Extract text only, preserving message order. */
export function liveText(messages: readonly LiveMessage[]): string {
  return messages.flatMap(message => message.content.map(block => block.text ?? '')).join('\n')
}

/** Parse a JSON object, optionally inside one Markdown JSON fence. */
export function parseLiveAnswer(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const content = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed)?.[1] ?? trimmed
  const value: unknown = JSON.parse(content)
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'answer must be one JSON object')
  return value as Record<string, unknown>
}

/** Validate actual request evidence, durable references, remote scoring, and exact task answers. */
export function verifyLiveTrial(trial: LiveTrial, facts: readonly LiveFact[], seed: LiveSnapshot, model: string, jevModel: string): void {
  const requests = trial.requests.filter(request => request.purpose === null)
  assert.equal(requests.length, 1, 'one no-tool main request per trial')
  const request = requests[0]!
  assert.equal(request.model, model)
  assert.equal(request.provider, 'deepseek-official')
  assert.equal(request.reconstructionMatches, true)
  const ordinary = liveText(request.messages.filter(message => message.source?.kind !== 'continuum-memory'))
  const recalls = request.messages.filter(message => message.source?.kind === 'continuum-memory')
  for (const fact of facts) {
    assert.ok(!ordinary.includes(fact.value), 'ordinary context leaked an answer')
    const original = seed.events.find(event => event.seq === fact.sourceSeq)
    assert.ok(original, 'missing original seed event')
    assert.deepEqual(trial.snapshot.events.find(event => event.seq === fact.sourceSeq), original, 'original source was changed')
    const record = seed.events.find(event => event.type === 'continuum/memory-record'
      && (event.data.record as { id?: string } | undefined)?.id === fact.recordId)
    assert.ok(record, 'missing source-backed memory record')
    const stored = record.data.record as { sourceRefs: Array<{ sessionId: string; eventSeq: number }> }
    assert.ok(stored.sourceRefs.some(ref => ref.sessionId === seed.sessionId && ref.eventSeq === fact.sourceSeq), 'record source was forged')
    if (trial.arm !== 'off') {
      assert.ok(recalls.some(message => message.source?.recordIds?.includes(fact.recordId)
        && liveText([message]).includes(fact.value)), 'source-backed answer absent from actual recall')
    }
  }
  assert.ok(trial.events.some(event => event.type === 'turn/end' && (event.data.reason as { kind?: string })?.kind === 'completed'), 'turn did not complete normally')
  assert.ok(!trial.events.some(event => event.type === 'tool/call'), 'trial invoked a tool')
  const assistant = trial.events.filter(event => event.type === 'assistant/message')
  assert.ok(assistant.length > 0, 'missing assistant output')
  const lastAssistant = assistant.at(-1)!
  const message = lastAssistant.data.message as LiveMessage & { source: { provider: string; model: string } }
  assert.equal(message.source.provider, 'deepseek-official')
  assert.equal(message.source.model, model)
  assert.equal(trial.finalResponse, message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join(''),
    'reported answer differs from actual assistant output')
  assert.deepEqual(trial.snapshot.events.find(event => event.seq === lastAssistant.seq), lastAssistant, 'assistant output was not persisted')
  for (const event of assistant) {
    const stream = event.data.stream as Array<{ type: string; chunk?: { type: string; reason?: { kind: string } } }>
    const finishes = stream.filter(item => item.type === 'chunk' && item.chunk?.type === 'finish')
    assert.equal(finishes.at(-1)?.chunk?.reason?.kind, 'stop', 'assistant output was truncated or failed')
  }
  const decisions = trial.events.filter(event => event.type === 'continuum/memory-decision')
  if (trial.arm === 'off') {
    assert.equal(recalls.length, 0, 'off arm injected memory')
    assert.equal(decisions.length, 0, 'off arm ran a selector')
    assert.ok(facts.every(fact => !trial.finalResponse.includes(fact.value)), 'off arm answered a hidden random value')
    const unknownAnswer = parseLiveAnswer(trial.finalResponse)
    assert.deepEqual(Object.keys(unknownAnswer).sort(), facts.map(fact => fact.id).sort(), 'off answer keys differ from query')
    for (const fact of facts) assert.equal(unknownAnswer[fact.id], 'UNKNOWN', 'off arm fabricated an unknown value')
    return
  }
  const answer = parseLiveAnswer(trial.finalResponse)
  assert.deepEqual(Object.keys(answer).sort(), facts.map(fact => fact.id).sort(), 'answer keys differ from query')
  for (const fact of facts) assert.equal(answer[fact.id], fact.value, 'answer value differs from source')
  if (trial.arm === 'baseline') {
    assert.ok(decisions.length > 0, 'baseline selector receipt missing')
    assert.ok(decisions.every(event => event.data.mode === 'off' && event.data.outcome === 'off'), 'baseline made a Jev decision')
    return
  }
  const prepared = decisions.find(event => (event.data.evaluation as { phase?: string } | undefined)?.phase === 'prepared')
  const settled = decisions.find(event => (event.data.evaluation as { phase?: string } | undefined)?.phase === 'settled'
    && event.data.outcome === 'jev')
  assert.ok(prepared && settled, 'missing successful prepared/settled Reflex evidence')
  const evaluation = settled.data.evaluation as {
    preparedSeq: number
    request: {
      model: string
      questions: Record<string, { type: string }>
      state: { candidates: Array<{ id: string; question: string; excerpt: string }> }
    }
    response: { model: string; answers: Record<string, { type: string; noul: number }> }
  }
  assert.equal(evaluation.preparedSeq, prepared.seq)
  assert.equal(evaluation.request.model, jevModel)
  assert.equal(evaluation.response.model, jevModel, 'Reflex response model differs from requested model')
  assert.deepEqual(evaluation.request, (prepared.data.evaluation as { request: unknown }).request)
  const questions = Object.entries(evaluation.request.questions)
  assert.ok(questions.length >= facts.length, 'Reflex did not score all target candidates')
  for (const [id, question] of questions) {
    assert.equal(question.type, 'noul')
    const answer = evaluation.response.answers[id]
    assert.equal(answer?.type, 'noul')
    assert.ok(answer && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1, 'invalid relevance probability')
  }
  const selected = settled.data.selectedIds as string[]
  const baseline = settled.data.baselineIds as string[]
  assert.deepEqual([...selected].sort(), [...baseline].sort(), 'Reflex dropped candidates')
  assert.deepEqual(recalls.flatMap(recall => recall.source?.recordIds ?? []), selected,
    'actual recall order differs from settled Reflex selection')
  for (const fact of facts) {
    assert.ok(selected.includes(fact.recordId), 'target was not a real candidate')
    const candidate = evaluation.request.state.candidates.find(item => item.id === fact.recordId)
    assert.ok(candidate, 'Reflex request omitted target candidate')
    assert.ok(candidate.excerpt.includes(fact.value), 'Reflex did not receive target evidence')
    assert.equal(evaluation.response.answers[candidate.question]?.type, 'noul', 'Reflex did not score target evidence')
  }
  assert.deepEqual(trial.snapshot.events.find(event => event.seq === prepared.seq), prepared, 'prepared receipt was not persisted')
  assert.deepEqual(trial.snapshot.events.find(event => event.seq === settled.seq), settled, 'settled receipt was not persisted')
}
