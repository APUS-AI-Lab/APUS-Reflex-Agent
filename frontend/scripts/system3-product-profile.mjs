/** Shared Desktop and Web input judgment and Skill selection profile. */

/**
 * Compose the product UI and bounded execution plugin without enabling other System3 capabilities.
 * @param {object} [modules] Deployed package names or workspace module paths.
 * @param {string} [modules.system3Ui] Client contribution module.
 * @param {string} [modules.system3] Execution plugin module.
 * @returns {string} Loader insert patch consumed by both product surfaces.
 */
export function system3ProductPatch({ system3Ui = '@deepseek-ai/dsh-experimental-client-ui-system3',
  system3 = '@deepseek-ai/dsh-experimental-system3' } = {}) {
  return `# Skill advice uses the configured Reflex provider; unavailable decisions preserve native execution.
- insert:
    - id: ui-system3
      name: ${JSON.stringify(system3Ui)}
    - id: system3
      name: ${JSON.stringify(system3)}
      config:
        privacyMode: controlled
        approvedRemoteIds: [jev]
        approvedRemoteDataClasses: [workspace]
        jevRouteId: jev
        jevExecutionDomain: network
        skillSelection:
          sessionDataClasses: [workspace]
          minConfidence: 0.5
          maxInputBytes: 16000
          maxContentBytes: 12000
          maxCandidates: 15
          deadlineMs: 3000
`
}
