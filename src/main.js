const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, MenuItem } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs').promises
const fss = require('fs')
const nspell = require('nspell')
const { Document, Paragraph, TextRun, HeadingLevel, PageBreak, Packer } = require('docx')

let win

// ── Spell Checker (nspell / Hunspell) ─────────────────────────────────────────
const DICT_PACKAGES = {
  'en-US': 'dictionary-en',
  'en-GB': 'dictionary-en-gb',
  'fr-FR': 'dictionary-fr',
  'de-DE': 'dictionary-de',
  'es-ES': 'dictionary-es',
}
const dictCache = new Map()  // lang → nspell instance
let spellReady = null        // Promise<nspell>

// Tries to load a .aff/.dic pair from {userData}/dictionaries/{lang}.{ext}
// before falling back to the bundled npm package.
async function loadDictionary(lang) {
  if (dictCache.has(lang)) return dictCache.get(lang)

  const dictDir = path.join(app.getPath('userData'), 'dictionaries')
  const affPath = path.join(dictDir, `${lang}.aff`)
  const dicPath = path.join(dictDir, `${lang}.dic`)

  // Known-correct word per language — used to validate a custom dictionary file
  const PROBE = { 'de-DE': 'Straße', 'en-US': 'house', 'en-GB': 'colour', 'fr-FR': 'maison', 'es-ES': 'casa' }

  let dict
  try {
    const [aff, dic] = await Promise.all([fs.readFile(affPath), fs.readFile(dicPath)])
    const probe = nspell({ aff, dic })
    if (probe.correct(PROBE[lang] || 'the')) {
      dict = { aff, dic }
      console.log(`[spellcheck] loaded custom dictionary for ${lang} from ${dictDir}`)
    } else {
      console.log(`[spellcheck] custom dictionary for ${lang} failed validation — falling back to npm package`)
    }
  } catch {
    // no custom files present
  }

  if (!dict) {
    const pkg = DICT_PACKAGES[lang] || DICT_PACKAGES['en-US']
    console.log(`[spellcheck] using npm package ${pkg}`)
    const mod = await import(pkg)
    dict = mod.default
  }

  const spell = nspell(dict)
  dictCache.set(lang, spell)
  return spell
}

function spellSuggest(spell, word) {
  const contractions = []
  for (let i = 1; i < word.length; i++) {
    const candidate = word.slice(0, i) + "'" + word.slice(i)
    if (spell.correct(candidate)) contractions.push(candidate)
  }
  const base = spell.suggest(word).filter(s => !s.includes('\uFFFD') && !contractions.includes(s))
  return [...contractions, ...base].slice(0, 6)
}

async function spellSetLanguage(lang) {
  dictCache.delete(lang)  // Always re-check filesystem so newly placed files are picked up
  spellReady = loadDictionary(lang).then(async spell => {
    // Re-apply persisted custom words whenever the dictionary switches
    const s = await readStore().catch(() => ({}))
    for (const w of (s['spell-custom-words'] || [])) spell.add(w)
    return spell
  })
  return spellReady
}

function setupSpellcheck() {
  ipcMain.handle('spellcheck:setLanguage', async (_, lang) => { await spellSetLanguage(lang); return true })
  ipcMain.handle('spellcheck:openDictionaryFolder', async () => {
    const dir = path.join(app.getPath('userData'), 'dictionaries')
    await fs.mkdir(dir, { recursive: true })
    shell.openPath(dir)
  })
  ipcMain.handle('spellcheck:checkWords',  async (_, words) => {
    const spell = await spellReady.catch(() => null)
    if (!spell) return []
    const result = words.filter(w => {
      const nfc = w.normalize('NFC')
      if (spell.correct(nfc)) return false
      const cap = nfc.charAt(0).toUpperCase() + nfc.slice(1)
      return !spell.correct(cap)
    })
    return result
  })
  ipcMain.handle('spellcheck:suggest', async (_, word) => {
    const spell = await spellReady.catch(() => null)
    return spell ? spellSuggest(spell, word.normalize('NFC')) : []
  })
  ipcMain.handle('spellcheck:addWord', async (_, word) => {
    const spell = await spellReady.catch(() => null)
    const nfc = word.normalize('NFC')
    if (spell) spell.add(nfc)
    const s = await readStore()
    const custom = s['spell-custom-words'] || []
    if (!custom.includes(nfc)) { s['spell-custom-words'] = [...custom, nfc]; await writeStore(s) }
    return true
  })
}

