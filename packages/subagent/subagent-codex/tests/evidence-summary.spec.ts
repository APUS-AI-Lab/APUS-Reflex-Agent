import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { summarizeNativeEvidence } from '../src/evidence-summary.ts'
import { Config } from '../src/index.ts'

const workspace = resolve('/workspace')
const limits = { maxActions: 8, maxPathChars: 80 }

describe('native operation summaries', () => {
  it('extracts structured native actions without command, query, output or reasoning', () => {
    const summary = summarizeNativeEvidence({ type: 'commandExecution', cwd: workspace,
      command: 'SECRET', aggregatedOutput: 'SECRET', reasoning: 'SECRET',
      commandActions: [{ type: 'read', name: 'SECRET', command: 'SECRET', path: 'src/main.ts' },
        { type: 'listFiles', path: workspace }, { type: 'search', query: 'SECRET', path: 'tests' }] }, workspace, limits)
    expect(summary).toEqual({ version: 1, truncated: false, actions: [
      { kind: 'read', path: 'src/main.ts' }, { kind: 'list-files', path: '.' }, { kind: 'search', path: 'tests' }] })
    expect(JSON.stringify(summary)).not.toContain('SECRET')
  })

  it('extracts file change kinds and omits diffs and move metadata', () => {
    expect(summarizeNativeEvidence({ type: 'fileChange', changes: [
      { kind: { type: 'add' }, path: 'new.txt', diff: 'SECRET' },
      { kind: { type: 'update', move_path: 'SECRET' }, path: 'old.txt' },
      { kind: { type: 'delete' }, path: 'gone.txt' },
    ] }, workspace, limits)).toEqual({ version: 1, truncated: false, actions: [
      { kind: 'file-add', path: 'new.txt' }, { kind: 'file-update', path: 'old.txt' }, { kind: 'file-delete', path: 'gone.txt' }] })
  })

  it('omits unknown or malformed actions instead of interpreting command text', () => {
    for (const commandActions of [undefined, null, {}, [], [null, [], 1, { type: 'unknown', command: 'cat private' }]]) {
      expect(summarizeNativeEvidence({ type: 'commandExecution', commandActions }, workspace, limits)).toBeUndefined()
    }
    expect(summarizeNativeEvidence({ type: 'fileChange', changes: [{ kind: 'add' }] }, workspace, limits)).toBeUndefined()
    expect(summarizeNativeEvidence({ type: 'commandExecution', commandActions: [null, { type: 'read' }] }, workspace, limits))
      .toEqual({ version: 1, actions: [{ kind: 'read' }], truncated: true })
  })

  it('resolves relative command targets only from the reported native cwd', () => {
    expect(summarizeNativeEvidence({ type: 'commandExecution', cwd: resolve(workspace, 'src'),
      commandActions: [{ type: 'read', path: '../tests/a.ts' }] }, workspace, limits)?.actions)
      .toEqual([{ kind: 'read', path: 'tests/a.ts' }])
    for (const cwd of [undefined, 'relative']) {
      expect(summarizeNativeEvidence({ type: 'commandExecution', cwd,
        commandActions: [{ type: 'read', path: 'src.ts' }] }, workspace, limits))
        .toEqual({ version: 1, actions: [{ kind: 'read' }], truncated: true })
    }
    expect(summarizeNativeEvidence({ type: 'commandExecution', commandActions: [{ type: 'read', path: resolve(workspace, 'src.ts') }] }, workspace, limits)?.actions)
      .toEqual([{ kind: 'read', path: 'src.ts' }])
  })

  it('omits outside, malformed and over-budget paths without slicing their identity', () => {
    const paths = [undefined, null, 1, '', '../outside', '..', resolve(workspace, '..', 'other', 'file'),
      'private\nfile', 'a'.repeat(81), 'C:\\private\\file', ...sep === '/' ? ['src\\file'] : []]
    for (const path of paths) {
      expect(summarizeNativeEvidence({ type: 'fileChange', changes: [{ kind: { type: 'update' }, path }] }, workspace, limits))
        .toEqual({ version: 1, truncated: true, actions: [{ kind: 'file-update' }] })
    }
  })

  it('bounds actions and reports discarded evidence', () => {
    expect(summarizeNativeEvidence({ type: 'fileChange', changes: [
      { kind: { type: 'add' }, path: 'one' }, { kind: { type: 'add' }, path: 'two' },
    ] }, workspace, { ...limits, maxActions: 1 })).toEqual({ version: 1, truncated: true, actions: [{ kind: 'file-add', path: 'one' }] })
  })

  it('requires positive integer budgets when collection is enabled', () => {
    expect(Config({}).evidenceSummary).toBeUndefined()
    expect(Config({ evidenceSummary: limits }).evidenceSummary).toEqual(limits)
    for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => Config({ evidenceSummary: { ...limits, maxActions: value } })).toThrow()
      expect(() => Config({ evidenceSummary: { ...limits, maxPathChars: value } })).toThrow()
    }
    expect(() => Schema.resolve({ evidenceSummary: {} }, Config, {})).toThrow()
  })
})
