/** Product branding preserves installed preferences and explicit Electron path overrides. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { App } from 'electron'
import { preserveDesktopUserData } from '../src/user-data.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'apus-desktop-data-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const paths: Record<string, string> = { appData: root, userData: join(root, 'APUS Reflex'), sessionData: join(root, 'APUS Reflex') }
  const setPath = vi.fn<App['setPath']>((name, path) => {
    if (!existsSync(path)) throw new Error('Electron requires an existing directory')
    paths[name] = path
  })
  const app = { getPath: (name: string) => paths[name]!, setPath,
    commandLine: { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn(), appendArgument: vi.fn(),
      getSwitchValue: vi.fn(), removeSwitch: vi.fn() } }
  return { root, paths, app, stable: join(root, 'APUS Reflex Harness') }
}

it('reuses existing preferences and browser data before the default Session starts', () => {
  const f = fixture()
  mkdirSync(f.stable)
  writeFileSync(join(f.stable, 'keybindings.json'), '{"retained":true}')
  writeFileSync(join(f.stable, 'Cookies'), 'existing session')
  preserveDesktopUserData(f.app)
  expect(f.paths.userData).toBe(f.stable)
  expect(f.paths.sessionData).toBe(f.stable)
  expect(readFileSync(join(f.paths.userData!, 'keybindings.json'), 'utf8')).toBe('{"retained":true}')
  expect(readFileSync(join(f.paths.sessionData!, 'Cookies'), 'utf8')).toBe('existing session')
  expect(existsSync(join(f.root, 'APUS Reflex'))).toBe(false)
  preserveDesktopUserData(f.app)
  expect(f.app.setPath).toHaveBeenCalledTimes(2)
})

it('creates the stable directory for a new installation', () => {
  const f = fixture()
  preserveDesktopUserData(f.app)
  expect(existsSync(f.stable)).toBe(true)
  expect(f.paths.userData).toBe(f.stable)
  expect(f.paths.sessionData).toBe(f.stable)
})

it('preserves an explicit user-data-dir even when it equals the renamed default', () => {
  const f = fixture()
  f.app.commandLine.hasSwitch.mockReturnValue(true)
  preserveDesktopUserData(f.app)
  expect(f.app.commandLine.hasSwitch).toHaveBeenCalledWith('user-data-dir')
  expect(f.app.setPath).not.toHaveBeenCalled()
  expect(existsSync(f.stable)).toBe(false)
})

it('preserves a custom browser-data location supplied by a launcher', () => {
  const f = fixture()
  f.paths.userData = join(f.root, 'isolated profile')
  preserveDesktopUserData(f.app)
  expect(f.app.setPath).not.toHaveBeenCalled()
  expect(existsSync(f.stable)).toBe(false)
})

it('preserves a separately configured Session directory', () => {
  const f = fixture()
  f.paths.sessionData = join(f.root, 'isolated session')
  preserveDesktopUserData(f.app)
  expect(f.paths.userData).toBe(f.stable)
  expect(f.paths.sessionData).toBe(join(f.root, 'isolated session'))
  expect(f.app.setPath).toHaveBeenCalledExactlyOnceWith('userData', f.stable)
})


it('leaves the full product-name default and existing data unchanged', () => {
  const f = fixture()
  mkdirSync(f.stable)
  writeFileSync(join(f.stable, 'Cookies'), 'existing full-name session')
  f.paths.userData = f.stable
  f.paths.sessionData = f.stable
  preserveDesktopUserData(f.app)
  expect(f.app.setPath).not.toHaveBeenCalled()
  expect(f.paths.userData).toBe(f.stable)
  expect(f.paths.sessionData).toBe(f.stable)
  expect(readFileSync(join(f.stable, 'Cookies'), 'utf8')).toBe('existing full-name session')
})
