/** Resumable, verified downloads of revision-pinned weights from Hugging Face-compatible origins. */
import { createHash } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import { lstat, mkdir, open, rename, rm, statfs } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { deadline, idleWatchdog, timeoutOf, TimeoutReason } from '@deepseek-ai/dsh-timeout'
import type { ReflexDownloadFailure } from './types.ts'

/** Release-pinned weight file. */
export interface ModelAsset {
  readonly name: string
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

/** A download failure whose public fields exclude raw causes, credentials, signed URLs, and local paths. */
export class ReflexDownloadError extends Error {
  override name = 'ReflexDownloadError'

  constructor(readonly download: ReflexDownloadFailure, options?: ErrorOptions) {
    super(`Reflex weights download from ${download.source} failed: ${download.reason}${download.code === undefined ? '' : ` (${download.code})`}${download.status === undefined ? '' : ` (HTTP ${download.status})`}`, options)
  }
}

/** The data volume cannot hold the remaining bytes plus the configured margin. */
export class ReflexDiskError extends Error {
  override name = 'ReflexDiskError'

  constructor(readonly requiredBytes: number, readonly availableBytes: number) {
    super(`Reflex weights need ${requiredBytes} free bytes; ${availableBytes} are available`)
  }
}

type FailureKind = Pick<ReflexDownloadFailure, 'reason' | 'code'>

function reasonOfCode(code: string): ReflexDownloadFailure['reason'] | undefined {
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns'
  if (code === 'ETIMEDOUT' || code.endsWith('_TIMEOUT')) return 'timeout'
  if (/CERT|SELF_SIGNED|UNABLE_TO_(VERIFY|GET_ISSUER)/.test(code)) return 'certificate'
  if (['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EROFS'].includes(code)) return 'storage'
  if (['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return 'network'
  return undefined
}

/**
 * Classify a network or filesystem failure by walking its causes, including aggregate connection attempts, without publishing messages.
 * @param failure - error received from fetch, streams, or the filesystem.
 * @param seen - causes already visited.
 * @returns the first recognized category and code depth-first; a bare `fetch failed` is `network`, anything else `unknown`.
 */
export function classifyFailure(failure: unknown, seen = new Set<unknown>()): FailureKind {
  if (!(failure instanceof Error) || seen.has(failure)) return { reason: 'unknown' }
  seen.add(failure)
  if (failure instanceof TimeoutReason || failure.name === 'TimeoutError') return { reason: 'timeout' }
  if ('code' in failure && typeof failure.code === 'string') {
    const reason = reasonOfCode(failure.code)
    if (reason !== undefined) return { reason, code: failure.code }
  }
  const causes: unknown[] = failure instanceof AggregateError ? [failure.cause, ...failure.errors as unknown[]] : [failure.cause]
  for (const cause of causes) {
    const nested = classifyFailure(cause, seen)
    if (nested.reason !== 'unknown') return nested
  }
  return { reason: failure instanceof TypeError && failure.message === 'fetch failed' ? 'network' : 'unknown' }
}

/**
 * Probe every origin with HEAD and move the first 2xx responder to the front.
 * @param assetUrl - revision-pinned upstream URL whose path every origin serves.
 * @param origins - nonempty configured origins.
 * @param timeoutMs - probe deadline including redirects; a timed-out probe counts as a failure.
 * @param signal - preparation cancellation.
 * @returns deduplicated download URLs; configured order when no probe succeeds; a single URL without probing.
 */
export async function orderSources(
  assetUrl: string, origins: readonly string[], timeoutMs: number, signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted()
  const path = new URL(assetUrl).pathname
  const urls = [...new Set(origins.map(origin => new URL(path, origin).href))]
  if (urls.length === 1) return urls
  using probe = deadline(signal, timeoutMs, 'REFLEX_SOURCE_PROBE_TIMEOUT')
  const decided = new AbortController()
  const probing = AbortSignal.any([probe.signal, decided.signal])
  let first: string | undefined
  await Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(url, { method: 'HEAD', signal: probing })
    await response.body?.cancel()
    if (!response.ok || first !== undefined) return
    first = url
    decided.abort()
  }))
  signal.throwIfAborted()
  return first === undefined ? urls : [first, ...urls.filter(url => url !== first)]
}

/**
 * Compare a file with its pinned size and SHA-256.
 * @param path - candidate file.
 * @param asset - pinned identity.
 * @param signal - cancellation of the hash pass.
 * @returns false for a missing file or any mismatch.
 */
export async function matchesAsset(path: string, asset: ModelAsset, signal: AbortSignal): Promise<boolean> {
  const info = await fileInfo(path)
  if (info?.isFile() !== true || info.size !== asset.bytes) return false
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer)
  return digest.digest('hex') === asset.sha256
}

/**
 * Read file metadata without following a final symbolic link.
 * @param path - inspected path.
 * @returns metadata, or undefined when nothing exists at the path.
 */
export async function fileInfo(path: string): Promise<Stats | undefined> {
  return await lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  })
}

/**
 * Locate the deterministic partial file of an asset.
 * @param directory - weights directory.
 * @param asset - pinned identity.
 * @returns `<directory>/<name>.part`.
 */
export function partialPath(directory: string, asset: ModelAsset): string {
  return join(directory, `${asset.name}.part`)
}

/**
 * Measure retained partial bytes.
 * @param path - partial file.
 * @returns its size, or zero when it is absent or not a regular file.
 */
export async function partialBytes(path: string): Promise<number> {
  const info = await fileInfo(path)
  return info?.isFile() === true ? info.size : 0
}

