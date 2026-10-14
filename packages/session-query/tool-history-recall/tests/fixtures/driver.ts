#!/usr/bin/env node
/** Test driver that fills one Headless session past its window, then asks for a compacted detail. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('history-recall driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'history-recall-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'Remember the access code ALPHA-7731 for later.' })
  for (let turn = 0; turn < 4; turn += 1) await runFixtureTurn(ctx, { task: `Padding request ${turn}.` })
  const answer = await runFixtureTurn(ctx, { task: 'What was the access code?' })
  const log = await ctx.sessionQuery.readSession(SessionId(answer.sessionId))
  process.stdout.write(`ANSWER ${JSON.stringify(answer.output)}\nEVENTS ${JSON.stringify(log.events)}\n`)
} finally {
  await ctx.fiber.dispose()
}
