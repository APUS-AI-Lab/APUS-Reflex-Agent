/** Resumable verified downloads against loopback servers, including Range resume, restart, integrity, disk, and cancellation. */
import { readFile, rename, statfs, mkdir, writeFile, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { TimeoutReason } from '@deepseek-ai/dsh-timeout'
import { afterEach, expect, it, vi } from 'vitest'
import {
  availableBytes, classifyFailure, downloadModel, fileInfo, matchesAsset, orderSources, partialBytes, partialPath,
  ReflexDiskError, ReflexDownloadError, type DownloadRequest, type ModelAsset,
} from '../src/download.ts'
import { assetOf, serve, temporaryRoot, weightsServer } from './harness.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename), statfs: vi.fn(actual.statfs) }
})
afterEach(() => { vi.restoreAllMocks(); vi.mocked(rename).mockClear(); vi.mocked(statfs).mockClear() })

const bytes = Buffer.from('reflex weights fixture '.repeat(64))

function request(asset: ModelAsset, directory: string, urls: string[], overrides: Partial<DownloadRequest> = {}) {
  const reports: number[] = []
  const phases: string[] = []
  const options: DownloadRequest = {
    asset, directory, urls, stallTimeoutMs: 5000, diskMarginBytes: 0, progressIntervalMs: 60_000,
    signal: new AbortController().signal,
    report: (completed) => { reports.push(completed); phases.push('downloading') },
    verifying: () => { phases.push('verifying') },
    ...overrides,
  }
  return { options, reports, phases }
}

it('downloads, verifies, and publishes the file atomically with owner-only permissions', async () => {
  const root = await temporaryRoot(), { origin, ranges } = await weightsServer(bytes)
  const asset = assetOf('model.gguf', bytes, origin)
  const { options, reports, phases } = request(asset, join(root, 'models'), [asset.url])
  const path = await downloadModel(options)
  expect(await readFile(path)).toEqual(bytes)
  expect(ranges).toEqual([''])
  expect(reports).toEqual([0, bytes.length])
  expect(phases.at(-1)).toBe('verifying')
  expect((await stat(join(root, 'models'))).mode & 0o777).toBe(0o700)
  expect(await fileInfo(partialPath(join(root, 'models'), asset))).toBeUndefined()
  expect(await matchesAsset(path, asset, new AbortController().signal)).toBe(true)
  expect(await matchesAsset(join(root, 'absent'), asset, new AbortController().signal)).toBe(false)
  expect(await matchesAsset(path, { ...asset, sha256: '0'.repeat(64) }, new AbortController().signal)).toBe(false)
  expect(await matchesAsset(path, { ...asset, bytes: 1 }, new AbortController().signal)).toBe(false)
})

it('resumes retained bytes with a 206 range and hashes the retained prefix', async () => {
  const root = await temporaryRoot(), { origin, ranges } = await weightsServer(bytes)
  const asset = assetOf('model.gguf', bytes, origin)
  await writeFile(partialPath(root, asset), bytes.subarray(0, 100))
  expect(await partialBytes(partialPath(root, asset))).toBe(100)
  const { options, reports } = request(asset, root, [asset.url])
  expect(await readFile(await downloadModel(options))).toEqual(bytes)
  expect(ranges).toEqual(['bytes=100-'])
  expect(reports[0]).toBe(100)
})

it('restarts from byte zero when the source ignores the range', async () => {
  const root = await temporaryRoot(), { origin, ranges } = await weightsServer(bytes, { ignoreRange: true })
  const asset = assetOf('model.gguf', bytes, origin)
  await writeFile(partialPath(root, asset), Buffer.from('stale prefix'))
  expect(await readFile(await downloadModel(request(asset, root, [asset.url]).options))).toEqual(bytes)
  expect(ranges).toEqual(['bytes=12-'])
})

it('rejects a 206 that starts elsewhere and keeps the partial file', async () => {
  const root = await temporaryRoot(), { origin } = await weightsServer(bytes, { wrongStart: true })
  const asset = assetOf('model.gguf', bytes, origin)
  await writeFile(partialPath(root, asset), bytes.subarray(0, 10))
  await expect(downloadModel(request(asset, root, [asset.url]).options)).rejects.toMatchObject({
    download: { reason: 'http', status: 206, source: origin },
  })
  expect(await partialBytes(partialPath(root, asset))).toBe(10)
  const unlabeled = await serve((_request, response) => { response.writeHead(206).end(bytes.subarray(10)) })
  await expect(downloadModel(request(asset, root, [`${unlabeled}/x`]).options)).rejects.toMatchObject({ download: { reason: 'http', status: 206 } })
})

