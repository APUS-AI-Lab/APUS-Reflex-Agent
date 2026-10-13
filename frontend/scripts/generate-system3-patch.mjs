/** Compose Desktop Skill selection with user-configured Reflex credentials. */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import productEdition from './product-edition.cjs'
import { system3ProductPatch } from './system3-product-profile.mjs'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Write the default Desktop profile. Models and credentials are configured in
 * Settings; model routing, supervision and memory require explicit configuration.
 * Editable Jev defaults come from the profile bundle, never this CLI overlay.
 * The historical function name is retained for the runtime assembly script.
 * @param {string} stage Directory receiving desktop.patch.yml.
 */
export async function generateSystem3Patch(stage, { sourceRoot = join(appRoot, '..'), mode = 'deployed', edition = 'full' } = {}) {
  const selected = productEdition.resolveEdition(edition)
  const system3Ui = mode === 'deployed' ? '@deepseek-ai/dsh-experimental-client-ui-system3'
    : join(sourceRoot, 'packages/experimental/client-ui-system3/lib/index.js')
  const system3 = mode === 'deployed' ? '@deepseek-ai/dsh-experimental-system3'
    : join(sourceRoot, 'packages/experimental/system3/lib/index.js')
  const desktop = await readFile(join(appRoot, 'build/dsh-desktop.patch.yml'), 'utf8')
  await writeFile(join(stage, 'desktop.patch.yml'), `${desktop.trimEnd()}

${system3ProductPatch({ system3Ui, system3 }).trimEnd()}
# Remote session export is opt-in for the APUS desktop product.
- id: session-log-deepseek
  config:
    enabled: false
${selected === 'lite' ? '\n# This product does not bundle an Office conversion engine.\n' + productEdition.editionPatch(selected) : ''}
`)
}
