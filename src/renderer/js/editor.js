const Editor = {
  _docPath: null,
  _saveTimer: null,
  _content: null,

  PAGE_SIZES: {
    a4:     { width: 794,  height: 1123, label: 'A4' },
    letter: { width: 816,  height: 1056, label: 'Letter' },
    custom: { width: 794,  height: 1123, label: 'Custom' },
  },
  MARGIN: 80,

  async getPageSize() {
    try {
      const saved = await api.store.get('page-size')
      if (saved && saved.width) return saved
    } catch {}
    return { ...this.PAGE_SIZES.a4, preset: 'a4' }
  },

  mount(container) {
    container.innerHTML = `
      <div class="editor">
        <div class="editor-toolbar" id="editor-toolbar"></div>
        <div class="editor-scroll" id="editor-scroll">
          <div class="editor-page-wrap" id="editor-page-wrap">
            <div id="editor-content" class="ProseMirror" contenteditable="true" spellcheck="true" data-placeholder="Begin writing…"></div>
          </div>
        </div>
        <div class="editor-status">
          <span id="word-count">0 words</span>
          <span id="char-count">0 characters</span>
          <span id="page-count" style="margin-left:auto"></span>
        </div>
      </div>
    `
    this._content = document.getElementById('editor-content')
    this._buildToolbar()
    this._content.addEventListener('input', () => this._onInput())
    this._content.addEventListener('keydown', e => this._onKeydown(e))
    this._applyPageSize()
  },

  async _applyPageSize() {
    const pg = await this.getPageSize()
    const wrap = document.getElementById('editor-page-wrap')
    const content = this._content
    if (!wrap || !content) return

    wrap.style.cssText = `
      width: ${pg.width}px;
      min-height: ${pg.height}px;
      background: #1c1c18;
      border: 1px solid var(--b1);
      border-radius: 2px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      padding: ${this.MARGIN}px;
      position: relative;
    `

    // Page break guide lines via background on the wrap
    const lineH = pg.height - this.MARGIN * 2
    wrap.style.backgroundImage = `repeating-linear-gradient(
      to bottom,
      transparent,
      transparent ${lineH - 1}px,
      rgba(255,255,255,0.07) ${lineH - 1}px,
      rgba(255,255,255,0.07) ${lineH}px
    )`
    wrap.style.backgroundSize = `100% ${lineH}px`
    wrap.style.backgroundPosition = `0 ${this.MARGIN}px`

    // Content itself stays simple — no extra styles that block input
    content.style.cssText = `outline: none; min-height: ${pg.height - this.MARGIN * 2}px;`

    // Update page selector
    const sel = document.getElementById('pg-sel')
    if (sel) sel.value = pg.preset || 'a4'

    this._updatePageCount(pg)
  },

  _updatePageCount(pg) {
    if (!this._content) return
    const lineH = pg.height - this.MARGIN * 2
    const pages = Math.max(1, Math.ceil(this._content.scrollHeight / lineH))
    const el = document.getElementById('page-count')
    if (el) el.textContent = `${pages} ${pages === 1 ? 'page' : 'pages'}`
  },

  _buildToolbar() {
    const tb = document.getElementById('editor-toolbar')

    const btn = (label, cmd, arg, title) => {
      const b = document.createElement('button')
      b.className = 'editor-tool'; b.textContent = label; b.title = title || label
      b.dataset.cmd = cmd; b.dataset.arg = arg || ''
      b.addEventListener('mousedown', e => { e.preventDefault(); this._exec(cmd, arg); this._updateToolbar() })
      return b
    }
    const div = () => { const d = document.createElement('div'); d.className = 'editor-div'; return d }

    ;[
      btn('H1','formatBlock','h1'), btn('H2','formatBlock','h2'), btn('H3','formatBlock','h3'), div(),
      btn('B','bold','','Bold ⌘B'), btn('I','italic','','Italic ⌘I'), btn('U','underline','','Underline ⌘U'), div(),
      btn('❝','formatBlock','blockquote'), btn('•','insertUnorderedList'), btn('1.','insertOrderedList'), div(),
    ].forEach(el => tb.appendChild(el))

    // Page break button
    const pbBtn = document.createElement('button')
    pbBtn.className = 'editor-tool'; pbBtn.textContent = '⊟'; pbBtn.title = 'Insert page break (⌘↵)'
    pbBtn.addEventListener('mousedown', e => { e.preventDefault(); this._insertPageBreak() })
    tb.appendChild(pbBtn)
    tb.appendChild(div())

    // Page size selector
    const sel = document.createElement('select')
    sel.id = 'pg-sel'; sel.className = 'editor-page-sel'; sel.title = 'Page size'
    ;[['a4','A4'],['letter','Letter'],['custom','Custom']].forEach(([val,lbl]) => {
      const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl; sel.appendChild(opt)
    })
    this.getPageSize().then(pg => { sel.value = pg.preset || 'a4' })
    sel.addEventListener('change', async () => {
      let saved
      if (sel.value === 'custom') {
        const w = parseInt(prompt('Page width (px):', '794') || '794')
        const h = parseInt(prompt('Page height (px):', '1123') || '1123')
        saved = { preset: 'custom', width: w, height: h, label: 'Custom' }
      } else {
        saved = { ...this.PAGE_SIZES[sel.value], preset: sel.value }
      }
      await api.store.set('page-size', saved)
      this._applyPageSize()
    })
    tb.appendChild(sel)

    this._content.addEventListener('keyup', () => this._updateToolbar())
    this._content.addEventListener('mouseup', () => this._updateToolbar())

    // Font size control
    const fsSep = div(); tb.appendChild(fsSep)
    const fsLabel = document.createElement('span')
    fsLabel.style.cssText = 'font-size:11px;color:var(--tx3);margin-left:4px;'
    fsLabel.textContent = 'Aa'
    tb.appendChild(fsLabel)
    const fsSlider = document.createElement('input')
    fsSlider.type = 'range'; fsSlider.min = 14; fsSlider.max = 28; fsSlider.step = 1; fsSlider.value = 18
    fsSlider.style.cssText = 'width:72px;margin:0 4px;'
    fsSlider.title = 'Font size'
    // Load saved font size
    api.store.get('editor-font-size').then(v => {
      if (v) { fsSlider.value = v; this._content.style.fontSize = v + 'px' }
    }).catch(() => {})
    fsSlider.addEventListener('input', async () => {
      const sz = fsSlider.value
      this._content.style.fontSize = sz + 'px'
      await api.store.set('editor-font-size', sz)
    })
    tb.appendChild(fsSlider)
  },

  _exec(cmd, arg) { document.execCommand(cmd, false, arg || null); this._content.focus() },

  _updateToolbar() {
    document.querySelectorAll('.editor-tool[data-cmd]').forEach(btn => {
      const cmd = btn.dataset.cmd, arg = btn.dataset.arg
      let active = false
      try {
        if (cmd === 'formatBlock') active = document.queryCommandValue('formatBlock').toLowerCase() === arg
        else active = document.queryCommandState(cmd)
      } catch {}
      btn.classList.toggle('active', active)
    })
  },

  _insertPageBreak() {
    document.execCommand('insertHTML', false, '<hr class="page-break" contenteditable="false"><p><br></p>')
    this._content.focus()
  },

  _onInput() {
    this._updateCounts()
    this.getPageSize().then(pg => this._updatePageCount(pg))
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => this._save(), 1400)
    Store.patch('git', { dirty: true })
  },

  _onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); this._exec('bold') }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); this._exec('italic') }
    if ((e.metaKey || e.ctrlKey) && e.key === 'u') { e.preventDefault(); this._exec('underline') }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this._insertPageBreak() }
  },

  _updateCounts() {
    const text = this._content.innerText || ''
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const wc = document.getElementById('word-count')
    const cc = document.getElementById('char-count')
    if (wc) wc.textContent = `${words} words`
    if (cc) cc.textContent = `${text.length} characters`
  },

  async loadDoc(path) {
    this._docPath = path
    try {
      const md = await api.fs.read(path)
      this._content.innerHTML = this._md2html(md)
    } catch { this._content.innerHTML = '<p><br></p>' }
    this._updateCounts()
    this._updateToolbar()
    this._applyPageSize()
    // Restore font size
    api.store.get('editor-font-size').then(v => {
      if (v && this._content) this._content.style.fontSize = v + 'px'
    }).catch(() => {})
  },

  async _save() {
    if (!this._docPath) return
    try { await api.fs.write(this._docPath, this._html2md(this._content.innerHTML)) } catch {}
  },

  _md2html(md) {
    return md
      .replace(/^---PAGE---$/gm, '<hr class="page-break" contenteditable="false">')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,   '<em>$1</em>')
      .replace(/^> (.+)$/gm,   '<blockquote>$1</blockquote>')
      .split('\n\n').map(b => b.startsWith('<') ? b : `<p>${b || '<br>'}</p>`).join('')
      || '<p><br></p>'
  },

  _html2md(html) {
    return html
      .replace(/<hr[^>]*class="page-break"[^>]*>/gi, '\n---PAGE---\n')
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .trim() + '\n'
  }
}
