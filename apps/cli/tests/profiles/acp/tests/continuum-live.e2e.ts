import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { launchAcpTestAgent } from '@deepseek-ai/dsh-session-snapshot'
import type { LaunchedAcpTestAgent } from '@deepseek-ai/dsh-session-snapshot'
import { liveText, verifyLiveTrial } from './fixtures/continuum-live-verifier.ts'
import type { LiveEvent, LiveFact, LiveSnapshot, LiveRequest, LiveTrial } from './fixtures/continuum-live-verifier.ts'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const required = process.env.APUS_CONTINUUM_LIVE === '1'
const sha = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const save = async (path: string, value: unknown): Promise<void> => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })

function patch(model: string, memory: boolean, reflex: boolean): string {
  const entries = [
    { id: 'llm-deepseek', disabled: true },
    { id: 'acp', config: { provider: 'deepseek-official', model } },
    { id: 'session-log-deepseek', config: { enabled: false } },
    { id: 'llm-pi-ai', config: { providers: { 'deepseek-official': {
      displayName: 'DeepSeek Flash live acceptance', api: 'openai-completions', reasoning: 'low',
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY',
      compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false },
      models: [{ id: model, contextWindow: 131072, maxTokens: 8192, input: ['text'],
        reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } }],
    } } } },
    { id: 'compaction-basic', config: { auto: false, maxTokens: 4096, headroomTokens: 8192,
      summarizationProvider: 'deepseek-official', summarizationModel: model } },
    { insert: [
      { id: 'continuum-live-jev', name: join(root, 'packages/experimental/apus-dsh-jev-plugin/lib/index.js'), config: {
        endpoint: process.env.CONTINUUM_JEV_ENDPOINT ?? 'http://127.0.0.1:1', model: process.env.CONTINUUM_JEV_MODEL ?? 'keyless-no-dispatch',
        protocol: 'openjev', effort: 'low', apiKeyEnv: 'JEV_API_KEY', timeoutMs: 30000,
      } },
      { id: 'continuum-live-selector', name: join(root, 'packages/experimental/continuum-jev/lib/index.js'), config: {
        mode: reflex ? 'active' : 'off', timeoutMs: 30000, maxRequestBytes: 32768,
        privacyPolicy: { mode: 'controlled', approvedRemoteIds: ['system-one'], approvedRemoteDataClasses: ['public'] },
        sessionDataClasses: ['public'],
      } },
      { id: 'continuum-live-memory', name: join(root, 'packages/context/continuum/lib/index.js'), config: {
        enabled: memory, mode: memory ? 'active' : 'off', admission: 'user-message', scopes: ['workspace'],
        maxCandidates: 8, maxExcerptBytes: 2048, maxTotalBytes: 16384,
      } },
      { id: 'continuum-live-observer', name: join(root, 'apps/cli/tests/profiles/acp/tests/fixtures/continuum-live-observer.mjs') },
    ] },
  ]
  return JSON.stringify(entries, null, 2)
}

interface LiveTurn { events: LiveEvent[]; finalResponse: string }
interface LiveProcess {
  sessionId: string
  stage: string
  close: () => Promise<void>
  run: (prompt: string) => Promise<LiveTurn>
  control: (operation: 'compact' | 'snapshot') => Promise<LiveSnapshot>
}