it('verifies a complete partial file without a request and discards an oversized one', async () => {
  const root = await temporaryRoot(), { origin, ranges } = await weightsServer(bytes)
  const asset = assetOf('model.gguf', bytes, origin)
  await writeFile(partialPath(root, asset), bytes)
  expect(await readFile(await downloadModel(request(asset, root, [asset.url]).options))).toEqual(bytes)
  expect(ranges).toEqual([])
  await writeFile(partialPath(root, asset), Buffer.concat([bytes, bytes]))
  expect(await readFile(await downloadModel(request(asset, root, [asset.url]).options))).toEqual(bytes)
  expect(ranges).toEqual([''])
})

it('deletes corrupt or oversized bodies and fails integrity after the last source', async () => {
  const root = await temporaryRoot()
  const origin = await serve((_request, response) => { response.writeHead(200).end(Buffer.alloc(bytes.length)) })
  const asset = assetOf('model.gguf', bytes, origin)
  await expect(downloadModel(request(asset, root, [asset.url]).options)).rejects.toMatchObject({ download: { reason: 'integrity' } })
  expect(await fileInfo(partialPath(root, asset))).toBeUndefined()
  const long = await serve((_request, response) => { response.writeHead(200).end(Buffer.concat([bytes, bytes])) })
  await expect(downloadModel(request({ ...asset, url: `${long}/x` }, root, [`${long}/x`]).options)).rejects.toMatchObject({ download: { reason: 'integrity' } })
  expect(await fileInfo(partialPath(root, asset))).toBeUndefined()
})

it('falls back to the next source after HTTP, empty-body, and network failures', async () => {
  const root = await temporaryRoot(), { origin } = await weightsServer(bytes)
  const failing = await serve((request, response) => {
    if (request.url?.endsWith('empty')) response.writeHead(204).end()
    else response.writeHead(503).end('unavailable')
  })
  const asset = assetOf('model.gguf', bytes, origin)
  const urls = [`${failing}/a`, `${failing}/empty`, 'http://127.0.0.1:1/unreachable', asset.url]
  expect(await readFile(await downloadModel(request(asset, root, urls).options))).toEqual(bytes)
  await expect(downloadModel(request(asset, await temporaryRoot(), [`${failing}/a`]).options)).rejects.toMatchObject({
    download: { reason: 'http', status: 503, source: failing },
  })
})

it('stops without trying other sources after a storage or unclassified failure', async () => {
  const { origin, ranges } = await weightsServer(bytes)
  const asset = assetOf('model.gguf', bytes, origin)
  for (const code of ['EACCES', 'EUNKNOWN']) {
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('cannot publish'), { code }))
    await expect(downloadModel(request(asset, await temporaryRoot(), [asset.url, asset.url]).options)).rejects.toMatchObject({
      download: { reason: code === 'EACCES' ? 'storage' : 'unknown' },
    })
  }
  expect(ranges).toHaveLength(2)
})

it('refuses to start when the volume cannot hold the remaining bytes plus the margin', async () => {
  const root = await temporaryRoot(), { origin, ranges } = await weightsServer(bytes)
  const asset = assetOf('model.gguf', bytes, origin)
  await writeFile(partialPath(root, asset), bytes.subarray(0, 100))
  vi.mocked(statfs).mockResolvedValueOnce({ bavail: 10, bsize: 100 } as Awaited<ReturnType<typeof statfs>>)
  const failure = downloadModel(request(asset, root, [asset.url, asset.url], { diskMarginBytes: 1000 }).options)
  await expect(failure).rejects.toBeInstanceOf(ReflexDiskError)
  await expect(failure).rejects.toMatchObject({ requiredBytes: bytes.length - 100 + 1000, availableBytes: 1000 })
  expect(ranges).toEqual([])
})

it('keeps the partial file when paused mid-body and reports a stalled body as a timeout', async () => {
  const root = await temporaryRoot(), abort = new AbortController()
  const origin = await serve((_request, response) => { response.writeHead(200); response.write(bytes.subarray(0, 50)) })
  const asset = assetOf('model.gguf', bytes, origin)
  const paused = downloadModel(request(asset, root, [asset.url], {
    signal: abort.signal, progressIntervalMs: 0,
    report: (completed) => { if (completed === 50) setImmediate(() => { abort.abort(new Error('paused')) }) },
  }).options)
  await expect(paused).rejects.toThrow('paused')
  expect((await fileInfo(partialPath(root, asset)))?.isFile()).toBe(true)
  await expect(downloadModel(request(asset, root, [asset.url], { stallTimeoutMs: 50 }).options)).rejects.toMatchObject({
    download: { reason: 'timeout', source: origin },
  })
})

