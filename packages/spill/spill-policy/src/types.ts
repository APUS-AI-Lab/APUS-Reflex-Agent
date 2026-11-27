/**
 * Vocabulary for the spill-policy plugin: the structural view of a tool
 * execution the policy needs to derive the owning session and append its
 * log-only record, and the payload of that record.
 *
 * `@deepseek-ai/dsh-tools`' `ToolExecution` satisfies this shape. The session
 * HEADER id is the spill owner — the same identity every other subsystem keys
 * off (see `dsh-tool-bash`'s owner derivation).
 *
 * @module @deepseek-ai/dsh-spill-policy/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SpillLocator } from '@deepseek-ai/dsh-spill'

/** Minimal structural view of a tool execution: its owning session, when present. */
export interface SpillPolicyExec {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    session: {
      header: {
        /** The canonical session identity — the spill owner. */
        id: SessionId
      }
      /** Append the log-only `spill/spilled` record to this session's event log. */
      append(type: 'spill/spilled', data: SpillSpilledEventData): unknown
    }
  }
}

/** Which tool-result copy a retention decision replaced. */
export type SpillCopyLabel = 'result' | 'dispatch'

/** One recorded replacement of an oversized tool-result copy by retained ends and a spill locator. */
export interface SpillSpilledEventData {
  /** Tool call whose copy was bounded; for a PTC dispatch copy this is the sub-call id. */
  callId: ToolCallId
  /** Tool whose result the policy bounded. */
  toolName: string
  /** The replaced copy: the model-facing result or a durable PTC dispatch-log copy. */
  label: SpillCopyLabel
  /** Effective `maxInlineTokens` in force for this decision. */
  threshold: number
  /** Token budget handed to retention after reserving the gap and the worst-case notice. */
  budgetTokens: number
  /** Estimated tokens of the replacement content, including the gap and notice. */
  retainedTokens: number
  /** UTF-8 bytes of the replacement's text blocks; image bytes stay in attachment storage. */
  retainedBytes: number
  /** Whole images kept in the replacement. */
  retainedImages: number
  /** UTF-8 bytes of the complete text stored through the spill backend. */
  spilledBytes: number
  /** UTF-8 text bytes omitted from the replacement. */
  omittedBytes: number
  /** Whole images omitted from the replacement. */
  omittedImages: number
  /** Backend handle for the complete stored text. */
  locator: SpillLocator
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One oversized tool-result copy replaced by retained ends and a spill
     * locator. Appended after the backend save and the replacement content are
     * known, so a record means the model-visible or durable dispatch-log copy
     * actually changed. It carries the effective threshold, the retention
     * budget and final token/byte/image accounting, and the locator. No
     * digests: the stored text embeds wall-clock times and the replacement
     * embeds the per-run locator name, so a hash could never replay. Log-only:
     * `deriveMessages()` ignores it; the owning `tool/result` or
     * `tool/ptc-dispatch` event stays authoritative, and the stored text
     * remains the recovery source.
     */
    'spill/spilled': SpillSpilledEventData
  }
}
