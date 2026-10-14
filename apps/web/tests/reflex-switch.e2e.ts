/** Browser acceptance for the Reflex switch: the saved value persists and turns the Host's decision provider off and on. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./reflex-switch.overlay.yml', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const JEV_PACKAGE = join(REPO_ROOT, 'packages/experimental/apus-dsh-jev-plugin')
const INSTALL_ANCHORS = [join(REPO_ROOT, 'packages/experimental/client-ui-system3/package.json')]
const SHOT_DIR = process.env.REFLEX_SWITCH_SHOT_DIR
const DECISION = { state: null, questions: { q: { type: 'noul' as const } } }

describe('web e2e: Reflex switch', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    // The bundle reads these, as the product's does; a closed local port keeps every decision inside the process.
    process.env.JEV_ENDPOINT = 'http://127.0.0.1:9'
    process.env.JEV_MODEL = 'acceptance-no-call'
    scaffold = await launchWebScaffold({ developerTools: false, extraOverlayPath: OVERLAY, extraInstallAnchors: INSTALL_ANCHORS,
      profile: { packages: [{ dir: JEV_PACKAGE, enabled: true }] } })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    Reflect.deleteProperty(process.env, 'JEV_ENDPOINT')
    Reflect.deleteProperty(process.env, 'JEV_MODEL')
  })

  /** The Reflex page's switch, opened from the settings dialog. */
  const reflexSwitch = async () => {
    await openSettings(page, 'zh')
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: 'Reflex 配置', exact: true }).click()
    return { dialog, toggle: dialog.getByRole('switch', { name: '启用 Reflex 决策' }) }
  }
  /** Whether the Host's provider accepts decisions; a configuration error other than the switch also counts as on. */
  const resolves = (): boolean => {
    try {
      scaffold.ctx.get('jev')?.resolve(DECISION)
      return true
    } catch (error) {
      // The Host runs the built plugin, so its error classes differ from this file's imports; their names do not.
      if (error instanceof Error && error.name === 'JevDisabledError') return false
      if (error instanceof Error && error.name === 'JevConfigurationError') return true
      throw error
    }
  }

  it('turns Reflex decisions off and on from settings, persisting the choice across reload', async () => {
    expect(resolves()).toBe(true)
    let { dialog, toggle } = await reflexSwitch()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await dialog.getByText('已开启：输入判断、Skill 选择、工作区预取等由 Reflex 在主模型之前完成', { exact: true }).waitFor()
    if (SHOT_DIR !== undefined) await page.screenshot({ path: `${SHOT_DIR}/reflex-switch-on.png` })

    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    await dialog.getByText('已关闭：所有请求按原生流程执行，不调用决策服务', { exact: true }).waitFor()
    await expect.poll(resolves).toBe(false)
    if (SHOT_DIR !== undefined) await page.screenshot({ path: `${SHOT_DIR}/reflex-switch-off.png` })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 });
    ({ dialog, toggle } = await reflexSwitch())
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    expect(resolves()).toBe(false)

    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await expect.poll(resolves).toBe(true)
  })
})
