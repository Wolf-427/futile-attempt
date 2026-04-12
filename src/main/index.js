const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0f0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../build/index.html'));
  }
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

const storePath = path.join(app.getPath('userData'), 'scriptum-store.json');
async function readStore() { try { return JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { return {}; } }
async function writeStore(d) { await fs.writeFile(storePath, JSON.stringify(d, null, 2)); }

ipcMain.handle('store:get', async (_, k) => { const s = await readStore(); return k ? s[k] : s; });
ipcMain.handle('store:set', async (_, k, v) => { const s = await readStore(); s[k] = v; await writeStore(s); return true; });
ipcMain.handle('dialog:openFolder', async () => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory','createDirectory'], title: 'Choose project location' }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('dialog:openFile', async (_, filters) => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: filters || [{ name: 'All Files', extensions: ['*'] }] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('dialog:saveFile', async (_, opts) => { const r = await dialog.showSaveDialog(mainWindow, opts || {}); return r.canceled ? null : r.filePath; });
ipcMain.handle('fs:readFile', (_, p) => fs.readFile(p, 'utf8'));
ipcMain.handle('fs:writeFile', async (_, p, c) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, c, 'utf8'); return true; });
ipcMain.handle('fs:readDir', async (_, p) => { const e = await fs.readdir(p, { withFileTypes: true }); return e.map(x => ({ name: x.name, isDirectory: x.isDirectory(), path: path.join(p, x.name) })); });
ipcMain.handle('fs:exists', (_, p) => fsSync.existsSync(p));
ipcMain.handle('fs:mkdir', async (_, p) => { await fs.mkdir(p, { recursive: true }); return true; });
ipcMain.handle('fs:rename', async (_, o, n) => { await fs.rename(o, n); return true; });
ipcMain.handle('fs:delete', async (_, p) => { const s = await fs.stat(p); if (s.isDirectory()) { await fs.rm(p, { recursive: true, force: true }); } else { await fs.unlink(p); } return true; });
ipcMain.handle('fs:copyFile', async (_, s, d) => { await fs.mkdir(path.dirname(d), { recursive: true }); await fs.copyFile(s, d); return true; });
ipcMain.handle('fs:readFileBinary', async (_, p) => (await fs.readFile(p)).toString('base64'));
ipcMain.handle('shell:openPath', (_, p) => shell.openPath(p));
ipcMain.handle('keychain:getToken', async () => { const s = await readStore(); return s['github-token'] || null; });
ipcMain.handle('keychain:setToken', async (_, t) => { const s = await readStore(); s['github-token'] = t; await writeStore(s); return true; });
ipcMain.handle('keychain:deleteToken', async () => { const s = await readStore(); delete s['github-token']; await writeStore(s); return true; });
