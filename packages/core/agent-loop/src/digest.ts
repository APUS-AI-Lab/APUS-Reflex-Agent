/**
 * Stable digests for durable request and pre-step records.
 *
 * @module dsh-agent-loop/digest
 */

import { createHash } from 'node:crypto'

/**
 * Digest one UTF-8 string as lowercase hexadecimal SHA-256.
 * @param text - exact text to hash.
 * @returns 64-character lowercase hex digest.
 */
export function digestText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Digest a JSON value by hashing its `JSON.stringify` text.
 * @param value - losslessly JSON-serializable value.
 * @returns 64-character lowercase hex digest.
 */
export function digestJson(value: unknown): string {
  return digestText(JSON.stringify(value))
}
