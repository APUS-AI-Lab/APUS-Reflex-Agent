/** Protocol fixture replacing llama-server: the same argv, stderr readiness line, Bearer key, and /completion fields. */
import { createServer } from 'node:http'
import { appendFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const key = process.env.LLAMA_API_KEY
const mode = process.env.FAKE_MODE ?? 'ok'
const log = (entry) => { if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(entry)}\n`) }
const model = argv[argv.indexOf('-m') + 1]
log({ event: 'start', argv, key })
process.stderr.write('build: b11118 (fixture)\nmain: loading model\n')
// Marker files switch behavior of later processes, so one test can fail runners only after its self-test.
const marked = name => process.env[name] !== undefined && existsSync(process.env[name])
if (mode === 'exit-early' || marked('FAKE_START_FAIL_FILE')) {
  process.stderr.write('error: failed to load model\n')
  process.exit(3)
}
let unhealthy = Number(process.env.FAKE_HEALTH_503 ?? 0)

function completion(prompt) {
  const logprobs = mode === 'wrong' ? { A: -3, B: -0.1, C: -4 } : { A: -0.01, B: -6, C: -7 }
  const top = Object.entries(logprobs).filter(([token]) => !(mode === 'missing' && token === 'C'))
    .map(([token, logprob], id) => ({ id, token, bytes: [token.charCodeAt(0)], logprob }))
  top.push({ id: 99, token: 'A', logprob: -20 })
  return {
    content: 'A', completion_probabilities: [{ token: 'A', logprob: -0.01, top_logprobs: top }],
    timings: { prompt_n: prompt.length, cache_n: 0,
      prompt_ms: model.includes(process.env.FAKE_SLOW_MODEL ?? '\0') ? 1_000_000 : Number(process.env.FAKE_PROMPT_MS ?? 10) },
  }
}

const server = createServer((request, response) => {
  if (request.url === '/health') {
    if (process.env.FAKE_HEALTH_STATUS) { response.writeHead(Number(process.env.FAKE_HEALTH_STATUS)).end(); return }
    response.writeHead(unhealthy-- > 0 ? 503 : 200, { 'content-type': 'application/json' }).end('{"status":"ok"}')
    return
  }
  if (mode !== 'no-auth' && request.headers.authorization !== `Bearer ${key}`) { request.resume(); response.writeHead(401).end(); return }
  if (request.url === '/props') { response.writeHead(200).end('{}'); return }
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    log({ event: 'completion', model, body })
    if (mode === 'crash' || marked('FAKE_CRASH_FILE')) process.exit(1)
    if (mode === 'hold') return
    if (mode === 'http500') { response.writeHead(500).end('{"error":"failed"}'); return }
    if (mode === 'invalid-json') { response.writeHead(200).end('not json'); return }
    if (mode === 'invalid-fields') { response.writeHead(200).end('{"completion_probabilities":[]}'); return }
    if (mode === 'large') { response.writeHead(200).end(' '.repeat(4096)); return }
    const reply = () => { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(completion(body.prompt))) }
    if (marked('FAKE_DELAY_FILE')) setTimeout(reply, 300)
    else reply()
  })
})
if (mode === 'silent') setInterval(() => {}, 1000)
else if (mode === 'wrong-port') {
  process.stderr.write('srv  llama_server: listening on http://127.0.0.1:1\n')
  setInterval(() => {}, 1000)
}
else {
  server.listen(0, '127.0.0.1', () => {
    process.stderr.write(`0.02.414.658 I srv  llama_server: listening on http://127.0.0.1:${server.address().port}\n`)
    if (process.env.FAKE_EXIT_AFTER_MS) setTimeout(() => { process.exit(2) }, Number(process.env.FAKE_EXIT_AFTER_MS))
  })
}
