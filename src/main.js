const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, MenuItem } = require('electron')
const path = require('path')
const fs = require('fs').promises
const htmlToDocx = require('html-to-docx')
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
      webSecurity: false,
      spellcheck: true,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer/index.html'))

  // Initialize Spellchecker from Store
  readStore().then(s => {
    // Default to system locale or US English, but avoid mixing them into a multi-lang list
    const langs = s['spellcheck-languages'] || [app.getLocale()?.replace('_', '-') || 'en-US']
    const finalLangs = Array.isArray(langs) ? langs : [langs]
    if (win?.webContents?.session) win.webContents.session.setSpellCheckerLanguages(finalLangs)
  }).catch(() => {})

  // Spelling Corrector Context Menu
  win.webContents.on('context-menu', (event, params) => {
    // Only show the native menu if we are clicking on editable text (the Editor)
    if (!params.isEditable) return

    const menu = new Menu()

    // Add spelling suggestions provided by Electron
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion)
      }))
    }

    if (params.dictionarySuggestions.length > 0) {
      menu.append(new MenuItem({ type: 'separator' }))
    }

    // Option to add the misspelled word to the local dictionary
    if (params.misspelledWord) {
      menu.append(new MenuItem({
        label: `Add "${params.misspelledWord}" to Dictionary`,
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    menu.append(new MenuItem({ role: 'cut' }))
    menu.append(new MenuItem({ role: 'copy' }))
    menu.append(new MenuItem({ role: 'paste' }))

    menu.popup()
  })
}

app.whenReady().then(() => {
  createWindow()
  setupStore()
  setupFs()
  setupDialogs()
  setupUpdater()
  setupExport()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Store ─────────────────────────────────────────────────────────────────────
const STORE_PATH = path.join(app.getPath('userData'), 'scriptum.json')
const readStore  = async () => { try { return JSON.parse(await fs.readFile(STORE_PATH, 'utf8')) } catch { return {} } }
const writeStore = async d  => fs.writeFile(STORE_PATH, JSON.stringify(d, null, 2))

function setupStore() {
  ipcMain.handle('store:get', async (_, k)    => { const s = await readStore(); return k ? s[k] : s })
  ipcMain.handle('store:set', async (_, k, v) => { 
    const s = await readStore(); 
    s[k] = v; 
    await writeStore(s); 
    if (k === 'spellcheck-languages' && win && !win.isDestroyed()) {
      const langs = Array.isArray(v) ? v : [v];
      win.webContents.session.setSpellCheckerLanguages(langs);
    }
    return true 
  })
  ipcMain.handle('store:del', async (_, k)    => { const s = await readStore(); delete s[k]; await writeStore(s); return true })
}

// ── File system ───────────────────────────────────────────────────────────────
function setupFs() {
  ipcMain.handle('fs:read',    (_,  p)    => fs.readFile(p, 'utf8'))
  ipcMain.handle('fs:readBin', async (_, p) => (await fs.readFile(p)).toString('base64'))
  ipcMain.handle('fs:writeBin', async (_, p, b64) => {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, Buffer.from(b64, 'base64'))
    return true
  })
  ipcMain.handle('fs:write',   async (_, p, c) => {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, c, 'utf8')
    return true
  })
  ipcMain.handle('fs:exists',  (_, p)       => fss.existsSync(p))
  ipcMain.handle('fs:mkdir',   async (_, p) => { await fs.mkdir(p, { recursive: true }); return true })
  ipcMain.handle('fs:readdir', async (_, p) => {
    const e = await fs.readdir(p, { withFileTypes: true })
    return e.map(x => ({ name: x.name, isDir: x.isDirectory(), path: path.join(p, x.name) }))
  })
  ipcMain.handle('fs:delete', async (_, p) => {
    const st = await fs.stat(p)
    st.isDirectory() ? await fs.rm(p, { recursive: true, force: true }) : await fs.unlink(p)
    return true
  })
  ipcMain.handle('fs:rename', async (_, o, n) => { await fs.rename(o, n); return true })
  ipcMain.handle('fs:copy',   async (_, s, d) => {
    await fs.mkdir(path.dirname(d), { recursive: true })
    await fs.copyFile(s, d)
    return true
  })
  ipcMain.handle('shell:open',   (_, p) => shell.openPath(p))
  ipcMain.handle('app:version',  ()    => app.getVersion())
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
  ipcMain.handle('dialog:save', async (_, title, defaultName, filters) => {
    const r = await dialog.showSaveDialog(win, { title, defaultPath: defaultName, filters })
    return r.canceled ? null : r.filePath
  })
}

// ── Export ────────────────────────────────────────────────────────────────────
function setupExport() {
  ipcMain.handle('export:pdf', async (_, filePath, options = {}) => {
    try {
      // Force window background to white to prevent dark margins in the PDF
      win.setBackgroundColor('#ffffff')

      // Normalize Page Size
      let pageSize = options.pageSize || 'A4';
      if (typeof pageSize === 'string') {
        if (pageSize.toLowerCase() === 'letter') pageSize = 'Letter';
        else if (pageSize.toLowerCase() === 'a4') pageSize = 'A4';
      } else if (typeof pageSize === 'object') {
        // Electron printToPDF expects microns for custom sizes (1px approx 264.58 microns)
        pageSize = {
          width: Math.round(pageSize.width * 264.58),
          height: Math.round(pageSize.height * 264.58)
        };
      }

      const pdfOptions = {
        marginsType: 1, // 1 is "No Margins" - ensures our CSS padding/layout is used exactly
        preferCSSPageSize: true,
        pageSize: pageSize,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `
          <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 10px; width: 100%; text-align: left; color: #999; padding: 0 0 15px 20px;">
            <span class="pageNumber"></span>
          </div>
        `
      }

      const data = await win.webContents.printToPDF(pdfOptions)
      await fs.writeFile(filePath, data)
      return true
    } finally {
      // Restore the dark theme background
      win.setBackgroundColor('#0f0f0d')
    }
  })

  ipcMain.handle('export:docx', async (_, filePath, htmlContent, options = {}) => {
    try {
      const font = options.font || 'Times New Roman';
      const fontSize = options.fontSize || 24; // Half-points (24 = 12pt)

      // html-to-docx is more reliable when styles are applied directly to elements.
      // The font and fontSize options here act as a general document default.
      const fullHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
          </head>
          <body>${htmlContent || ''}</body>
        </html>`;
        
      // Use empty strings instead of null for header/footer to avoid internal library "null to object" errors
      const docxBuffer = await htmlToDocx(fullHtml, '', '', {
        title: 'Scriptum Document',
        orientation: 'portrait',
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // Standard 1-inch margins
        font: options.font || 'Times New Roman',
        fontSize: fontSize,
        decodeEntities: true
      })

      // Ensure we are writing a valid Buffer
      const buffer = Buffer.isBuffer(docxBuffer) ? docxBuffer : Buffer.from(docxBuffer);
      await fs.writeFile(filePath, buffer)
      
      return true
    } catch (error) { throw error }
  })
}

// ── Updater ───────────────────────────────────────────────────────────────────
function setupUpdater() {
  ipcMain.handle('update:check', async (_, token, owner, repo) => {
    try {
      const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Scriptum' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/commits/main`, { headers })
      if (!res.ok) return { error: `GitHub API ${res.status}` }
      const data = await res.json()
      const latestSha = data.sha
      const s = await readStore()
      const installedSha = s['installed-sha'] || null
      let newVersion = null
      try {
        const pkgRes = await net.fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${latestSha}/package.json`, { headers })
        const pkg = await pkgRes.json()
        newVersion = pkg.version || null
      } catch {}
      return {
        hasUpdate: latestSha !== installedSha,
        latestSha, installedSha, newVersion,
        currentVersion: app.getVersion(),
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
      if (installedSha && installedSha !== sha) {
        const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${installedSha}...${sha}`, { headers })
        const cmp = await res.json()
        files = (cmp.files || [])
          .filter(f => f.status !== 'removed' && f.filename.startsWith('src/'))
          .map(f => f.filename)
        // If compare returns nothing, fall through to full download
      }
      if (!files.length) {
        const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, { headers })
        const tree = await res.json()
        files = (tree.tree || []).filter(f => f.type === 'blob' && f.path.startsWith('src/')).map(f => f.path)
      }
      for (const file of files) {
        const r = await net.fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${file}`, { headers })
        if (!r.ok) continue
        const dest = path.join(appDir, file)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, await r.text(), 'utf8')
      }
      s['installed-sha'] = sha
      await writeStore(s)
      return { ok: true, filesUpdated: files.length }
    } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('update:restart', () => { app.relaunch(); app.exit(0) })
}
