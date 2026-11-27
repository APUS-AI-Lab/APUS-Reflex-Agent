import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

interface Job {
  child: ChildProcess
  done: Promise<void>
  stdout: Buffer
  stderr: Buffer
  status: 'running' | 'completed' | 'killed'
  exitCode: number | null
  signal: NodeJS.Signals | null
  inputSequence: number
  inputReceipts: Map<number, string>
  stdoutPath: string
  stderrPath: string
}

/** Real child processes behind the external task-worker HTTP protocol. */
export async function processService() {
  const jobs = new Map<string, Job>()
  const directory = mkdtempSync(join(tmpdir(), 'dsh-process-worker-test-'))
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  let droppedSpawnResponses = 0
  let transientReadFailures = 0
  let droppedInputResponses = 0
  let heldRange = false
  const frame = (id: string, body: Record<string, unknown>) => {
    const job = jobs.get(id)
    if (job === undefined) return undefined
    const stdoutStart = Number(body.stdout_offset ?? 0)
    const stderrStart = Number(body.stderr_offset ?? 0)
    const limit = Number(body.max_bytes ?? 65_536)
    const stdout = body.op === 'read' ? job.stdout.subarray(stdoutStart, stdoutStart + limit) : Buffer.alloc(0)
    const stderr = body.op === 'read' ? job.stderr.subarray(stderrStart, stderrStart + limit) : Buffer.alloc(0)
    return {
      call_id: id, status: job.status, exit_code: job.exitCode, signal: job.signal,
      range_empty: job.status !== 'running' && !heldRange,
      stdout_b64: stdout.toString('base64'), stderr_b64: stderr.toString('base64'),
      stdout_offset: stdoutStart + stdout.length, stderr_offset: stderrStart + stderr.length,
      stdout_lossy: false, stderr_lossy: false,
      stdout_spill_path: job.stdoutPath, stderr_spill_path: job.stderrPath,
    }
  }
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      requests.push({ path: request.url ?? '', body })
      const id = String(body.call_id)
      if (body.op === 'spawn') {
        if (jobs.has(id)) throw new Error('a spawn was replayed')
        const argv = body.argv as string[]
        const overrides = (body.env ?? {}) as Record<string, string | null>
        const env: NodeJS.ProcessEnv = {}
        for (const [key, value] of Object.entries(process.env)) {
          if (Object.hasOwn(overrides, key)) {
            if (overrides[key] !== null) env[key] = overrides[key]
          } else {
            env[key] = value
          }
        }
        for (const [key, value] of Object.entries(overrides)) {
          if (value !== null && !Object.hasOwn(env, key)) env[key] = value
        }
        const child = spawn(argv[0]!, argv.slice(1), {
          cwd: String(body.cwd), env, stdio: ['pipe', 'pipe', 'pipe'],
        })
        let settle!: () => void
        const job: Job = {
          child, done: new Promise((resolve) => { settle = resolve }), stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
          status: 'running', exitCode: null, signal: null, inputSequence: 0, inputReceipts: new Map(),
          stdoutPath: join(directory, `${id}.stdout`), stderrPath: join(directory, `${id}.stderr`),
        }
        jobs.set(id, job)
        writeFileSync(job.stdoutPath, '')
        writeFileSync(job.stderrPath, '')
        child.stdout!.on('data', (data: Buffer) => {
          job.stdout = Buffer.concat([job.stdout, data]); writeFileSync(job.stdoutPath, job.stdout)
        })
        child.stderr!.on('data', (data: Buffer) => {
          job.stderr = Buffer.concat([job.stderr, data]); writeFileSync(job.stderrPath, job.stderr)
        })
        child.once('error', () => { job.status = 'killed'; settle() })
        child.once('close', (code, signal) => {
          job.status = signal === null ? 'completed' : 'killed'
          job.exitCode = code
          job.signal = signal
          settle()
        })
        if (!body.stdin_pipe) child.stdin!.end(typeof body.stdin === 'string' ? body.stdin : undefined)
        if (droppedSpawnResponses > 0) { droppedSpawnResponses--; request.destroy(); return }
      }
      if (body.op === 'read' && transientReadFailures > 0) {
        transientReadFailures--
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ call_id: id, status: 'unknown', error: 'temporary outage' }))
        return
      }
      const job = jobs.get(id)
      if (job === undefined) {
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ call_id: id, status: 'unknown', error: 'unknown process' }))
        return
      }
      if (body.op === 'stdin') {
        const sequence = Number(body.input_seq)
        const fingerprint = JSON.stringify([body.data_b64 ?? '', body.end === true])
        if (job.inputReceipts.has(sequence)) {
          if (job.inputReceipts.get(sequence) !== fingerprint) throw new Error('conflicting stdin retry')
        } else {
          if (sequence !== job.inputSequence + 1) throw new Error('stdin sequence gap')
          job.inputSequence = sequence
          job.inputReceipts.set(sequence, fingerprint)
          if (typeof body.data_b64 === 'string') job.child.stdin!.write(Buffer.from(body.data_b64, 'base64'))
          if (body.end) job.child.stdin!.end()
        }
      }
      if (body.op === 'stdin' && droppedInputResponses > 0) { droppedInputResponses--; request.destroy(); return }
      if (body.op === 'terminate') {
        job.child.kill('SIGTERM')
        await job.done
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(frame(id, body)))
    })().catch((error: unknown) => {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    endpoint: `http://127.0.0.1:${address.port}`, requests, jobs,
    dropSpawnResponse() { droppedSpawnResponses++ },
    dropInputResponse() { droppedInputResponses++ },
    failReads(count: number) { transientReadFailures = count },
    holdRange(value: boolean) { heldRange = value },
    async close() {
      for (const job of jobs.values()) if (job.status === 'running') job.child.kill('SIGKILL')
      await Promise.all([...jobs.values()].map(job => job.done))
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
