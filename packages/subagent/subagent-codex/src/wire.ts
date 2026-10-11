/**
 * Minimal Codex app-server 0.153.4 protocol adapter. The shared JSON-RPC
 * transport owns framing and request correlation; this module owns only the
 * product methods, current thread/turn association, unattended approval
 * responses, and terminal-answer selection.
 *
 * @module @deepseek-ai/dsh-subagent-codex/wire
 */

import { createHash } from 'node:crypto'
import { summarizeNativeEvidence } from './evidence-summary.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Readable, Writable } from 'node:stream'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentEvidence, SubagentEvidenceTurnId, SubagentActivity, SubagentActivityKind, SubagentResult, SubagentNativeThreadId, SubagentRecoveryState, SubagentRecoveryRequest, SubagentRecoveryReceipt } from '@deepseek-ai/dsh-subagent'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { CodexPermissionMode } from './run.ts'

type JsonObject = Record<string, unknown>

/** Step category for each app-server item type the child performs; unlisted types report as `other`. */
const ITEM_ACTIVITY_KINDS: Readonly<Record<string, SubagentActivityKind>> = {
  agentMessage: 'message',
  reasoning: 'reasoning',
  commandExecution: 'command',
  fileChange: 'file-change',
  mcpToolCall: 'tool',
  dynamicToolCall: 'tool',
  collabAgentToolCall: 'tool',
  collabToolCall: 'tool',
  webSearch: 'web-search',
}

/** Product facts owned by the Codex wire after publication. */
export interface CodexWireFailureFacts {
  readonly stage: 'turn-start' | 'turn'
  readonly category:
    | 'limit'
    | 'access-policy'
    | 'service'
    | 'transport'
    | 'product-error'
    | 'invalid-result'
    | 'unknown'
  readonly httpStatus?: number | undefined
}

const THREAD_PERMISSION_PARAMS: Readonly<Record<CodexPermissionMode, JsonObject>> = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  },
  'dangerously-bypass-approvals-and-sandbox': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value
}

function unattendedDecision(params: JsonObject): 'cancel' | 'decline' {
  const available = params.availableDecisions
  if (available === undefined || available === null) return 'decline'
  if (Array.isArray(available)) {
    if (available.includes('cancel')) return 'cancel'
    if (available.includes('decline')) return 'decline'
  }
  throw new Error('subagent-codex: app-server offered no unattended approval decision')
}

function numericHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 65_535
    ? value
    : undefined
}

interface ParsedFailureInfo {
  readonly category: CodexWireFailureFacts['category']
  readonly httpStatus?: number | undefined
  readonly maxTokens?: true
  readonly sandboxFailure?: true
}

function objectFailureInfo(value: JsonObject): ParsedFailureInfo {
  const keys = Object.keys(value)
  const category = keys[0]
  if (keys.length !== 1 || category === undefined) {
    return { category: 'unknown' }
  }
  const detail = value[category]
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return { category: 'unknown' }
  }
  const fields = detail as JsonObject
  switch (category) {
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
    {
      const httpStatus = numericHttpStatus(fields.httpStatusCode)
      return httpStatus === undefined
        ? { category: 'transport' }
        : { category: 'transport', httpStatus }
    }
    case 'activeTurnNotSteerable':
      return { category: 'product-error' }
    default:
      return { category: 'unknown' }
  }
}

function failureInfo(turn: JsonObject): ParsedFailureInfo {
  if (turn.status !== 'failed') return { category: 'unknown' }
  const error = turn.error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return { category: 'unknown' }
  }
  const info = (error as JsonObject).codexErrorInfo
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
        return { category: 'limit', maxTokens: true }
      case 'sessionBudgetExceeded':
      case 'usageLimitExceeded':
        return { category: 'limit' }
      case 'serverOverloaded':
      case 'internalServerError':
        return { category: 'service' }
      case 'cyberPolicy':
      case 'misalignmentPolicyViolation':
      case 'unauthorized':
        return { category: 'access-policy' }
      case 'badRequest':
      case 'threadRollbackFailed':
      case 'other':
        return { category: 'product-error' }
      case 'sandboxError':
        return { category: 'access-policy', sandboxFailure: true }
      default:
        return { category: 'unknown' }
    }
  }
  return info !== null && typeof info === 'object' && !Array.isArray(info)
    ? objectFailureInfo(info as JsonObject)
    : { category: 'unknown' }
}

