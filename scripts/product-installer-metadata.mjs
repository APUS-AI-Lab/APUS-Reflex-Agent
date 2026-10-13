/** Match native installers to their edition-specific collected metadata. */
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { releaseAssetNames, releaseSupportNames } from './product-release.mjs'
import editionPolicy from '../frontend/scripts/product-edition.cjs'

/** Require edition identity on new builds while supporting original 0.1.0 receipts.
 * @param {{edition?:string}} runtime Installed runtime metadata.
 * @param {{edition?:string,version?:string}} build Collected product metadata.
 * @returns {void}
 */
export function verifyInstalledEdition(runtime, build) {
  if (build.version === '0.1.0' && build.edition === undefined && runtime.edition === undefined) return
  if (!['full', 'lite'].includes(build.edition) || runtime.edition !== build.edition) {
    throw new Error('Installed runtime edition does not match the collected build.')
  }
}

/** Verify actual edition files after native installation rather than trusting the installer label.
 * @param {string} root Installed runtime directory.
 * @param {object} build Collected product metadata.
 * @returns {void}
 */
export function verifyInstalledEditionFiles(root, build) {
  if (build.version === '0.1.0' && build.edition === undefined) return
  editionPolicy.verifyEditionRuntime(root, build.edition)
  if (build.edition === 'full') {
    const [platform, arch] = build.target.split('-')
    editionPolicy.verifyOfficeEngine(root, platform, arch)
  }
}

/** Locate metadata for a supported edition or the original 0.1.0 installer.
 * @param {string} installer Native installer path.
 * @param {string} target Expected native platform and architecture.
 * @returns {{file:string,edition:'full'|'lite',legacy:boolean}} Selected metadata identity.
 */
export function installerMetadata(installer, target) {
  const [platform, arch] = target.split('-')
  const name = basename(installer)
  for (const edition of ['full', 'lite']) {
    if (releaseAssetNames(platform, arch, edition).includes(name)) {
      return { file: join(dirname(installer), releaseSupportNames(target, edition).info), edition, legacy: false }
    }
  }
  const legacyName = platform === 'darwin' ? `apus-reflex-harness-mac-${arch}.dmg`
    : platform === 'win32' ? 'apus-reflex-harness-windows-x64-setup.exe'
    : 'apus-reflex-harness-linux-x64.deb'
  if (name !== legacyName) throw new Error('Installer filename does not identify a supported product edition.')
  const suffix = target === 'darwin-arm64' ? '' : `-${target}`
  return { file: join(dirname(installer), `build-info${suffix}.json`), edition: 'full', legacy: true }
}

/** Read build metadata and reject an edition, target, or artifact-name mismatch.
 * @param {string} installer Native installer path.
 * @param {string} target Expected native target.
 * @returns {Promise<object>} Validated collected build metadata.
 */
export async function readInstallerBuild(installer, target) {
  const selected = installerMetadata(installer, target)
  const build = JSON.parse(await readFile(selected.file, 'utf8'))
  if (build.target !== target || (selected.legacy
    ? build.version !== '0.1.0' || build.edition !== undefined
    : build.edition !== selected.edition)) throw new Error('Installer metadata does not match its target and edition.')
  if (!Array.isArray(build.assets) || !build.assets.some(asset => asset.name === basename(installer))) {
    throw new Error('Installer filename is missing from collected build metadata.')
  }
  return build
}
