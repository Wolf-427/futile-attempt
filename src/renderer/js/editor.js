const Editor = {
  _docPath: null,
  _saveTimer: null,
  _content: null,
  _pageSize: null,

  PAGE_SIZES: {
    a4:     { width: 794,  height: 1123, label: 'A4' },
    letter: { width: 816,  height: 1056, label: 'Letter' },
    custom: { width: 794,  height: 1123, label: 'Custom' },
  },
  MARGIN: 80,
  PAGE_GAP: 32,

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
    document.execCommand('defaultParagraphSeparator', false, 'p')
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

    // Export button
    tb.appendChild(div()) // Separator
    const exportBtn = btn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>', () => this._showExportOptions(), null, 'Export Document')
    tb.appendChild(exportBtn)
  },

  async _showExportOptions() {
    const name = this._docPath ? this._docPath.split('/').pop().replace('.md', '') : 'Document'

    const overlay = document.createElement('div'); overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">Export Document</div>
        <div class="modal-body">
          <p class="modal-label">Choose export format:</p>
          <div style="display:flex;gap:10px;margin-top:10px;">
            <button class="btn-sm primary" id="export-pdf-btn" style="flex:1;">Export as PDF</button>
            <button class="btn-sm primary" id="export-docx-btn" style="flex:1;">Export as DOCX</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-sm" id="modal-cancel">Cancel</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const close = () => overlay.remove()

    overlay.querySelector('#modal-cancel').onclick = close
    overlay.onclick = (e) => { if (e.target === overlay) close() }

    overlay.querySelector('#export-pdf-btn').onclick = async () => {
      close()
      const path = await api.dialog.save('Export PDF', `${name}.pdf`, [{ name: 'PDF Files', extensions: ['pdf'] }])
      if (!path) return

      document.body.classList.add('is-exporting')
      try {
        await api.export.pdf(path)
        alert('Export successful!')
      } catch (e) {
        alert('Export failed: ' + e.message)
      } finally {
        document.body.classList.remove('is-exporting')
      }
    }

    overlay.querySelector('#export-docx-btn').onclick = async () => {
      close()
      const path = await api.dialog.save('Export DOCX', `${name}.docx`, [{ name: 'Word Documents', extensions: ['docx'] }])
      if (!path) return

      try {
        await api.export.docx(path, this._getCleanHTML())
        alert('Export successful!')
      } catch (e) {
        alert('Export failed: ' + e.message)
      }
    }
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
    document.execCommand('insertHTML', false,
      '<hr class="page-break" contenteditable="false"><p><br></p>'
    )
    this._content.focus()
    if (!this._pageSize) return
    // Run spacers immediately, then scroll the cursor into view on the new page
    requestAnimationFrame(() => {
      const { pages } = this._updatePageSpacers(this._pageSize)
      const wrap = document.getElementById('editor-page-wrap')
      if (wrap) wrap.style.height = `${pages * (this._pageSize.height + this.PAGE_GAP) - this.PAGE_GAP}px`
      const pc = document.getElementById('page-count')
      if (pc) pc.textContent = `Page ${pages}`
      const sel = window.getSelection()
      if (sel?.focusNode) {
        const node = sel.focusNode.nodeType === Node.TEXT_NODE
          ? sel.focusNode.parentElement : sel.focusNode
        node?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  },

  _onInput() {
    this._updateCounts()
    if (this._pageSize) this._updatePageCount(this._pageSize)
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

    const gap = this.PAGE_GAP
    const tileH = pg.height + gap

    wrap.style.width = `${pg.width}px`
    wrap.style.height = `${pg.height}px`
    wrap.style.padding = `${this.MARGIN}px`
    wrap.style.position = 'relative'
    wrap.style.boxShadow = 'none'
    wrap.style.border = 'none'

    // Fetch computed CSS variables after classes are applied
    const computedStyle = getComputedStyle(wrap)
    const paperBg   = computedStyle.getPropertyValue('--paper-bg').trim()
    const deskColor = getComputedStyle(document.body).getPropertyValue('--bg').trim()

    // Layer 1 — drop shadow that bleeds into the gap below each page
    // Layer 2 — full page rectangle (paperBg) + gap (deskColor)
    wrap.style.backgroundImage = `
      linear-gradient(to bottom,
        transparent        0px,
        transparent        ${pg.height}px,
        rgba(0,0,0,0.22)   ${pg.height}px,
        rgba(0,0,0,0.06)   ${pg.height + 18}px,
        transparent        ${pg.height + 36}px,
        transparent        ${tileH}px
      ),
      linear-gradient(to bottom,
        ${paperBg}   0px,
        ${paperBg}   ${pg.height}px,
        ${deskColor} ${pg.height}px,
        ${deskColor} ${tileH}px
      )
    `
    wrap.style.backgroundColor = paperBg
    wrap.style.backgroundSize = `100% ${tileH}px`
    wrap.style.backgroundRepeat = 'repeat-y'
    wrap.style.backgroundPosition = '0 0'

    if (this._content) this._content.style.minHeight = (pg.height - this.MARGIN * 2) + 'px'

    // Inject @page rule so printToPDF respects the chosen page size and margins
    let pageStyleEl = document.getElementById('editor-page-style')
    if (!pageStyleEl) {
      pageStyleEl = document.createElement('style')
      pageStyleEl.id = 'editor-page-style'
      document.head.appendChild(pageStyleEl)
    }
    pageStyleEl.textContent = `@page { size: ${pg.width}px ${pg.height}px; margin: ${this.MARGIN}px; }`

    this._pageSize = pg
    this._updatePageCount(pg)
  },

  _updatePageCount(pg) {
    if (!this._content) return
    requestAnimationFrame(() => {
      const { pages } = this._updatePageSpacers(pg)
      const el = document.getElementById('page-count')
      if (el) el.textContent = `Page ${pages}`
      const wrap = document.getElementById('editor-page-wrap')
      if (wrap) wrap.style.height = `${pages * (pg.height + this.PAGE_GAP) - this.PAGE_GAP}px`
    })
  },

  // Inserts spacer divs at page overflow boundaries so content never renders over
  // the inter-page gap. Uses offsetTop (not offsetHeight sums) so CSS margins are
  // correctly accounted for. Returns the actual page count.
  _updatePageSpacers(pg) {
    const contentAreaH = pg.height - 2 * this.MARGIN      // usable content height per page
    const spacerH      = this.PAGE_GAP + 2 * this.MARGIN  // visual gap + both page margins

    // Remove old spacers first so offsetTop readings reflect clean layout
    this._content.querySelectorAll('.page-auto-spacer, .page-break-spacer').forEach(s => s.remove())

    // offsetTop of the content div itself gives the wrap-top-to-content-div offset (= MARGIN).
    // Subtracting it converts each child's offsetTop to content-div-local coordinates.
    const contentDivOffset = this._content.offsetTop

    const childData = Array.from(this._content.children).map(el => ({
      el,
      // Use offsetTop so CSS margins between paragraphs are included in position
      top:    el.offsetTop - contentDivOffset,
      bottom: el.offsetTop + el.offsetHeight - contentDivOffset,
      isBreakHR: el.tagName === 'HR' && el.classList.contains('page-break'),
    }))

    const toInsert    = []
    let pageNum       = 0
    let totalSpacersH = 0  // cumulative spacer pixels inserted so far (shifts paged positions)

    // Paged limit: where page N's content area ends in paged coordinates
    const pagedLimit = () => (pageNum + 1) * contentAreaH + pageNum * spacerH

    for (const { el, top, bottom, isBreakHR } of childData) {
      // Convert natural positions → paged positions
      const pagedTop    = top    + totalSpacersH
      const pagedBottom = bottom + totalSpacersH

      if (isBreakHR) {
        // Explicit page break: advance to next page regardless of position
        pageNum++
        const nextPageStart = pageNum * (contentAreaH + spacerH)
        const needed = Math.max(0, nextPageStart - pagedBottom)
        if (needed > 0) {
          toInsert.push({ ref: el, after: true, h: needed, cls: 'page-break-spacer' })
          totalSpacersH += needed
        }
        continue
      }

      if (pagedBottom > pagedLimit()) {
        // Element overflows: insert spacer before it to push it to the next page
        const remaining    = Math.max(0, pagedLimit() - pagedTop)
        const spacerHeight = remaining + spacerH
        toInsert.push({ ref: el, after: false, h: spacerHeight, cls: 'page-auto-spacer' })
        totalSpacersH += spacerHeight
        pageNum++
      }
    }

    for (const { ref, after, h, cls } of toInsert) {
      const s = document.createElement('div')
      s.className = cls
      s.contentEditable = 'false'
      s.style.cssText = `height:${Math.max(0, h)}px;display:block;pointer-events:none;user-select:none;`
      if (after) ref.insertAdjacentElement('afterend', s)
      else       this._content.insertBefore(s, ref)
    }

    return { pages: pageNum + 1 }
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

  _getCleanHTML() {
    const clone = this._content.cloneNode(true)
    clone.querySelectorAll('.page-auto-spacer, .page-break-spacer').forEach(s => s.remove())
    return clone.innerHTML
  },

  async _save() {
    if (!this._docPath) return
    try { await api.fs.write(this._docPath, this._html2md(this._getCleanHTML())) } catch {}
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
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let markdown = '';

    const processNode = (node) => {
      let result = '';
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        const childrenMarkdown = Array.from(node.childNodes).map(processNode).join('');

        switch (tagName) {
          case 'h1':    result += `\n# ${childrenMarkdown}\n`; break;
          case 'h2':    result += `\n## ${childrenMarkdown}\n`; break;
          case 'h3':    result += `\n### ${childrenMarkdown}\n`; break;
          case 'p':
          case 'div':   // Treat divs as paragraphs for contenteditable output
            // Only add newlines if content exists, to avoid excessive blank lines
            if (childrenMarkdown.trim()) {
              result += `\n\n${childrenMarkdown}`;
            } else if (node.innerHTML === '<br>') { // Handle empty paragraphs with just a <br>
              result += '\n\n';
            }
            break;
          case 'strong':
          case 'b':     result += `**${childrenMarkdown}**`; break;
          case 'em':
          case 'i':     result += `*${childrenMarkdown}*`; break;
          case 'blockquote': result += `\n> ${childrenMarkdown.replace(/\n\n/g, '\n> ').trim()}\n`; break;
          case 'ul':
          case 'ol':
            // List items are handled by their children, just ensure block separation
            result += `\n${childrenMarkdown}\n`;
            break;
          case 'li':
            // Indent list items and add bullet/number. This is a simplification.
            // For nested lists, a more complex state machine would be needed.
            result += `- ${childrenMarkdown.trim()}\n`;
            break;
          case 'hr':
            if (node.classList.contains('page-break')) {
              result += '\n---PAGE---\n';
            } else {
              result += '\n---\n'; // Generic HR
            }
            break;
          case 'br':    result += '\n'; break;
          // Add more cases for other HTML tags as needed (e.g., code, links, images)
          default:      result += childrenMarkdown; break; // Fallback for unhandled tags
        }
      }
      return result;
    };

    // Process all top-level nodes in the body
    Array.from(doc.body.childNodes).forEach(node => {
      markdown += processNode(node);
    });

    // Decode HTML entities that might have been preserved
    markdown = markdown
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');

    // Clean up excessive newlines
    markdown = markdown.replace(/\n\s*\n/g, '\n\n'); // Collapse multiple blank lines
    markdown = markdown.replace(/^\n+/, '').trim(); // Trim leading/trailing newlines

    // Ensure a final newline if content exists
    if (markdown.length > 0 && !markdown.endsWith('\n')) {
      markdown += '\n';
    }

    return markdown;
  }
}
