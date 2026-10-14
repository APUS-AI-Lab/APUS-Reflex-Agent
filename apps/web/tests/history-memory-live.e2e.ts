/** Live Web flow on DeepSeek's official API and the deployed APUS Reflex (Jev): compaction, memory scoring, and per-turn recall. */
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import { connectWorkspace, standardPresetWithRecall } from './history-memory.support.ts'

const OVERLAY = fileURLToPath(new URL('./history-memory-live.overlay.yml', import.meta.url))
const INSTALL_ANCHORS = ['system3', 'client-ui-system3', 'apus-dsh-jev-plugin'].map(name =>
  fileURLToPath(new URL(`../../../packages/experimental/${name}/package.json`, import.meta.url)))
  .concat(fileURLToPath(new URL('../../../packages/session-query/tool-history-recall/package.json', import.meta.url)))
const SHOT_DIR = process.env.HISTORY_MEMORY_SHOT_DIR
const LIVE_TIMEOUT_MS = 900_000

/** Distinct filler, so compaction has real history to replace and nothing in it is worth remembering. */
function padding(turn: number): string {
  const topics = ['城市绿化', '图书馆排架', '咖啡烘焙', '高山徒步', '天文观测', '古籍修复', '海洋潮汐', '城市公交']
  const lines = Array.from({ length: 160 }, (_, index) =>
    `第${String(turn)}段资料第${String(index + 1)}条：关于${topics[(turn + index) % topics.length]!}的背景说明，与当前任务无关，只用于填充上下文。`)
  return `以下是一段背景资料，阅读后只回复“收到”，不要调用任何工具。\n${lines.join('\n')}`
}

/** Text of the dock card that lists the recall for the latest input, or null while none is shown. */
async function recallCard(page: Page): Promise<string | null> {
  const card = page.locator('[data-system3-memory="recalled"]')
  if (await card.count() === 0) return null
  if (!await card.evaluate(element => (element as HTMLDetailsElement).open)) await card.locator('summary').click()
  return card.innerText()
}

// Record mode mounts the real DeepSeek adapter; the Jev key gates the rest. Without either the case skips.
describe.runIf(webSnapshotMode() === 'record' && process.env.APUS_JEV_API_KEY !== undefined)(
  'web e2e (live): Continuum memory on DeepSeek and APUS Reflex', () => {
    it('compacts, keeps the constraint, and recalls each compacted original only for the question that needs it', async () => {
      const scaffold = await launchWebScaffold({
        extraOverlayPath: [OVERLAY, standardPresetWithRecall({ thresholdRatio: 0.7, headroomTokens: 2048, retainRatio: 0.2 })],
        extraInstallAnchors: INSTALL_ANCHORS,
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
          const shot = async (name: string): Promise<void> => {
            if (SHOT_DIR !== undefined) await page.screenshot({ path: `${SHOT_DIR}/${name}.png` })
          }
          await send('请记住这条要求：订单统计只算已支付订单，金额阈值是 100 美元。只回复“已记住”。')
          await send('另外记一下：部署区域是 us-east-1。只回复“好”。')
          for (let turn = 1; turn <= 6; turn += 1) await send(padding(turn))
          await page.getByText(/^Originals recallable · checkpoint \d+$/u).first().waitFor({ state: 'attached' })
          await page.getByText(/^Memory card · originals kept after compaction: \d+$/u).waitFor()

          await send('上次说的金额阈值是多少？只用一句话回答。')
          const threshold = await recallCard(page)
          expect(threshold).toContain('金额阈值是 100 美元')
          expect(threshold).not.toContain('us-east-1')
          // The visible answer; the collapsed memory card quotes the original too.
          await page.getByText(/100 ?美元/u).filter({ visible: true }).last().waitFor()
          await shot('live-threshold')

          await send('部署区域是哪里？只用一句话回答。')
          const region = await recallCard(page)
          expect(region).toContain('us-east-1')
          expect(region).not.toContain('金额阈值')
          await page.getByText(/us-east-1/u).filter({ visible: true }).last().waitFor()
          await shot('live-region')

          await send('用一句话说说你最喜欢的季节，不要调用任何工具。')
          expect(await recallCard(page)).toBeNull()
          await shot('live-unrelated')
          expect(tripwire.pageErrors).toEqual([])
        } catch (error) {
          await saveFailureShot(page, 'history-memory-live')
          throw error
        }
      } finally {
        await browser.close()
        await scaffold.close()
      }
    }, LIVE_TIMEOUT_MS)
  })
