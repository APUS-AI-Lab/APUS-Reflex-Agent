import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it, onTestFinished } from 'vitest'
import { SystemOneProvider } from '../src/client.ts'

it('cancels real HTTP body reads without a detached rejection', async () => {
  const failures: unknown[] = []
  const trace = (error: unknown): void => { failures.push(error) }
  process.on('unhandledRejection', trace)
  onTestFinished(() => { process.off('unhandledRejection', trace) })
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{') })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(() => { server.closeAllConnections(); server.close() })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing address')
  const provider = new SystemOneProvider({ id: 'test', endpoint: `http://127.0.0.1:${address.port}`, model: 'test', effort: 'low', timeoutMs: 1000 })
  for (let i = 0; i < 10; i += 1) {
    const signal = AbortSignal.timeout(50)
    await expect(provider.decide({ state: 'hello', questions: { intent: { type: 'choice', criteria: { yes: 'yes', no: 'no' } } } }, signal)).rejects.toMatchObject({ name: 'TimeoutError' })
  }
  server.closeAllConnections()
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(failures).toEqual([])
})
