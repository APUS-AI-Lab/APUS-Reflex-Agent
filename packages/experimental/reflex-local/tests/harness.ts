/** Shared fixtures: temporary roots, a wrapper launching the fake runner, and loopback HTTP servers owned by each test. */
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onTestFinished } from 'vitest'
import type { ModelAsset } from '../src/download.ts'

/** @returns a private temporary directory removed after the current test. */
export async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reflex-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

/**
 * Write an executable wrapper that runs the fake llama-server with fixed fixture variables.
 * @returns the wrapper path and the request log path.
 */
export async function fakeRunner(root: string, env: Record<string, string> = {}): Promise<{ path: string; log: string }> {
  const log = join(root, 'runner.log')
  const fixture = fileURLToPath(new URL('./fake-llama-server.fixture.mjs', import.meta.url))
  const exports = Object.entries({ FAKE_LOG: log, ...env }).map(([name, value]) => `export ${name}='${value}'`)
  const path = join(root, 'llama-server')
  await writeFile(path, ['#!/bin/sh', ...exports, `exec '${process.execPath}' '${fixture}' "$@"`, ''].join('\n'))
  await chmod(path, 0o755)
  return { path, log }
}

/** @returns parsed JSON lines the fake runner appended. */
export async function runnerLog(
  log: string,
): Promise<Array<{ event: string; argv?: string[]; key?: string; body?: Record<string, unknown> }>> {
  const text = await readFile(log, 'utf8').catch(() => '')
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as { event: string })
}

/**
 * Start a loopback HTTP server closed after the current test.
 * @returns its origin.
 */
export async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

/** @returns a pinned asset describing `bytes`. */
export function assetOf(name: string, bytes: Buffer, origin = 'https://huggingface.co'): ModelAsset {
  return { name, url: `${origin}/owner/model/resolve/rev/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/**
 * Serve `bytes` with HTTP Range support; `options.ignoreRange` answers 200 to every request.
 * @returns the origin and every received Range header (`''` when absent).
 */
export async function weightsServer(
  bytes: Buffer, options: { ignoreRange?: boolean; wrongStart?: boolean } = {},
): Promise<{ origin: string; ranges: string[] }> {
  const ranges: string[] = []
  const origin = await serve((request, response) => {
    if (request.method === 'HEAD') { response.writeHead(200).end(); return }
    const range = request.headers.range ?? ''
    ranges.push(range)
    const match = /^bytes=(\d+)-$/.exec(range)
    if (match === null || options.ignoreRange) { response.writeHead(200, { 'content-length': bytes.length }).end(bytes); return }
    const start = Number(match[1]) + (options.wrongStart ? 1 : 0)
    response.writeHead(206, { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` }).end(bytes.subarray(start))
  })
  return { origin, ranges }
}
