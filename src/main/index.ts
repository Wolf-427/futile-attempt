import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { ItemStatusEvent } from '@shared/ipc'
import { join } from 'node:path'
import { AppState } from './appState'
import { registerIpc, requestHandOver } from './ipc'
import { StorageService } from './storage'

let storage: StorageService | null = null
let readyToQuit = false

// Tests point the app at a throwaway profile so they never touch real settings.
const testProfile = process.env['SCRIPTUM_USER_DATA']
if (testProfile) app.setPath('userData', testProfile)

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

  // Closing the window first collects what the editors still hold and writes it.
  let closing = false
  win.on('close', (event) => {
    if (closing || readyToQuit) return
    event.preventDefault()
    closing = true
    void requestHandOver(win)
      .then(() => storage?.flushAll())
      .finally(() => win.destroy())
  })

  // The app is a single local page. Links open in the system browser and the
  // window never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // Right-click menu for text: the system spellchecker's suggestions, then the
  // usual editing commands. On macOS the system picks the language itself.
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return
    const items: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 6)) {
        items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No suggestions', enabled: false })
      items.push(
        { type: 'separator' },
        {
          label: `Add “${params.misspelledWord}” to dictionary`,
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        },
        { type: 'separator' }
      )
    }
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    else items.push({ role: 'copy' })
    Menu.buildFromTemplate(items).popup({ window: win })
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

void app.whenReady().then(async () => {
  storage = new StorageService(join(app.getPath('userData'), 'snapshots'), {
    onItemChange: (kind, id, status) => {
      if (kind === 'manifest') return
      const event: ItemStatusEvent = { kind, id, status }
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('item:status', event)
    }
  })
  const state = new AppState(join(app.getPath('userData'), 'app-state.json'))
  await state.load()
  registerIpc(storage, state)
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
app.on('before-quit', (event) => {
  if (readyToQuit || !storage) return
  event.preventDefault()
  const store = storage
  void Promise.all(BrowserWindow.getAllWindows().map(requestHandOver))
    .then(() => store.flushAll())
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
