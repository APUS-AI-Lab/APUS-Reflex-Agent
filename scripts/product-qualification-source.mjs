/** Bind installed-package qualification to an immutable native build artifact. */

/** Validate the source run and select its uniquely named native product artifact. */
export function validateRequalification(run, artifacts, repository, runId, source, target, edition = 'legacy') {
  if (!['legacy', 'full', 'lite'].includes(edition)) throw new Error('Unsupported qualification edition')
  if (!['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'].includes(target)) throw new Error('Unsupported qualification target')
  if (!/^[0-9a-f]{40}$/.test(source) || !/^[1-9][0-9]*$/.test(String(runId))) throw new Error('Expected a build run ID and full lowercase source SHA')
  if (String(run.id) !== String(runId) || run.repository?.full_name !== repository
    || run.head_repository?.full_name !== repository || run.head_sha !== source
    || run.path !== '.github/workflows/product-release.yml' || run.status !== 'completed') {
    throw new Error('Qualification source run must be this repository’s completed product-release build at the expected SHA')
  }
  const name = edition === 'legacy' ? `apus-preview-${target}-${runId}` : `apus-preview-${edition}-${target}-${runId}`
  const matches = artifacts.filter(item => item.name === name && !item.expired)
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id < 1
    || matches[0].workflow_run?.id !== run.id || matches[0].workflow_run?.head_sha !== source) {
    throw new Error('Expected exactly one unexpired native artifact from the selected build run and source')
  }
  return matches[0].id
}
