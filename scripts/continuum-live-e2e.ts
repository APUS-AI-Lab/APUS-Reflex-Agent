import { Context } from '@deepseek-ai/cordis'
import Jev from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { MemoryId } from '@deepseek-ai/dsh-continuum'
import {
  admissionBatchSize, admitContinuumMemory, selectContinuumMemory, type ContinuumJevConfig, type MemoryAdmissionCandidate,
} from '../packages/experimental/continuum-jev/src/index.ts'

const MESSAGES: readonly MemoryAdmissionCandidate[] = [
  { id: MemoryId('dentist'), content: '我下周五下午三点要去看牙医，到时候提醒我。' },
  { id: MemoryId('ack'), content: '好的，谢谢。' },
  { id: MemoryId('budget'), content: 'My budget for the new laptop is at most 1500 USD.' },
  { id: MemoryId('noise'), content: 'ok' },
]

/** Strict live Jev acceptance of ranking, admission, and threshold recall: missing configuration is a failure, never a skip. */
async function main(): Promise<void> {
  const endpoint = process.env.CONTINUUM_JEV_ENDPOINT
  const apiKey = process.env.CONTINUUM_JEV_API_KEY
  const model = process.env.CONTINUUM_JEV_MODEL
  if (endpoint === undefined || apiKey === undefined || model === undefined) {
    throw new Error('continuum-live-e2e requires CONTINUUM_JEV_ENDPOINT, CONTINUUM_JEV_API_KEY, and CONTINUUM_JEV_MODEL')
  }
  const config: ContinuumJevConfig = { mode: 'active', timeoutMs: 30_000, maxRequestBytes: 65_536, sessionDataClasses: ['workspace'],
    privacyPolicy: { mode: 'controlled', approvedRemoteIds: ['system-one'], approvedRemoteDataClasses: ['workspace'] } }
  const context = new Context()
  try {
    await context.plugin(Jev, {
      endpoint,
      model,
      effort: 'low',
      timeoutMs: 30_000,
      apiKeyEnv: 'CONTINUUM_JEV_API_KEY',
    })
    const rankStartedAt = performance.now()
    const rank = await selectContinuumMemory(context.jev, config, {
      query: 'Choose the migration schedule memory.',
      candidates: [
        { id: MemoryId('migration'), label: 'Migration schedule', excerpt: 'The migration is scheduled for Friday.', score: 0.8, tags: [] },
        { id: MemoryId('unrelated'), label: 'Unrelated note', excerpt: 'The office is closed on Monday.', score: 0.2, tags: [] },
      ],
    })
    const rankLatencyMs = Math.round(performance.now() - rankStartedAt)
    if (rank.outcome !== 'jev' || rank.selectedIds.length !== 2) {
      throw new Error(`live Jev did not retain both candidates: ${rank.outcome}`)
    }
    if (rank.evaluation.request?.model !== model) throw new Error(`live Jev model was not pinned: ${rank.evaluation.request?.model ?? 'missing'}`)

    const admitted = new Map<string, readonly string[]>()
    const admissionLatencyMs: number[] = []
    const size = admissionBatchSize(config)
    for (let start = 0; start < MESSAGES.length; start += size) {
      const startedAt = performance.now()
      const receipt = await admitContinuumMemory(context.jev, config, { candidates: MESSAGES.slice(start, start + size) })
      admissionLatencyMs.push(Math.round(performance.now() - startedAt))
      if (receipt.outcome !== 'jev') throw new Error(`live Jev admission fell back: ${receipt.reason} ${receipt.failure ?? ''}`)
      receipt.admittedIds.forEach((id, index) => admitted.set(id, receipt.admittedTags[index] ?? []))
    }
    const failures: string[] = []
    for (const id of ['dentist', 'budget']) if (!admitted.has(id)) failures.push(`admission skipped ${id}`)
    for (const id of ['ack', 'noise']) if (admitted.has(id)) failures.push(`admission indexed chatter ${id}`)

    const recallStartedAt = performance.now()
    const recall = await selectContinuumMemory(context.jev, { ...config, selection: 'threshold' }, {
      query: 'When is my dentist appointment?',
      candidates: MESSAGES.filter(message => admitted.has(message.id)).map(message => ({
        id: message.id, label: message.id, excerpt: message.content, score: 0.5, tags: admitted.get(message.id) ?? [],
      })),
    })
    const recallLatencyMs = Math.round(performance.now() - recallStartedAt)
    if (recall.outcome !== 'jev') failures.push(`threshold recall fell back: ${recall.failure ?? recall.outcome}`)
    if (!recall.selectedIds.includes(MemoryId('dentist'))) failures.push('threshold recall dropped dentist')
    if (recall.selectedIds.includes(MemoryId('budget'))) failures.push('threshold recall kept unrelated budget')

    console.log(JSON.stringify({
      model: rank.evaluation.request.model,
      rank: { outcome: rank.outcome, selectedIds: rank.selectedIds, latencyMs: rankLatencyMs },
      admission: { admitted: Object.fromEntries(admitted), latencyMs: admissionLatencyMs },
      recall: { outcome: recall.outcome, selectedIds: recall.selectedIds, latencyMs: recallLatencyMs },
      failures,
    }))
    if (failures.length > 0) throw new Error(`live Jev memory round trip failed: ${failures.join('; ')}`)
  } finally {
    await context.fiber.dispose()
  }
}

await main()
