/** Configuration defaults and load-time rejection of unusable deployments. */
import { expect, it } from 'vitest'
import { checkConfig, Config } from '../src/index.ts'

it('fills deployment defaults around the required data root', () => {
  const config = Config({ dataRoot: '/data/reflex' })
  expect(config).toMatchObject({
    providerId: 'reflex-local', variant: 'auto', contextTokens: 9216, idleTimeoutMs: 600_000, minPrefillTokensPerSecond: 150,
    modelOrigins: ['https://huggingface.co', 'https://hf-mirror.com'], minMemoryBytes: { q8_0: 16 * 1024 ** 3, q4_k_m: 8 * 1024 ** 3 },
  })
  expect(config.runnerPath).toBeUndefined()
  expect(config.cloudProviderId).toBeUndefined()
  expect(checkConfig(config)).toBe(config)
  expect(() => Config({})).toThrow()
  expect(() => Config({ dataRoot: '/data', modelOrigins: ['https://user@mirror.example'] })).toThrow()
})

it.each([
  [{ dataRoot: 'relative' }, 'absolute'],
  [{ dataRoot: '/data', runnerPath: 'bin/llama-server' }, 'absolute'],
  [{ dataRoot: '/data', modelOrigin: 'http://[::1' }, 'Invalid URL'],
  [{ dataRoot: '/data', cloudProviderId: 'reflex-local' }, 'must differ'],
] as const)('rejects %j at load', (input, message) => {
  expect(() => checkConfig(Config(input))).toThrow(message)
})
