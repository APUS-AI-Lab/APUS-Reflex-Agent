/** Shared installed-product Reflex execution and settings acceptance. */
import { randomUUID } from 'node:crypto'

/** Reject a missing execution plugin or unexpectedly active routing, supervision, or context recovery. */
export function verifyReflexExecutionResponse(response, rpcId) {
  if (response?.type !== 'server-response' || response.rpcId !== rpcId || response.result?.ok !== true
    || !Array.isArray(response.result.value?.capabilities)) throw new Error('Reflex capability status RPC did not succeed.')
  const capabilities = response.result.value.capabilities
  return ['entryRouting', 'codexSupervision', 'contextMemory', 'skillSelection'].map(id => {
    const matches = capabilities.filter(capability => capability?.id === id)
    const capability = matches[0]
    if (matches.length !== 1 || capability.implemented !== true || capability.enabled !== (id === 'skillSelection')) {
      throw new Error(`Reflex execution capability differs from the product profile: ${id}`)
    }
    return { id, implemented: capability.implemented, enabled: capability.enabled }
  })
}

/** Read the running Host through the browser's authenticated, read-only Remote endpoint. */
export async function verifyReflexExecution(page) {
  const rpcId = randomUUID()
  const response = await page.request.post(new URL('/api/reflex/readStatus', page.url()).href, {
    data: { type: 'client-request', rpcId, method: 'reflex/readStatus', payload: { args: {} } }, timeout: 30_000,
  })
  try {
    if (!response.ok()) throw new Error('Reflex capability status request failed.')
    return verifyReflexExecutionResponse(await response.json(), rpcId)
  } finally { await response.dispose() }
}

/** Verify the three Reflex page modes and memory control; leave an unsaved custom draft selected. */
export async function verifyReflexSettings(dialog) {
  const mode = dialog.locator('#reflex-mode')
  await mode.waitFor({ state: 'visible' })
  const options = await mode.getByRole('option').allTextContents()
  const localizedOptions = [
    ['APUS Reflex limited-time free endpoint', 'Custom parameters', 'This Mac'],
    ['APUS Reflex 限时免费端点', '自定义参数', '本机'],
  ]
  if (!localizedOptions.some(expected => JSON.stringify(options) === JSON.stringify(expected))) {
    throw new Error('Reflex connection choices differ from the supported trial, custom, and local modes.')
  }
  await mode.selectOption('trial')
  await dialog.getByText(/^(Service protocol|服务协议): Reflex$/).waitFor()
  await dialog.locator('#reflex-endpoint').waitFor({ state: 'detached' })
  if (await dialog.locator('#reflex-api-key, #reflex-protocol').count() !== 0) {
    throw new Error('The trial mode exposes a credential field or protocol selector.')
  }
  await dialog.getByRole('switch', { name: /^Continuum (memory|无限记忆)$/, disabled: false }).waitFor()
  // Local mode shows the engine card when the local engine plugin is mounted, otherwise the page's own fallback.
  await mode.selectOption('local')
  await dialog.locator('[data-reflex-local]').first().waitFor({ state: 'visible' })
  if (await dialog.locator('#reflex-endpoint, #reflex-api-key').count() !== 0) {
    throw new Error('The local mode exposes remote connection fields.')
  }
  await mode.selectOption('custom')
  for (const id of ['reflex-endpoint', 'reflex-model', 'reflex-api-key']) {
    await dialog.locator(`#${id}`).waitFor({ state: 'visible' })
  }
  if (await dialog.locator('#reflex-protocol').count() !== 0) throw new Error('Custom mode exposes a protocol selector.')
}