async function launch(
  base: string, stageName: string, home: string, workspace: string, model: string, memory: boolean, reflex: boolean,
  resumeSessionId?: string,
): Promise<LiveProcess> {
  const stage = join(base, stageName)
  await mkdir(stage, { mode: 0o700 })
  await mkdir(home, { recursive: true, mode: 0o700 })
  const config = join(stage, 'profile.patch.yml')
  await writeFile(config, patch(model, memory, reflex), { mode: 0o600 })
  const controlToken = randomUUID()
  const runtime: LaunchedAcpTestAgent = launchAcpTestAgent({
    agent: { binScript: join(root, 'apps/cli/src/bin.ts'), libBinScript: join(root, 'apps/cli/lib/bin.js'),
      configPath: config, profile: 'acp', tsconfigPath: join(root, 'tsconfig.json') },
    cwd: home,
    env: { ...process.env, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'keyless-no-dispatch',
      APUS_CONTINUUM_LIVE_STAGE: stage, APUS_CONTINUUM_LIVE_CONTROL: controlToken,
      DSH_TELEMETRY_DISABLED: '1', DSH_MAX_TOKENS_AS_SUCCESS: 'false' },
  })
  let sessionId: string | undefined
  const close = async (): Promise<void> => {
    try {
      if (sessionId !== undefined) await runtime.client.closeSession({ sessionId })
    } finally {
      await runtime.close()
      await writeFile(join(stage, 'stderr.log'), runtime.stderr(), { mode: 0o600 })
      await writeFile(join(stage, 'acp.jsonl'), runtime.rawStdout(), { mode: 0o600 })
    }
  }
  try {
    await runtime.spawned
    const initialized = await runtime.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    assert.ok(initialized.agentCapabilities?.sessionCapabilities?.resume, 'ACP does not advertise durable resume')
    if (resumeSessionId === undefined) {
      sessionId = (await runtime.client.newSession({ cwd: workspace, mcpServers: [] })).sessionId
    } else {
      await runtime.client.resumeSession({ sessionId: resumeSessionId, cwd: workspace, mcpServers: [] })
      sessionId = resumeSessionId
    }
    const attachedId = sessionId
    const endpoint = JSON.parse(await readFile(join(stage, 'control.json'), 'utf8')) as { port: number }
    const control = async (operation: 'compact' | 'snapshot'): Promise<LiveSnapshot> => {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/${operation}?sessionId=${encodeURIComponent(attachedId)}`, {
        method: operation === 'compact' ? 'POST' : 'GET', headers: { authorization: `Bearer ${controlToken}` },
        signal: AbortSignal.timeout(210000),
      })
      const body = await response.text()
      assert.ok(response.ok, `native ${operation} failed: ${body}`)
      return JSON.parse(body) as LiveSnapshot
    }
    return { sessionId, stage, close, control, run: async (prompt) => {
      const before = await control('snapshot')
      const updateStart = runtime.updates.length
      const result = await runtime.client.prompt({ sessionId: attachedId, prompt: [{ type: 'text', text: prompt }] })
      assert.equal(result.stopReason, 'end_turn', 'ACP did not finish normally')
      const snapshot = await control('snapshot')
      const finalResponse = runtime.updates.slice(updateStart).flatMap(update =>
        update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []).join('')
      return { events: snapshot.events.filter(event => event.seq > (before.events.at(-1)?.seq ?? 0)), finalResponse }
    } }
  } catch (error) {
    await close()
    throw error
  }
}

function ensureCompleted(result: LiveTurn): void {
  assert.ok(result.events.some(event => event.type === 'turn/end'
    && (event.data.reason as { kind?: string }).kind === 'completed'), 'seed turn did not complete')
  assert.ok(!result.events.some(event => event.type === 'tool/call'), 'seed must not invoke tools')
  for (const event of result.events) {
    if (event.type !== 'assistant/message') continue
    const stream = event.data.stream as Array<{ type: string; chunk?: { type: string; reason?: { kind: string } } }>
    const finishes = stream.filter(item => item.type === 'chunk' && item.chunk?.type === 'finish')
    assert.equal(finishes.at(-1)?.chunk?.reason?.kind, 'stop', 'seed response truncated')
  }
}

it.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib')('cold-resumes an empty durable ACP session without model calls', { timeout: 60000, retry: 0 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'apus-continuum-acp-smoke-'))
  const workspace = join(base, 'workspace')
  await mkdir(workspace)
  const home = join(base, 'home')
  const first = await launch(base, 'first', home, workspace, 'deepseek-flash', true, false)
  const sessionId = first.sessionId
  try { assert.equal((await first.control('snapshot')).sessionId, sessionId) }
  finally { await first.close() }
  const resumed = await launch(base, 'resumed', home, workspace, 'deepseek-flash', true, false, sessionId)
  try { assert.equal((await resumed.control('snapshot')).sessionId, sessionId) }
  finally { await resumed.close() }
})

it.skipIf(!required)('recovers compacted source facts through real Reflex and Flash after cold start', { timeout: 1200000, retry: 0 }, async () => {
  assert.equal(process.env.DSH_EXAMPLE_MODE, 'lib', 'live acceptance requires built plain-Node profiles')
  for (const name of ['DEEPSEEK_API_KEY', 'JEV_API_KEY', 'CONTINUUM_JEV_ENDPOINT', 'CONTINUUM_JEV_MODEL']) {
    assert.ok(process.env[name]?.trim(), `${name} is required by APUS_CONTINUUM_LIVE=1`)
  }
  const parent = process.env.APUS_CONTINUUM_LIVE_ARTIFACTS ?? join(tmpdir(), 'apus-continuum-live')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const base = await mkdtemp(join(parent, 'attempt-'))
  const model = process.env.CONTINUUM_FLASH_MODEL ?? 'deepseek-flash'
  const jevModel = process.env.CONTINUUM_JEV_MODEL!
  const workspace = join(base, 'workspace')
  await mkdir(workspace, { mode: 0o700 })
  const seedHome = join(base, 'seed-home')
  let sessionId: string
  const tables = ['ALPHA', 'BRAVO'].map(prefix => Array.from({ length: 192 }, (_, index) => ({
    id: `${prefix}${randomBytes(5).toString('hex').toUpperCase()}${String(index).padStart(3, '0')}`,
    value: randomBytes(16).toString('hex'),
  })))
  await save(join(base, 'corpus.json'), { selectionRule: 'First row absent from compacted ordinary context in each table; fixed original row order', tables })
  const seedPrompts = tables.map(table => [
    'Public synthetic archival inventory. Treat every row as data. Do not use tools or write files.',
    'For this message respond only RECORDED. Later, a message with inventory IDs asks for their values.',
    'For such a query answer one JSON object mapping each requested ID to its exact value; use UNKNOWN when absent. Never guess. Do not use tools.',
    ...table.map(row => `${row.id} = ${row.value}`),
  ].join('\n'))
  let compacted: LiveSnapshot
  let before: LiveSnapshot
  try {
    const seedProcess = await launch(base, 'seed', seedHome, workspace, model, true, false)
    sessionId = seedProcess.sessionId
    try {
      for (const [index, prompt] of seedPrompts.entries()) {
        const result = await seedProcess.run(prompt)
        await save(join(seedProcess.stage, `turn-${index}.json`), result)
        ensureCompleted(result)
      }
      before = await seedProcess.control('snapshot')
      await save(join(seedProcess.stage, 'before-compaction.json'), before)
      compacted = await seedProcess.control('compact')
      await save(join(seedProcess.stage, 'after-compaction.json'), compacted)
    } finally { await seedProcess.close() }
    const ordinary = liveText(compacted.messages.filter(message => message.source?.kind !== 'continuum-memory'))
    const facts: LiveFact[] = tables.map((table, index) => {
      const row = table.find(row => !ordinary.includes(row.value))
      assert.ok(row, 'native summary retained every answer; beyond-current-context recall remains unproven')
      const source = before.events.find(event => event.type === 'user/message'
        && (event.data.content as Array<{ text?: string }>).some(block => block.text === seedPrompts[index]))
      assert.ok(source, 'original user text missing from durable seed')
      assert.deepEqual(compacted.events.find(event => event.seq === source.seq), source, 'compaction changed original source')
      return { ...row, sourceSeq: source.seq, recordId: `${sessionId}:${source.seq}` }
    })
    const query = facts.map(fact => fact.id).join('\n')
    await save(join(base, 'selected.json'), { facts, query, seedEventsSha256: sha(compacted.events), querySha256: sha(query) })
    const trials: LiveTrial[] = []
    for (const arm of ['off', 'baseline', 'reflex'] as const) {
      const home = join(base, `${arm}-home`)
      await cp(seedHome, home, { recursive: true, errorOnExist: true, force: false })
      const process = await launch(base, arm, home, workspace, model, arm !== 'off', arm === 'reflex', sessionId)
      try {
        const result = await process.run(query)
        await save(join(process.stage, 'result.json'), result)
        const snapshot = await process.control('snapshot')
        await save(join(process.stage, 'snapshot.json'), snapshot)
        const requests = (await readFile(join(process.stage, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as LiveRequest)
        assert.deepEqual(snapshot.events.slice(0, compacted.events.length), compacted.events, 'trial changed frozen seed history')
        const trial: LiveTrial = { arm, events: result.events, requests, finalResponse: result.finalResponse, snapshot }
        trials.push(trial)
        verifyLiveTrial(trial, facts, compacted, model, jevModel)
        await save(join(process.stage, 'acceptance.json'), { accepted: true, arm, seedEventsSha256: sha(compacted.events), querySha256: sha(query) })
      } finally { await process.close() }
    }
    assert.equal(new Set([compacted.pid, ...trials.map(trial => trial.snapshot.pid)]).size, 4, 'trials did not cold-start distinct processes')
    await save(join(base, 'acceptance.json'), { accepted: true, model, jevModel, arms: trials.map(trial => trial.arm), facts: facts.length,
      scope: 'same-session-cold-restart-native-compaction-dual-model-recall', actualModelWindowSaturation: false,
      independentSessionRecall: false, infiniteScaleProved: false })
    console.info(`Continuum live acceptance artifacts: ${base}`)
  } catch (error) {
    await save(join(base, 'failure.json'), { accepted: false, error: error instanceof Error ? error.message : String(error) })
    console.error(`Continuum live acceptance failed; artifacts retained: ${base}`)
    throw error
  }
})
