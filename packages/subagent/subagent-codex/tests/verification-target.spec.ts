import { describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { verificationTargets } from '../src/verification-target.ts'
import { summarizeNativeEvidence } from '../src/evidence-summary.ts'
import { Config } from '../src/index.ts'

describe('literal verification targets', () => {
  it.each(['pytest finance/test_total.py', 'python -m pytest finance/test_total.py',
    'python3 -m unittest finance/test_total.py'])('recognizes %s without publishing command text', (command) => {
    expect(verificationTargets(command, 4096, 'linux')).toEqual({ envelope: 'direct', paths: ['finance/test_total.py'] })
  })
  it.each(['sh', '/bin/bash', '/usr/bin/zsh'])('unwraps exactly one %s transport', (shell) => {
    expect(verificationTargets(`${shell} -lc 'python3 -m unittest finance/test_total.py'`, 4096, 'linux'))
      .toEqual({ envelope: 'posix-shell', paths: ['finance/test_total.py'] })
  })
  it.each(['', 'pytest', 'python -m pytest', 'pytest "', 'pytest $TARGET', 'pytest $(echo test.py)',
    'pytest $((1))', 'pytest *.py', 'pytest t.py | cat', 'pytest t.py && echo done', 'pytest t.py; echo done',
    'pytest t.py &', '(pytest t.py)', 'X=1 pytest t.py', 'X=1', 'pytest t.py >out',
    'echo pytest t.py', 'python verify.py', 'python -m other t.py', 'pytest -q t.py',
    'pytest t.py::test_total', 'pytest t.py\n', 'sh -c', 'sh -x "pytest t.py"',
    'sh -c "pytest t.py" extra', 'sh -c "pytest \'"', 'sh -c \'sh -c "pytest t.py"\''])('rejects %j', (command) => {
    expect(verificationTargets(command, 4096, 'linux')).toMatchObject({ envelope: 'unsupported', paths: [] })
  })
  it.each([
    ['pytest t.py && echo done', 'compound'], ['X=1 pytest t.py', 'environment'],
    ['pytest t.py > out', 'redirection'], ['pytest $FILE', 'nonliteral'],
    ['sh -x "pytest t.py"', 'wrapper'], ['echo pytest t.py', 'command'],
    ['pytest -q t.py', 'options'], ['pytest t.py::check', 'target'], ['pytest "', 'syntax'],
  ])('reports only fixed diagnostics for %s', (command, rejection) => {
    expect(verificationTargets(command, 4096, 'linux').rejection).toBe(rejection)
  })
  it('rejects unsupported platforms, absent commands and oversized inputs before parsing', () => {
    expect(verificationTargets('pytest t.py', 4096, 'win32').paths).toEqual([])
    expect(verificationTargets(undefined, 4096, 'linux').paths).toEqual([])
    expect(verificationTargets('pytest t.py', 2, 'linux').paths).toEqual([])
    expect(verificationTargets('pytest t.py t.py', 4096, 'linux').paths).toEqual(['t.py'])
  })
  it.skipIf(process.platform === 'win32')('collects an executed target only with explicit opt-in and native cwd', () => {
    const item = { type: 'commandExecution', cwd: '/workspace', command: "sh -lc 'python3 -m unittest finance/test_total.py'",
      commandActions: [{ type: 'unknown' }] }
    const limits = { maxActions: 8, maxPathChars: 160 }
    expect(summarizeNativeEvidence(item, '/workspace', limits)).toBeUndefined()
    expect(summarizeNativeEvidence(item, '/workspace', { ...limits, verificationTargets: { maxCommandChars: 4096 } }))
      .toEqual({ version: 1, truncated: false, actions: [{ kind: 'verification-target', path: 'finance/test_total.py' }] })
    expect(summarizeNativeEvidence({ ...item, command: 'pytest ../outside.py' }, '/workspace',
      { ...limits, verificationTargets: { maxCommandChars: 4096 } }))
      .toEqual({ version: 1, truncated: true, actions: [{ kind: 'verification-target' }] })
  })
  it('validates the parser budget through the actual configuration parser', () => {
    for (const maxCommandChars of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => Schema.resolve({ model: 'fixture', evidenceSummary: {
        maxActions: 8, maxPathChars: 160, verificationTargets: { maxCommandChars },
      } }, Config, {})).toThrow()
    }
    expect(() => Schema.resolve({ model: 'fixture', evidenceSummary: {
      maxActions: 8, maxPathChars: 160, verificationTargets: { maxCommandChars: 4096 },
    } }, Config, {})).not.toThrow()
  })
})