const createWindow = () => {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0f0d',
    icon: path.join(__dirname, '../assets/icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      spellcheck: false, // handled entirely by our nspell plugin
    },
  })
  win.loadFile(path.join(__dirname, 'renderer/index.html'))

  // Bootstrap the spell checker with the stored language (or system default)
  readStore().then(s => {
    const lang = (s['spellcheck-languages'] || [])[0] || app.getLocale()?.replace('_', '-') || 'en-US'
    spellSetLanguage(lang)
  }).catch(() => { spellSetLanguage('en-US') })

  // Fallback context menu for editable elements outside the editor (e.g. input fields)
  win.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable) return
    const menu = new Menu()
    menu.append(new MenuItem({ role: 'cut' }))
    menu.append(new MenuItem({ role: 'copy' }))
    menu.append(new MenuItem({ role: 'paste' }))
    menu.popup()
  })
}

// ── Font enumeration ──────────────────────────────────────────────────────────
async function parseFontFamily(filePath) {
  let handle
  try {
    handle = await fs.open(filePath, 'r')

    // Step 1: read enough to find the sfnt offset table (first 4 KB covers any TTC header + table dir)
    const hdr = Buffer.alloc(4096)
    const { bytesRead: hdrRead } = await handle.read(hdr, 0, 4096, 0)
    const h = hdr.subarray(0, hdrRead)

    // Resolve sfnt start offset (0 for plain TTF/OTF, or from TTC header)
    let sfnt = 0
    if (h.length >= 4 && h.toString('ascii', 0, 4) === 'ttcf') {
      if (h.length < 16) { await handle.close(); return null }
      sfnt = h.readUInt32BE(12) // offset of first font in collection
    }
    if (h.length < sfnt + 12) { await handle.close(); return null }

    // Step 2: locate the 'name' table record
    const nTables = h.readUInt16BE(sfnt + 4)
    let nameOff = -1, nameLen = 0
    for (let i = 0; i < nTables; i++) {
      const p = sfnt + 12 + i * 16
      if (p + 16 > h.length) break
      if (h.toString('ascii', p, p + 4) === 'name') {
        nameOff = h.readUInt32BE(p + 8)
        nameLen = h.readUInt32BE(p + 12)
        break
      }
    }
    if (nameOff < 0) { await handle.close(); return null }

    // Step 3: read the full name table using its declared length
    const readLen = Math.min(Math.max(nameLen, 4096), 131072) // cap at 128 KB
    const nb = Buffer.alloc(readLen)
    const { bytesRead: nRead } = await handle.read(nb, 0, readLen, nameOff)
    await handle.close()
    const nameBuf = nb.subarray(0, nRead)

    if (nameBuf.length < 6) return null
    const nRec = nameBuf.readUInt16BE(2)
    const strBase = nameBuf.readUInt16BE(4) // offset within nameBuf to string storage

    let family = null, preferred = null
    for (let i = 0; i < nRec; i++) {
      const p = 6 + i * 12
      if (p + 12 > nameBuf.length) break
      const pid = nameBuf.readUInt16BE(p)
      const eid = nameBuf.readUInt16BE(p + 2)
      const nid = nameBuf.readUInt16BE(p + 6)
      if (nid !== 1 && nid !== 16) continue
      const len  = nameBuf.readUInt16BE(p + 8)
      const soff = nameBuf.readUInt16BE(p + 10)
      const start = strBase + soff
      if (start + len > nameBuf.length) continue
      let name
      if (pid === 3 && eid === 1) {           // Windows UTF-16 BE
        const b = Buffer.from(nameBuf.subarray(start, start + len))
        for (let j = 0; j < b.length - 1; j += 2) { const t = b[j]; b[j] = b[j+1]; b[j+1] = t }
        name = b.toString('utf16le').replace(/\0/g, '').trim()
      } else if (pid === 1) {                  // Mac Roman
        name = nameBuf.toString('latin1', start, start + len).trim()
      }
      if (!name) continue
      if (nid === 16 && !preferred) preferred = name
      else if (nid === 1 && !family) family = name
      if (preferred && family) break
    }
    return preferred || family
  } catch { try { await handle?.close() } catch {} return null }
}

