/** Activation-time device gate: platform, unified memory, and the bundled runner executable. */
import { accessSync, constants, statSync } from 'node:fs'
import { totalmem } from 'node:os'
import type { Config } from './index.ts'
import type { ReflexDeviceSupport, ReflexVariant } from './types.ts'

/** Variants in descending quality and memory order. */
const VARIANTS: readonly ReflexVariant[] = ['q8_0', 'q4_k_m']

/**
 * List the variants this Host may prepare.
 * @param config - pinned variant and per-variant memory minimums.
 * @param memoryBytes - total Host memory.
 * @returns the pinned variant when its minimum is met, otherwise every variant whose minimum is met, best first.
 */
export function offeredVariants(config: Config, memoryBytes: number): ReflexVariant[] {
  const fitting = VARIANTS.filter(variant => memoryBytes >= config.minMemoryBytes[variant])
  return config.variant === 'auto' ? fitting : fitting.filter(variant => variant === config.variant)
}

function isExecutableFile(path: string): boolean {
  try { accessSync(path, constants.X_OK) } catch (_unusable) {
    // A missing or non-executable runner is a device fact reported as `runner-missing`, not an activation error.
    return false
  }
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true
}

/**
 * Decide whether this Host can run the bundled runner. Only macOS arm64 ships the runner.
 * @param config - runner path, pinned variant, and memory minimums.
 * @returns support with the recommended variant, or the first unmet requirement.
 */
export function inspectDevice(config: Config): ReflexDeviceSupport {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return { supported: false, reason: 'platform' }
  const memoryBytes = totalmem()
  const [recommended] = offeredVariants(config, memoryBytes)
  if (recommended === undefined) return { supported: false, reason: 'memory' }
  if (config.runnerPath === undefined || !isExecutableFile(config.runnerPath)) return { supported: false, reason: 'runner-missing' }
  return { supported: true, memoryBytes, recommended }
}
