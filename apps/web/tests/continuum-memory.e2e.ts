/** Browser acceptance for the Reflex-only Continuum switch and Host persistence. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./continuum-memory.overlay.yml', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const INSTALL_ANCHORS = [
  join(REPO_ROOT, 'packages/experimental/apus-dsh-jev-plugin/package.json'),
  join(REPO_ROOT, 'packages/experimental/continuum-jev/package.json'),
  join(REPO_ROOT, 'packages/context/continuum/package.json'),
]

describe('web e2e: Continuum Reflex-only switch', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      developerTools: false,
      extraOverlayPath: OVERLAY,
      extraInstallAnchors: INSTALL_ANCHORS,
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows only with the Reflex host namespace and persists enabled across reload', async () => {
    await openSettings(page, 'zh')
    const dialog = page.getByRole('dialog', { name: '设置' })
    const row = dialog.getByText('Continuum 无限记忆', { exact: true })
    await row.waitFor({ state: 'visible' })
    await expect.poll(() => dialog.getByText('允许 Reflex 为后续回合管理基于 Session 的长历史记忆。', { exact: true }).count())
      .toBe(1)
    const toggle = dialog.getByRole('switch', { name: 'Continuum 无限记忆' })
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSettings(page, 'zh')
    await expect.poll(() => page.getByRole('dialog', { name: '设置' })
      .getByRole('switch', { name: 'Continuum 无限记忆' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('web e2e: original profile without Continuum/Reflex', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ developerTools: false })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the original General settings surface without the Continuum row', async () => {
    await openSettings(page, 'zh')
    const dialog = page.getByRole('dialog', { name: '设置' })
    await expect.poll(() => dialog.getByText('Continuum 无限记忆', { exact: true }).count()).toBe(0)
    await expect.poll(() => dialog.getByRole('button', { name: '通用设置', exact: true }).count()).toBe(1)
  })
})
