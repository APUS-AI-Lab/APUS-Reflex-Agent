/** Stage the Harness-locked llama.cpp runner used by local Reflex decisions. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Host platform and architecture mapped to the Harness primary-runtime lock targets. */
export const PRIMARY_RUNTIME_TARGETS = { 'darwin-arm64': 'mac-arm64', 'darwin-x64': 'mac-x64', 'linux-arm64': 'linux-arm64', 'linux-x64': 'linux-x64', 'win32-x64': 'win-x64' }

/**
 * Download, verify, materialize, and execute the runner the Harness lock pins for this host.
 * The Harness primary-runtime builder owns the download hash, Mach-O dependency checks, and version smoke;
 * the checkout's own tsx loads that TypeScript module in this process.
 * @param {string} sourceRoot - Built Harness checkout.
 * @param {string} destination - Directory replaced with `llama-server`, its libraries, and its license.
 * @param {string} cache - SHA-256-addressed download cache.
 * @param {{ platform?: string, arch?: string }} [host] - Host whose lock target is prepared.
 * @returns {Promise<string | undefined>} Staged release tag, or undefined when the host target locks no runner.
 */
export async function prepareReflexRunner(sourceRoot, destination, cache, { platform = process.platform, arch = process.arch } = {}) {
  const target = PRIMARY_RUNTIME_TARGETS[`${platform}-${arch}`]
  if (target === undefined) return undefined
  const { tsImport } = await import(pathToFileURL(createRequire(join(sourceRoot, 'package.json')).resolve('tsx/esm/api')).href)
  const builder = await tsImport(pathToFileURL(join(sourceRoot, 'scripts/primary-runtime/prepare.ts')).href, import.meta.url)
  const release = await builder.prepareLockedLlamaServer(target, destination, cache)
  if (release !== undefined) builder.smokeLlamaServer(join(destination, 'llama-server'), release, process.env)
  return release
}
