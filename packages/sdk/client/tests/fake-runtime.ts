#!/usr/bin/env node
/**
 * Scripted stand-in for the APUS Reflex Harness SDK runtime, driven entirely by
 * env vars — no model, no network, no harness imports. Speaks the runtime's
 * newline-delimited JSON-RPC protocol on stdio: answers `initialize`,
 * `session/prompt` (streaming scripted `session.event` notifications, then
 * `session.finished`, then the response), and `shutdown`.
 *
 * Script vocabulary (all optional):
 * - `FAKE_TEXT`: assistant text for each turn (default `hello from fake runtime`).
 * - `FAKE_STATUS`: the `session.finished` status (default `ok`).
 * - `FAKE_REASON_KIND`: the `session.finished` reason kind (default `completed`; `none` omits the reason).
 * - `FAKE_ABORT_REASON_KIND`: nested cause for an `aborted` turn (default `user`).
 * - `FAKE_SUBAGENT`: also emit a child session (subagent.started + child event + subagent.finished).
 * - `FAKE_ECHO_CWD`: prefix the assistant text with the process cwd.
 * - `FAKE_ECHO_ENV`: comma-separated env names to echo as `name=value` lines in the assistant text.
 * - `FAKE_MALFORMED`: `initialize` returns `{}` (no serverInfo); `prompt` returns `{}` (no accepted).
 * - `FAKE_MALFORMED_PROMPT`: `initialize` is normal; only `prompt` returns `{}` (no accepted).
 * - `FAKE_INIT_ERROR`: `initialize` answers a JSON-RPC error response with code 7.
 * - `FAKE_INIT_ERROR_ONCE_FILE`: fail `initialize` (code 7) only when this
 *   marker file does NOT exist yet, creating it — so the first runtime
 *   process fails the handshake and a respawned one succeeds (retry probe).
 * - `FAKE_ECHO_CWD_IN_INIT`: reply `serverInfo.version` = this process's cwd
 *   (wire-visible spawn-cwd probe).
 * - `FAKE_MALFORMED_EVENT`: the turn's `session.event` carries a number as
 *   the event; `FAKE_MALFORMED_MESSAGE`: assistant/message content is not an
 *   array; `FAKE_MESSAGE_WITHOUT_DATA`: assistant/message with no data
 *   member; `FAKE_MALFORMED_REASON`: the `turn/end` carries a bare reason
 *   (`1`), an aborted reason without its cause (`aborted`), an unknown abort
 *   cause (`abort-unknown`), a hook cause without its reason (`hook`), or no
 *   data member (`no-data`) for wire-validation probes.
 * - `FAKE_EMPTY_MESSAGE`: record an empty assistant/message whose embedded
 *   stream contains only usage and max-tokens settlement.
 * - `FAKE_HANG_INIT`: never answer `initialize` (mid-handshake cancel probe).
 * - `FAKE_INIT_READY` + `FAKE_INIT_GO`: touch the READY file when `initialize`
 *   arrives, then poll for the GO file before answering (deterministic
 *   cancel-during-handshake window).
 * - `FAKE_HANG_PROMPT`: never answer `session/prompt` (for timeout/dispose tests).
 * - `FAKE_HANG_CANCEL`: accept `session/cancel` but never answer it (cancellation
 *   timeout probe); emits the prompt turn normally first.
 * - `FAKE_CANCEL_ERROR`: answer `session/cancel` with a JSON-RPC error response.
 * - `FAKE_CANCEL_UNCONFIRMED`: answer `session/cancel` with `{ cancelled: false }`.
 * - `FAKE_RECORD_CANCELS`: append each `session/cancel` sessionId to this file.
 * - `FAKE_PRE_RECEIPT_EVENTS`: comma list of `source:type` entries published
 *   before this prompt's inbox receipt — `self` for this session, another id
 *   for an unrelated one. A source session that already ran sees a stale tail
 *   here instead, which the client must not attribute to this run.
 * - `FAKE_EXIT_DURING_PROMPT`: commit one interrupted assistant message, then
 *   exit 17 while the owned session run is waiting for its terminal state.
 * - `FAKE_STREAM_THEN_MALFORMED`: commit a partial assistant attempt for the
 *   prompt, then answer `{}` (no accepted) — same-pipe ordering makes the
 *   attempt arrive before the protocol failure (partial-output retention probe).
 * - `FAKE_IGNORE_EOF` + `FAKE_SIGTERM_FILE`: keep running after stdin EOF; touch the file on SIGTERM (ladder probe).
 * - `FAKE_TRAP_SIGTERM`: with `FAKE_IGNORE_EOF`, survive SIGTERM too (SIGKILL-rung probe).
 * - `FAKE_EXIT_BEFORE_INIT`: exit 3 immediately (spawn-then-die probe).
 * - `FAKE_STDERR`: write this line to stderr at boot (diagnostics-tail probe).
 * - `FAKE_STDERR_NO_NEWLINE`: write this to stderr WITHOUT a newline (buffer-flush probe).
 * - `FAKE_RECORD_INIT`: append each `initialize` params JSON to this file (handshake probe).
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline'

const env = process.env

if (env.FAKE_STDERR !== undefined) process.stderr.write(`${env.FAKE_STDERR}\n`)
if (env.FAKE_STDERR_NO_NEWLINE !== undefined) process.stderr.write(env.FAKE_STDERR_NO_NEWLINE)
if (env.FAKE_EXIT_BEFORE_INIT !== undefined) process.exit(3)

if (env.FAKE_IGNORE_EOF !== undefined) {
  // Simulate a runtime that never quiesces from EOF so the dispose ladder
  // must escalate; record which rung fired.
  process.stdin.resume()
  process.stdin.on('end', () => { setInterval(() => {}, 1_000) })
  process.on('SIGTERM', () => {
    if (env.FAKE_SIGTERM_FILE !== undefined) writeFileSync(env.FAKE_SIGTERM_FILE, 'sigterm\n')
    if (env.FAKE_TRAP_SIGTERM === undefined) process.exit(0)
  })
}

function write(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function notify(method: string, params: object): void {
  write({ jsonrpc: '2.0', method, params })
}

let seq = 0
function event(sessionId: string, type: string, data: object): void {
  notify('session.event', { sessionId, event: { type, seq: seq++, time: 0, data } })
}

function assistantText(): string {
  const parts: string[] = []
  if (env.FAKE_ECHO_CWD !== undefined) parts.push(`cwd=${process.cwd()}`)
  for (const name of (env.FAKE_ECHO_ENV ?? '').split(',').filter(entry => entry.length > 0)) {
    parts.push(`${name}=${env[name] ?? ''}`)
  }
  parts.push(env.FAKE_TEXT ?? 'hello from fake runtime')
  return parts.join('\n')
}

function textStream(text: string): object[] {
  return [
    { type: 'chunk', time: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: 0, index: 0, dt: [], texts: [text] },
    { type: 'chunk', time: 0, chunk: { type: 'block-end', index: 0, block: { type: 'text', text } } },
    { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
}

function usageOnlyStream(): object[] {
  return [
    {
      type: 'chunk',
      time: 0,
      chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
    },
    { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'max-tokens' } } },
  ]
}

function runTurn(sessionId: string): void {
  const text = assistantText()
  if (env.FAKE_MALFORMED_EVENT !== undefined) {
    notify('session.event', { sessionId, event: 42 })
    return
  }
  event(sessionId, 'turn/start', { turn: 0 })
  if (env.FAKE_CONTINUUM_RECEIPT !== undefined) {
    event(sessionId, 'continuum/memory-decision', {
      version: 1, mode: 'active', selectedIds: ['migration'], baselineIds: ['migration'], outcome: 'jev', confidence: 0.95,
    })
  }
  if (env.FAKE_MALFORMED_MESSAGE !== undefined) {
    event(sessionId, 'assistant/attempt', {
      turn: 0,
      step: 0,
      stream: textStream(text),
    })
    event(sessionId, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'fake-malformed-message',
        role: 'assistant',
        content: 'not-an-array',
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
      stream: textStream(text),
    })
    return
  }
  if (env.FAKE_MESSAGE_WITHOUT_DATA !== undefined) {
    notify('session.event', { sessionId, event: { type: 'assistant/message', seq: seq++, time: 0 } })
    return
  }
  if (env.FAKE_EMPTY_MESSAGE !== undefined) {
    event(sessionId, 'assistant/attempt', {
      turn: 0,
      step: 0,
      stream: textStream(text),
    })
  }
  event(sessionId, 'assistant/message', {
    turn: 0,
    step: 0,
    message: {
      id: `fake-assistant-${seq}`,
      role: 'assistant',
      // Model the usage-only message recorded after a max-tokens step that
      // assembled no output blocks.
      content: env.FAKE_EMPTY_MESSAGE !== undefined ? [] : [{ type: 'text', text }],
      source: { kind: 'model', provider: 'fake', model: 'fake' },
    },
    stream: env.FAKE_EMPTY_MESSAGE !== undefined ? usageOnlyStream() : textStream(text),
  })
  const reasonKind = env.FAKE_REASON_KIND ?? 'completed'
  if (reasonKind !== 'none') {
    if (env.FAKE_MALFORMED_REASON === 'no-data') {
      notify('session.event', { sessionId, event: { type: 'turn/end', seq: seq++, time: 0 } })
      return
    }
    const reason = env.FAKE_MALFORMED_REASON === 'aborted'
      ? { kind: 'aborted' }
      : env.FAKE_MALFORMED_REASON === 'abort-unknown'
        ? { kind: 'aborted', reason: { kind: 'future' } }
        : env.FAKE_MALFORMED_REASON === 'hook'
          ? { kind: 'aborted', reason: { kind: 'hook' } }
          : env.FAKE_MALFORMED_REASON !== undefined
            ? 'not-a-reason-envelope'
            : reasonKind === 'aborted'
              ? {
                kind: 'aborted',
                reason: env.FAKE_ABORT_REASON_KIND === 'hook'
                  ? { kind: 'hook', reason: 'scripted hook abort' }
                  : { kind: env.FAKE_ABORT_REASON_KIND ?? 'user' },
              }
              : reasonKind === 'error'
                ? { kind: 'error', error: { message: 'scripted child error', code: 'UNKNOWN' } }
                : { kind: reasonKind }
    event(sessionId, 'turn/end', { turn: 0, reason })
  }
  if (env.FAKE_SUBAGENT !== undefined) {
    const childId = `${sessionId}-child`
    notify('subagent.started', { parentSessionId: sessionId, childSessionId: childId })
    event(childId, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: `fake-child-${seq}`,
        role: 'assistant',
        content: [{ type: 'text', text: 'child says hi' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
      stream: textStream('child says hi'),
    })
    notify('subagent.finished', {
      provider: 'spawn',
      agentId: childId,
      parentSessionId: sessionId,
      childSessionId: childId,
      status: 'ok',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'child says hi' }],
    })
  }
}

function sessionIdOf(params: Record<string, unknown> | undefined): string {
  const value = params?.sessionId
  return typeof value === 'string' ? value : ''
}

/**
 * Scripted request-view surface: when `FAKE_REQUEST_VIEW` names a JSON file it
 * contains `{ dispatches, views }`, answered per session. Unset means an older
 * runtime with the capability absent and both methods unknown.
 */