async function collectFontFiles(dir, EXTS, results = []) {
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return results }
  await Promise.all(entries.map(async e => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { await collectFontFiles(full, EXTS, results) }
    else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) results.push(full)
  }))
  return results
}

function setupFonts() {
  ipcMain.handle('fonts:list', async () => {
    const dirs = process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')]
      : process.platform === 'win32'
      ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts'), path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts')]
    const EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc'])
    const seen = new Set()
    const fonts = []
    const allFiles = (await Promise.all(dirs.map(d => collectFontFiles(d, EXTS)))).flat()
    await Promise.all(allFiles.map(async filePath => {
      const name = await parseFontFamily(filePath)
      if (name && !seen.has(name)) { seen.add(name); fonts.push(name) }
    }))
    return fonts.sort()
  })
}

app.whenReady().then(async () => {
  const { session } = require('electron')
  await session.defaultSession.clearCache()
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'local-fonts') { callback(true); return }
    callback(false)
  })
  createWindow()
  setupStore()
  setupFs()
  setupDialogs()
  setupUpdater()
  setupExport()
  setupSpellcheck()
  setupFonts()
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
      const lang = Array.isArray(v) ? v[0] : v
      if (lang) spellSetLanguage(lang)
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

// ── Markdown → DOCX ───────────────────────────────────────────────────────────
function parseInlineRuns(text, props) {
  const runs = []
  // Handles ***bold-italic***, **bold**, *italic*, ~~strike~~ in one pass
  const re = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~/g
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ ...props, text: text.slice(last, m.index) }))
    if      (m[1]) runs.push(new TextRun({ ...props, text: m[1], bold: true, italics: true }))
    else if (m[2]) runs.push(new TextRun({ ...props, text: m[2], bold: true }))
    else if (m[3]) runs.push(new TextRun({ ...props, text: m[3], italics: true }))
    else if (m[4]) runs.push(new TextRun({ ...props, text: m[4], strike: true }))
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push(new TextRun({ ...props, text: text.slice(last) }))
  return runs.length ? runs : [new TextRun({ ...props, text })]
}

async function mdToDocxBuffer(markdown, options = {}) {
  const font     = options.font     || 'Times New Roman'
  const halfPts  = options.fontSize || 24               // half-points (24 = 12 pt)
  const base     = { font, size: halfPts }

  const paragraphs = []
  const lines = (markdown || '').split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim())            { i++; continue }
    if (line.trim() === '---PAGE---') {
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
      i++; continue
    }
    if (line.startsWith('### ')) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInlineRuns(line.slice(4), base) }))
      i++; continue
    }
    if (line.startsWith('## '))  {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInlineRuns(line.slice(3), base) }))
      i++; continue
    }
    if (line.startsWith('# '))   {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: parseInlineRuns(line.slice(2), base) }))
      i++; continue
    }
    if (line.startsWith('> '))   {
      paragraphs.push(new Paragraph({
        indent: { left: 720 },
        children: parseInlineRuns(line.slice(2), { ...base, italics: true })
      }))
      i++; continue
    }
    if (line.startsWith('- '))   {
      paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2), base) }))
      i++; continue
    }

    // Regular paragraph — merge consecutive plain lines into one
    let text = line; i++
    while (i < lines.length) {
      const next = lines[i]
      if (!next.trim() || /^(#{1,3} |> |- |---PAGE---)/.test(next)) break
      text += ' ' + next.trim(); i++
    }
    paragraphs.push(new Paragraph({ children: parseInlineRuns(text, base) }))
  }

  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))

  const doc = new Document({
    creator: 'Scriptum',
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: paragraphs
    }]
  })
  return Packer.toBuffer(doc)
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

  ipcMain.handle('export:docx', async (_, filePath, markdown, options = {}) => {
    const buffer = await mdToDocxBuffer(markdown, options)
    await fs.writeFile(filePath, buffer)
    return true
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
