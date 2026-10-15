/** The device gate admits only macOS arm64 Hosts with enough memory and an executable runner. */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { inspectDevice } from '../src/device.ts'
import { temporaryRoot } from './harness.ts'

const memory = vi.hoisted(() => ({ bytes: 24 * 1024 ** 3 }))
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), totalmem: () => memory.bytes }))
afterEach(() => { vi.unstubAllGlobals(); memory.bytes = 24 * 1024 ** 3 })
const GIB = 1024 ** 3

async function runner(mode = 0o755): Promise<string> {
  const path = join(await temporaryRoot(), 'llama-server')
  await writeFile(path, '#!/bin/sh\n')
  await chmod(path, mode)
  return path
}

function host(platform: string, arch: string): void {
  vi.stubGlobal('process', { ...process, platform, arch })
}

it('admits Apple Silicon Hosts whose memory meets the smallest configured tier', async () => {
  host('darwin', 'arm64')
  const runnerPath = await runner()
  expect(inspectDevice(Config({ dataRoot: '/data', runnerPath }))).toEqual({ supported: true, memoryBytes: 24 * GIB })
  memory.bytes = 8 * GIB
  expect(inspectDevice(Config({ dataRoot: '/data', runnerPath }))).toEqual({ supported: true, memoryBytes: 8 * GIB })
  memory.bytes = 4 * GIB
  expect(inspectDevice(Config({ dataRoot: '/data', runnerPath }))).toEqual({ supported: false, reason: 'memory' })
  const lowered = { ...Config({ dataRoot: '/data' }).minMemoryBytes, '4b-q4_k_m': 4 * GIB }
  expect(inspectDevice(Config({ dataRoot: '/data', runnerPath, minMemoryBytes: lowered }))).toEqual({ supported: true, memoryBytes: 4 * GIB })
})

it.each([['linux', 'x64'], ['darwin', 'x64'], ['win32', 'arm64']])('reports %s-%s as an unsupported platform', (platform, arch) => {
  host(platform, arch)
  expect(inspectDevice(Config({ dataRoot: '/data', runnerPath: '/missing' }))).toEqual({ supported: false, reason: 'platform' })
})

it('reports a missing, non-executable, or directory runner as runner-missing', async () => {
  host('darwin', 'arm64')
  const root = await temporaryRoot()
  await mkdir(join(root, 'directory'))
  for (const runnerPath of [undefined, join(root, 'absent'), await runner(0o644), join(root, 'directory')]) {
    expect(inspectDevice(Config({ dataRoot: '/data', runnerPath }))).toEqual({ supported: false, reason: 'runner-missing' })
  }
})
