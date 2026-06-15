const Settings = {
  accentColors: [
    { name: 'Crimson', hex: '#ab0909' },
    { name: 'Amber',   hex: '#c9a96e' },
    { name: 'Blue',    hex: '#5b8dd9' },
    { name: 'Green',   hex: '#6bbf8e' },
    { name: 'Mauve',   hex: '#9b72cf' },
    { name: 'Ember',   hex: '#e0853c' },
    { name: 'Teal',    hex: '#4db8b8' },
  ].map(c => {
    const n = parseInt(c.hex.slice(1), 16)
    return { ...c, rgb: `${(n>>16)&255},${(n>>8)&255},${n&255}` }
  }),

  _fontCache: null,

  async _loadSystemFonts() {
    if (this._fontCache) return this._fontCache
    try {
      if ('queryLocalFonts' in window) {
        const raw = await window.queryLocalFonts()
        const seen = new Set()
        this._fontCache = raw
          .map(f => f.family)
          .filter(f => { if (seen.has(f)) return false; seen.add(f); return true })
          .sort()
      }
    } catch(e) {
      // permission denied or API unavailable
    }
    if (!this._fontCache) this._fontCache = []
    return this._fontCache
  },

  _initFontPicker(id, fonts, current, storeKey) {
    const container = document.getElementById(id)
    if (!container) return

    // Remove any orphaned list from a previous render of this picker
    document.querySelector(`.font-picker-list[data-picker="${id}"]`)?.remove()

    const display = current || (storeKey === 'editorFont' ? 'Lora' : 'DM Sans')
    container.innerHTML = `<input class="font-picker-input" type="text" value="${display}" placeholder="Search fonts…" autocomplete="off" spellcheck="false" style="font-family:'${display}',serif"/>`
    const input = container.querySelector('.font-picker-input')

    // Append list to body so it escapes any overflow:hidden/auto parent
    const list = document.createElement('div')
    list.className = 'font-picker-list'
    list.dataset.picker = id
    document.body.appendChild(list)

    const position = () => {
      const r = input.getBoundingClientRect()
      list.style.top  = `${r.bottom + 4}px`
      list.style.left = `${Math.max(4, r.right - 220)}px`
    }

    const showList = (filter) => {
      const q = (filter || '').toLowerCase()
      const matches = fonts.filter(f => f.toLowerCase().includes(q)).slice(0, 120)
      if (!matches.length) { list.style.display = 'none'; return }
      const active = Store.get(storeKey) || display
      list.innerHTML = matches.map(f =>
        `<div class="font-picker-item${f === active ? ' selected' : ''}" data-font="${f}" style="font-family:'${f}',serif">${f}</div>`
      ).join('')
      position()
      list.style.display = 'block'
      list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
    }

    input.addEventListener('focus', () => showList(input.value))
    input.addEventListener('input', () => showList(input.value))
    window.addEventListener('scroll', position, true)

    list.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.font-picker-item')
      if (!item) return
      e.preventDefault()
      const font = item.dataset.font
      input.value = font
      input.style.fontFamily = `'${font}',serif`
      list.style.display = 'none'
      Store.set(storeKey, font)
    })

    input.addEventListener('blur', () => {
      setTimeout(() => { list.style.display = 'none' }, 150)
    })

    if (!fonts.length) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        const val = input.value.trim()
        if (val) { input.style.fontFamily = `'${val}',serif`; Store.set(storeKey, val); input.blur() }
      })
    }
  },

  async mount(container, project = null) {
    const version = await api.app.version().catch(() => '0.1.0')
    const token   = await api.store.get('gh-token').catch(() => null)
    const theme = Store.get('theme')
    const paperTheme = Store.get('paperTheme')
    const coverBgEnabled = Store.get('coverBgEnabled')
    const backupInterval = Store.get('backupInterval') ?? 5
    const accentColors = this.accentColors
    const currentHex = (accentColors.find(c => c.name === Store.get('accentName')) ?? accentColors[0]).hex

    container.innerHTML = `
      <div class="settings">
        <h2>Settings</h2>

        <div class="settings-section">
          <div class="settings-title">Appearance</div>
          <div class="settings-row" style="margin-bottom:12px">
            <div style="flex:1"><div class="settings-note" style="margin:0">Application Theme</div></div>
            <select class="settings-input" id="setting-theme" style="max-width:120px">
              <option value="dark" ${theme==='dark'?'selected':''}>Dark</option>
              <option value="light" ${theme==='light'?'selected':''}>Light</option>
            </select>
          </div>
          <div class="settings-row" style="margin-top:12px">
            <div style="flex:1">
              <div class="settings-note" style="margin:0">Accent Color</div>
            </div>
            <div class="accent-swatches" id="accent-swatches">
              ${accentColors.map(c => `<button class="accent-swatch${currentHex === c.hex ? ' active' : ''}" data-hex="${c.hex}" data-rgb="${c.rgb}" title="${c.name}" style="background:${c.hex}"></button>`).join('')}
            </div>
          </div>

          <div class="settings-row" style="margin-top:12px">
            <div style="flex:1">
              <div class="settings-note" style="margin:0">Editor Paper</div>
              <div style="font-size:10px;color:var(--tx3)">The writing area background</div>
            </div>
            <select class="settings-input" id="setting-paper" style="max-width:120px">
              <option value="auto" ${paperTheme==='auto'?'selected':''}>Follow Theme</option>
              <option value="dark" ${paperTheme==='dark'?'selected':''}>Always Dark</option>
              <option value="light" ${paperTheme==='light'?'selected':''}>Always Light</option>
            </select>
          </div>

          <div class="settings-row" style="margin-top:12px">
            <div style="flex:1">
              <div class="settings-note" style="margin:0">Cover Background</div>
              <div style="font-size:10px;color:var(--tx3)">Blurred project cover behind the editor</div>
            </div>
            <label class="toggle">
              <input type="checkbox" id="setting-cover-bg" ${coverBgEnabled ? 'checked' : ''}/>
              <span class="toggle-track"></span>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-title">Backups</div>
          <div class="settings-row">
            <div style="flex:1">
              <div class="settings-note" style="margin:0">Timed backup interval</div>
              <div style="font-size:10px;color:var(--tx3)">Keeps 5 timed + 3 switch backups per document in .backups/</div>
            </div>
            <select class="settings-input" id="setting-backup-interval" style="max-width:120px">
              <option value="0"  ${backupInterval===0?'selected':''}>Off</option>
              <option value="5"  ${backupInterval===5?'selected':''}>5 min</option>
              <option value="10" ${backupInterval===10?'selected':''}>10 min</option>
              <option value="15" ${backupInterval===15?'selected':''}>15 min</option>
              <option value="30" ${backupInterval===30?'selected':''}>30 min</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-title">Current version</div>
          <div class="settings-version">v${version}</div>
        </div>

        <div class="settings-section">
          <div class="settings-title">GitHub token</div>
          <div class="settings-note">Personal access token with <strong>repo</strong> scope.<br>GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → New token → tick repo</div>
          <div id="token-area">
            ${token
              ? `<div class="settings-row"><span style="color:var(--ok);font-size:13px">✓ Token saved</span><button class="btn-sm danger" id="clear-token" style="margin-left:10px">Remove</button></div>`
              : `<div class="settings-row"><input type="password" class="settings-input" id="token-input" placeholder="ghp_…"/><button class="btn-sm" id="save-token" style="margin-left:8px">Save</button></div>`
            }
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-title">App updates</div>
          <div class="settings-note">Checks GitHub for new commits and downloads changed files directly — no build needed.</div>
          <div id="update-card"></div>
          <button class="btn-sm" id="check-update" style="margin-top:8px">Check for updates</button>
          <div id="update-msg" class="settings-msg" style="margin-top:8px"></div>
        </div>
      </div>
    `
    this._currentVersion = version
    this._bind()
  },

  _currentVersion: '0.1.0',

  _bind() {
    document.getElementById('save-token')?.addEventListener('click', async () => {
      const t = document.getElementById('token-input')?.value?.trim()
      if (!t) return
      await api.store.set('gh-token', t)
      document.getElementById('token-area').innerHTML = `<div class="settings-row"><span style="color:var(--ok);font-size:13px">✓ Token saved</span><button class="btn-sm danger" id="clear-token" style="margin-left:10px">Remove</button></div>`
      document.getElementById('clear-token').addEventListener('click', async () => { await api.store.del('gh-token'); location.reload() })
    })
    document.getElementById('clear-token')?.addEventListener('click', async () => { await api.store.del('gh-token'); location.reload() })

    document.querySelectorAll('.accent-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        Store.set('accentName', btn.title)
        document.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', b === btn))
      })
    })

    document.getElementById('setting-theme')?.addEventListener('change', (e) => {
      Store.set('theme', e.target.value)
    })
    document.getElementById('setting-paper')?.addEventListener('change', (e) => {
      Store.set('paperTheme', e.target.value)
    })
    document.getElementById('setting-cover-bg')?.addEventListener('change', (e) => {
      Store.set('coverBgEnabled', e.target.checked)
    })
    document.getElementById('setting-backup-interval')?.addEventListener('change', (e) => {
      Store.set('backupInterval', Number(e.target.value))
    })

    document.getElementById('check-update').addEventListener('click', async () => {
      const token = await api.store.get('gh-token')
      if (!token) { this._msg('Save a GitHub token first', 'err'); return }
      this._msg('Checking…', '')
      document.getElementById('update-card').innerHTML = ''
      const result = await api.update.check(token, 'Wolf-427', 'futile-attempt')
      if (result.error) { this._msg('Error: ' + result.error, 'err'); return }
      if (!result.hasUpdate) { this._msg('✓ Already up to date', 'ok'); return }
      this._msg('', '')

      // Format the commit date nicely
      const dateStr = result.commitDate
        ? new Date(result.commitDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : ''

      document.getElementById('update-card').innerHTML = `
        <div class="update-card">
          <div class="update-title">Update available</div>
          <div class="update-meta">Installed: v${this._currentVersion} → Latest: v${result.newVersion}</div>
          ${dateStr ? `<div class="update-date">${dateStr}</div>` : ''}
          ${result.message ? `<div class="update-msg">${result.message}</div>` : ''}
          <button class="btn-sm primary" id="apply-btn" style="margin-top:12px">Download and apply</button>
        </div>
      `
      document.getElementById('apply-btn').addEventListener('click', async () => {
        document.getElementById('apply-btn').disabled = true
        this._msg('Applying update…', '')
        const r = await api.update.apply(token, 'Wolf-427', 'futile-attempt', result.latestSha)
        if (r.ok) {
          this._msg(`✓ Updated ${r.filesUpdated} files. Restarting…`, 'ok')
          setTimeout(() => api.update.restart(), 1500)
        } else {
          this._msg('✗ ' + r.error, 'err')
          document.getElementById('apply-btn').disabled = false
        }
      })
    })
  },

  _msg(text, type) {
    const m = document.getElementById('update-msg')
    if (m) { m.textContent = text; m.className = 'settings-msg' + (type ? ' ' + type : '') }
  }
}
