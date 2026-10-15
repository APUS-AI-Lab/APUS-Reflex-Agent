/** The pinned catalog covers every variant and keys round-trip; fitness and recommendation follow memory, disk, and stability. */
import { expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import { modelOptions, readCatalog, recommend, VARIANT_KEYS, variantKey, variantOf } from '../src/models.ts'

const GIB = 1024 ** 3
const tiers = Config({ dataRoot: '/data' }).minMemoryBytes

it('pins every published variant to a revision-qualified Hugging Face URL, smallest first', () => {
  const catalog = readCatalog()
  expect(Object.keys(catalog)).toEqual([...VARIANT_KEYS])
  const sizes = VARIANT_KEYS.map(key => catalog[key].bytes)
  expect(sizes).toEqual([...sizes].sort((left, right) => left - right))
  for (const key of VARIANT_KEYS) {
    const pinned = /^https:\/\/huggingface\.co\/apus-ailab\/APUS-Reflex-[0-9A-Z-]+-GGUF\/resolve\/[0-9a-f]{40}\/APUS-OpenJev-v1-/
    expect(catalog[key].url).toMatch(pinned)
    expect(catalog[key].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(catalog[key].experimental).toBe(key.startsWith('35b-a3b'))
    expect(variantKey(variantOf(key))).toBe(key)
  }
  expect(variantOf('35b-a3b-q4_k_m')).toEqual({ model: '35b-a3b', quant: 'q4_k_m' })
})

it('judges memory before disk, counts bytes already present, and never recommends experimental models', () => {
  const catalog = readCatalog()
  const judge = (memoryBytes: number, availableBytes: number | undefined, present = 0) => modelOptions(catalog, tiers,
    { memoryBytes, availableBytes, diskMarginBytes: GIB, presentBytes: key => key === '9b-q8_0' ? present : 0 })
  const roomy = judge(128 * GIB, 1000 * GIB)
  expect(roomy.every(option => option.fits)).toBe(true)
  expect(recommend(roomy)).toEqual({ model: '9b', quant: 'q8_0' })
  const unmeasured = judge(16 * GIB, undefined)
  expect(unmeasured.map(option => option.reason)).toEqual([undefined, undefined, undefined, 'memory', 'memory', 'memory'])
  expect(recommend(unmeasured)).toEqual({ model: '9b', quant: 'q4_k_m' })
  const nineGb = catalog['9b-q8_0'].bytes
  expect(judge(24 * GIB, nineGb).find(option => option.model === '9b' && option.quant === 'q8_0')?.reason).toBe('disk')
  expect(judge(24 * GIB, 2 * GIB, nineGb).find(option => option.model === '9b' && option.quant === 'q8_0')?.fits).toBe(true)
  const full = judge(24 * GIB, 0)
  expect(full.map(option => option.reason)).toEqual(['disk', 'disk', 'disk', 'disk', 'memory', 'memory'])
  expect(recommend(full)).toEqual({ model: '4b', quant: 'q4_k_m' })
  expect(recommend(judge(4 * GIB, 0))).toBeUndefined()
})
