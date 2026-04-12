const { app, BrowserWindow, ipcMain, dialog, shell, net, protocol } = require('electron')
const path = require('path')
const fs = require('fs').promises
const fss = require('fs')

let win

const createWindow = () => {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0f0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allow local file:// images
    },
  })
  win.loadFile(path.join(__dirname, 'renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  setupStore()
  setupFs()
  setupDialogs()
  setupUpdater()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Store ─────────────────────────────────────────────────────────────────────
const STORE_PATH = path.join(app.getPath('userData'), 'scriptum.json')
const readStore = async () => { try { return JSON.parse(await fs.readFile(STORE_PATH, 'utf8')) } catch { return {} } }
const writeStore = async d => fs.writeFile(STORE_PATH, JSON.stringify(d, null, 2))

function setupStore() {
  ipcMain.handle('store:get', async (_, k) => { const s = await readStore(); return k ? s[k] : s })
  ipcMain.handle('store:set', async (_, k, v) => { const s = await readStore(); s[k] = v; await writeStore(s); return true })
  ipcMain.handle('store:del', async (_, k) => { const s = await readStore(); delete s[k]; await writeStore(s); return true })
}

// ── File system ───────────────────────────────────────────────────────────────
function setupFs() {
  ipcMain.handle('fs:read',    (_, p) => fs.readFile(p, 'utf8'))
  ipcMain.handle('fs:readBin', async (_, p) => (await fs.readFile(p)).toString('base64'))
  ipcMain.handle('fs:write',   async (_, p, c) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, c, 'utf8'); return true })
  ipcMain.handle('fs:exists',  (_, p) => fss.existsSync(p))
  ipcMain.handle('fs:mkdir',   async (_, p) => { await fs.mkdir(p, { recursive: true }); return true })
  ipcMain.handle('fs:readdir', async (_, p) => { const e = await fs.readdir(p, { withFileTypes: true }); return e.map(x => ({ name: x.name, isDir: x.isDirectory(), path: path.join(p, x.name) })) })
  ipcMain.handle('fs:delete',  async (_, p) => { const st = await fs.stat(p); st.isDirectory() ? await fs.rm(p, { recursive: true, force: true }) : await fs.unlink(p); return true })
  ipcMain.handle('fs:rename',  async (_, o, n) => { await fs.rename(o, n); return true })
  ipcMain.handle('fs:copy',    async (_, s, d) => { await fs.mkdir(path.dirname(d), { recursive: true }); await fs.copyFile(s, d); return true })
  ipcMain.handle('fs:readBin', async (_, p) => (await fs.readFile(p)).toString('base64'))
  // Return file:// URL for local images — avoids CSP issues
  ipcMain.handle('fs:fileUrl', (_, p) => `file://${p}`)
  ipcMain.handle('shell:open', (_, p) => shell.openPath(p))
  ipcMain.handle('app:version', () => app.getVersion())
}

// ── Dialogs ───────────────────────────────────────────────────────────────────
function setupDialogs() {
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:file', async (_, filters) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [] })
    return r.canceled ? null : r.filePaths[0]
  })
}

// ── Updater ───────────────────────────────────────────────────────────────────
function setupUpdater() {
  ipcMain.handle('update:check', async (_, token, owner, repo) => {
    try {
      const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Scriptum' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      // Get latest commit on main
      const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/commits/main`, { headers })
      if (!res.ok) return { error: `GitHub API error: ${res.status}` }
      const data = await res.json()
      const latestSha = data.sha

      // Get current installed SHA from store
      const s = await readStore()
      const installedSha = s['installed-sha'] || null

      // Get new version from package.json on GitHub
      let newVersion = null
      try {
        const pkgRes = await net.fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${latestSha}/package.json`, { headers })
        const pkg = await pkgRes.json()
        newVersion = pkg.version || null
      } catch {}

      const currentVersion = app.getVersion()
      const hasUpdate = latestSha !== installedSha

      return {
        hasUpdate,
        latestSha,
        installedSha,
        currentVersion,
        newVersion,
        message: data.commit?.message?.split('\n')[0].trim() || '',
        commitDate: data.commit?.author?.date || null,
      }
    } catch (e) { return { error: e.message } }
  })

  ipcMain.handle('update:apply', async (_, token, owner, repo, sha) => {
    try {
      const appDir = path.join(__dirname, '..')
      const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Scriptum' }
      const s = await readStore()
      const installedSha = s['installed-sha']
      let files = []

      if (installedSha) {
        // Get only changed files since last install
        const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${installedSha}...${sha}`, { headers })
        const cmp = await res.json()
        files = (cmp.files || [])
          .filter(f => f.status !== 'removed' && (f.filename.startsWith('src/') || f.filename === 'package.json'))
          .map(f => f.filename)
      } else {
        // First time — get all src/ files
        const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, { headers })
        const tree = await res.json()
        files = (tree.tree || [])
          .filter(f => f.type === 'blob' && f.path.startsWith('src/'))
          .map(f => f.path)
      }

      if (files.length === 0) return { ok: true, filesUpdated: 0 }

      // Download each file
      for (const file of files) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${file}`
        const r = await net.fetch(rawUrl, { headers })
        if (!r.ok) continue
        const content = await r.text()
        const dest = path.join(appDir, file)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, content, 'utf8')
      }

      // Save the installed SHA so next check compares correctly
      s['installed-sha'] = sha
      await writeStore(s)

      return { ok: true, filesUpdated: files.length }
    } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('update:restart', () => { app.relaunch(); app.exit(0) })
}
