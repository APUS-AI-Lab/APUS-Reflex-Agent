import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DEFAULT_CONTINUUM_ABLATION_CASES, runContinuumAblation } from '@deepseek-ai/dsh-continuum'

const output = resolve('docs/feat-continuum-memory/continuum-ablation.json')
mkdirSync(dirname(output), { recursive: true })
const result = {
  version: 1,
  generatedAt: '2026-10-11',
  corpus: DEFAULT_CONTINUUM_ABLATION_CASES,
  results: runContinuumAblation(DEFAULT_CONTINUUM_ABLATION_CASES),
  interpretation: 'Deterministic local ablation only; estimated cache bytes are layout reuse, not provider billing or a cache-hit claim.',
}
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(`continuum-ablation: wrote ${output}`)
