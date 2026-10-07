import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { FORK_GATE, stripForkGate } from './ci-fork-gate.ts'

describe('fork CI gate', () => {
  it('restores the upstream condition of wrapped, bare, and ungated jobs and steps', () => {
    const workflow = stripForkGate({ jobs: {
      wrapped: { if: `\${{ ${FORK_GATE} && (github.event_name == 'pull_request') }}`, steps: [{ if: FORK_GATE }, { run: 'x' }] },
      bare: { if: FORK_GATE },
      upstream: { if: 'always()' },
      boolean: { if: false },
      off: { if: `\${{ ${FORK_GATE} && (false) }}` },
      on: { if: `\${{ ${FORK_GATE} && (true) }}` },
    } })
    expect(workflow.jobs).toEqual({
      wrapped: { if: "github.event_name == 'pull_request'", steps: [{}, { run: 'x' }] },
      bare: {},
      upstream: { if: 'always()' },
      boolean: { if: false },
      off: { if: false },
      on: { if: true },
    })
    expect(stripForkGate('not a workflow')).toBe('not a workflow')
  })

  it('keeps upstream automation off in this repository unless the variable opts in', () => {
    for (const file of ['ci.yml', 'ci-master.yml']) {
      const raw = readFileSync(resolve(import.meta.dirname, '../.github/workflows', file), 'utf8')
      expect(raw, `${file} must gate upstream jobs`).toContain(FORK_GATE)
      const workflow = yaml.load(raw) as { jobs: Record<string, { if?: unknown }> }
      const ungated = Object.entries(workflow.jobs).filter(([, job]) => typeof job.if !== 'string' || !job.if.includes(FORK_GATE))
      expect(ungated.map(([name]) => name), `${file} jobs without the fork gate`).toEqual([])
    }
  })
})
