/** Recorded npm evidence stays intact while authored files and exact edits remain checked. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exactEditState, isRescopeExcluded, rewriteRescopeSource } from './rescope-vendor.ts'

const ANCHOR = '\n## Sync procedure'
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

describe('rescope file selection', () => {
  it('preserves the recorded npm resolution', () => {
    expect(isRescopeExcluded('scripts/dependency-catalog/package-lock.json')).toBe(true)
  })

  it.each([
    'scripts/dependency-catalog/package.json',
    'scripts/dependency-catalog/source.ts',
    'scripts/other/package-lock.json',
    'packages/example/src/index.ts',
    'packages/example/package.json',
  ])('keeps %s subject to upstream package-name checks', (file) => {
    expect(isRescopeExcluded(file)).toBe(false)
  })
})

describe('exactEditState', () => {
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    const remainder = 'exclude:\n'
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })
})

describe('runtime identifier literals', () => {
  const file = 'frontend/src/main/state/legacy-preset-migration.ts'
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const upstream = '@deepseek-ai/cordis'.split('/')[1]!

  it.each([
    'frontend/package-lock.json',
    file,
    'frontend/test/generation-installer.test.ts',
    'frontend/test/profile-compatibility.test.ts',
  ])('preserves counted runtime identifiers in %s', (owner) => {
    const text = readFileSync(new URL(`../${owner}`, import.meta.url), 'utf8')
    expect(rewriteRescopeSource(text, owner).text).toBe(text)
  })

  it('still rewrites a new import in the same owning file', () => {
    const input = `${source}\nimport '${upstream}'\n`
    expect(rewriteRescopeSource(input, file).text).toBe(`${source}\nimport '@deepseek-ai/cordis'\n`)
  })

  it('does not exempt the same literal in another file', () => {
    expect(rewriteRescopeSource(source, 'frontend/another.ts').text).not.toBe(source)
  })

  it('rejects duplicated and missing compatibility literals', () => {
    expect(() => rewriteRescopeSource(source + source, file)).toThrow(/expected 1 occurrences/)
    expect(() => rewriteRescopeSource('', file)).toThrow(/expected 1 occurrences/)
  })
})
