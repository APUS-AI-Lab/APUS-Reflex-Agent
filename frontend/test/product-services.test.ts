import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  service: vi.fn(), updates: vi.fn(), diagnostics: vi.fn(),
  updater: { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), on: vi.fn(), removeAllListeners: vi.fn() }
}))
vi.mock('electron', () => ({ app: { name: 'APUS Reflex Harness', isPackaged: true, isReady: () => true, getVersion: () => '0.1.7-rc.2', getPath: () => '/unused' }, dialog: {}, net: {}, BrowserWindow: { getAllWindows: () => [] }, powerMonitor: { on: vi.fn(), removeListener: vi.fn() }, ipcMain: { handle: vi.fn() } }))
vi.mock('../src/main/desktop-service/service', () => ({ DesktopService: mocks.service, isPrereleaseVersion: () => false, isVersion: () => true }))
vi.mock('../src/main/desktop-service/diagnostics', () => ({ attachDiagnostics: mocks.diagnostics }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
afterEach(() => vi.clearAllMocks())
it('keeps reporting and every upstream update action disabled after rebranding', async () => {
  const services = await import('../src/main/desktop-service')
  services.initializeDesktopService()
  expect(mocks.service).not.toHaveBeenCalled()
  expect(mocks.diagnostics).not.toHaveBeenCalled()
  const manager = await import('../src/main/update/update-manager')
  manager.startUpdateManager({ prepareToInstall: async () => {} })
  await manager.checkForUpdates()
  await manager.installSpecificVersion('0.9.0')
  await manager.downloadAvailableUpdate()
  expect(manager.getUpdateStatus().phase).toBe('unsupported')
  expect(mocks.updater.setFeedURL).not.toHaveBeenCalled()
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  manager.stopUpdateManager()
})
