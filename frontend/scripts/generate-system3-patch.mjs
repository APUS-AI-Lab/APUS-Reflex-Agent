/** Compose the Desktop profile without enabling remote System3 services. */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Write the default Desktop profile. Models and credentials are configured in
 * Settings; System3 is enabled only through the opt-in desktop settings page.
 * The historical function name is retained for the runtime assembly script.
 * @param {string} stage Directory receiving desktop.patch.yml.
 */
export async function generateSystem3Patch(stage, { sourceRoot = join(appRoot, '..'), mode = 'deployed' } = {}) {
  const system3Ui = mode === 'deployed' ? '@deepseek-ai/dsh-experimental-client-ui-system3'
    : join(sourceRoot, 'packages/experimental/client-ui-system3/lib/index.js')
  const desktop = await readFile(join(appRoot, 'build/dsh-desktop.patch.yml'), 'utf8')
  await writeFile(join(stage, 'desktop.patch.yml'), `${desktop.trimEnd()}

# System3 cards render recorded decisions; this UI does not enable remote services.
- insert:
    - id: ui-system3
      name: ${JSON.stringify(system3Ui)}

# Remote session export is opt-in for the APUS desktop product.
- id: session-log-deepseek
  config:
    enabled: false
`)
}
