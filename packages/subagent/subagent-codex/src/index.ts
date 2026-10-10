/**
 * Profile-named Codex one-shot subagent provider. Every accepted run starts a
 * fresh official package-local Codex wrapper with `app-server --stdio` in the
 * delegating Session's workspace and publishes only after an ephemeral thread exists.
 *
 * @module @deepseek-ai/dsh-subagent-codex
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  codexStartupFailure,
  startCodexRun,
  type CodexPermissionMode,
  type CodexRunSpec,
} from './run.ts'

export { verificationTargets, type VerificationEnvelope, type VerificationRejection } from './verification-target.ts'

export const name = 'subagent-codex'
export const inject = ['subagents', 'subprocess']

const DEFAULT_PROVIDER_NAME = 'codex'
const DEFAULT_EVIDENCE_PATTERNS = {
  verification: '(?:^|\\s)(?:test|pytest|vitest|jest|tsc|build|check)(?:\\s|$)',
  diagnostic: '(?:^|\\s)(?:cat|head|tail|rg|grep|ls|stat)(?:\\s|$)',
}

/** Deployment-owned model, permission, environment, and process-release settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `codex`). */
  providerName?: string
  /** Native Codex model fixed for this instance; omitted to inherit Codex settings. */
  model?: string
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Native non-interactive permission mode fixed for this Provider instance. */
  permissionMode?: CodexPermissionMode
  /** Grace in milliseconds between app-server managed-range termination tiers. */
  disposeGraceMs?: number
  /** Opt in to workspace operation labels and relative paths; omitted disables semantic collection. */
  evidenceSummary?: {
    /** Maximum structured actions per completed native item. */
    maxActions: number
    /** Maximum relative path length; longer paths are omitted, never cut into a different path. */
    maxPathChars: number
    /** Opt in to strictly parsed literal test-file targets from native command text. */
    verificationTargets?: {
      /** Maximum command characters accepted before static parsing. */
      maxCommandChars: number
    } | undefined
  } | undefined
  /** Command classification for fingerprint evidence; patterns never establish correctness. */
  evidencePatterns?: {
    /** Unicode regular expression matching verification command text emitted by Codex. */
    verification: string
    /** Unicode regular expression matching diagnostic command text when verification does not match. */
    diagnostic: string
  }
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  model: z.string().min(1),
  env: z.dict(z.string()).default({}),
  permissionMode: z.union([...CODEX_PERMISSION_MODES])
    .default(DEFAULT_CODEX_PERMISSION_MODE),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  evidenceSummary: z.union([z.const(undefined), z.object({
    maxActions: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    maxPathChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    verificationTargets: z.union([z.const(undefined), z.object({
      maxCommandChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    })]),
  })]),
  evidencePatterns: z.object({ verification: z.string(), diagnostic: z.string() }).default(DEFAULT_EVIDENCE_PATTERNS),
})

type ResolvedConfig = Omit<Required<Config>, 'model' | 'evidenceSummary'> & Pick<Config, 'model' | 'evidenceSummary'>

class CodexProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  start(request: ResolvedSubagentStartRequest) {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-codex: no working directory for the child — delegate from a parent session that has one',
      )
    }
    let cwd: string
    try {
      cwd = resolveChildCwd(
        'subagent-codex',
        undefined,
        parentCwd,
      )
    } catch (error: unknown) {
      if (request.signal.aborted) {
        throw new Error(
          'subagent-codex: request was aborted before app-server startup',
        )
      }
      throw codexStartupFailure(error)
    }
    const spec: CodexRunSpec = {
      cwd,
      ...this.config.model === undefined ? {} : { model: this.config.model },
      permissionMode: this.config.permissionMode,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      evidencePatterns: this.config.evidencePatterns,
      ...this.config.evidenceSummary === undefined ? {} : { evidenceSummary: this.config.evidenceSummary },
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-codex "${this.name}": child run failed (${stopReason}): ${error.message}`,
        )
      },
    }
    return startCodexRun(request, spec)
  }
}

/**
 * Register one Profile-named Codex provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - registry name, optional model, permission mode, child environment, and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    ...config.model === undefined ? {} : { model: config.model },
    env: config.env as Record<string, string>,
    permissionMode: config.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
    disposeGraceMs: config.disposeGraceMs as number,
    evidencePatterns: config.evidencePatterns ?? DEFAULT_EVIDENCE_PATTERNS,
    ...config.evidenceSummary === undefined ? {} : { evidenceSummary: config.evidenceSummary },
  }
  assertPositiveFinite(
    'subagent-codex',
    'disposeGraceMs',
    resolved.disposeGraceMs,
  )
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  for (const pattern of Object.values(resolved.evidencePatterns)) new RegExp(pattern, 'u')
  ctx.subagents.registerProvider(new CodexProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
