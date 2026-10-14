/** Shared setup of the compacted-history and memory Web scenarios. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'

const STANDARD_PRESET = fileURLToPath(new URL('../../../packages/bundle/web-app/presets/standard.patch.yml', import.meta.url))

/**
 * Patch the shipped standard preset row by id, changing only what a memory scenario needs: the compaction plugin writes
 * recall footers with the given thresholds, and the recall tools join the preset. Everything else stays as shipped.
 * @param compaction - `compaction-basic` thresholds the scenario compacts at.
 * @returns path of the generated patch.
 */
export function standardPresetWithRecall(compaction: Readonly<Record<string, number>>): string {
  const shipped = readFileSync(STANDARD_PRESET, 'utf8')
  const body = shipped.slice(shipped.indexOf('    - id: preset-standard'))
  const row = body.split('\n').map(line => line.slice(4)).join('\n')
  const mount = "            name: '@deepseek-ai/dsh-compaction-basic'\n"
  if (!row.includes(mount)) throw new Error('standard preset no longer mounts compaction-basic where this test expects')
  const settings = Object.entries(compaction).map(([key, value]) => `              ${key}: ${String(value)}\n`).join('')
  const patched = row.replace(mount, `${mount}            config:\n              recallFooter: true\n${settings}`)
    .trimEnd() + "\n      - id: tool-history-recall\n        name: '@deepseek-ai/dsh-tool-history-recall'\n"
  const path = join(tmpdir(), `history-memory-standard-${String(process.pid)}.patch.yml`)
  writeFileSync(path, patched)
  return path
}

/**
 * Connect a workspace like `connectFreshWorkspace`, without its standard-preset composer placeholder.
 * @param page - The authenticated page.
 * @param root - Scaffold workspace root; the scenario works in its `workspace` child.
 */
export async function connectWorkspace(page: Page, root: string): Promise<void> {
  mkdirSync(join(root, 'workspace'), { recursive: true })
  await page.getByRole('textbox', { name: 'Choose workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(join(root, 'workspace'))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 15_000 })
}
