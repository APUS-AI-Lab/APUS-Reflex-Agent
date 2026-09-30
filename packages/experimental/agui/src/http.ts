/** Small node:http helpers: bearer admission, bounded JSON bodies, JSON replies. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

/** A request the bridge refuses, with the HTTP status it answers. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * Whether the request carries the configured bearer token.
 * @param req - incoming HTTP request.
 * @param token - deployment bearer token.
 * @returns Whether the bearer token matches exactly.
 */
export function admitted(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const presented = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

/**
 * Read a JSON body no larger than `maxBytes`.
 * @param req - incoming HTTP body stream.
 * @param maxBytes - maximum accepted body size.
 * @returns Parsed JSON, or an empty object for an empty body; rejects oversized or invalid JSON.
 */
export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) throw new HttpError(413, 'request body too large')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return body
  } catch {
    throw new HttpError(400, 'invalid JSON body')
  }
}

/**
 * Answer with a JSON document.
 * @param res - response to finish.
 * @param status - HTTP response status.
 * @param body - JSON-serializable response value.
 */
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Narrow an unknown body to a plain object.
 * @param body - parsed request value.
 * @returns The object; throws HTTP 400 for null, arrays or primitives.
 */
export function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'expected a JSON object')
  return body as Record<string, unknown>
}
