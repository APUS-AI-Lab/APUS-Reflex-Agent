/** Shared Desktop and Web System3 UI profile; the System3 execution row and its editable defaults come from the System3 profile bundle. */

/**
 * Compose the product System3 UI. The `system3` row is not inserted here: a command-line overlay sits above the profile
 * patch, so a row inserted by it would reject every settings write. The System3 bundle owns that row instead.
 * @param {object} [modules] Deployed package names or workspace module paths.
 * @param {string} [modules.system3Ui] Client contribution module.
 * @returns {string} Loader insert patch consumed by both product surfaces.
 */
export function system3ProductPatch({ system3Ui = '@deepseek-ai/dsh-experimental-client-ui-system3' } = {}) {
  return `- insert:
    - id: ui-system3
      name: ${JSON.stringify(system3Ui)}
`
}
