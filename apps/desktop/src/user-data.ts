/** Desktop display names do not relocate existing browser data and device preferences. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from 'electron'

/**
 * Retain the installed data directory before Electron creates its default Session.
 * @param app - Electron application before ready; explicit path overrides remain unchanged.
 */
export function preserveDesktopUserData(app: Pick<App, 'getPath' | 'setPath' | 'commandLine'>): void {
  const renamedDefault = join(app.getPath('appData'), 'APUS Reflex')
  if (app.getPath('userData') !== renamedDefault || app.commandLine.hasSwitch('user-data-dir')) return
  const sessionData = app.getPath('sessionData')
  const stableDirectory = join(app.getPath('appData'), 'APUS Reflex Harness')
  mkdirSync(stableDirectory, { recursive: true })
  app.setPath('userData', stableDirectory)
  if (sessionData === renamedDefault) app.setPath('sessionData', stableDirectory)
}
