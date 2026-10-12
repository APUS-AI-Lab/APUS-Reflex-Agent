import { clipboard, Menu, shell, type BrowserWindow } from 'electron'
import { buildContextMenuTemplate } from './context-menu-template'

export function installContextMenu(
  window: BrowserWindow,
  locale: () => 'en' | 'zh'
): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, locale(), {
      openLink: (url) => {
        void shell.openExternal(url)
      },
      copyLink: (url) => clipboard.writeText(url),
      copyImage: () => {
        if (window.isDestroyed()) return
        window.webContents.copyImageAt(params.x, params.y)
      }
    })

    if (template.length === 0 || window.isDestroyed()) return
    Menu.buildFromTemplate(template).popup({ window })
  })
}
