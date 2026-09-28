import { describe, expect, it } from 'vitest'
import { admitSystem3Routes, selectSystem3Route, type System3RouteCandidate } from '../src/index.ts'

const local9b: System3RouteCandidate = {
  id: 'local-9b',
  executionDomain: 'local',
  dataClasses: ['public', 'workspace', 'sensitive', 'secret'],
}
const codex: System3RouteCandidate = {
  id: 'codex',
  executionDomain: 'network',
  dataClasses: ['workspace'],
}
const claude: System3RouteCandidate = {
  id: 'claude-code',
  executionDomain: 'network',
  dataClasses: ['workspace', 'sensitive'],
}

describe('System3 privacy admission', () => {
  it('keeps local work and blocks every network route in local-only mode', () => {
    const result = admitSystem3Routes({ mode: 'local-only' }, [codex, local9b, claude])

    expect(result.allowed).toEqual([local9b])
    expect(result.blocked.map(item => [item.candidate.id, item.reason])).toEqual([
      ['codex', 'network-disallowed'],
      ['claude-code', 'network-disallowed'],
    ])
    expect(result.requiresClarification).toBe(false)
  })

  it('requires both route and data-class approval for controlled export', () => {
    const result = admitSystem3Routes({
      mode: 'controlled',
      approvedRemoteIds: ['codex', 'claude-code'],
      approvedRemoteDataClasses: ['workspace'],
    }, [codex, claude])

    expect(result.allowed).toEqual([codex])
    expect(result.blocked).toEqual([{ candidate: claude, reason: 'data-class-not-approved' }])
  })

  it('requires a separate cloud approval signal for cloud-approved mode', () => {
    const policy = {
      mode: 'cloud-approved' as const,
      approvedRemoteIds: ['codex'],
      approvedRemoteDataClasses: ['workspace'] as const,
    }
    expect(admitSystem3Routes(policy, [codex]).blocked[0]?.reason).toBe('cloud-approval-required')
    expect(admitSystem3Routes({ ...policy, cloudApproval: true }, [codex]).allowed).toEqual([codex])
  })

  it('lets Jev prefer a legal local route but cannot override local-only policy', () => {
    const result = selectSystem3Route({ mode: 'local-only' }, [local9b, codex], 'codex')

    expect(result.selected?.id).toBe('local-9b')
    expect(result.blocked[0]?.candidate.id).toBe('codex')
  })

  it('fails closed when all candidates are remote and preserves first duplicate only', () => {
    const result = selectSystem3Route({ mode: 'local-only' }, [codex, codex])

    expect(result.selected).toBeUndefined()
    expect(result.requiresClarification).toBe(true)
    expect(result.blocked).toHaveLength(1)
  })
})
