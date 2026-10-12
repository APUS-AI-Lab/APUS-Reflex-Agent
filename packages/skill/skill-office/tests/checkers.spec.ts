import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const PROCESS_TIMEOUT_MS = 30_000

// The Python suite owns the deadline; leave time to reap its process and inspect the exit.
it.each(['utf-8', 'cp1252'])('executes the shipped OOXML checker against valid, edited, and broken documents with %s stdout', { timeout: PROCESS_TIMEOUT_MS + 15_000 }, (encoding) => {
  const python = process.env.DSH_OFFICE_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  const result = spawnSync(python, [fileURLToPath(new URL('./check_office_test.py', import.meta.url))], {
    env: { ...process.env, PYTHONIOENCODING: encoding },
    encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS,
  })
  expect(result.error).toBeUndefined()
  expect(result.signal, result.stderr + result.stdout).toBeNull()
  expect(result.status, result.stderr + result.stdout).toBe(0)
})
