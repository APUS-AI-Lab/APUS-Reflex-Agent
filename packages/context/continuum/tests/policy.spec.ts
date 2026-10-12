import { describe, expect, it } from 'vitest'
import { ContinuumMemoryController, MemoryId, MemoryRecordStore, resolveContinuumMemorySwitch } from '../src/index.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

function store(): MemoryRecordStore {
  const result = new MemoryRecordStore()
  result.create({ id: MemoryId('workspace-fact'), kind: 'fact', scope: 'workspace', content: 'The migration is Friday.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }] })
  result.create({ id: MemoryId('private-fact'), kind: 'fact', scope: 'private', content: 'The private migration note.', sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(1) }] })
  return result
}

describe('Continuum switch, permission, and stop lifecycle', () => {
  it('keeps the original path when disabled or Reflex is absent', () => {
    expect(resolveContinuumMemorySwitch({ enabled: false, mode: 'active', reflexMounted: true })).toEqual({ enabled: false, mode: 'off', reason: 'disabled' })
    expect(resolveContinuumMemorySwitch({ enabled: true, mode: 'active', reflexMounted: false })).toEqual({ enabled: false, mode: 'off', reason: 'reflex-required' })
  })

  it('filters records by exact authorized scope', () => {
    const controller = new ContinuumMemoryController(store(), { enabled: true, mode: 'shadow', reflexMounted: true })
    const ticket = controller.beginRead({ scopes: ['workspace'] })
    expect(ticket).toBeDefined()
    const working = controller.read(ticket!, { maxCandidates: 5, maxExcerptBytes: 100, maxTotalBytes: 500 }, 'migration')
    expect(working?.candidates.map(candidate => candidate.id)).toEqual([MemoryId('workspace-fact')])
  })

  it('builds an authorized summary view and resolves source references on zoom', () => {
    const controller = new ContinuumMemoryController(store(), { enabled: true, mode: 'active', reflexMounted: true })
    const ticket = controller.beginRead({ scopes: ['workspace'] })!
    const tree = controller.summary(ticket, { maxItemsPerLeaf: 1, maxSummaryBytes: 64 })
    expect(tree?.children.map(child => child.path)).toEqual(['workspace/fact'])
    expect(controller.zoom(ticket, 'workspace/fact')).toEqual([{
      recordId: MemoryId('workspace-fact'),
      sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(0) }],
    }])
    expect(controller.zoom(ticket, 'private/fact')).toEqual([])
  })

  it('omits superseded and deactivated records and rejects stale view tickets', () => {
    const records = store()
    const controller = new ContinuumMemoryController(records, { enabled: true, mode: 'active', reflexMounted: true })
    const ticket = controller.beginRead({ scopes: ['workspace'] })!
    const replacement = records.supersede(MemoryId('workspace-fact'), 1, {
      id: MemoryId('workspace-fact-v2'), kind: 'fact', scope: 'workspace', content: 'The migration moved.',
      sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(2) }],
    })
    controller.observe(replacement)
    expect(controller.summary(ticket)).toBeDefined()
    const fresh = controller.beginRead({ scopes: ['workspace'] })!
    expect(controller.zoom(fresh, 'workspace/fact')?.map(source => source.recordId)).toEqual([MemoryId('workspace-fact-v2')])
    controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
    expect(controller.summary(fresh)).toBeUndefined()
  })

  it('invalidates an in-flight read after disable and deactivation', () => {
    const records = store()
    const controller = new ContinuumMemoryController(records, { enabled: true, mode: 'active', reflexMounted: true })
    const ticket = controller.beginRead({ scopes: ['workspace'] })!
    controller.setSwitch({ enabled: false, mode: 'off', reflexMounted: true })
    expect(controller.isCurrent(ticket)).toBe(false)
    const next = controller.setSwitch({ enabled: true, mode: 'active', reflexMounted: true })
    expect(next.reason).toBe('ready')
    const second = controller.beginRead({ scopes: ['workspace'] })!
    controller.deactivate(MemoryId('workspace-fact'), 1)
    expect(controller.isCurrent(second)).toBe(false)
  })

  it('invalidates an in-flight Jev read when a record is superseded', () => {
    const records = store()
    const controller = new ContinuumMemoryController(records, { enabled: true, mode: 'active', reflexMounted: true })
    const ticket = controller.beginRead({ scopes: ['workspace'] })!
    const replacement = records.supersede(MemoryId('workspace-fact'), 1, {
      id: MemoryId('workspace-fact-v2'), kind: 'fact', scope: 'workspace', content: 'The migration moved to Monday.',
      sourceRefs: [{ sessionId: SessionId('s'), eventSeq: SessionSeq(2) }],
    })
    controller.supersede(replacement)
    expect(controller.isCurrent(ticket)).toBe(false)
    expect(controller.beginRead({ scopes: ['workspace'] })).toBeDefined()
  })

  it('does not invalidate a read when the switch is unchanged', () => {
    const controller = new ContinuumMemoryController(store(), { enabled: true, mode: 'active', reflexMounted: true })
    const ticket = controller.beginRead({ scopes: ['workspace'] })!
    controller.setSwitch({ enabled: true, mode: 'active', reflexMounted: true })
    expect(controller.isCurrent(ticket)).toBe(true)
  })
})
