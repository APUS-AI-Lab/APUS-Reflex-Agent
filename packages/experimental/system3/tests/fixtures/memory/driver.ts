#!/usr/bin/env node
/** Test driver: a local System One gateway scores compacted messages for one Headless session. */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('memory driver requires a config path')

interface WireQuestion { readonly type: string; readonly instructions?: string }

/** Every request the gateway received, as the wire carried it. */
const received: unknown[] = []
const gateway = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
  request.on('end', () => {
    const parsed = JSON.parse(body) as { questions: Record<string, WireQuestion>; model: string }
    received.push({ url: request.url, body: parsed })
    // A literal access code is the only thing this gateway judges worth keeping.
    const answers = Object.fromEntries(Object.entries(parsed.questions).map(([key, question]) =>
      [key, { type: 'noul', noul: /ALPHA-\d+/u.test(question.instructions ?? '') ? 0.93 : 0.04 }]))
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ model: parsed.model, answers, usage: { inputTokens: 10, outputTokens: 1 } }))
  })
})
await new Promise<void>((resolve) => { gateway.listen(0, '127.0.0.1', resolve) })
process.env.MEMORY_E2E_JEV_ENDPOINT = `http://127.0.0.1:${String((gateway.address() as AddressInfo).port)}`

const ctx = await bootProductionProfile({
  binName: 'memory-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'Remember the access code ALPHA-7731 for later.' })
  await runFixtureTurn(ctx, { task: 'Padding request: thanks, keep going.' })
  for (let turn = 0; turn < 4; turn += 1) await runFixtureTurn(ctx, { task: `Padding request ${String(turn)}.` })
  const answer = await runFixtureTurn(ctx, { task: 'What was the access code?' })
  const log = await ctx.sessionQuery.readSession(SessionId(answer.sessionId))
  process.stdout.write(`ANSWER ${JSON.stringify(answer.output)}\nJEV ${JSON.stringify(received)}\nEVENTS ${JSON.stringify(log.events)}\n`)
} finally {
  await ctx.fiber.dispose()
  gateway.close()
}
