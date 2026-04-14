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

  // Word-standard font sizes
  FONT_SIZES: [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72],

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
    this._content.addEventListener('keyup', () => this._updateToolbar())
    this._content.addEventListener('mouseup', () => this._updateToolbar())
    this._applyPageSize()
  },

  _buildToolbar() {
    const tb = document.getElementById('editor-toolbar')
    tb.innerHTML = ''

    const btn = (label, action, activeCheck, title, mono) => {
      const b = document.createElement('button')
      b.className = 'editor-tool'
      b.innerHTML = label
      b.title = title || label
      if (mono) b.style.fontFamily = 'var(--mono)'
      b.addEventListener('mousedown', e => {
        e.preventDefault()
        action()
        this._updateToolbar()
      })
      b._activeCheck = activeCheck
      return b
    }

    const div = () => { const d = document.createElement('div'); d.className = 'editor-div'; return d }

    // Font size dropdown (Word sizes)
    const fsSel = document.createElement('select')
    fsSel.className = 'editor-page-sel'
    fsSel.title = 'Font size'
    fsSel.style.width = '58px'
    this.FONT_SIZES.forEach(sz => {
      const opt = document.createElement('option')
      opt.value = sz; opt.textContent = sz
      fsSel.appendChild(opt)
    })
    fsSel.value = 12
    api.store.get('editor-font-size').then(v => {
      if (v) { fsSel.value = v; if (this._content) this._content.style.fontSize = v + 'pt' }
    }).catch(() => {})
    fsSel.addEventListener('change', async () => {
      if (this._content) this._content.style.fontSize = fsSel.value + 'pt'
      await api.store.set('editor-font-size', fsSel.value)
    })
    tb.appendChild(fsSel)
    tb.appendChild(div())

    // Headings
    const hSel = document.createElement('select')
    hSel.className = 'editor-page-sel'
    hSel.title = 'Paragraph style'
    hSel.style.width = '90px'
    ;[['p','Normal'],['h1','Heading 1'],['h2','Heading 2'],['h3','Heading 3'],['blockquote','Quote']].forEach(([v,l]) => {
      const opt = document.createElement('option'); opt.value = v; opt.textContent = l; hSel.appendChild(opt)
    })
    hSel.addEventListener('change', () => {
      document.execCommand('formatBlock', false, hSel.value)
      this._content.focus()
    })
    tb.appendChild(hSel)
    tb.appendChild(div())

    // Style buttons
    const styleButtons = [
      btn('<strong>B</strong>', () => document.execCommand('bold'), () => document.queryCommandState('bold'), 'Bold ⌘B'),
      btn('<em>I</em>',        () => document.execCommand('italic'), () => document.queryCommandState('italic'), 'Italic ⌘I'),
      btn('<u>U</u>',          () => document.execCommand('underline'), () => document.queryCommandState('underline'), 'Underline ⌘U'),
      btn('<s>S</s>',          () => document.execCommand('strikeThrough'), () => document.queryCommandState('strikeThrough'), 'Strikethrough'),
    ]
    styleButtons.forEach(b => tb.appendChild(b))
    tb.appendChild(div())

    // Alignment
    const alignButtons = [
      btn('⬤⬤⬤⬤', () => document.execCommand('justifyLeft'),    () => document.queryCommandState('justifyLeft'),    'Align left ⌘⇧L'),
      btn('◎◎◎◎', () => document.execCommand('justifyCenter'),  () => document.queryCommandState('justifyCenter'),  'Center ⌘⇧E'),
      btn('⬤⬤⬤⬤', () => document.execCommand('justifyRight'),   () => document.queryCommandState('justifyRight'),   'Align right ⌘⇧R'),
      btn('▬▬▬▬', () => document.execCommand('justifyFull'),    () => document.queryCommandState('justifyFull'),    'Justify ⌘⇧J'),
    ]
    // Better alignment icons
    const alignIcons = ['≡','≡','≡','≡']
    const alignLabels = [
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect x="2" y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect x="3" y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect x="4" y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect x="6" y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect y="3" width="14" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect y="9" width="14" height="1.5" rx=".75"/></svg>',
    ]
    const alignCmds = ['justifyLeft','justifyCenter','justifyRight','justifyFull']
    const alignTitles = ['Align left','Center','Align right','Justify']
    alignCmds.forEach((cmd, i) => {
      const b = btn(alignLabels[i], () => document.execCommand(cmd), () => document.queryCommandState(cmd), alignTitles[i])
      b.style.padding = '4px 6px'
      tb.appendChild(b)
    })
    tb.appendChild(div())

    // Lists & indent
    ;[
      btn('•—', () => document.execCommand('insertUnorderedList'), () => document.queryCommandState('insertUnorderedList'), 'Bullet list'),
      btn('1—', () => document.execCommand('insertOrderedList'),   () => document.queryCommandState('insertOrderedList'),   'Numbered list'),
      btn('⇥',  () => document.execCommand('indent'),   null, 'Increase indent'),
      btn('⇤',  () => document.execCommand('outdent'),  null, 'Decrease indent'),
    ].forEach(b => tb.appendChild(b))
    tb.appendChild(div())

    // Page break + page size
    const pbBtn = btn('⊟', () => this._insertPageBreak(), null, 'Page break (⌘↵)')
    tb.appendChild(pbBtn)
    tb.appendChild(div())

    const pgSel = document.createElement('select')
    pgSel.id = 'pg-sel'; pgSel.className = 'editor-page-sel'; pgSel.title = 'Page size'
    ;[['a4','A4'],['letter','Letter'],['custom','Custom']].forEach(([val,lbl]) => {
      const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl; pgSel.appendChild(opt)
    })
    this.getPageSize().then(pg => { pgSel.value = pg.preset || 'a4' })
    pgSel.addEventListener('change', async () => {
      let saved
      if (pgSel.value === 'custom') {
        const w = parseInt(prompt('Width (px):', '794') || '794')
        const h = parseInt(prompt('Height (px):', '1123') || '1123')
        saved = { preset: 'custom', width: w, height: h }
      } else {
        saved = { ...this.PAGE_SIZES[pgSel.value], preset: pgSel.value }
      }
      await api.store.set('page-size', saved)
      this._applyPageSize()
    })
    tb.appendChild(pgSel)
  },

  _exec(cmd, arg) { document.execCommand(cmd, false, arg || null); this._content.focus() },

  _updateToolbar() {
    // Update style buttons
    document.querySelectorAll('.editor-tool').forEach(btn => {
      if (btn._activeCheck) {
        try { btn.classList.toggle('active', btn._activeCheck()) } catch {}
      }
    })
    // Update paragraph style selector
    const hSel = document.querySelector('.editor-page-sel[title="Paragraph style"]')
    if (hSel) {
      try {
        const tag = document.queryCommandValue('formatBlock').toLowerCase()
        if (['h1','h2','h3','blockquote'].includes(tag)) hSel.value = tag
        else hSel.value = 'p'
      } catch {}
    }
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
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 'b') { e.preventDefault(); document.execCommand('bold') }
    if (mod && e.key === 'i') { e.preventDefault(); document.execCommand('italic') }
    if (mod && e.key === 'u') { e.preventDefault(); document.execCommand('underline') }
    if (mod && e.shiftKey && e.key === 'L') { e.preventDefault(); document.execCommand('justifyLeft') }
    if (mod && e.shiftKey && e.key === 'E') { e.preventDefault(); document.execCommand('justifyCenter') }
    if (mod && e.shiftKey && e.key === 'R') { e.preventDefault(); document.execCommand('justifyRight') }
    if (mod && e.shiftKey && e.key === 'J') { e.preventDefault(); document.execCommand('justifyFull') }
    if (mod && e.key === 'Enter') { e.preventDefault(); this._insertPageBreak() }
  },

  async _applyPageSize() {
    const pg = await this.getPageSize()
    const wrap = document.getElementById('editor-page-wrap')
    if (!wrap) return

    const paperTheme = Store.get('paperTheme')
    const isLight = paperTheme === 'light' || (paperTheme === 'auto' && Store.get('theme') === 'light')
    const isDark = paperTheme === 'dark' || (paperTheme === 'auto' && Store.get('theme') === 'dark')
    wrap.classList.toggle('paper-light', isLight)
    wrap.classList.toggle('paper-dark', isDark)

    const lineH = pg.height - this.MARGIN * 2
    wrap.style.cssText = `
      width: ${pg.width}px;
      min-height: ${pg.height}px;
      border: 1px solid var(--b1);
      border-radius: 2px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      padding: ${this.MARGIN}px;
      position: relative;
      background-image: repeating-linear-gradient(to bottom, transparent, transparent ${lineH - 1}px, var(--paper-line) ${lineH - 1}px, var(--paper-line) ${lineH}px);
      background-size: 100% ${lineH}px;
      background-position: 0 ${this.MARGIN}px;
    `
    if (this._content) this._content.style.minHeight = lineH + 'px'
    this._updatePageCount(pg)
  },

  _updatePageCount(pg) {
    if (!this._content) return
    const lineH = pg.height - this.MARGIN * 2
    const pages = Math.max(1, Math.ceil(this._content.scrollHeight / lineH))
    const el = document.getElementById('page-count')
    if (el) el.textContent = `Page ${pages}`
  },

  _updateCounts() {
    const text = this._content?.innerText || ''
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const wc = document.getElementById('word-count')
    const cc = document.getElementById('char-count')
    if (wc) wc.textContent = `${words} words`
    if (cc) cc.textContent = `${text.length} chars`
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
    try {
      const v = await api.store.get('editor-font-size')
      if (v && this._content) {
        this._content.style.fontSize = v + 'pt'
        const sel = document.querySelector('.editor-page-sel[title="Font size"]')
        if (sel) sel.value = v
      }
    } catch {}
    // Focus at end
    requestAnimationFrame(() => {
      if (!this._content) return
      this._content.focus()
      try {
        const range = document.createRange()
        range.selectNodeContents(this._content)
        range.collapse(false)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      } catch {}
    })
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
