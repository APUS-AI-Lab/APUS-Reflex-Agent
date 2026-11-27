/** Remote filesystem operations addressed by the owning agent session. @module @deepseek-ai/dsh-fs-remote */

import { posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsErrorCode,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { PROBE_SOURCE, probeCommand, type ProbeAnswer, type ProbeRequest } from './probe.ts'

/** Validated plugin configuration. */
export interface Config {
  /** The benchmark service that owns the task containers. */
  endpoint: string
  /** Bearer credential for that service, when it requires one. */
  token?: string
  /** Per-operation budget in seconds. */
  timeoutSec: number
}

const ERROR_CODES: Record<string, true> = {
  FS_NOT_FOUND: true, FS_NOT_DIRECTORY: true, FS_NOT_TEXT: true, FS_NOT_REGULAR_FILE: true,
  FS_TOO_LARGE: true, FS_PERMISSION_DENIED: true, FS_SANDBOX_DENIED: true, FS_IO_ERROR: true,
  FS_STALE_VERSION: true, FS_NOT_OBSERVED: true, FS_AMBIGUOUS_EDIT: true,
  FS_EDIT_NOT_FOUND: true, FS_ABORTED: true,
}

/** Split a target key back into the agent that owns it and its path. */
function decode(target: FsTarget): { agentId: string; path: string } {
  const key = String(target.targetKey)
  const split = key.indexOf('\u0000')
  if (split < 0) {
    throw new FsError(`target has no owning agent: ${key}`, 'FS_IO_ERROR')
  }
  return { agentId: key.slice(0, split), path: key.slice(split + 1) }
}

function encode(agentId: string, path: string): string {
  return `${agentId}\u0000${path}`
}

function rootSession(ctx: Context, agentId: string): string {
  const sessions = ctx.get('sessions')
  const seen = new Set<string>()
  let current = SessionId(agentId)
  while (sessions !== undefined) {
    if (seen.has(current)) throw new FsError('session parent chain contains a cycle', 'FS_IO_ERROR')
    seen.add(current)
    const parent = sessions.get(current)?.header.parentSession
    if (parent === undefined) break
    current = parent
  }
  return current
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkedAnswer(value: unknown, request: ProbeRequest): ProbeAnswer {
  const invalid = () => new FsError('filesystem probe returned invalid data', 'FS_IO_ERROR')
  if (!record(value)) throw invalid()
  if (value.ok === false) {
    if (typeof value.code !== 'string' || !Object.hasOwn(ERROR_CODES, value.code) || typeof value.message !== 'string') throw invalid()
    throw new FsError(value.message, value.code as FsErrorCode)
  }
  if (value.ok !== true) throw invalid()
  const version = () => typeof value.version === 'string' && value.version.length > 0
  switch (request.op) {
    case 'resolve':
      if (typeof value.path !== 'string' || !posix.isAbsolute(value.path)) throw invalid()
      break
    case 'stat':
    case 'lstat':
      if (value.exists !== false && (
        value.exists !== true || !version() || typeof value.type !== 'string'
        || !['file', 'directory', 'other', ...request.op === 'lstat' ? ['symlink'] : []].includes(value.type)
        || !Number.isSafeInteger(value.size) || Number(value.size) < 0
      )) throw invalid()
      break
    case 'read':
      if (typeof value.text !== 'string') throw invalid()
      break
    case 'bytes':
    case 'range': {
      if (typeof value.base64 !== 'string') throw invalid()
      const decoded = Buffer.from(value.base64, 'base64')
      if (decoded.toString('base64') !== value.base64) throw invalid()
      const limit = request.op === 'bytes' ? request.maxBytes : request.length
      if (limit === undefined || decoded.byteLength > limit) throw invalid()
      break
    }
    case 'list':
      if (!Array.isArray(value.entries) || !value.entries.every(entry => record(entry)
        && typeof entry.name === 'string' && entry.name.length > 0 && entry.name !== '.' && entry.name !== '..'
        && !entry.name.includes('/') && typeof entry.path === 'string' && posix.isAbsolute(entry.path)
        && typeof entry.type === 'string' && ['file', 'directory', 'other'].includes(entry.type)
        && typeof entry.version === 'string'
        && (entry.size === undefined || (Number.isSafeInteger(entry.size) && Number(entry.size) >= 0)),
      )) throw invalid()
      break
    case 'write':
      if (!version() || !['create', 'update'].includes(String(value.operation))
        || !(value.before === null || typeof value.before === 'string') || typeof value.after !== 'string') throw invalid()
      break
    case 'edit':
      if (!version() || typeof value.before !== 'string' || typeof value.after !== 'string') throw invalid()
      break
  }
  return value as ProbeAnswer
}

/** Filesystem provider that runs every operation in the task container its request names. */
export class RemoteFileSystem extends FileSystem {
  static Config = z.object({
    endpoint: z.string().required(),
    token: z.string(),
    timeoutSec: z.number().default(120),
  })

  constructor(ctx: Context, readonly config: Config) {
    super(ctx)
  }

  override async resolve(
    path: string,
    opts?: { cwd?: string; signal?: AbortSignal; agentId?: string },
  ): Promise<FsTarget> {
    if (opts?.agentId === undefined) {
      throw new FsError(
        'the request names no agent, so the service cannot tell which task container '
        + 'this path belongs to',
        'FS_IO_ERROR',
      )
    }
    const answer = await this._call(
      opts.agentId,
      { op: 'resolve', path, ...opts.cwd === undefined ? {} : { cwd: opts.cwd } },
      opts.signal,
    )
    const resolved = typeof answer.path === 'string' ? answer.path : path
    return { targetKey: FsTargetKey(encode(opts.agentId, resolved)), displayPath: resolved }
  }

  override processPath(target: FsTarget): string {
    return decode(target).path
  }

  override processPathFromHostPath(hostPath: string): string | undefined {
    void hostPath
    // The task container shares no path with this host.
    return undefined
  }

  override fileUrl(target: FsTarget): string {
    return pathToFileURL(this.processPath(target)).href
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    const outer = decode(parent)
    const inner = decode(child)
    if (outer.agentId !== inner.agentId) return false
    const relative = posix.relative(outer.path, inner.path)
    return relative === '' || (!relative.startsWith('../') && relative !== '..' && !posix.isAbsolute(relative))
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const { agentId, path } = decode(target)
    const answer = await this._call(agentId, { op: 'stat', path }, signal)
    if (answer.exists === false) return undefined
    return {
      version: FsVersion(String(answer.version ?? '')),
      type: answer.type === 'symlink' ? 'other' : answer.type ?? 'other',
      ...typeof answer.size === 'number' ? { size: answer.size } : {},
    }
  }

  override async lstat(
    path: string, opts?: { cwd?: string; agentId?: string }, signal?: AbortSignal,
  ): Promise<FsPathInfo | undefined> {
    const agentId = opts?.agentId
    if (agentId === undefined) throw new FsError('the request names no agent', 'FS_IO_ERROR')
    const answer = await this._call(
      agentId,
      { op: 'lstat', path, ...opts?.cwd === undefined ? {} : { cwd: opts.cwd } },
      signal,
    )
    if (answer.exists === false) return undefined
    return {
      version: FsVersion(String(answer.version ?? '')),
      type: answer.type ?? 'other',
      ...typeof answer.size === 'number' ? { size: answer.size } : {},
    }
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    const { agentId, path } = decode(target)
    const answer = await this._call(agentId, { op: 'read', path }, signal)
    return typeof answer.text === 'string' ? answer.text : ''
  }

  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const info = await this.stat(target, signal)
    if (info === undefined) throw new FsError('file not found', 'FS_NOT_FOUND')
    if (info.type !== 'file') throw new FsError('not a regular file', 'FS_NOT_REGULAR_FILE')
    const { agentId, path } = decode(target)
    const readRange = (offset: number) => this._call(agentId, {
      op: 'range', path, offset, length: 65_536, expectedVersion: String(info.version),
    }, signal)
    return (async function* () {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let offset = 0
      while (true) {
        if (signal?.aborted) throw new FsError('read aborted', 'FS_ABORTED')
        const answer = await readRange(offset)
        const bytes = Buffer.from(String(answer.base64), 'base64')
        if (offset < 8192 && bytes.subarray(0, 8192 - offset).includes(0)) {
          throw new FsError('binary file', 'FS_NOT_TEXT')
        }
        let text: string
        try {
          text = bytes.length === 0 ? decoder.decode() : decoder.decode(bytes, { stream: true })
        } catch (error) {
          throw new FsError('not UTF-8 text', 'FS_NOT_TEXT', { cause: error })
        }
        if (text.length > 0) yield text
        if (bytes.length === 0) return
        offset += bytes.length
      }
    })()
  }

  override async readBytes(
    target: FsTarget, signal: AbortSignal | undefined, maxBytes: number,
  ): Promise<Uint8Array> {
    const { agentId, path } = decode(target)
    const answer = await this._call(agentId, { op: 'bytes', path, maxBytes }, signal)
    return Buffer.from(String(answer.base64 ?? ''), 'base64')
  }

  override async readByteRange(
    target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const { agentId, path } = decode(target)
    const answer = await this._call(
      agentId, { op: 'range', path, offset: range.offset, length: range.length }, signal,
    )
    return Buffer.from(String(answer.base64 ?? ''), 'base64')
  }

  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const { agentId, path } = decode(target)
    const answer = await this._call(agentId, { op: 'list', path }, signal)
    return (answer.entries ?? []).map(entry => ({
      name: entry.name,
      type: entry.type,
      target: {
        targetKey: FsTargetKey(encode(agentId, entry.path)),
        displayPath: entry.path,
      },
      ...entry.version ? { version: FsVersion(entry.version) } : {},
      ...typeof entry.size === 'number' ? { size: entry.size } : {},
    }))
  }

  override async writeText(
    target: FsTarget, content: string, expected?: FsWriteIntent,
    signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    const { agentId, path } = decode(target)
    const request: ProbeRequest = {
      op: 'write', path, content,
      ...sandboxPolicy === undefined ? {} : { policy: sandboxPolicy },
      ...expected?.kind === 'createIfAbsent' ? { createOnly: true } : {},
      ...expected?.kind === 'replaceIfVersion' ? { expectedVersion: String(expected.version) } : {},
    }
    const answer = await this._call(agentId, request, signal)
    return {
      operation: answer.operation === 'create' ? 'create' : 'update',
      version: FsVersion(String(answer.version ?? '')),
      before: typeof answer.before === 'string' ? answer.before : null,
      after: content.replace(/\r\n/g, '\n'),
    }
  }

  override async editText(
    target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion },
    signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    const { agentId, path } = decode(target)
    const request: ProbeRequest = {
      op: 'edit', path,
      ...sandboxPolicy === undefined ? {} : { policy: sandboxPolicy },
      old: edit.oldString, new: edit.newString, replaceAll: edit.replaceAll,
      ...expected === undefined ? {} : { expectedVersion: String(expected.version) },
    }
    const answer = await this._call(agentId, request, signal)
    return {
      version: FsVersion(String(answer.version ?? '')),
      before: String(answer.before ?? ''),
      after: String(answer.after ?? ''),
    }
  }

  /** Execute one probe without retrying a possibly committed mutation. */
  private async _call(
    agentId: string, request: ProbeRequest, signal?: AbortSignal,
  ): Promise<ProbeAnswer> {
    if (signal?.aborted) throw new FsError('filesystem operation aborted', 'FS_ABORTED')
    if (!agentId) throw new FsError('the request names no agent', 'FS_IO_ERROR')
    const service = this.config.endpoint.replace(/\/$/, '')
    const token = this.config.token?.trim()
    const owner = rootSession(this.ctx, agentId)
    try {
      const response = await fetch(`${service}/jobs/by-session/${encodeURIComponent(owner)}/exec`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...token ? { Authorization: `Bearer ${token}` } : {},
        },
        body: JSON.stringify({ command: probeCommand(request), timeout_sec: this.config.timeoutSec }),
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.ceil(this.config.timeoutSec * 1000)),
          ...signal === undefined ? [] : [signal],
        ]),
      })
      if (!response.ok) throw new FsError(`the task service answered ${response.status}`, 'FS_IO_ERROR')
      const body: unknown = await response.json()
      if (!record(body) || body.return_code !== 0 || body.refused === true
        || (body.refused !== undefined && typeof body.refused !== 'boolean') || typeof body.stdout !== 'string') {
        throw new FsError('the task service did not complete the filesystem probe', 'FS_IO_ERROR')
      }
      if (signal?.aborted) throw new FsError('filesystem operation aborted', 'FS_ABORTED')
      return checkedAnswer(JSON.parse(body.stdout), request)
    } catch (error) {
      if (signal?.aborted) throw new FsError('filesystem operation aborted', 'FS_ABORTED', { cause: error })
      if (error instanceof FsError) throw error
      throw new FsError('filesystem request failed or returned invalid data', 'FS_IO_ERROR', { cause: error })
    }
  }

}

export default RemoteFileSystem

export { PROBE_SOURCE }