function unattendedDiagnostic(
  mode: CodexPermissionMode,
  request: 'command approval' | 'file approval' | 'permission grant' | 'user input' | 'MCP elicitation' | 'command execution' | 'file change' | 'sandbox execution',
  decision: 'cancelled' | 'declined' | 'denied' | 'empty response' | 'failed',
  reason: string,
): string {
  return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed protocol and stream failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`)
}

async function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {})
    throw abortError(signal)
  }
  let rejectAbort!: (error: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => { rejectAbort(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** A dispatched recovery lost its authoritative outcome and requires process quiescence. */
export class CodexRecoveryUnconfirmedError extends Error {}

/**
 * One app-server connection and its ephemeral thread and sequential native turns.
 *
 * The class deliberately exposes no generic request surface. Supporting
 * another product method must first become part of the provider contract.
 */
export class CodexAppServerWire {
  private readonly transport: JsonRpcLineTransport
  private readonly fatal = Promise.withResolvers<never>()
  private threadId: string | undefined
  private turnId: string | undefined
  private pendingTurnId: string | undefined
  private turnCompleted: PromiseWithResolvers<{
    readonly params: JsonObject
    readonly order: number
  }> | undefined
  private readonly earlyTurnNotifications: Array<{
    readonly method: string
    readonly params: JsonObject
    readonly order: number
  }> = []
  private lastFinalAnswer: string | undefined
  private lastUnphasedAnswer: string | undefined
  private diagnostic: string | undefined
  private failure: CodexWireFailureFacts | undefined
  private diagnosticOrder = 0
  private observationOrder = 0
  private pendingDiagnostic: {
    readonly order: number
    readonly request: Parameters<typeof unattendedDiagnostic>[1]
    readonly decision: Parameters<typeof unattendedDiagnostic>[2]
    readonly reason: string
  } | undefined
  private inputEnded = false
  private terminalObserved = false
  private closed = false
  private lastActivityAt = Date.now()
  private workspace = ''
  private retryCount = 0
  private waiting = false
  private readonly sideEffects = new Set<string>()
  private readonly retiredTurns = new Set<string>()
  private recovery: {
    readonly request: SubagentRecoveryRequest
    readonly before: SubagentRecoveryState
    readonly receipt: PromiseWithResolvers<SubagentRecoveryReceipt>
  } | undefined

  constructor(
    private readonly input: Readable,
    output: Writable,
    private readonly permissionMode: CodexPermissionMode,
    private readonly model?: string,
    private readonly onActivity?: (activity: SubagentActivity) => void,
    private readonly onEvidence?: (evidence: SubagentEvidence) => void,
    private readonly evidencePatterns?: { readonly verification: string; readonly diagnostic: string },
    private readonly evidenceSummary?: { readonly maxActions: number
      readonly maxPathChars: number
      readonly verificationTargets?: { readonly maxCommandChars: number } | undefined },
  ) {
    this.transport = new JsonRpcLineTransport(input, output)
    // Fatal protocol state can arrive after the current guarded operation has
    // already settled. Keep the shared rejection observed without inserting
    // another promise-adoption hop into active races.
    void this.fatal.promise.catch(() => {})
    this.transport.onRequest((method, params) => this.handleServerRequest(method, params))
    this.transport.onNotification((method, params) => {
      try {
        this.handleNotification(method, params)
      } catch (error: unknown) {
        this.fail(thrown(error))
      }
    })
    this.input.on('error', this.onInputError)
    this.input.on('end', this.onInputEnd)
    // Pipe errors can race protocol closure and process teardown. Retain both
    // error listeners for the lifetime of their per-run streams so no late
    // EPIPE or read failure becomes an unhandled EventEmitter error.
    output.on('error', this.onOutputError)
  }

  /** Start reading app-server frames. */
  start(): void {
    this.transport.start()
  }

  /**
   * Whether protocol output ended before a terminal turn notification.
   * @returns `true` only for an early protocol close without a terminal turn.
   */
  endedBeforeTerminal(): boolean {
    return this.inputEnded && !this.terminalObserved
  }

  /**
   * Perform the required app-server initialize/initialized handshake.
   * @param signal - unpublished-start cancellation.
   */
  async initialize(signal: AbortSignal): Promise<void> {
    object(await this.guarded(this.transport.request('initialize', {
      clientInfo: {
        name: 'deepseek-harness',
        title: 'DeepSeek Harness',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    }, signal), signal), 'initialize response')
    this.transport.notify('initialized')
    await this.guarded(this.transport.flush(), signal)
  }

  /**
   * Create the run's private ephemeral thread and retain its identity.
   * @param cwd - parent Session workspace.
   * @param signal - unpublished-start cancellation.
   */
  async startThread(cwd: string, signal: AbortSignal): Promise<void> {
    this.workspace = cwd
    const response = object(await this.guarded(this.transport.request('thread/start', {
      cwd,
      ephemeral: true,
      ...this.model === undefined ? {} : { model: this.model },
      ...THREAD_PERMISSION_PARAMS[this.permissionMode],
    }, signal), signal), 'thread/start response')
    const thread = object(response.thread, 'thread/start thread')
    const id = string(thread.id, 'thread/start thread id')
    if (thread.ephemeral !== true) {
      throw new Error('subagent-codex: app-server did not create an ephemeral thread')
    }
    this.threadId = id
  }

  /**
   * Submit the one text-only task and wait for this thread/turn's authoritative
   * terminal notification.
   * @param texts - already validated task text blocks.
   * @param signal - local cancellation for the published run.
   * @returns the shared subagent result.
   */
  async runTurn(
    texts: readonly string[],
    signal: AbortSignal,
  ): Promise<SubagentResult> {
    const continuing = this.recovery
    const completion = Promise.withResolvers<{
      readonly params: JsonObject
      readonly order: number
    }>()
    this.turnCompleted = completion
    const threadId = this.threadId as string
    try {
      const response = object(await this.guarded(this.transport.request('turn/start', {
        threadId,
        input: texts.map(text => ({ type: 'text', text, text_elements: [] })),
        ...continuing === undefined ? {} : { turnTrigger: 'reflex-supervision' },
      }, signal), signal), 'turn/start response')
      const turn = object(response.turn, 'turn/start turn')
      this.commitTurnId(string(turn.id, 'turn/start turn id'))
      this.lastActivityAt = Date.now()
      if (continuing !== undefined) {
        continuing.receipt.resolve({ state: 'continued', threadId: continuing.before.threadId,
          previousTurnId: continuing.before.turnId, turnId: brandString<SubagentEvidenceTurnId>(this.turnId as string) })
        this.recovery = undefined
      }
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn-start', category: 'unknown' })
      throw error
    }

    let completed: {
      readonly params: JsonObject
      readonly order: number
    }
    let terminal: JsonObject
    try {
      completed = await this.guarded(completion.promise, signal)
      terminal = object(completed.params.turn, 'turn/completed turn')
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw error
    }
    const status = terminal.status
    const recovery = this.recovery
    if (recovery !== undefined && status === 'interrupted') {
      const content = recovery.request.continuation()
      if (content === undefined) {
        recovery.receipt.resolve({ state: 'stale', threadId: recovery.before.threadId, previousTurnId: recovery.before.turnId })
        this.recovery = undefined
        throw new Error('subagent-codex: recovery authority changed after interruption')
      }
      const next = content.map((block) => {
        if (block.type !== 'text') throw new Error('subagent-codex: recovery requires text input')
        return block.text
      })
      this.retiredTurns.add(recovery.before.turnId)
      this.turnId = undefined
      this.pendingTurnId = undefined
      this.turnCompleted = undefined
      this.earlyTurnNotifications.length = 0
      this.lastFinalAnswer = undefined
      this.lastUnphasedAnswer = undefined
      this.terminalObserved = false
      this.retryCount = 0
      this.waiting = false
      this.sideEffects.clear()
      return this.runTurn(next, signal)
    }
    if (recovery !== undefined && status === 'completed') {
      recovery.receipt.resolve({ state: 'completed', threadId: recovery.before.threadId, previousTurnId: recovery.before.turnId })
      this.recovery = undefined
    }
    if (status !== 'completed') {
      const parsed = failureInfo(terminal)
      this.recordFailure(parsed.httpStatus === undefined
        ? { stage: 'turn', category: parsed.category }
        : {
          stage: 'turn',
          category: parsed.category,
          httpStatus: parsed.httpStatus,
        })
      if (parsed.sandboxFailure) {
        this.recordDiagnostic(
          'sandbox execution',
          'failed',
          'Codex reported a sandbox failure',
          completed.order,
        )
      }
      if (parsed.maxTokens) {
        return { output: this.collectOutput(), stopReason: 'max-tokens' }
      }
      const detail = status === 'failed' ? `: ${parsed.category}` : ''
      throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`)
    }
    const output = this.collectOutput()
    if (output.length === 0) {
      this.recordFailure({ stage: 'turn', category: 'invalid-result' })
      throw new Error('subagent-codex: Codex completed without a final answer')
    }
    return { output, stopReason: 'completed' }
  }

  /**
   * Add a person's input to the active turn through `turn/steer`, guarded by the
   * committed turn id so input never lands on a different turn.
   * @param texts - non-empty text blocks delivered as user input.
   * @param signal - caller cancellation before Codex accepts the input.
   * @throws when no turn is active, the connection closed, or Codex refused the input.
   */
  async steer(texts: readonly string[], signal: AbortSignal): Promise<void> {
    if (this.threadId === undefined || this.turnId === undefined || this.terminalObserved || this.closed) {
      throw new Error('subagent-codex: no active turn accepts input')
    }
    await this.guarded(this.transport.request('turn/steer', {
      threadId: this.threadId,
      expectedTurnId: this.turnId,
      input: texts.map(text => ({ type: 'text', text, text_elements: [] })),
    }, signal), signal)
  }

  /** Read content-free native activity for bounded supervision.
   * @returns The active turn observations, excluding interrupted or completed turns.
   */
  recoveryState(): SubagentRecoveryState | undefined {
    if (this.threadId === undefined || this.turnId === undefined || this.terminalObserved
      || this.closed || this.recovery !== undefined) return undefined
    return { threadId: brandString<SubagentNativeThreadId>(this.threadId), turnId: brandString<SubagentEvidenceTurnId>(this.turnId),
      lastActivityAt: this.lastActivityAt, retryCount: this.retryCount, waiting: this.waiting, activeSideEffects: this.sideEffects.size }
  }

  /** Interrupt only the observed turn and await a confirmed same-thread continuation.
   * @param request - Native identity, terminal deadline, and current authority callback.
   * @param signal - Supervisor lifetime; cancellation never silently starts replacement work.
   * @returns The confirmed native transition; a lost acknowledgement rejects without retry.
   */
  async recover(request: SubagentRecoveryRequest, signal: AbortSignal): Promise<SubagentRecoveryReceipt> {
    signal.throwIfAborted()
    const before = this.recoveryState()
    if (before === undefined || before.turnId !== request.expectedTurnId || before.waiting || before.activeSideEffects > 0) {
      throw new Error('subagent-codex: native turn is not recoverable')
    }
    if (request.expectedActivity !== undefined && (before.lastActivityAt !== request.expectedActivity.lastActivityAt
      || before.retryCount !== request.expectedActivity.retryCount)) {
      return { state: 'stale', threadId: before.threadId, previousTurnId: before.turnId }
    }
    if (request.continuation() === undefined) return { state: 'stale', threadId: before.threadId, previousTurnId: before.turnId }
    const receipt = Promise.withResolvers<SubagentRecoveryReceipt>()
    const pending = { request, before, receipt }
    this.recovery = pending
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(request.interruptGraceMs)])
    try {
      // The terminal notification, not the empty interrupt response, authorizes continuation.
      const dispatched = this.transport.request('turn/interrupt', { threadId: before.threadId, turnId: before.turnId }, deadline)
      void dispatched.catch((error: unknown) => { if (this.recovery === pending) this.fail(thrown(error)) })
      return await this.guarded(receipt.promise, deadline)
    } catch (error) {
      this.fail(thrown(error))
      throw new CodexRecoveryUnconfirmedError('subagent-codex: native recovery unconfirmed', { cause: error })
    }
  }

  /**
   * Best-effort remote cancellation. Local settlement and process teardown
   * remain authoritative when the child no longer accepts protocol requests.
   */
  interrupt(): void {
    if (this.threadId === undefined || this.turnId === undefined || this.closed || this.recovery !== undefined) return
    void this.transport.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    }).catch(() => {})
  }

  /**
   * The best non-commentary answer observed so far, preserving exact bytes.
   * @returns the selected final or nullable-phase text block, if any.
   */
  collectOutput(): ContentBlock[] {
    const selected = this.lastFinalAnswer ?? this.lastUnphasedAnswer
    return selected !== undefined && selected.trim().length > 0
      ? [{ type: 'text', text: selected }]
      : []
  }

  /**
   * The latest safe unattended permission fact observed for this run.
   * @returns provider-authored diagnostic text, when one was observed.
   */
  collectDiagnostic(): string | undefined {
    return this.diagnostic
  }

  /**
   * The structured failure fact observed for this published turn.
   * Call only after a non-completed return or rejection from {@link runTurn}.
   * @returns the fixed stage/category pair and optional HTTP status.
   */
  collectFailure(): CodexWireFailureFacts {
    return this.failure as CodexWireFailureFacts
  }

  /** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.input.off('end', this.onInputEnd)
    this.transport.close()
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    const withFatal = Promise.race([this.fatal.promise, pending])
    return raceAbort(withFatal, signal)
  }

  private fail(error: Error): void {
    this.recovery?.receipt.reject(error)
    this.fatal.reject(error)
  }

  private readonly onInputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onOutputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onInputEnd = (): void => {
    this.inputEnded = true
    this.fail(new Error('subagent-codex: app-server protocol stream closed'))
  }

  private observePendingTurnId(id: string): void {
    if (this.turnCompleted === undefined) {
      throw new Error('subagent-codex: app-server referenced a turn before turn/start')
    }
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: app-server referenced conflicting turns')
    }
    this.pendingTurnId = id
  }

  private commitTurnId(id: string): void {
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: turn/start response did not match the active turn')
    }
    this.turnId = id
    const pendingDiagnostic = this.pendingDiagnostic
    this.pendingDiagnostic = undefined
    if (pendingDiagnostic !== undefined) {
      this.recordDiagnostic(
        pendingDiagnostic.request,
        pendingDiagnostic.decision,
        pendingDiagnostic.reason,
        pendingDiagnostic.order,
      )
    }
    const notifications = this.earlyTurnNotifications.splice(0)
    for (const notification of notifications) {
      this.handleNotification(
        notification.method,
        notification.params,
        notification.order,
      )
    }
  }

  /**
   * Validate the request's thread and turn association.
   * @returns `true` when the matching turn is still provisional, so the caller
   * defers its diagnostic until `commitTurnId()`.
   */
  private validateRunIds(
    params: JsonObject,
    nullableTurn = false,
  ): boolean {
    if (params.threadId !== this.threadId) {
      throw new Error('subagent-codex: app-server request referenced another thread')
    }
    if (nullableTurn && params.turnId === null) return false
    const id = string(params.turnId, 'server request turn id')
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      return true
    }
    if (id !== this.turnId) {
      throw new Error('subagent-codex: app-server request referenced another turn')
    }
    return false
  }

  private recordRequestDiagnostic(
    provisional: boolean,
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
  ): void {
    const order = this.nextObservationOrder()
    if (provisional) {
      this.pendingDiagnostic = {
        order,
        request,
        decision,
        reason,
      }
      return
    }
    this.recordDiagnostic(request, decision, reason, order)
  }

  private recordDiagnostic(
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
    order = this.nextObservationOrder(),
  ): void {
    if (order < this.diagnosticOrder) return
    this.diagnosticOrder = order
    this.diagnostic = unattendedDiagnostic(
      this.permissionMode,
      request,
      decision,
      reason,
    )
  }

  private recordFailure(facts: CodexWireFailureFacts): void {
    this.failure = facts
  }

  private nextObservationOrder(): number {
    this.observationOrder += 1
    return this.observationOrder
  }

  private recordDeclinedItem(item: JsonObject, order?: number): boolean {
    if (item.type === 'commandExecution' && item.status === 'declined') {
      this.recordDiagnostic(
        'command execution',
        'declined',
        'Codex declined the command under the selected permission mode',
        order,
      )
      return true
    }
    if (item.type === 'fileChange' && item.status === 'declined') {
      this.recordDiagnostic(
        'file change',
        'declined',
        'Codex declined the file change under the selected permission mode',
        order,
      )
      return true
    }
    return false
  }

  private handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval':
        {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'command approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/fileChange/requestApproval':
        {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'file approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/permissions/requestApproval':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'permission grant',
            'denied',
            'the provider grants no additional turn permissions',
          )
          return Promise.resolve({ permissions: {}, scope: 'turn' })
        case 'item/tool/requestUserInput':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'user input',
            'empty response',
            'the provider does not collect interactive answers',
          )
          return Promise.resolve({ answers: {} })
        case 'mcpServer/elicitation/request':
          this.recordRequestDiagnostic(
            this.validateRunIds(params, true),
            'MCP elicitation',
            'declined',
            'the provider does not collect interactive MCP input',
          )
          return Promise.resolve({ action: 'decline', content: null, _meta: null })
        default:
          throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`)
      }
    } catch (error: unknown) {
      const normalized = thrown(error)
      this.fail(normalized)
      return Promise.reject(normalized)
    }
  }

  /**
   * Report an item's category and phase. The echoed task item is not child
   * work. Only a completed non-final agent message contributes its text as the
   * note. The separate opt-in evidence callback includes bounded native labels and relative paths, never commands or results.
   */
  private reportItem(item: JsonObject, phase: SubagentActivity['phase']): void {
    this.lastActivityAt = Date.now()
    if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'collabToolCall'].includes(String(item.type))) {
      if (typeof item.id === 'string') {
        if (phase === 'started') this.sideEffects.add(item.id)
        else this.sideEffects.delete(item.id)
      } else if (phase === 'started') {
        // An uncorrelatable start blocks automatic recovery for this turn.
        this.sideEffects.add('unidentified')
      }
    }
    if (item.type === 'userMessage') return
    if (phase === 'completed' && this.turnId !== undefined && (item.type === 'commandExecution' || item.type === 'fileChange')) {
      const command = typeof item.command === 'string' ? item.command : ''
      const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : undefined
      const failed = item.status === 'failed' || (typeof item.exitCode === 'number' && item.exitCode !== 0)
      const succeeded = item.status === 'completed' || item.exitCode === 0
      const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
      const semantic = this.evidenceSummary === undefined ? undefined
        : summarizeNativeEvidence(item, this.workspace, this.evidenceSummary)
      const verificationTarget = semantic?.actions.some(action => action.kind === 'verification-target') === true
      this.onEvidence?.({
        turnId: brandString<SubagentEvidenceTurnId>(this.turnId),
        kind: item.type === 'fileChange' ? 'file-change' : 'command',
        operation: item.type === 'fileChange' ? 'file-change'
          : verificationTarget || this.evidencePatterns !== undefined && new RegExp(this.evidencePatterns.verification, 'u').test(command) ? 'verification'
            : this.evidencePatterns !== undefined && new RegExp(this.evidencePatterns.diagnostic, 'u').test(command) ? 'diagnostic' : 'command',
        operationDigest: digest(command || JSON.stringify(item.changes ?? [])),
        ...semantic === undefined ? {} : { semantic },
        ...output === undefined ? {} : { resultDigest: digest(output) },
        outcome: failed ? 'failed' : (verificationTarget ? item.exitCode === 0 : succeeded) ? 'succeeded' : 'unknown',
      })
    }
    const note = phase === 'completed' && item.type === 'agentMessage' && item.phase !== 'final_answer'
      && typeof item.text === 'string' ? item.text : undefined
    // A finished command failed when Codex marks it failed or reports a nonzero exit code.
    const failed = phase === 'completed' && item.type === 'commandExecution'
      && (item.status === 'failed' || (typeof item.exitCode === 'number' && item.exitCode !== 0))
    this.onActivity?.({ kind: ITEM_ACTIVITY_KINDS[String(item.type)] ?? 'other', phase,
      ...note === undefined ? {} : { note }, ...failed ? { outcome: 'failed' as const } : {} })
  }

  private handleNotification(
    method: string,
    params: JsonObject,
    order?: number,
  ): void {
    if (params.threadId === this.threadId) {
      const notifiedTurn = typeof params.turnId === 'string' ? params.turnId
        : typeof params.turn === 'object' && params.turn !== null ? (params.turn as JsonObject).id : undefined
      if (typeof notifiedTurn === 'string' && this.retiredTurns.has(notifiedTurn)) return
    }
    if (params.threadId === this.threadId && this.turnId !== undefined && !this.terminalObserved) {
      if (method === 'thread/status/changed') {
        const status = object(params.status, 'thread status')
        this.waiting = status.type === 'active' && Array.isArray(status.activeFlags) && status.activeFlags.length > 0
      }
      if (params.turnId === this.turnId) {
        if (method === 'error' && params.willRetry === true) this.retryCount += 1
        if (['item/agentMessage/delta', 'item/reasoning/textDelta', 'item/reasoning/summaryTextDelta', 'item/commandExecution/outputDelta'].includes(method)) {
          this.lastActivityAt = Date.now()
          this.retryCount = 0
        }
      }
    }
    if (method === 'item/started') {
      if (params.threadId === this.threadId && this.turnId === undefined && this.turnCompleted !== undefined && typeof params.turnId === 'string') {
        this.observePendingTurnId(params.turnId)
        this.earlyTurnNotifications.push({ method, params, order: this.nextObservationOrder() })
        return
      }
      // Observe-only: a malformed start notification is skipped, never a run failure.
      const item = params.item
      if (
        params.threadId === this.threadId && this.turnId !== undefined && params.turnId === this.turnId
        && typeof item === 'object' && item !== null && !Array.isArray(item)
      ) this.reportItem(item as JsonObject, 'started')
      return
    }
    if (method === 'turn/started') {
      const threadId = string(params.threadId, 'turn/started thread id')
      if (threadId !== this.threadId) return
      const turn = object(params.turn, 'turn/started turn')
      if (this.turnCompleted !== undefined && this.turnId === undefined) {
        this.observePendingTurnId(string(turn.id, 'turn/started turn id'))
      }
      return
    }
    if (method === 'item/completed') {
      const threadId = string(params.threadId, 'item/completed thread id')
      if (threadId !== this.threadId) return
      const id = string(params.turnId, 'item/completed turn id')
      if (this.turnId === undefined) {
        if (this.turnCompleted !== undefined) {
          this.observePendingTurnId(id)
          this.earlyTurnNotifications.push({
            method,
            params,
            order: this.nextObservationOrder(),
          })
        }
        return
      }
      if (id !== this.turnId) return
      const item = object(params.item, 'item/completed item')
      this.reportItem(item, 'completed')
      if (this.recordDeclinedItem(item, order)) return
      if (item.type !== 'agentMessage') return
      const text = typeof item.text === 'string'
        ? item.text
        : (() => { throw new Error('subagent-codex: app-server returned an invalid agent message') })()
      if (item.phase === 'final_answer') {
        this.lastFinalAnswer = text
      } else if (item.phase === null) {
        this.lastUnphasedAnswer = text
      } else if (item.phase !== 'commentary') {
        throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`)
      }
      return
    }
    if (method !== 'turn/completed') return
    const threadId = string(params.threadId, 'turn/completed thread id')
    if (threadId !== this.threadId) return
    const turn = object(params.turn, 'turn/completed turn')
    const id = string(turn.id, 'turn/completed turn id')
    const turnCompleted = this.turnCompleted
    if (turnCompleted === undefined) return
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      this.earlyTurnNotifications.push({
        method,
        params,
        order: this.nextObservationOrder(),
      })
      return
    }
    if (id !== this.turnId) return
    this.terminalObserved = true
    if (!['completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`)
    }
    turnCompleted.resolve({
      params,
      order: order ?? this.nextObservationOrder(),
    })
  }
}
