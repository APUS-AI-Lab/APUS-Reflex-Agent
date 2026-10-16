import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import { selectContinuumMemory } from '../packages/experimental/continuum-jev/src/index.ts'

/** Strict live Jev acceptance: missing configuration is a failure, never a skip. */
async function main(): Promise<void> {
  const endpoint = process.env.CONTINUUM_JEV_ENDPOINT
  const apiKey = process.env.CONTINUUM_JEV_API_KEY
  const model = process.env.CONTINUUM_JEV_MODEL
  if (endpoint === undefined || apiKey === undefined || model === undefined) {
    throw new Error('continuum-live-e2e requires CONTINUUM_JEV_ENDPOINT, CONTINUUM_JEV_API_KEY, and CONTINUUM_JEV_MODEL')
  }
  const context = new Context()
  try {
    await context.plugin(Jev, {
      endpoint,
      model,
      effort: 'low',
      timeoutMs: 30_000,
      apiKeyEnv: 'CONTINUUM_JEV_API_KEY',
    })
    const startedAt = performance.now()
    const result = await selectContinuumMemory(context.jev, { mode: 'active', timeoutMs: 30_000, maxRequestBytes: 32_768, sessionDataClasses: ['workspace'],
      privacyPolicy: { mode: 'controlled', approvedRemoteIds: ['system-one'], approvedRemoteDataClasses: ['workspace'] } }, {
      query: 'Choose the migration schedule memory.',
      candidates: [
        { id: MemoryId('migration'), label: 'Migration schedule', excerpt: 'The migration is scheduled for Friday.', score: 0.8, tags: [] },
        { id: MemoryId('unrelated'), label: 'Unrelated note', excerpt: 'The office is closed on Monday.', score: 0.2, tags: [] },
      ],
    })
    if (result.outcome !== 'jev' || result.selectedIds.length !== 2) {
      throw new Error(`live Jev did not retain both candidates: ${result.outcome}`)
    }
    if (result.evaluation.request?.model !== model) throw new Error(`live Jev model was not pinned: ${result.evaluation.request?.model ?? 'missing'}`)
    console.log(JSON.stringify({
      outcome: result.outcome, selectedIds: result.selectedIds, model: result.evaluation.request.model,
      latencyMs: Math.round(performance.now() - startedAt),
    }))
  } finally {
    await context.fiber.dispose()
  }
}

await main()
