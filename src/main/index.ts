import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { StorageService } from './storage'

let storage: StorageService | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0f0d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // The app is a single local page. Links open in the system browser and the
  // window never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

void app.whenReady().then(() => {
  storage = new StorageService(join(app.getPath('userData'), 'snapshots'))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Quitting waits for every pending write. If something cannot be saved, the
// user decides whether to quit anyway.
let readyToQuit = false
app.on('before-quit', (event) => {
  if (readyToQuit || !storage) return
  event.preventDefault()
  void storage
    .flushAll()
    .catch((e: unknown) => [e instanceof Error ? e.message : String(e)])
    .then(async (unsaved) => {
      if (unsaved.length > 0) {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          message: 'Some changes could not be saved.',
          detail: unsaved.join('\n'),
          buttons: ['Keep Scriptum open', 'Quit anyway'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 0) return
      }
      readyToQuit = true
      app.quit()
    })
})
