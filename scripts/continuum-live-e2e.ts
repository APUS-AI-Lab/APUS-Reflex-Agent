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
    const result = await selectContinuumMemory(context.jev, { mode: 'active', minConfidence: 0.5 }, {
      query: 'Choose the migration schedule memory.',
      candidates: [
        { id: MemoryId('migration'), label: 'Migration schedule', excerpt: 'The migration is scheduled for Friday.', score: 0.8 },
        { id: MemoryId('unrelated'), label: 'Unrelated note', excerpt: 'The office is closed on Monday.', score: 0.2 },
      ],
    })
    if (result.outcome !== 'jev' || result.selectedIds.length !== 1) {
      throw new Error(`live Jev did not make one active selection: ${result.outcome}`)
    }
    if (result.request?.model !== model) throw new Error(`live Jev model was not pinned: ${result.request?.model ?? 'missing'}`)
    console.log(JSON.stringify({
      outcome: result.outcome, selectedIds: result.selectedIds, confidence: result.confidence, model: result.request.model,
    }))
  } finally {
    await context.fiber.dispose()
  }
}

await main()
