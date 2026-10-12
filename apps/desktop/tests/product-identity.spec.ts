/** Electron-builder keeps existing Windows installation ownership after a display-name change. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppInfo } from 'app-builder-lib/out/appInfo.js'
import { Packager } from 'app-builder-lib/out/packager.js'
import { expect, it, onTestFinished } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

it('resolves the registered executable and data directory under the new displayed product name', async () => {
  const root = mkdtempSync(join(tmpdir(), 'apus-desktop-identity-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'desktop-identity-fixture', version: '1.0.0',
    description: 'Desktop identity fixture', author: 'Fixture', main: 'index.js' }))
  const config = createElectronBuilderConfig({ DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_APP_ID: 'com.example.apus' }, 'win32', 'x64')
  const packager = new Packager({ projectDir: root, config: { extends: null, electronVersion: '44.0.0',
    appId: config.appId, productName: config.productName, win: { executableName: config.win.executableName } } })
  await packager.validateConfig()
  const identity = new AppInfo(packager, null, packager.config.win)
  const installed = join(root, 'registered-installation')
  mkdirSync(installed)
  writeFileSync(join(installed, 'APUS Reflex Harness.exe'), 'installed executable')
  expect(identity.productName).toBe('APUS Reflex')
  expect(identity.productFilename).toBe('APUS Reflex Harness')
  expect(existsSync(join(installed, `${identity.productFilename}.exe`))).toBe(true)
  expect(identity.id).toBe('com.example.apus')
})
