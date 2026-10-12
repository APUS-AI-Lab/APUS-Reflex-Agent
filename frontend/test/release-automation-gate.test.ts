import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'

describe('APUS release automation consent', () => {
  it('gates publishing, signing and upstream archive writes on an explicit variable', () => {
    const release = load(readFileSync('.upstream-workflows/workflows/release.yml', 'utf8')) as { jobs: Record<string, { if: string }> }
    for (const id of ['sign-windows', 'publish', 'publish-prerelease']) {
      expect(release.jobs[id]?.if.trim().startsWith("vars.APUS_RELEASE_AUTOMATION == 'true' &&")).toBe(true)
    }
    const archive = load(readFileSync('.upstream-workflows/workflows/backfill-archive.yml', 'utf8')) as { jobs: Record<string, { if: string }> }
    expect(archive.jobs.backfill?.if).toBe("vars.APUS_RELEASE_AUTOMATION == 'true'")
    for (const id of ['macos', 'windows-x64']) {
      expect(release.jobs[id]?.if).toContain("inputs.mode == 'development'")
      expect(release.jobs[id]?.if).toContain("vars.APUS_RELEASE_AUTOMATION == 'true'")
    }
  })
})
