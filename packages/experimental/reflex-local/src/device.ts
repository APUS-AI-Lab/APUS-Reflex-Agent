/** Activation-time device gate: platform, unified memory, and the bundled runner executable. */
import { accessSync, constants, statSync } from 'node:fs'
import { totalmem } from 'node:os'
import type { Config } from './index.ts'
import type { ReflexDeviceSupport } from './types.ts'

function isExecutableFile(path: string): boolean {
  try { accessSync(path, constants.X_OK) } catch (_unusable) {
    // A missing or non-executable runner is a device fact reported as `runner-missing`, not an activation error.
    return false
  }
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true
}

/**
 * Decide whether this Host can run the bundled runner. Only Apple Silicon Macs ship the runner.
 * @param config - runner path and per-variant memory tiers.
 * @returns support with total memory, or the first unmet requirement; `memory` means no tier fits.
 */
export function inspectDevice(config: Config): ReflexDeviceSupport {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return { supported: false, reason: 'platform' }
  const memoryBytes = totalmem()
  if (memoryBytes < Math.min(...Object.values(config.minMemoryBytes))) return { supported: false, reason: 'memory' }
  if (config.runnerPath === undefined || !isExecutableFile(config.runnerPath)) return { supported: false, reason: 'runner-missing' }
  return { supported: true, memoryBytes }
}
