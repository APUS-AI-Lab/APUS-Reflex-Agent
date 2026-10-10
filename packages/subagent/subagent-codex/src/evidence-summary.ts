/** Opt-in structural summaries of completed Codex 0.153.4 items; never publishes command text or output. */
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SubagentEvidence } from '@deepseek-ai/dsh-subagent'

import { verificationTargets } from './verification-target.ts'

type Semantic = NonNullable<SubagentEvidence['semantic']>
type Action = Semantic['actions'][number]

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Extract native action labels and lexical workspace-relative paths without filesystem access.
 * @param item - Completed native commandExecution or fileChange item from the wire parser.
 * @param workspace - Absolute parent workspace supplied to thread/start.
 * @param limits - Deployment-approved action and path budgets.
 * @returns Optional bounded project data; unknown actions supply no invented semantics.
 */
export function summarizeNativeEvidence(item: Record<string, unknown>, workspace: string,
  limits: { readonly maxActions: number
    readonly maxPathChars: number
    readonly verificationTargets?: { readonly maxCommandChars: number } | undefined }): Semantic | undefined {
  const verification = item.type === 'commandExecution' && limits.verificationTargets !== undefined
    ? verificationTargets(item.command, limits.verificationTargets.maxCommandChars) : undefined
  const entries = verification !== undefined && verification.paths.length > 0
    ? verification.paths.map(path => ({ type: 'verification-target', path }))
    : item.type === 'fileChange' ? item.changes : item.commandActions
  if (!Array.isArray(entries)) return undefined
  const actions: Action[] = []
  let truncated = false
  for (const entry of entries) {
    const value = object(entry)
    const type = item.type === 'fileChange' ? object(value?.kind)?.type : value?.type
    const kind: Action['kind'] | undefined = item.type === 'fileChange'
      ? type === 'add' ? 'file-add' : type === 'update' ? 'file-update' : type === 'delete' ? 'file-delete' : undefined
      : type === 'verification-target' && verification?.paths.length ? 'verification-target' : type === 'read' ? 'read' : type === 'listFiles' ? 'list-files' : type === 'search' ? 'search' : undefined
    if (kind === undefined) { truncated = true; continue }
    if (actions.length >= limits.maxActions) { truncated = true; break }
    let path: string | undefined
    const raw = value?.path
    if (typeof raw === 'string' && raw.length > 0 && !/[\x00-\x1f\x7f]/u.test(raw)
      && !(sep === '/' && (raw.includes('\\') || /^[A-Za-z]:/u.test(raw)))) {
      // Relative command targets resolve against the item's native cwd, not the parent workspace.
      const cwd = item.type === 'fileChange' ? workspace : typeof item.cwd === 'string' && isAbsolute(item.cwd) ? item.cwd : undefined
      const target = isAbsolute(raw) ? raw : cwd === undefined ? undefined : resolve(cwd, raw)
      if (target !== undefined) {
        const local = relative(workspace, target)
        if (local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)) {
          const candidate = local.split(sep).join('/') || '.'
          if (candidate.length <= limits.maxPathChars) path = candidate
        }
      }
    }
    if (path === undefined) truncated = true
    actions.push({ kind, ...path === undefined ? {} : { path } })
  }
  return actions.length === 0 ? undefined : { version: 1, actions, truncated }
}
