/** Real Web flow: compaction gains a recall label, the history tools get cards, and System3 shows its memory card. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { newEnglishPage, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./history-memory.overlay.yml', import.meta.url))
const INSTALL_ANCHORS = ['system3', 'client-ui-system3', 'apus-dsh-jev-plugin'].map(name =>
  fileURLToPath(new URL(`../../../packages/experimental/${name}/package.json`, import.meta.url)))
  .concat(fileURLToPath(new URL('../../../packages/session-query/tool-history-recall/package.json', import.meta.url)))
const SHOT_DIR = process.env.HISTORY_MEMORY_SHOT_DIR
const STANDARD_PRESET = fileURLToPath(new URL('../../../packages/bundle/web-app/presets/standard.patch.yml', import.meta.url))

/**
 * Patch the shipped standard preset row by id, changing only what this scenario needs: the compaction plugin writes
 * recall footers at a small window, and the recall tools join the preset. Everything else stays as shipped.
 * @returns path of the generated patch.
 */
function standardPresetWithRecall(): string {
  const shipped = readFileSync(STANDARD_PRESET, 'utf8')
  const body = shipped.slice(shipped.indexOf('    - id: preset-standard'))
  const row = body.split('\n').map(line => line.slice(4)).join('\n')
  const compaction = "            name: '@deepseek-ai/dsh-compaction-basic'\n"
  if (!row.includes(compaction)) throw new Error('standard preset no longer mounts compaction-basic where this test expects')
  const patched = row.replace(compaction, `${compaction}            config:\n              recallFooter: true\n`
    + '              thresholdRatio: 0.5\n              headroomTokens: 0\n              retainRatio: 0.1\n              maxTokens: 512\n')
    .trimEnd() + "\n      - id: tool-history-recall\n        name: '@deepseek-ai/dsh-tool-history-recall'\n"
  const path = join(tmpdir(), `history-memory-standard-${String(process.pid)}.patch.yml`)
  writeFileSync(path, patched)
  return path
}

/** A System One gateway that keeps messages carrying a literal access code and recalls them only for a question about the code. */
async function startGateway(): Promise<{ readonly endpoint: string; readonly requests: number[]; close(): void }> {
  const requests: number[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      const parsed = JSON.parse(body) as { model: string; questions: Record<string, { instructions?: string }> }
      requests.push(Object.keys(parsed.questions).length)
      const answers = Object.fromEntries(Object.entries(parsed.questions).map(([key, question]) => {
        const instructions = question.instructions ?? ''
        const input = /用户当前输入：「(.*?)」/u.exec(instructions)?.[1]
        const relevant = /ALPHA-\d+/u.test(instructions) && (input === undefined || input.includes('access code?'))
        return [key, { type: 'noul', noul: relevant ? 0.93 : 0.04 }]
      }))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ model: parsed.model, answers }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return { endpoint: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, requests, close: () => { server.close() } }
}

/** Connect a workspace like `connectFreshWorkspace`, without its standard-preset composer placeholder. */
async function connectWorkspace(page: Page, root: string): Promise<void> {
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

describe.skipIf(webSnapshotMode() === 'record')('web e2e: compacted history recall and memory', () => {
  it('labels recallable checkpoints, renders recall tool cards, and shows the memory card', async () => {
    const gateway = await startGateway()
    process.env.MEMORY_E2E_JEV_ENDPOINT = gateway.endpoint
    const scaffold = await launchWebScaffold({
      extraOverlayPath: [OVERLAY, standardPresetWithRecall()], extraInstallAnchors: INSTALL_ANCHORS,
    })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      try {
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await connectWorkspace(page, scaffold.workspaceCwd)
        const send = async (text: string): Promise<void> => {
          const settled = scaffold.whenTurnSettled()
          const input = page.locator('[data-composer-input]').first()
          await input.fill(text)
          await input.press('Enter')
          await settled
        }
        await send('Remember the access code ALPHA-7731 for later.')
        await send('Padding request: thanks, keep going.')
        for (let turn = 0; turn < 4; turn += 1) await send(`Padding request ${String(turn)}.`)
        await send('Read the compacted originals.')
        await send('Search the compacted history.')
        await send('What was the access code?')

        // Compaction markers and tool rows sit inside each turn's collapsed work section; open every one.
        for (const fold of await page.getByRole('button', { name: /^Took / }).all()) {
          if (await fold.isEnabled() && await fold.getAttribute('aria-expanded') !== 'true') await fold.click()
        }
        const seen = async (locator: ReturnType<Page['getByText']>): Promise<void> => {
          await locator.waitFor({ state: 'attached', timeout: 15_000 })
          // Tool rows sit in each step's collapsed process group; open them like a reader would.
          for (const header of await page.locator('[data-step-process] button[aria-expanded="false"]').all()) {
            if (await header.isVisible()) await header.click()
          }
          await locator.scrollIntoViewIfNeeded()
          await locator.waitFor({ state: 'visible' })
        }
        const recallLabel = page.getByText(/^Originals recallable · checkpoint \d+$/u).first()
        await seen(recallLabel)
        if (SHOT_DIR !== undefined) await page.screenshot({ path: `${SHOT_DIR}/compaction-recall.png` })
        await seen(page.getByText('Recall compacted originals').first())
        if (SHOT_DIR !== undefined) await page.screenshot({ path: `${SHOT_DIR}/recall-tool.png` })
        await seen(page.getByText('Search compacted originals').first())
        const memory = page.getByText('Memory card · originals kept after compaction: 1')
        await memory.waitFor({ timeout: 15_000 })
        await memory.click()
        await page.locator('[data-system3-memory="kept"]').getByText(/^· Remember the access code ALPHA-7731 for later\. \(checkpoint \d+ · score 93\)$/u).waitFor()
        const recalled = page.getByText('Recalled this turn · compacted originals: 1')
        await recalled.waitFor({ timeout: 15_000 })
        await recalled.click()
        await page.locator('[data-system3-memory="recalled"]').getByText(/^· Remember the access code ALPHA-7731 for later\. \(checkpoint \d+ · score 93\)$/u).waitFor()
        await page.getByText('From memory: the code is ALPHA-7731.').waitFor()
        expect(gateway.requests.length).toBeGreaterThan(0)
        if (SHOT_DIR !== undefined) await page.screenshot({ path: `${SHOT_DIR}/history-memory.png`, fullPage: true })
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      } catch (error) {
        await saveFailureShot(page, 'history-memory')
        throw error
      }
    } finally {
      await browser.close()
      await scaffold.close()
      gateway.close()
    }
  }, 300_000)
})