/**
 * Read free space on the volume holding a path that may not exist yet.
 * @param path - target path; the nearest existing ancestor is measured.
 * @returns bytes available to this user.
 */
export async function availableBytes(path: string): Promise<number> {
  const info = await statfs(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error
    return undefined
  })
  return info === undefined ? await availableBytes(dirname(path)) : info.bavail * info.bsize
}

/** One resumable download of a pinned asset. */
export interface DownloadRequest {
  readonly asset: ModelAsset
  /** Directory receiving `<name>.part` and, after verification, `<name>`. */
  readonly directory: string
  /** Ordered candidate URLs; storage, disk, and unclassified failures stop without trying the rest. */
  readonly urls: readonly string[]
  readonly stallTimeoutMs: number
  readonly diskMarginBytes: number
  readonly progressIntervalMs: number
  /** Pause, cancellation, or disposal; an abort rethrows its reason and keeps the partial file. */
  readonly signal: AbortSignal
  /** Receive throttled progress; the first and the final byte counts are always reported. */
  report(completedBytes: number, source: string): void
  /** Called once the body is complete, before the final hash comparison. */
  verifying(): void
}

const STALL = 'REFLEX_DOWNLOAD_STALL_TIMEOUT'

/**
 * Download into `<name>.part`, resuming retained bytes with an HTTP Range request, then verify and rename atomically.
 * A 206 must start exactly at the retained size; a 200 restarts from byte zero. A size or hash mismatch deletes the partial file.
 * @param request - asset, sources, limits, cancellation, and progress callbacks.
 * @returns the verified file path.
 */
export async function downloadModel(request: DownloadRequest): Promise<string> {
  await mkdir(request.directory, { recursive: true, mode: 0o700 })
  for (const [index, url] of request.urls.entries()) {
    try { return await attempt(request, url) } catch (error) {
      const retry = error instanceof ReflexDownloadError && error.download.reason !== 'storage' && error.download.reason !== 'unknown'
      if (!retry || index === request.urls.length - 1) throw error
    }
  }
  /* v8 ignore next -- configuration requires at least one origin. */
  throw new Error('Reflex download has no source')
}

async function attempt(request: DownloadRequest, url: string): Promise<string> {
  const { asset, signal } = request
  const destination = join(request.directory, asset.name), partial = partialPath(request.directory, asset)
  const source = new URL(url).origin
  using stall = idleWatchdog(signal, request.stallTimeoutMs, STALL)
  let trailing: ReturnType<typeof setTimeout> | undefined
  try {
    let offset = await partialBytes(partial)
    if (offset > asset.bytes) offset = 0
    const available = await availableBytes(request.directory)
    const required = asset.bytes - offset + request.diskMarginBytes
    if (available < required) throw new ReflexDiskError(required, available)
    let digest = createHash('sha256')
    if (offset > 0) for await (const chunk of createReadStream(partial, { end: offset - 1, signal })) digest.update(chunk as Buffer)
    let completed = offset, reported = -Infinity
    const emit = (): void => {
      clearTimeout(trailing)
      trailing = undefined
      reported = performance.now()
      request.report(completed, source)
    }
    // A throttled count is published when the interval ends, so a stalled body still shows its last bytes.
    const progress = (): void => {
      const wait = reported + request.progressIntervalMs - performance.now()
      if (completed === offset || completed === asset.bytes || wait <= 0) emit()
      else trailing ??= setTimeout(emit, wait)
    }
    progress()
    if (offset < asset.bytes) {
      using headers = deadline(stall.signal, request.stallTimeoutMs, STALL)
      const response = await fetch(url, { headers: offset > 0 ? { range: `bytes=${offset}-` } : {}, signal: headers.signal })
      headers[Symbol.dispose]()
      if (response.status === 200) {
        offset = completed = 0
        digest = createHash('sha256')
      }
      if (response.body === null || response.status !== 200 && (response.status !== 206 || rangeStart(response) !== offset)) {
        await response.body?.cancel()
        throw new ReflexDownloadError({ reason: 'http', source, status: response.status })
      }
      const body = response.body[Symbol.asyncIterator]()
      async function* chunks(): AsyncGenerator<Uint8Array> {
        for (let next = await stall.next(body); next.done !== true; next = await stall.next(body)) {
          completed += next.value.length
          if (completed > asset.bytes) throw new ReflexDownloadError({ reason: 'integrity', source })
          digest.update(next.value)
          progress()
          yield next.value
        }
      }
      // Opening before streaming means no deferred open can recreate the file after a failed attempt removes it.
      const output = await open(partial, offset > 0 ? 'a' : 'w', 0o600)
      await pipeline(chunks, output.createWriteStream(), { signal: stall.signal })
    }
    request.verifying()
    if (completed !== asset.bytes || digest.digest('hex') !== asset.sha256) throw new ReflexDownloadError({ reason: 'integrity', source })
    signal.throwIfAborted()
    await rename(partial, destination)
    return destination
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof ReflexDiskError) throw error
    const failure = error instanceof ReflexDownloadError ? error
      : new ReflexDownloadError({ source, ...timeoutOf(stall.signal, STALL) ? { reason: 'timeout' } : classifyFailure(error) }, { cause: error })
    if (failure.download.reason === 'integrity') await rm(partial, { force: true })
    throw failure
  } finally {
    clearTimeout(trailing)
  }
}

function rangeStart(response: Response): number | undefined {
  const match = /^bytes (\d+)-\d+\/(?:\d+|\*)$/.exec(response.headers.get('content-range') ?? '')
  return match === null ? undefined : Number(match[1])
}
