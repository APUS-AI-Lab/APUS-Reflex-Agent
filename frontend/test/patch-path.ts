import { readdirSync } from 'node:fs'
import path from 'node:path'

export const projectRoot = path.resolve(import.meta.dirname, '..')

const patchesDir = path.join(projectRoot, 'patches')

/**
 * Patch files are named after the exact version they were captured against, so
 * every Harness upgrade renames all of them. Most of the patched packages are
 * transitive dependencies of `@deepseek-ai/dsh` and carry no pin of their own,
 * so resolve by package name and let the version fall where it may — otherwise
 * a version bump turns into a wall of unrelated test failures.
 */
export function patchPath(packageName: string): string {
  const prefix = `${packageName.replace('/', '+')}+`
  const matches = readdirSync(patchesDir).filter(
    (name) => name.startsWith(prefix) && name.endsWith('.patch')
  )
  const [only] = matches
  if (only === undefined || matches.length !== 1) {
    throw new Error(
      `expected exactly one patch for ${packageName}, found ${matches.length}`
    )
  }
  return path.join(patchesDir, only)
}

/** Whether the project still carries any patch against `packageName`. */
export function hasPatch(packageName: string): boolean {
  const prefix = `${packageName.replace('/', '+')}+`
  return readdirSync(patchesDir).some(
    (name) => name.startsWith(prefix) && name.endsWith('.patch')
  )
}