it('publishes a throttled byte count when the progress interval ends', async () => {
  const origin = await serve((_request, response) => {
    response.writeHead(200)
    response.write(bytes.subarray(0, 10))
    setTimeout(() => { response.write(bytes.subarray(10, 20)) }, 5)
  })
  const asset = assetOf('model.gguf', bytes, origin), abort = new AbortController()
  const { options, reports } = request(asset, await temporaryRoot(), [asset.url], { signal: abort.signal, progressIntervalMs: 200 })
  const pending = downloadModel(options)
  await vi.waitFor(() => { expect(reports.at(-1)).toBe(20) })
  expect(reports).toEqual([0, 20])
  abort.abort(new Error('paused'))
  await expect(pending).rejects.toThrow('paused')
})

it('reports a source that sends no headers within the stall deadline as a timeout', async () => {
  const origin = await serve(() => {})
  const asset = assetOf('model.gguf', bytes, origin)
  await expect(downloadModel(request(asset, await temporaryRoot(), [asset.url], { stallTimeoutMs: 50 }).options)).rejects.toMatchObject({
    download: { reason: 'timeout' },
  })
})

it('measures free space at the nearest existing ancestor and treats non-files as empty partials', async () => {
  const root = await temporaryRoot()
  expect(await availableBytes(join(root, 'a', 'b'))).toBeGreaterThan(0)
  vi.mocked(statfs).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(availableBytes(root)).rejects.toThrow('denied')
  await mkdir(join(root, 'directory.part'))
  expect(await partialBytes(join(root, 'directory.part'))).toBe(0)
  await symlink(join(root, 'nowhere'), join(root, 'link.part'))
  expect(await partialBytes(join(root, 'link.part'))).toBe(0)
  await expect(fileInfo(join(root, 'directory.part', '\0'))).rejects.toThrow()
})

it('prefers the first responding origin and keeps configured order when every probe fails', async () => {
  const slow = await serve(() => {})
  const failing = await serve((_request, response) => { response.writeHead(405).end() })
  const fast = await serve((_request, response) => { response.writeHead(200).end() })
  const path = '/owner/model/resolve/rev/model.gguf'
  const signal = new AbortController().signal
  expect(await orderSources(`https://huggingface.co${path}`, [slow, failing, fast], 1000, signal))
    .toEqual([`${fast}${path}`, `${slow}${path}`, `${failing}${path}`])
  expect(await orderSources(`https://huggingface.co${path}`, [slow, failing], 50, signal)).toEqual([`${slow}${path}`, `${failing}${path}`])
  expect(await orderSources(`https://huggingface.co${path}`, [fast, `${fast}/`], 50, signal)).toEqual([`${fast}${path}`])
  await expect(orderSources(`https://huggingface.co${path}`, [fast], 50, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
  const cancel = new AbortController()
  const pending = orderSources(`https://huggingface.co${path}`, [slow, failing], 5000, cancel.signal)
  cancel.abort(new Error('stopped'))
  await expect(pending).rejects.toThrow('stopped')
})

it('classifies nested network, filesystem, certificate, and timeout causes', () => {
  const coded = (code: string): Error => Object.assign(new Error(code), { code })
  expect(classifyFailure(new TypeError('fetch failed', { cause: coded('ENOTFOUND') }))).toEqual({ reason: 'dns', code: 'ENOTFOUND' })
  expect(classifyFailure(new TypeError('fetch failed', { cause: new AggregateError([new Error('x'), coded('ECONNREFUSED')]) })))
    .toEqual({ reason: 'network', code: 'ECONNREFUSED' })
  expect(classifyFailure(coded('UND_ERR_HEADERS_TIMEOUT'))).toEqual({ reason: 'timeout', code: 'UND_ERR_HEADERS_TIMEOUT' })
  expect(classifyFailure(coded('ETIMEDOUT'))).toEqual({ reason: 'timeout', code: 'ETIMEDOUT' })
  expect(classifyFailure(coded('DEPTH_ZERO_SELF_SIGNED_CERT'))).toEqual({ reason: 'certificate', code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  expect(classifyFailure(coded('ENOSPC'))).toEqual({ reason: 'storage', code: 'ENOSPC' })
  expect(classifyFailure(new TimeoutReason('X', 1))).toEqual({ reason: 'timeout' })
  expect(classifyFailure(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toEqual({ reason: 'timeout' })
  expect(classifyFailure(new TypeError('fetch failed'))).toEqual({ reason: 'network' })
  expect(classifyFailure(coded('EOTHER'))).toEqual({ reason: 'unknown' })
  expect(classifyFailure('text')).toEqual({ reason: 'unknown' })
  const cyclic: Error & { cause?: unknown } = new Error('cycle')
  cyclic.cause = cyclic
  expect(classifyFailure(cyclic)).toEqual({ reason: 'unknown' })
  expect(new ReflexDownloadError({ reason: 'http', source: 'https://hf.example', status: 404, code: 'X' }).message).toBe(
    'Reflex weights download from https://hf.example failed: http (X) (HTTP 404)')
})
