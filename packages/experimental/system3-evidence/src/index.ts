/**
 * Deterministic, lossless evidence span selection for long tool output.
 * @module @deepseek-ai/dsh-experimental-system3-evidence
 */

/** Why a retained span was selected. */
export type System3EvidenceReason = 'full' | 'head' | 'tail' | 'match'

/** A half-open character range in the immutable original artifact. */
export interface System3EvidenceSpan {
  readonly start: number
  readonly end: number
  readonly reason: System3EvidenceReason
  readonly matchedTerms?: readonly string[]
}

/** An omitted half-open range in the original artifact. */
export interface System3OmittedRange {
  readonly start: number
  readonly end: number
}

/** Input to the evidence selector. */
export interface System3EvidenceRequest {
  /** Stable reference to the complete, recoverable artifact. */
  readonly artifactRef: string
  /** Complete tool output; this function never mutates or discards it. */
  readonly text: string
  /** Maximum retained characters sent to a downstream model. */
  readonly maxChars: number
  /** Terms whose surrounding lines should be retained when present. */
  readonly requiredTerms?: readonly string[]
  /** Characters of context on either side of a matching term. */
  readonly contextChars?: number
  /** Preferred head budget before match and tail spans are considered. */
  readonly headChars?: number
  /** Preferred tail budget before match and head spans are considered. */
  readonly tailChars?: number
}

/** Auditable selection result; omitted text remains available through artifactRef. */
export interface System3EvidenceSelection {
  readonly artifactRef: string
  readonly retainedSpans: readonly System3EvidenceSpan[]
  readonly omittedRanges: readonly System3OmittedRange[]
  readonly retainedChars: number
  readonly omittedChars: number
  readonly truncated: boolean
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`)
}

function mergeSpans(spans: readonly System3EvidenceSpan[]): System3EvidenceSpan[] {
  const ordered = [...spans].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: System3EvidenceSpan[] = []
  for (const span of ordered) {
    const previous = merged.at(-1)
    if (previous === undefined || span.start > previous.end) {
      merged.push(span.matchedTerms === undefined ? { ...span } : { ...span, matchedTerms: [...span.matchedTerms] })
      continue
    }
    const reasons = new Set<System3EvidenceReason>([previous.reason, span.reason])
    const reason: System3EvidenceReason = reasons.has('match') ? 'match' : reasons.has('head') && reasons.has('tail') ? 'head' : previous.reason
    const terms = [...new Set([...(previous.matchedTerms ?? []), ...(span.matchedTerms ?? [])])]
    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, span.end),
      reason,
      ...(terms.length === 0 ? {} : { matchedTerms: terms }),
    }
  }
  return merged
}

function addClippedSpan(
  spans: System3EvidenceSpan[],
  candidate: System3EvidenceSpan,
  maxChars: number,
): void {
  const used = spans.reduce((total, span) => total + span.end - span.start, 0)
  const remaining = maxChars - used
  if (remaining <= 0) return
  const length = candidate.end - candidate.start
  if (length <= remaining) {
    spans.push(candidate)
    return
  }
  const start = candidate.reason === 'tail' ? candidate.end - remaining : candidate.start
  spans.push({ ...candidate, start, end: start + remaining })
}

function termWindows(request: System3EvidenceRequest): System3EvidenceSpan[] {
  const context = request.contextChars ?? 160
  assertNonNegativeInteger(context, 'contextChars')
  const terms = [...new Set((request.requiredTerms ?? []).map(term => term.trim()).filter(term => term.length > 0))]
  const windows: System3EvidenceSpan[] = []
  for (const term of terms) {
    const lowerText = request.text.toLocaleLowerCase()
    const lowerTerm = term.toLocaleLowerCase()
    let from = 0
    while (from < lowerText.length) {
      const index = lowerText.indexOf(lowerTerm, from)
      if (index < 0) break
      windows.push({
        start: Math.max(0, index - context),
        end: Math.min(request.text.length, index + term.length + context),
        reason: 'match',
        matchedTerms: [term],
      })
      from = index + Math.max(1, lowerTerm.length)
    }
  }
  return windows
}

/**
 * Select bounded, auditable spans while retaining the complete original artifact.
 *
 * Required-term windows receive priority, then the requested head and tail
 * budgets. Every returned offset refers to the original text, and omitted
 * ranges are explicit so a downstream summary cannot masquerade as source.
 * @param request - Artifact and deterministic selection limits.
 * @returns Retained and omitted ranges with the original artifact reference.
 */
export function selectSystem3Evidence(request: System3EvidenceRequest): System3EvidenceSelection {
  if (request.artifactRef.trim().length === 0) throw new TypeError('artifactRef must not be empty')
  assertNonNegativeInteger(request.maxChars, 'maxChars')
  const head = request.headChars ?? Math.min(2048, request.maxChars)
  const tail = request.tailChars ?? Math.min(1024, request.maxChars)
  assertNonNegativeInteger(head, 'headChars')
  assertNonNegativeInteger(tail, 'tailChars')

  if (request.text.length <= request.maxChars) {
    const full = request.text.length === 0 ? [] : [{ start: 0, end: request.text.length, reason: 'full' as const }]
    return {
      artifactRef: request.artifactRef,
      retainedSpans: full,
      omittedRanges: [],
      retainedChars: request.text.length,
      omittedChars: 0,
      truncated: false,
    }
  }

  const selected: System3EvidenceSpan[] = []
  for (const span of termWindows(request)) addClippedSpan(selected, span, request.maxChars)
  addClippedSpan(selected, { start: 0, end: Math.min(request.text.length, head), reason: 'head' }, request.maxChars)
  addClippedSpan(selected, { start: Math.max(0, request.text.length - tail), end: request.text.length, reason: 'tail' }, request.maxChars)

  const retainedSpans = mergeSpans(selected)
  const omittedRanges: System3OmittedRange[] = []
  let cursor = 0
  for (const span of retainedSpans) {
    if (span.start > cursor) omittedRanges.push({ start: cursor, end: span.start })
    cursor = Math.max(cursor, span.end)
  }
  if (cursor < request.text.length) omittedRanges.push({ start: cursor, end: request.text.length })
  const retainedChars = retainedSpans.reduce((total, span) => total + span.end - span.start, 0)
  return {
    artifactRef: request.artifactRef,
    retainedSpans,
    omittedRanges,
    retainedChars,
    omittedChars: request.text.length - retainedChars,
    truncated: true,
  }
}
