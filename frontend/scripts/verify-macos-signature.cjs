/** Verify the final macOS application after all runtime files have been copied and signed. */
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

/** Require a valid bundle seal, with explicit ad-hoc identity when selected for preview builds. */
async function verifyMacBundle(app, { adHoc = false } = {}) {
  await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { timeout: 120_000, maxBuffer: 1024 * 1024 })
  const displayed = await execFileAsync('/usr/bin/codesign', ['--display', '--verbose=4', app], { timeout: 30_000, maxBuffer: 1024 * 1024 })
  const details = displayed.stdout + displayed.stderr
  if (details.includes('Info.plist=not bound') || !/Sealed Resources version=/.test(details)) throw new Error('The macOS application signature does not seal its Info.plist and resources.')
  if (adHoc && !/^Signature=adhoc$/m.test(details)) throw new Error('The macOS preview application must use the selected ad-hoc identity.')
  return { valid: true, adHoc: /^Signature=adhoc$/m.test(details), resourceSeal: true }
}

/**
 * Execute the signed local Reflex runner when the runtime carries one; hardened-runtime library validation rejects
 * its sibling libraries unless all share a Team ID or the runner is entitled to load them.
 * @returns Whether a runner was present and started.
 */
async function verifySignedReflexRunner(resources) {
  const runner = path.join(resources, 'system3-runtime', 'dependencies', 'llama-server', 'llama-server')
  if (!fs.existsSync(runner)) return false
  // Skipping Metal device setup keeps this independent of the build host's GPU; dyld still maps every signed library.
  await execFileAsync(runner, ['--version'], { timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, GGML_METAL_DEVICES: '0' } })
  return true
}

/** electron-builder runs this after bottom-up signing and before producing DMG/ZIP archives. */
async function verifyPackagedMacSignature(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app')
  await verifyMacBundle(app, { adHoc: context.packager.platformSpecificBuildOptions.identity === '-' })
  await verifySignedReflexRunner(path.join(app, 'Contents', 'Resources'))
  console.log('macOS application signature verified: Info.plist and resources sealed; notarization is not implied.')
}

module.exports = verifyPackagedMacSignature
module.exports.verifyMacBundle = verifyMacBundle
module.exports.verifySignedReflexRunner = verifySignedReflexRunner
