/** Configuration defaults and load-time rejection of unusable deployments. */
import { expect, it } from 'vitest'
import { checkConfig, Config } from '../src/index.ts'

const GIB = 1024 ** 3

it('fills deployment defaults around the required data root', () => {
  const config = Config({ dataRoot: '/data/reflex' })
  expect(config).toMatchObject({
    providerId: 'reflex-local', contextTokens: 9216, minPrefillTokensPerSecond: 150,
    modelOrigins: ['https://huggingface.co', 'https://hf-mirror.com'],
    minMemoryBytes: { '4b-q4_k_m': 8 * GIB, '4b-q8_0': 16 * GIB, '9b-q4_k_m': 16 * GIB, '9b-q8_0': 24 * GIB, '35b-a3b-q4_k_m': 32 * GIB, '35b-a3b-q8_0': 64 * GIB },
  })
  expect(config.runnerPath).toBeUndefined()
  expect(config.idleReleaseMs).toBeUndefined()
  expect(Config({ dataRoot: '/data/reflex', idleReleaseMs: 60_000 }).idleReleaseMs).toBe(60_000)
  expect(() => Config({ dataRoot: '/data/reflex', idleReleaseMs: 0 })).toThrow()
  expect(checkConfig(config)).toBe(config)
  expect(() => Config({})).toThrow()
  expect(() => Config({ dataRoot: '/data', modelOrigins: ['https://user@mirror.example'] })).toThrow()
})

it.each([
  [{ dataRoot: 'relative' }, 'absolute'],
  [{ dataRoot: '/data', runnerPath: 'bin/llama-server' }, 'absolute'],
  [{ dataRoot: '/data', modelOrigin: 'http://[::1' }, 'Invalid URL'],
] as const)('rejects %j at load', (input, message) => {
  expect(() => checkConfig(Config(input))).toThrow(message)
})
