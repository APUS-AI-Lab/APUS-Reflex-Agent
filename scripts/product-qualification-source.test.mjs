/** Keyless checks for selecting a native build artifact. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateRequalification } from './product-qualification-source.mjs'

test('requalification rejects another run, source, repository, workflow, or ambiguous artifact', () => {
  const source = 'a'.repeat(40)
  const repository = 'APUS-AI-Lab/APUS-Reflex-Harness'
  const run = { id: 123, repository: { full_name: repository }, head_repository: { full_name: repository },
    head_sha: source, path: '.github/workflows/product-release.yml', status: 'completed' }
  const artifact = { id: 456, name: 'apus-preview-win32-x64-123', expired: false, workflow_run: { id: 123, head_sha: source } }
  assert.equal(validateRequalification(run, [artifact], repository, '123', source, 'win32-x64'), 456)
  for (const change of [{ id: 999 }, { head_sha: 'b'.repeat(40) }, { repository: { full_name: 'other/repo' } },
    { head_repository: { full_name: 'other/repo' } }, { path: '.github/workflows/ci.yml' }, { status: 'in_progress' }]) {
    assert.throws(() => validateRequalification({ ...run, ...change }, [artifact], repository, '123', source, 'win32-x64'), /source run/)
  }
  for (const artifacts of [[], [artifact, artifact], [{ ...artifact, expired: true }], [{ ...artifact, name: 'other' }],
    [{ ...artifact, workflow_run: { id: 999, head_sha: source } }], [{ ...artifact, workflow_run: { id: 123, head_sha: 'b'.repeat(40) } }]]) {
    assert.throws(() => validateRequalification(run, artifacts, repository, '123', source, 'win32-x64'), /exactly one/)
  }
  assert.throws(() => validateRequalification(run, [artifact], repository, '123', 'short', 'win32-x64'), /full lowercase/)
})

test('native targets require their own exact artifact and reject unsupported targets', () => {
  const source = 'a'.repeat(40)
  const repository = 'APUS-AI-Lab/APUS-Reflex-Harness'
  const run = { id: 123, repository: { full_name: repository }, head_repository: { full_name: repository },
    head_sha: source, path: '.github/workflows/product-release.yml', status: 'completed' }
  for (const target of ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64']) {
    const artifact = { id: 456, name: `apus-preview-${target}-123`, expired: false, workflow_run: { id: 123, head_sha: source } }
    assert.equal(validateRequalification(run, [artifact], repository, '123', source, target), 456)
    const other = target === 'win32-x64' ? 'linux-x64' : 'win32-x64'
    assert.throws(() => validateRequalification(run, [artifact], repository, '123', source, other), /exactly one/)
  }
  assert.throws(() => validateRequalification(run, [], repository, '123', source, 'all'), /Unsupported/)
})

test('edition selection rejects another edition and keeps legacy artifacts explicit', () => {
  const source = 'a'.repeat(40)
  const repository = 'APUS-AI-Lab/APUS-Reflex-Harness'
  const run = { id: 123, repository: { full_name: repository }, head_repository: { full_name: repository }, head_sha: source, path: '.github/workflows/product-release.yml', status: 'completed' }
  const legacy = { id: 1, name: 'apus-preview-win32-x64-123', expired: false, workflow_run: { id: 123, head_sha: source } }
  const full = { ...legacy, id: 2, name: 'apus-preview-full-win32-x64-123' }
  const lite = { ...legacy, id: 3, name: 'apus-preview-lite-win32-x64-123' }
  for (const [edition, expected] of [['legacy', 1], ['full', 2], ['lite', 3]]) {
    assert.equal(validateRequalification(run, [legacy, full, lite], repository, 123, source, 'win32-x64', edition), expected)
  }
  assert.throws(() => validateRequalification(run, [legacy, full], repository, 123, source, 'win32-x64', 'lite'), /exactly one/)
  assert.throws(() => validateRequalification(run, [legacy], repository, 123, source, 'win32-x64', 'full'), /exactly one/)
  assert.throws(() => validateRequalification(run, [full, lite], repository, 123, source, 'win32-x64', 'both'), /Unsupported qualification edition/)
})