function requestViewScript(): { dispatches?: Record<string, unknown[]>; views?: Record<string, unknown> } {
  const path = env.FAKE_REQUEST_VIEW
  if (path === undefined) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as { dispatches?: Record<string, unknown[]>; views?: Record<string, unknown> }
}

const viewScript = requestViewScript()

const reader = createInterface({ input: process.stdin })
reader.on('line', (line) => {
  if (line.trim().length === 0) return
  const frame = JSON.parse(line) as { id?: string | number; method?: string; params?: Record<string, unknown> }
  if (frame.method === undefined || frame.id === undefined) return
  const respond = (result: object): void => { write({ jsonrpc: '2.0', id: frame.id, result }) }
  switch (frame.method) {
    case 'initialize':
      if (env.FAKE_RECORD_INIT !== undefined) appendFileSync(env.FAKE_RECORD_INIT, `${JSON.stringify(frame.params)}\n`)
      if (env.FAKE_HANG_INIT !== undefined) return
      if (env.FAKE_INIT_READY !== undefined && env.FAKE_INIT_GO !== undefined) {
        writeFileSync(env.FAKE_INIT_READY, 'ready\n')
        const go = env.FAKE_INIT_GO
        const id = frame.id
        const poll = setInterval(() => {
          if (!existsSync(go)) return
          clearInterval(poll)
          write({ jsonrpc: '2.0', id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } })
        }, 5)
        return
      }
      if (env.FAKE_INIT_ERROR !== undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: 'scripted init failure', data: { hint: 'fake' } } })
        return
      }
      if (env.FAKE_INIT_ERROR_ONCE_FILE !== undefined && !existsSync(env.FAKE_INIT_ERROR_ONCE_FILE)) {
        writeFileSync(env.FAKE_INIT_ERROR_ONCE_FILE, 'failed-once\n')
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: 'scripted first-boot failure' } })
        return
      }
      if (env.FAKE_MALFORMED !== undefined) {
        respond({})
        return
      }
      if (env.FAKE_ECHO_CWD_IN_INIT !== undefined) {
        respond({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: process.cwd() } })
        return
      }
      if (env.FAKE_REQUEST_VIEW !== undefined) {
        respond({
          serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
          capabilities: ['request-view/dispatch-v1'],
        })
        return
      }
      respond({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } })
      return
    case 'session/dispatches': {
      if (env.FAKE_REQUEST_VIEW === undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: 'unknown APUS Reflex Harness SDK runtime method: session/dispatches' } })
        return
      }
      const sessionId = sessionIdOf(frame.params)
      if (viewScript.dispatches === undefined) {
        respond({ sessionId, dispatches: [] })
        return
      }
      respond({ sessionId, dispatches: viewScript.dispatches[sessionId] ?? [] })
      return
    }
    case 'session/request-view': {
      if (env.FAKE_REQUEST_VIEW === undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: 'unknown APUS Reflex Harness SDK runtime method: session/request-view' } })
        return
      }
      const sessionId = sessionIdOf(frame.params)
      const key = `${sessionId}:${String(frame.params?.dispatchSeq)}`
      const view = viewScript.views?.[key]
      if (view === undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: 'dispatch not found', data: { code: 'DISPATCH_NOT_FOUND' } } })
        return
      }
      respond(view)
      return
    }
    case 'session/prompt': {
      if (env.FAKE_RECORD_PROMPTS !== undefined) appendFileSync(env.FAKE_RECORD_PROMPTS, `${JSON.stringify(frame.params)}\n`)
      const sessionId = sessionIdOf(frame.params)
      // Initialization events published before this prompt's inbox receipt.
      // A fresh source session sends them here; a session that already ran
      // sends a stale tail instead, which the client must not attribute to
      // this run.
      if (env.FAKE_PRE_RECEIPT_EVENTS !== undefined) {
        for (const entry of env.FAKE_PRE_RECEIPT_EVENTS.split(',').filter(part => part.length > 0)) {
          const [source, type] = entry.split(':', 2)
          if (source === undefined || type === undefined) continue
          event(source === 'self' ? sessionId : source, type, {})
        }
      }
      const messageId = `fake-user-${seq}`
      event(sessionId, 'agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [{
          id: messageId,
          role: 'user',
          content: [],
          source: { kind: 'user' },
        }],
      })
      notify('session.status', { sessionId, status: 'running' })
      if (env.FAKE_STREAM_THEN_MALFORMED !== undefined) {
        event(sessionId, 'assistant/attempt', {
          turn: 0,
          step: 0,
          stream: textStream('streamed then cut short'),
        })
        respond({})
        return
      }
      if (env.FAKE_EXIT_DURING_PROMPT !== undefined) {
        const partial = env.FAKE_TEXT ?? 'partial before exit'
        respond({ messageId })
        event(sessionId, 'assistant/message', {
          turn: 0,
          step: 0,
          message: {
            id: `fake-partial-${seq}`,
            role: 'assistant',
            content: [{ type: 'text', text: partial }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
          stream: textStream(partial),
          interrupted: true,
        })
        setImmediate(() => { process.exit(17) })
        return
      }
      if (env.FAKE_HANG_PROMPT !== undefined) return
      if (env.FAKE_MALFORMED !== undefined || env.FAKE_MALFORMED_PROMPT !== undefined) {
        respond({})
        return
      }
      runTurn(sessionId)
      notify('session.status', { sessionId, status: 'idle' })
      respond({ messageId })
      return
    }
    case 'session/cancel': {
      const sessionId = sessionIdOf(frame.params)
      if (env.FAKE_RECORD_CANCELS !== undefined) appendFileSync(env.FAKE_RECORD_CANCELS, `${sessionId}\n`)
      if (env.FAKE_HANG_CANCEL !== undefined) return
      if (env.FAKE_CANCEL_ERROR !== undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: 'scripted cancel failure' } })
        return
      }
      if (env.FAKE_CANCEL_UNCONFIRMED !== undefined) {
        respond({ sessionId, cancelled: false })
        return
      }
      event(sessionId, 'turn/end', { turn: 0, reason: { kind: 'aborted', reason: { kind: 'user' } } })
      notify('session.status', { sessionId, status: 'idle' })
      respond({ sessionId, cancelled: true })
      return
    }
    case 'shutdown':
      respond({})
      // An EOF-ignoring fake also refuses the protocol exit, so the client's
      // dispose ladder (not this cooperative path) must reap it.
      if (env.FAKE_IGNORE_EOF === undefined) setImmediate(() => process.exit(0))
      return
    default:
      write({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: `unknown method: ${frame.method}` } })
  }
})
