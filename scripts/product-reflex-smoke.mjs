/** Shared installed-product Reflex execution and settings acceptance. */
import { randomUUID } from 'node:crypto'

/**
 * Reject a missing execution plugin or unexpectedly active routing, supervision, or context recovery.
 * @param {unknown} response Host `reflex/readStatus` response envelope.
 * @param {string} rpcId Request id the envelope must answer.
 * @param {{ frontLoaded?: boolean }} [expected] Saved 决策前置 state; while off, Skill selection reports suspended.
 * @returns {{ id: string, implemented: boolean, enabled: boolean, suspended?: boolean }[]} The checked capability rows.
 */
export function verifyReflexExecutionResponse(response, rpcId, { frontLoaded = true } = {}) {
  if (response?.type !== 'server-response' || response.rpcId !== rpcId || response.result?.ok !== true
    || !Array.isArray(response.result.value?.capabilities)) throw new Error('Reflex capability status RPC did not succeed.')
  const capabilities = response.result.value.capabilities
  return ['entryRouting', 'codexSupervision', 'contextMemory', 'skillSelection'].map(id => {
    const matches = capabilities.filter(capability => capability?.id === id)
    const capability = matches[0]
    const installed = id === 'skillSelection'
    if (matches.length !== 1 || capability.implemented !== true || capability.enabled !== (installed && frontLoaded)
      || (capability.suspended === true) !== (installed && !frontLoaded)) {
      throw new Error(`Reflex execution capability differs from the product profile: ${id}`)
    }
    return { id, implemented: capability.implemented, enabled: capability.enabled,
      ...capability.suspended === true ? { suspended: true } : {} }
  })
}

/**
 * Read the running Host through the browser's authenticated, read-only Remote endpoint.
 * @param {import('playwright').Page} page Page served by the installed product.
 * @param {{ frontLoaded?: boolean }} [expected] Saved 决策前置 state.
 * @returns {Promise<{ id: string, implemented: boolean, enabled: boolean, suspended?: boolean }[]>} The checked capability rows.
 */
export async function verifyReflexExecution(page, expected) {
  const rpcId = randomUUID()
  const response = await page.request.post(new URL('/api/reflex/readStatus', page.url()).href, {
    data: { type: 'client-request', rpcId, method: 'reflex/readStatus', payload: { args: {} } }, timeout: 30_000,
  })
  try {
    if (!response.ok()) throw new Error('Reflex capability status request failed.')
    return verifyReflexExecutionResponse(await response.json(), rpcId, expected)
  } finally { await response.dispose() }
}

/** The three connection choices in menu order, in either shipped language. */
const LOCALIZED_MODES = [
  ['APUS Reflex limited-time free endpoint', 'Custom parameters', 'This Mac'],
  ['APUS Reflex 限时免费端点', '自定义参数', '本机'],
]

/**
 * Open the page's mode menu, which renders in a portal outside the dialog, and return its rows.
 * Rows are read from the open `menu` popup because the Windows caption menubar also renders `menuitem` buttons.
 */
async function openModeMenu(dialog) {
  await dialog.locator('#reflex-mode').click()
  const items = dialog.page().getByRole('menu').filter({ visible: true }).getByRole('menuitem')
  await items.first().waitFor({ state: 'visible' })
  return items
}

/** Choose one connection mode by its menu position: 0 preset, 1 custom, 2 local. */
async function chooseMode(dialog, index) {
  await (await openModeMenu(dialog)).nth(index).click()
}

/** Verify the three Reflex page modes and memory control; leave an unsaved custom draft selected. */
export async function verifyReflexSettings(dialog) {
  await dialog.locator('#reflex-mode').waitFor({ state: 'visible' })
  const options = await (await openModeMenu(dialog)).allTextContents()
  if (!LOCALIZED_MODES.some(expected => JSON.stringify(options) === JSON.stringify(expected))) {
    throw new Error('Reflex connection choices differ from the supported trial, custom, and local modes.')
  }
  await dialog.page().keyboard.press('Escape')
  await chooseMode(dialog, 0)
  await dialog.locator('#reflex-endpoint').waitFor({ state: 'detached' })
  if (await dialog.locator('#reflex-api-key, #reflex-protocol').count() !== 0) {
    throw new Error('The trial mode exposes a credential field or protocol selector.')
  }
  await dialog.getByRole('switch', { name: /^Continuum (memory|无限记忆)$/, disabled: false }).waitFor()
  // Local mode shows the engine card when the local engine plugin is mounted, otherwise the page's own fallback.
  await chooseMode(dialog, 2)
  await dialog.locator('[data-reflex-local]').first().waitFor({ state: 'visible' })
  if (await dialog.locator('#reflex-endpoint, #reflex-api-key').count() !== 0) {
    throw new Error('The local mode exposes remote connection fields.')
  }
  await chooseMode(dialog, 1)
  for (const id of ['reflex-endpoint', 'reflex-model', 'reflex-api-key']) {
    await dialog.locator(`#${id}`).waitFor({ state: 'visible' })
  }
  if (await dialog.locator('#reflex-protocol').count() !== 0) throw new Error('Custom mode exposes a protocol selector.')
}
