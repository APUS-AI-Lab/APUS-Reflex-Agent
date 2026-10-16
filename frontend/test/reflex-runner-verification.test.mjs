import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import afterPack from '../scripts/package-system3-runtime.cjs'
import signature from '../scripts/verify-macos-signature.cjs'

const roots = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Shell stand-in for llama-server that reports a build only when Metal device setup is disabled. */
function runner(directory, body = 'echo "version: 0.4.1-dev (build 11118, commit e6ab7c1a4)" >&2') {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'llama-server')
  writeFileSync(file, `#!/bin/sh\n[ "$GGML_METAL_DEVICES" = 0 ] || exit 7\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

describe.skipIf(process.platform === 'win32')('local Reflex runner checks without Metal devices', () => {
  it('requires the packaged runner to report its locked release and explains a failed start', async () => {
    vi.stubEnv('GGML_METAL_DEVICES', '1')
    const root = mkdtempSync(join(tmpdir(), 'apus-runner-pack-'))
    roots.push(root)
    const file = runner(root)
    await expect(afterPack.verifyPackagedReflexRunner(file, 'b11118')).resolves.toBeUndefined()
    await expect(afterPack.verifyPackagedReflexRunner(file, 'b1')).rejects.toThrow('release mismatch')
    const failing = runner(join(root, 'failing'), 'exit 3')
    await expect(afterPack.verifyPackagedReflexRunner(failing, 'b11118')).rejects.toThrow('(exit 3, signal null, killed false)')
    const crashing = runner(join(root, 'crashing'), 'kill -ABRT $$')
    await expect(afterPack.verifyPackagedReflexRunner(crashing, 'b11118')).rejects.toThrow('signal SIGABRT')
    chmodSync(file, 0o644)
    await expect(afterPack.verifyPackagedReflexRunner(file, 'b11118')).rejects.toThrow('not an executable file')
  })

  it('starts the signed runner with Metal device setup disabled', async () => {
    vi.stubEnv('GGML_METAL_DEVICES', '1')
    const resources = mkdtempSync(join(tmpdir(), 'apus-runner-sign-'))
    roots.push(resources)
    runner(join(resources, 'system3-runtime', 'dependencies', 'llama-server'))
    await expect(signature.verifySignedReflexRunner(resources)).resolves.toBe(true)
  })
})
