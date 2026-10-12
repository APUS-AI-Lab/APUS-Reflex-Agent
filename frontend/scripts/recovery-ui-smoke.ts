import { app, BrowserWindow, ipcMain, shell, desktopCapturer } from 'electron'
import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAFE_MODE_FRAME_CHANNEL, SAFE_MODE_FRAME_UPDATE_CHANNEL, SafeModeFrame } from '../src/main/safe-mode-frame'
import { buildSafeModeViewModel } from '../src/main/safe-mode'
import { buildPluginRecoveryViewModel } from '../src/main/plugin-recovery-view'
import { WINDOWS_TITLEBAR_HEIGHT } from '../src/shared/desktop-menu'
import { secureWindow } from '../src/main/security'

const scale = process.env.RECOVERY_UI_SCALE || '1'
const zoom = process.env.RECOVERY_UI_ZOOM || '1'
const zoomFactor = Number(zoom)
if (!Number.isFinite(zoomFactor) || zoomFactor < 0.25 || zoomFactor > 5) throw new Error(`Invalid RECOVERY_UI_ZOOM: ${zoom}`)
// Keep the established scale-<n> artifact layout for the normal page zoom.
// The sibling scale-<n>-zoom-<n> directory also matches the release workflow's
// scale-* artifact glob, so page-zoom evidence is retained in CI.
const output = join(process.env.RECOVERY_UI_OUTPUT!, zoomFactor === 1 ? `scale-${scale}` : `scale-${scale}-zoom-${zoom}`)
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.commandLine.appendSwitch('force-device-scale-factor', scale)
app.on('window-all-closed', () => {})
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const results: unknown[] = []
const external: string[] = []
shell.openExternal = async url => { external.push(url) }
ipcMain.on('dsh:storage-load-sync', event => { event.returnValue = {} })
ipcMain.on('dsh:storage-sync', () => {})
ipcMain.handle('updates:status', () => ({ phase: 'idle', currentVersion: '0.0.0', manual: false }))
ipcMain.handle('mobile:status', () => ({ connected: false }))
ipcMain.handle('desktop-titlebar:popup-menu', () => {})
ipcMain.handle('desktop-titlebar:set-theme', () => {})

