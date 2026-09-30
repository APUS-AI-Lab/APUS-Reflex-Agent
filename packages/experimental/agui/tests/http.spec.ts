/** Bounded JSON parsing through the native incoming HTTP stream. */

import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { describe, expect, it, onTestFinished } from 'vitest'
import { HttpError, readJson } from '../src/http.ts'

function request(body: string): IncomingMessage {
  const socket = new Socket()
  const req = new IncomingMessage(socket)
  onTestFinished(() => { req.destroy(); socket.destroy() })
  req.push(Buffer.from(body))
  req.push(null)
  return req
}

describe('AG-UI JSON body parsing', () => {
  it.each([
    ['', {}],
    ['{"message":"中文"}', { message: '中文' }],
    ['[1,true]', [1, true]],
    ['null', null],
    ['42', 42],
    ['"text"', 'text'],
  ])('preserves the parsed JSON value for %s', async (body, expected) => {
    await expect(readJson(request(body), 64)).resolves.toEqual(expected)
  })

  it('refuses malformed JSON with HTTP 400', async () => {
    await expect(readJson(request('{bad'), 64)).rejects.toMatchObject({
      name: 'HttpError', status: 400, message: 'invalid JSON body',
    })
  })

  it('counts UTF-8 bytes and refuses an oversized body before parsing', async () => {
    const req = request('"中文"')
    await expect(readJson(req, 7)).rejects.toEqual(new HttpError(413, 'request body too large'))
  })
})