async function capture(contents: Electron.WebContents, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(path, (await contents.capturePage(undefined, { stayAwake: true })).toPNG())
      return
    } catch (error) {
      if (attempt === 2) throw new Error(`Unable to capture ${path}`, { cause: error })
      await delay(250)
    }
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  const parent = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 640,
    show: true, frame: process.platform !== 'darwin',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#00000000', symbolColor: '#fafafa', height: WINDOWS_TITLEBAR_HEIGHT },
      autoHideMenuBar: true
    } : {}),
    backgroundColor: '#18181b',
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  parent.setMenuBarVisibility(false)
  secureWindow(parent)
  const names = ['calendar-plugin', 'search-plugin', 'notes-plugin', '@community/billing-plugin', '@community/longer-agent-memory-plugin', 'mobile-plugin']
  let closed = 0
  for (const scenario of ['safe-mode', 'plugin-recovery', 'multiple-plugins', 'market-offline', 'unidentified-plugin']) {
    const page = scenario === 'unidentified-plugin' || scenario === 'multiple-plugins' || scenario === 'market-offline' ? 'plugin-recovery' : scenario
    await parent.loadURL('data:text/html,<body style="background:%2318181b;color:%23999">APUS Reflex Harness</body>')
    // In the app the Safe Mode page is an iframe the Harness page's preload
    // mounts over its main pane; here it fills the window, which gives the
    // same viewport its layout must fit.
    const contents = parent.webContents
    const rendererErrors: string[] = []
    contents.on('console-message', event => { if (event.level === 'error') rendererErrors.push(event.message) })
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark']) for (const [width, height] of [[1280,800], [900,640]]) {
      parent.setSize(width!, height!)
      if (process.platform === 'win32') {
        parent.setTitleBarOverlay({ color: '#00000000', symbolColor: theme === 'dark' ? '#fafafa' : '#18181b', height: WINDOWS_TITLEBAR_HEIGHT })
      }
      const model = page === 'safe-mode' ? buildSafeModeViewModel({ locale, plugins: names }) : buildPluginRecoveryViewModel({
        locale, plugins: scenario === 'unidentified-plugin' ? [] : (scenario === 'multiple-plugins' || scenario === 'market-offline') ? names.slice(0, 3) : [names[0]!], removedPlugins: [],
        pluginChecks: scenario === 'market-offline' ? names.slice(0, 3).map(packageName => ({ packageName, hint: 'ENOTFOUND — 请重新检查更新' })) : scenario === 'multiple-plugins' ? names.slice(0, 3).map((packageName, index) => ({
          packageName, hint: index === 1 ? '已是 latest，仍阻挡启动，请卸载此插件。' : '可尝试升级，兼容性未确认；升级后仍需验证启动。',
          removalRecommended: index === 1,
          upgradeCandidate: index === 1 ? undefined : { packageName, targetVersion: '2.0.0' }
        })) : undefined,
        snapshot: { phase: 'failed', message: 'Plugin startup conflict', logs: ['duplicate prefix route "/calendar/api"'] }
      })
      if ('pluginItems' in model) {
        model.pluginItems.forEach((item, index) => {
          item.installedVersion = '0.4.0'
          if (index < 3) return
          Object.assign(item, { upgradeReady: true, upgradeVersion: '0.5.1', statusTone: 'success',
            statusLabel: locale === 'zh' ? '（发现新版本 v0.5.1）' : '(Update available v0.5.1)',
            upgradeButtonLabel: locale === 'zh' ? '升级至 v0.5.1' : 'Upgrade to v0.5.1' })
        })
        model.upgradeReadyCount = 3
        model.upgradeAllLabel = locale === 'zh' ? '一键升级 3 个已适配插件' : 'Upgrade 3 compatible plugins'
      }
      await contents.loadFile(join(process.cwd(), 'build', `${page}.html`), { query: { state: JSON.stringify(model), theme, icon: '../.build/brand/brand-icon.png' } })
      // Electron page zoom is independent of the device scale factor above.
      // Set it on the real WebContents after navigation so the layout and
      // input hit targets are measured at the requested CSS zoom.
      contents.setZoomFactor(zoomFactor)
      contents.focus()
      await delay(150)
      assert.equal(BrowserWindow.getAllWindows().length, 1, 'The page must not create another native window')
      // At a fractional scale factor the viewport is a fractional number of
      // CSS pixels (800 / 1.5 = 533.33); innerHeight rounds that down while a
      // full-height layout's bottom edge does not, so edges are compared
      // against the visual viewport's exact size.
      const layout = {
        ...(await contents.executeJavaScript(`(() => {
        const content=document.querySelector('.content'), list=document.querySelector('.plugins'), footer=document.querySelector('.footer');
        const cr=content.getBoundingClientRect(), fr=footer.getBoundingClientRect();
        const vw=visualViewport.width, vh=visualViewport.height, epsilon=0.5;
        const actionSelector = ${JSON.stringify(page === 'safe-mode' ? '.actions button:not([hidden])' : '#decision-row button:not([hidden])')};
        return { width:innerWidth, height:innerHeight, viewport:[vw,vh], dpr:devicePixelRatio,
          zoom:visualViewport.scale,
          outerHorizontalScroll:document.documentElement.scrollWidth>vw+epsilon,
          outerVerticalScroll:document.documentElement.scrollHeight>vh+epsilon,
          contentScroll:content.scrollHeight>content.clientHeight,
          listScroll:list ? list.scrollHeight>list.clientHeight : false,
          mainActionsVisible:[...document.querySelectorAll(actionSelector)].filter(b=>b.getBoundingClientRect().height).every(b=>{const r=b.getBoundingClientRect();return r.top>=cr.top-epsilon&&r.bottom<=vh+epsilon&&r.right<=vw+epsilon}),
          footerBottom:fr.bottom,
          footerVisible:fr.bottom<=vh+epsilon,
          supportLabel:document.querySelector('#community-label').innerText }
      })()`)),
        // visualViewport.scale is the browser pinch scale and remains 1 for
        // Electron page zoom. The WebContents value is the authoritative page
        // zoom factor; retain it in the evidence alongside the CSS viewport.
        pageZoomFactor: contents.getZoomFactor(),
      }
      const where = `${scenario} ${locale} ${theme} ${width}x${height} -> ${JSON.stringify(layout)}`
      assert.equal(layout.pageZoomFactor, zoomFactor, `page zoom must be applied to WebContents: ${where}`)
      assert.ok(Math.abs(layout.viewport[0] - width / zoomFactor) <= 1, `CSS viewport width must reflect page zoom: ${where}`)
      assert.ok(Math.abs(layout.viewport[1] - height / zoomFactor) <= 1, `CSS viewport height must reflect page zoom: ${where}`)
      assert.equal(layout.outerHorizontalScroll, false, `page must not overflow horizontally: ${where}`)
      assert.equal(layout.footerVisible, true, `footer must end inside the viewport: ${where}`)
      const actionReachability = await contents.executeJavaScript(`(() => {
        const selector = ${JSON.stringify(page === 'safe-mode' ? '.actions button:not([hidden])' : '#decision-row button:not([hidden])')};
        const targets = [...document.querySelectorAll(selector)].filter(button => button.getBoundingClientRect().height > 0);
        for (const target of targets) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return targets.map(target => {
          const r = target.getBoundingClientRect();
          return { visible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= visualViewport.width + 0.5 && r.top >= 0 && r.bottom <= visualViewport.height + 0.5 };
        });
      })()`)
      assert.equal(actionReachability.length > 0 && actionReachability.every((item: { visible: boolean }) => item.visible), true,
        `primary actions must remain reachable, with vertical scroll allowed: ${where}`)
      if (page === 'safe-mode') {
        if (zoomFactor === 1) assert.equal(layout.contentScroll, false, `content must not scroll: ${where}`)
        // At normal page zoom the wide viewport should fit the list; at 200%
        // page zoom vertical scrolling inside this list is an accessible and
        // intentional fallback, while outer horizontal overflow remains disallowed.
        if (width === 1280 && zoomFactor === 1) assert.equal(layout.listScroll, false, `list must fit: ${where}`)
      }
      if (page === 'plugin-recovery') {
        const visibleLabels = (selector: string) => contents.executeJavaScript(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(b => b.getBoundingClientRect().height > 0).map(b => b.textContent)`)
        const actions = await visibleLabels('.actions button')
        const safeModeLabel = locale === 'zh' ? '进入安全模式' : 'Enter Safe Mode'
        // Safe Mode is offered exactly once: as its own button beside the
        // actions when a repair is on offer, otherwise as the primary action.
        const decision = await visibleLabels('#decision-row button')
        assert.equal(decision.filter((label: string) => label === safeModeLabel).length, 1)
        // With no culprit to repair, the agent sits beside Safe Mode; otherwise it stays out of the way.
        const agentLabel = locale === 'zh' ? '智能修复 Agent' : 'Repair agent'
        if (scenario === 'unidentified-plugin') assert.deepEqual(actions, [agentLabel, safeModeLabel])
        else assert.equal(actions.includes(agentLabel), false)
      }
      const prefix = `${scenario}-${locale}-${theme}-${width}`
      await capture(contents, join(output, `${prefix}.png`))
      const before = contents.getURL()
      // Keyboard focus must reach the primary recovery action at page zoom;
      // vertical scrolling inside the content card is allowed, but the action
      // itself must not be clipped or hidden behind the footer.
      const focusable = await contents.executeJavaScript(`(() => {
        const selector = ${JSON.stringify(page === 'safe-mode' ? '#restart' : '#decision-row button:not([hidden])')};
        const target = document.querySelector(selector);
        if (!(target instanceof HTMLElement)) return { focused: false, visible: false };
        target.focus();
        const r = target.getBoundingClientRect();
        return { focused: document.activeElement === target, visible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= visualViewport.width + 0.5 && r.top >= 0 && r.bottom <= visualViewport.height + 0.5 };
      })()`)
      assert.deepEqual(focusable, { focused: true, visible: true })
      await contents.executeJavaScript("document.getElementById('community-support').click()")
      await delay(60)
      assert.equal(contents.getURL(), before)
      assert.deepEqual(external.splice(0), ['https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues'])
      if (scenario === 'unidentified-plugin') {
        const action = await contents.executeJavaScript(`(() => {
          let action;
          window.dshRecovery = { action: value => { action = value } };
          document.getElementById('primary').click();
          return { action, disabled: document.getElementById('primary').disabled };
        })()`)
        assert.deepEqual(action, { action: 'safe-mode', disabled: true })
      }
      if (scenario === 'multiple-plugins') {
        const perPluginActions = await contents.executeJavaScript(`(() => {
          const actions = [];
          window.dshRecovery = { action: value => { actions.push(value) } };
          const rows = [...document.querySelectorAll('#plugins li')];
          for (const button of document.querySelectorAll('#plugins button')) {
            document.querySelectorAll('button').forEach(control => { control.disabled = false });
            button.click();
          }
          document.querySelectorAll('button').forEach(control => { control.disabled = false });
          document.getElementById('primary').click();
          return { actions, hints: rows.map(row => row.querySelector('.plugin-check-hint').textContent) };
        })()`)
        assert.deepEqual(perPluginActions.actions, [
          `upgrade:${names[0]}`, `uninstall:${names[0]}`, `uninstall:${names[1]}`,
          `upgrade:${names[2]}`, `uninstall:${names[2]}`, 'auto-process'
        ])
        assert.equal(perPluginActions.hints.length, 3)
      }
      if (scenario === 'market-offline') {
        const retry = await contents.executeJavaScript(`(() => {
          let action;
          window.dshRecovery = { action: value => { action = value } };
          const label = document.getElementById('primary').textContent;
          document.getElementById('primary').click();
          return { action, label };
        })()`)
        assert.deepEqual(retry, { action: 'check-updates', label: locale === 'zh' ? '重新检查更新' : 'Retry update checks' })
      }
      results.push({ page, scenario, locale, theme, requestedSize: [width,height], layout, popup })
    }
    assert.deepEqual(rendererErrors, [])
  }
  // The Safe Mode frame is driven over IPC to the host page: the URL to show,
  // in-place model updates, and null to take the page down. Closing is
  // idempotent and follows the parent window.
  const sent: unknown[][] = []
  const send = parent.webContents.send.bind(parent.webContents)
  parent.webContents.send = (channel: string, ...args: unknown[]) => { sent.push([channel, ...args]); send(channel, ...args) }
  const frame = new SafeModeFrame(parent, () => { closed++ })
  const frameUrl = 'dsh-desktop://desktop/safe-mode.html?state=%7B%7D&seq=1'
  frame.show(frameUrl)
  frame.applyUpdate({ seq: '1', model: { seq: '1' } })
  assert.deepEqual(sent, [[SAFE_MODE_FRAME_CHANNEL, frameUrl], [SAFE_MODE_FRAME_UPDATE_CHANNEL, { seq: '1', model: { seq: '1' } }]])
  frame.close(); frame.close(); await delay(60)
  assert.equal(closed, 1)
  assert.equal(frame.isDestroyed(), true)
  assert.deepEqual(sent.slice(2), [[SAFE_MODE_FRAME_CHANNEL, null]])
  frame.show(frameUrl)
  assert.equal(sent.length, 3, 'A closed frame must not show again')
  // Save a native-window thumbnail as well as renderer captures where the
  // runner supports it (a machine without screen-capture permission cannot).
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1280, height: 800 } })
    const source = sources.find(item => item.id === parent.getMediaSourceId())
    if (source && !source.thumbnail.isEmpty()) writeFileSync(join(output, 'native-window.png'), source.thumbnail.toPNG())
  } catch (error) {
    console.warn(`native-window thumbnail skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
  const lateFrame = new SafeModeFrame(parent, () => { closed++ })
  lateFrame.show(frameUrl)
  parent.destroy(); await delay(60)
  assert.equal(lateFrame.isDestroyed(), true)
  assert.equal(closed, 2)
  writeFileSync(join(output, 'results.json'), JSON.stringify({ platform: process.platform, arch: process.arch, scale, zoom, results, closed }, null, 2))
  console.log(JSON.stringify({ platform: process.platform, scale, zoom, variants: results.length, status: 'passed' }))
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
