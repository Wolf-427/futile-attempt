import { EditorCore } from './EditorCore.js';
import { Paginator } from './Paginator.js';

export const Editor = {
  _docPath:  null,
  _saveTimer: null,
  _paginateTimer: null,
  core:      null,
  paginator: null,

  PAGE_SIZES: {
    a4:     { width: 794,  height: 1123 },
    letter: { width: 816,  height: 1056 },
  },
  _fontCache: null,
  _fontCachePromise: null,
  SPELLCHECK_LANGS: [
    { label: 'English (US)', value: 'en-US' },
    { label: 'English (UK)', value: 'en-GB' },
    { label: 'German', value: 'de-DE' },
    { label: 'French', value: 'fr-FR' },
    { label: 'Spanish', value: 'es-ES' },
  ],
  MARGIN:   96,
  PAGE_GAP: 32,
  FONT_SIZES: [8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72],

  async getPageSize() {
    try { const s = await api.store.get('page-size'); if (s?.width) return s } catch {}
    return { ...this.PAGE_SIZES.a4, preset: 'a4' }
  },

  async mount(container) {
    // Expose a promise that loadDoc() can await — prevents it running before this.core exists
    let _resolveMountReady
    this._mountReady = new Promise(r => { _resolveMountReady = r })

    this._freshMount = true
    container.innerHTML = `
      <div class="editor editor-enter">
        <div class="editor-cover-bg" id="editor-cover-bg"><div class="editor-cover-bg-img" id="editor-cover-bg-img"></div></div>
        <div class="focus-mode-strip" id="focus-mode-strip"></div>
        <div class="editor-toolbar" id="editor-toolbar"></div>
        <div class="editor-scroll" id="editor-scroll">
          <div class="editor-page-wrap" id="editor-page-wrap">
            <div id="tiptap-target"></div>
          </div>
        </div>
        <div class="editor-status">
          <span id="word-count">0 words</span>
          <span id="char-count">0 chars</span>
          <span id="page-count" style="margin-left:auto">Page 1</span>
        </div>
      </div>`;

    const savedLangs = await api.store.get('spellcheck-languages').catch(() => []);
    const initialLang = savedLangs?.[0] || 'en-US';

    // Prime the nspell dictionary before the editor boots so the first check has it ready
    await api.spellcheck.setLanguage(initialLang).catch(() => {});

    this.core = new EditorCore(container.querySelector('#tiptap-target'), {
      lang: initialLang,
      spellcheckApi: api.spellcheck,
      onUpdate: () => this._onUpdate(),
      onSelectionUpdate: () => this._syncToolbar()
    });
    this.paginator = new Paginator(this.core);
    // Start loading fonts immediately so they're ready when the picker opens
    if (!this._fontCachePromise) {
      this._fontCachePromise = api.fonts.list()
        .then(f => { this._fontCache = f; return f })
        .catch(() => { this._fontCache = []; return [] })
    }
    this._buildToolbar();
    this._applyPageSize();
    this._setupFocusMode();
    this._initContextMenu();
    Store.sub(['visibleMargins', 'showFormattingChars', 'paperTheme', 'theme'], async () => {
      await this._applyPageSize();
      this._updateUI();
    });

    _resolveMountReady()
  },

  _setupFocusMode() {
    const editorEl = document.querySelector('.editor');
    const strip = document.getElementById('focus-mode-strip');

    // Restore persisted state
    api.store.get('focus-mode').then(v => { if (v) editorEl?.classList.add('focus-mode') }).catch(() => {})

    // Hover strip — peek at toolbar while in focus mode
    if (strip) {
      const tb = document.getElementById('editor-toolbar')
      strip.addEventListener('mouseenter', () => editorEl?.classList.add('toolbar-peek'))
      strip.addEventListener('mouseleave', (e) => {
        if (tb && tb.contains(e.relatedTarget)) return
        editorEl?.classList.remove('toolbar-peek')
      })
      if (tb) {
        tb.addEventListener('mouseleave', (e) => {
          if (strip.contains(e.relatedTarget)) return
          editorEl?.classList.remove('toolbar-peek')
        })
      }
    }

    // Keyboard shortcut Cmd+Shift+F
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        this._toggleFocusMode()
      }
    })
  },

  _toggleFocusMode() {
    const editorEl = document.querySelector('.editor')
    if (!editorEl) return
    const isOn = editorEl.classList.toggle('focus-mode')
    editorEl.classList.remove('toolbar-peek')
    api.store.set('focus-mode', isOn).catch(() => {})
    // Update button state
    const btn = document.getElementById('focus-mode-btn')
    if (btn) btn.classList.toggle('active', isOn)
  },

  _initContextMenu() {
    let menu = document.getElementById('editor-ctx')
    if (!menu) {
      menu = document.createElement('div')
      menu.id = 'editor-ctx'
      menu.className = 'editor-ctx-bar'
      menu.style.display = 'none'
      document.body.appendChild(menu)
    }
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('#editor-ctx')) this._hideCtxMenu()
    }, true)

    const pm = document.querySelector('.ProseMirror')
    if (pm) {
      pm.addEventListener('contextmenu', async e => {
        e.preventDefault()
        await this._onContextMenu(e)
      })
    }
  },

  _hideCtxMenu() {
    const m = document.getElementById('editor-ctx')
    if (m) m.style.display = 'none'
  },

  _showCtxMenu(cx, cy, groups) {
    const menu = document.getElementById('editor-ctx')
    if (!menu) return
    menu.innerHTML = ''

    const sep = () => {
      const d = document.createElement('div'); d.className = 'editor-ctx-sep'; menu.appendChild(d)
    }

    groups.forEach((group, gi) => {
      if (gi > 0) sep()
      for (const item of group) {
        const btn = document.createElement('button')
        btn.className = 'text-fmt-btn editor-ctx-btn'
        if (item.checked) btn.classList.add('active')
        if (item.danger)  btn.style.color = 'var(--err)'
        btn.innerHTML = item.icon
        btn.title = item.label
        btn.onclick = () => { this._hideCtxMenu(); item.action() }
        menu.appendChild(btn)
      }
    })

    menu.style.display = 'flex'
    menu.style.left = cx + 'px'
    menu.style.top  = cy + 'px'
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect()
      if (r.right  > window.innerWidth)  menu.style.left = (cx - r.width)  + 'px'
      if (r.bottom > window.innerHeight) menu.style.top  = (cy - r.height) + 'px'
    })
  },

  async _onContextMenu(e) {
    const groups = []
    const ed = this.core?.instance

    // Spell suggestions — text chips
    const span = e.target.closest('.spell-error')
    if (span) {
      const word = span.dataset.word || span.textContent.trim()
      const from = parseInt(span.dataset.from)
      const to   = parseInt(span.dataset.to)
      const suggestions = await api.spellcheck.suggest(word).catch(() => [])
      const spellGroup = []
      for (const s of suggestions) {
        spellGroup.push({
          icon: `<span style="font-size:11px;font-family:var(--sans)">${s}</span>`,
          label: s,
          action: () => { const tr = ed.state.tr.insertText(s, from, to); ed.view.dispatch(tr) }
        })
      }
      spellGroup.push({
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        label: `Add "${word}" to Dictionary`,
        action: () => api.spellcheck.addWord(word)
      })
      if (spellGroup.length) groups.push(spellGroup)
    }

    // Formatting
    if (ed && !ed.state.selection.empty) {
      groups.push([
        { icon: '<strong>B</strong>', label: 'Bold',            checked: ed.isActive('bold'),      action: () => ed.chain().focus().toggleBold().run() },
        { icon: '<em>I</em>',         label: 'Italic',          checked: ed.isActive('italic'),    action: () => ed.chain().focus().toggleItalic().run() },
        { icon: '<u>U</u>',           label: 'Underline',       checked: ed.isActive('underline'), action: () => ed.chain().focus().toggleUnderline().run() },
        { icon: '<s>S</s>',           label: 'Strikethrough',   checked: ed.isActive('strike'),    action: () => ed.chain().focus().toggleStrike().run() },
        { icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>', label: 'Clear Formatting', action: () => ed.chain().focus().unsetAllMarks().run() },
      ])
    }

    // Clipboard
    groups.push([
      { icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="20" r="2"/><circle cx="6" cy="4" r="2"/><line x1="6" y1="6" x2="6" y2="18"/><line x1="6" y1="12" x2="18" y2="4"/><line x1="6" y1="12" x2="18" y2="20"/></svg>', label: 'Cut',   action: () => document.execCommand('cut') },
      { icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', label: 'Copy',  action: () => document.execCommand('copy') },
      { icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>', label: 'Paste', action: () => document.execCommand('paste') },
    ])

    if (groups.length) this._showCtxMenu(e.clientX, e.clientY, groups)
  },

  _buildToolbar() {
    const tb = document.getElementById('editor-toolbar'); tb.innerHTML = '';
    const t = this;

    const btn = (html, act, chk, title) => {
      const b = document.createElement('button');
      b.className = 'editor-tool'; b.innerHTML = html; b.title = title || '';
      b.addEventListener('mousedown', e => { e.preventDefault(); act(); t._syncToolbar() })
      b._chk = chk; return b
    }
    const sep = () => { const d=document.createElement('div'); d.className='editor-div'; return d }

    // Font size
    const fsSel = document.createElement('select')
    fsSel.className='editor-page-sel'; fsSel.title='Font size'; fsSel.style.width='58px'
    this.FONT_SIZES.forEach(sz => { const o=document.createElement('option'); o.value=sz; o.textContent=sz; fsSel.appendChild(o) })
    fsSel.value=12
    fsSel.addEventListener('change', () => {
      this._setFontSize(fsSel.value)
    })
    tb.appendChild(fsSel); tb.appendChild(sep())

    // Font Family — searchable picker backed by system fonts
    // Remove any stale dropdown from a previous mount
    document.querySelector('.font-picker-list[data-picker="editor-ff"]')?.remove()

    const ffWrap = document.createElement('div')
    ffWrap.style.cssText = 'position:relative;display:inline-flex;align-items:center'
    const ffInput = document.createElement('input')
    ffInput.className = 'editor-page-sel'
    ffInput.type = 'text'
    ffInput.title = 'Font family'
    ffInput.style.cssText = 'width:130px;cursor:text'
    ffInput.autocomplete = 'off'
    ffInput.spellcheck = false
    ffInput.placeholder = 'Font…'
    ffWrap.appendChild(ffInput)

    // Dropdown lives on body so it's never clipped by toolbar overflow
    const ffList = document.createElement('div')
    ffList.className = 'font-picker-list'
    ffList.dataset.picker = 'editor-ff'
    document.body.appendChild(ffList)

    const ffPosition = () => {
      const r = ffInput.getBoundingClientRect()
      ffList.style.top  = `${r.bottom + 2}px`
      ffList.style.left = `${Math.max(4, r.left)}px`
      ffList.style.width = '240px'
    }

    const ffRender = (filter) => {
      const fonts = this._fontCache
      if (!fonts) {
        // Still loading
        ffList.innerHTML = '<div class="font-picker-loading">Loading fonts…</div>'
        ffPosition()
        ffList.style.display = 'block'
        return
      }
      const q = (filter || '').toLowerCase()
      const matches = q ? fonts.filter(f => f.toLowerCase().includes(q)) : fonts
      const capped = matches.slice(0, 150)
      if (!capped.length) { ffList.style.display = 'none'; return }
      const current = ffInput._selectedFont || ffInput.value
      ffList.innerHTML = capped.map(f =>
        `<div class="font-picker-item${f === current ? ' selected' : ''}" data-font="${f}" style="font-family:'${f}',serif">${f}</div>`
      ).join('')
      ffPosition()
      ffList.style.display = 'block'
      ffList.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
    }

    ffInput.addEventListener('focus', () => { ffInput.select(); ffRender('') })
    ffInput.addEventListener('input', () => ffRender(ffInput.value))
    window.addEventListener('scroll', ffPosition, true)

    ffList.addEventListener('mousedown', async (e) => {
      const item = e.target.closest('.font-picker-item')
      if (!item) return
      e.preventDefault()
      const font = item.dataset.font
      ffInput._selectedFont = font
      ffInput.value = font
      ffInput.style.fontFamily = `'${font}',serif`
      ffList.style.display = 'none'
      ffInput.blur()
      this._setFontFamily(font)
      await api.store.set('editor-font-family', font)
    })

    ffInput.addEventListener('blur', () => {
      // Restore selected font name if user typed something partial
      if (ffInput._selectedFont) ffInput.value = ffInput._selectedFont
      setTimeout(() => { ffList.style.display = 'none' }, 200)
    })

    // Set initial value from store
    api.store.get('editor-font-family').then(v => {
      const name = v && !v.startsWith('var(') && !v.includes(',') ? v : 'Lora'
      ffInput._selectedFont = name
      ffInput.value = name
      ffInput.style.fontFamily = `'${name}',serif`
      this._setFontFamily(name)
    }).catch(() => {})

    // When fonts finish loading, refresh the list if the input is still focused
    this._fontCachePromise.then(() => {
      if (document.activeElement === ffInput) ffRender(ffInput.value)
    })

    tb.appendChild(ffWrap); tb.appendChild(sep())

    // Paragraph style
    const hSel = document.createElement('select')
    hSel.className='editor-page-sel'; hSel.title='Paragraph style'; hSel.style.width='90px'
    ;[['p','Normal'],['h1','Heading 1'],['h2','Heading 2'],['h3','Heading 3'],['blockquote','Quote']].forEach(([v,l])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=l; hSel.appendChild(o)
    })
    hSel.addEventListener('change', () => {
      if (!t.core?.instance) return
      const v = hSel.value
      if      (v==='p')          t.core.instance.chain().focus().setParagraph().run()
      else if (v==='blockquote') t.core.instance.chain().focus().toggleBlockquote().run()
      else t.core.instance.chain().focus().toggleHeading({ level: parseInt(v[1]) }).run()
    })
    tb.appendChild(hSel); tb.appendChild(sep())

    const isActive = (type, attrs) => t.core?.instance?.isActive(type, attrs);

    // Formatting
    ;[
      btn('<strong>B</strong>', () => t.core?.instance?.chain().focus().toggleBold().run(),      () => isActive('bold'),      'Bold ⌘B'),
      btn('<em>I</em>',         () => t.core?.instance?.chain().focus().toggleItalic().run(),    () => isActive('italic'),    'Italic ⌘I'),
      btn('<u>U</u>',           () => t.core?.instance?.chain().focus().toggleUnderline().run(), () => isActive('underline'), 'Underline ⌘U'),
      btn('<s>S</s>',           () => t.core?.instance?.chain().focus().toggleStrike().run(),    () => isActive('strike'),    'Strikethrough'),
    ].forEach(b=>tb.appendChild(b)); tb.appendChild(sep())

    // Alignment
    const ASVG = [
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect x="2" y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect x="3" y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect x="4" y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect x="6" y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect y="3" width="14" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect y="9" width="14" height="1.5" rx=".75"/></svg>',
    ]
    ;['left','center','right','justify'].forEach((a,i)=>{
      const b=btn(ASVG[i], () => t.core.instance.chain().focus().setTextAlign(a).run(), () => isActive({textAlign:a}), ['Left','Center','Right','Justify'][i])
      b.style.padding='4px 6px'; tb.appendChild(b)
    }); tb.appendChild(sep())

    // Lists
    ;[
      btn('•—', () => t.core?.instance?.chain().focus().toggleBulletList().run(),          () => isActive('bulletList'),  'Bullet list'),
      btn('1—', () => t.core?.instance?.chain().focus().toggleOrderedList().run(),         () => isActive('orderedList'), 'Numbered list'),
      btn('⇥',  () => t.core?.instance?.chain().focus().sinkListItem('listItem').run(),    null, 'Indent'),
      btn('⇤',  () => t.core?.instance?.chain().focus().liftListItem('listItem').run(),    null, 'Outdent'),
    ].forEach(b=>tb.appendChild(b)); tb.appendChild(sep())

    // Spellcheck Language
    const langSel = document.createElement('select')
    langSel.className='editor-page-sel'; langSel.title='Spellcheck language'; langSel.style.width='90px'
    this.SPELLCHECK_LANGS.forEach(l => { const o=document.createElement('option'); o.value=l.value; o.textContent=l.label; langSel.appendChild(o) })
    api.store.get('spellcheck-languages').then(v => { if(v && v.length) { langSel.value = v[0]; t._applyLanguage(v[0], false) } }).catch(()=>{})
    langSel.addEventListener('change', () => {
      t._applyLanguage(langSel.value).catch(console.error)
    })
    const dictBtn = btn(
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      () => api.spellcheck.openDictionaryFolder(),
      null, 'Open dictionary folder'
    )
    const spellToggleBtn = btn(
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="2" y="16" font-size="13" font-family="serif" fill="currentColor" stroke="none">abc</text><line x1="2" y1="19" x2="22" y2="19" stroke-width="1.5"/></svg>',
      () => t._applySpellcheckEnabled(!t._spellEnabled),
      () => t._spellEnabled,
      'Toggle spellcheck'
    )
    t._spellEnabled = true
    api.store.get('spellcheck-enabled').then(v => {
      if (v === false) t._applySpellcheckEnabled(false, false)
    }).catch(() => {})
    tb.appendChild(langSel); tb.appendChild(dictBtn); tb.appendChild(spellToggleBtn); tb.appendChild(sep())

    // Page size
    const pgSel = document.createElement('select')
    pgSel.id='pg-sel'; pgSel.className='editor-page-sel'; pgSel.title='Page size'
    ;[['a4','A4'],['letter','Letter'],['custom','Custom']].forEach(([v,l])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=l; pgSel.appendChild(o)
    })
    this.getPageSize().then(pg=>{ pgSel.value=pg.preset||'a4' })
    pgSel.addEventListener('change', async () => {
      let saved
      if (pgSel.value==='custom') {
        const w=parseInt(prompt('Width (px):','794')||'794')
        const h=parseInt(prompt('Height (px):','1123')||'1123')
        saved={preset:'custom',width:w,height:h}
      } else { saved={...this.PAGE_SIZES[pgSel.value],preset:pgSel.value} }
      await api.store.set('page-size', saved)
      this._applyPageSize()
    })
    tb.appendChild(pgSel); tb.appendChild(sep())

    // Export
    tb.appendChild(btn(
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      ()=>t._showExportOptions(), null, 'Export'
    ))
    tb.appendChild(sep())
    tb.appendChild(btn(
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
      ()=>Store.set('visibleMargins', !Store.get('visibleMargins')),
      ()=>Store.get('visibleMargins'), 'Toggle visible margins'
    ))
    tb.appendChild(btn(
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/></svg>',
      ()=>Store.set('showFormattingChars', !Store.get('showFormattingChars')),
      ()=>Store.get('showFormattingChars'), 'Toggle formatting characters'
    ))

    // Focus mode toggle
    const focusBtn = btn(
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
      () => t._toggleFocusMode(),
      () => document.querySelector('.editor')?.classList.contains('focus-mode'),
      'Focus mode (⌘⇧F)'
    )
    focusBtn.id = 'focus-mode-btn'
    api.store.get('focus-mode').then(v => { if (v) focusBtn.classList.add('active') }).catch(() => {})
    tb.appendChild(focusBtn)
  },

  async _applyLanguage(lang, persist = true) {
    if (persist) await api.store.set('spellcheck-languages', [lang]);
    document.documentElement.lang = lang.split('-')[0];
    if (this.core) await this.core.setLanguage(lang);
  },

  async _applySpellcheckEnabled(enabled, persist = true) {
    this._spellEnabled = enabled
    if (persist) await api.store.set('spellcheck-enabled', enabled).catch(() => {})
    this.core?.setSpellcheckEnabled(enabled)
    const langSel = document.querySelector('.editor-toolbar select[title="Spellcheck language"]')
    if (langSel) langSel.disabled = !enabled
    this._syncToolbar()
  },

  _setFontSize(v) {
    const pm = document.querySelector('.ProseMirror')
    if (pm) pm.style.fontSize = v + 'px'
    if (this._docPath) api.store.set(`editor-font-size:${this._docPath}`, v).catch(() => {})
    if (this.core?.instance) {
      const { from, to } = this.core.instance.state.selection
      if (from !== to) this.core.setFontSize(v)
    }
  },

  _fontNameToCss(name) {
    if (!name) return 'var(--serif)'
    // Handle legacy stored CSS values
    if (name.startsWith('var(') || name.includes(',')) return name
    return `'${name}', Georgia, serif`
  },

  _setFontFamily(name) {
    const pm = document.querySelector('.ProseMirror')
    if (pm) pm.style.fontFamily = this._fontNameToCss(name)
  },

  _syncToolbar() {
    if (!this.core?.instance) return
    document.querySelectorAll('.editor-tool').forEach(b => {
      if (b._chk) { try { b.classList.toggle('active', !!b._chk()) } catch {} }
    })
    const hSel = document.querySelector('.editor-page-sel[title="Paragraph style"]')
    if (hSel) {
      if      (this.core.instance.isActive('heading',{level:1})) hSel.value='h1'
      else if (this.core.instance.isActive('heading',{level:2})) hSel.value='h2'
      else if (this.core.instance.isActive('heading',{level:3})) hSel.value='h3'
      else if (this.core.instance.isActive('blockquote'))         hSel.value='blockquote'
      else                                              hSel.value='p'
    }
    const fsSel = document.querySelector('.editor-page-sel[title="Font size"]')
    if (fsSel) {
      const active = this.core.getActiveFontSize()
      if (active) fsSel.value = active
      else {
        // Reflect the CSS default so the selector never looks blank
        const globalSize = document.querySelector('.ProseMirror')?.style.fontSize?.replace('px','')
        if (globalSize) fsSel.value = globalSize
      }
    }
  },

  // ── Page background ────────────────────────────────────────────────────────
  async _applyPageSize() {
    this._pg = await this.getPageSize()
    const pg   = this._pg
    const wrap = document.getElementById('editor-page-wrap')
    if (!wrap) return

    this.paginator.updateConfig({
      pageHeight: pg.height,
      margin: this.MARGIN,
      pageGap: this.PAGE_GAP
    });

    const paperTheme = Store.get('paperTheme')
    const isLight = paperTheme==='light' || (paperTheme==='auto' && Store.get('theme')==='light')
    const isDark  = paperTheme==='dark'  || (paperTheme==='auto' && Store.get('theme')==='dark')
    wrap.classList.toggle('paper-light', isLight)
    wrap.classList.toggle('paper-dark',  isDark)

    const showMargins = Store.get('visibleMargins')
    wrap.classList.toggle('show-margins', !!showMargins)

    const showFormattingChars = Store.get('showFormattingChars')
    wrap.classList.toggle('show-format-chars', !!showFormattingChars)

    wrap.style.width           = pg.width + 'px'
    wrap.style.height          = 'min-content'
    wrap.style.padding         = '0' // Fix: Remove wrapper padding to stop "narrow text"
    wrap.style.position        = 'relative'
    wrap.style.boxShadow       = 'none'
    wrap.style.border          = 'none'
    wrap.style.background      = 'transparent'
    wrap.style.backgroundImage = 'none'

    wrap.style.setProperty('--pg-w', pg.width + 'px')
    wrap.style.setProperty('--pg-h', pg.height + 'px')
    wrap.style.setProperty('--pg-m', this.MARGIN + 'px')
    wrap.style.setProperty('--pg-gap', this.PAGE_GAP + 'px')

    const pm = document.querySelector('.ProseMirror')
    if (pm) {
      pm.style.minHeight = (pg.height - 2 * this.MARGIN) + 'px';
      // Ensure margins are strictly applied here as the single source of truth
      pm.style.setProperty('padding', `${this.MARGIN}px ${this.MARGIN}px`, 'important');
    }

    let styleEl = document.getElementById('editor-page-style')
    if (!styleEl) { styleEl=document.createElement('style'); styleEl.id='editor-page-style'; document.head.appendChild(styleEl) }
    styleEl.textContent = `@page{size:${pg.width}px ${pg.height}px;margin:0}`

  },

  _updateUI() {
    if (!this.core?.instance) return;

    const text = this.core.instance.getText();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const wordEl = document.getElementById('word-count');
    const charEl = document.getElementById('char-count');

    if (wordEl) wordEl.textContent = words + ' words';
    if (charEl) charEl.textContent = text.length + ' chars';

    // Debounce pagination to handle large pastes without crashing
    clearTimeout(this._paginateTimer);
    this._paginateTimer = setTimeout(() => this.paginator.refresh(), 150);
  },

  _onUpdate() {
    this._updateUI();

    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 1000);
    Store.patch('git', { dirty: true });
  },

  async loadDoc(path) {
    // Wait for mount() to finish — renderEditor doesn't await mount(), so core may not exist yet
    if (this._mountReady) await this._mountReady

    const scroll = document.querySelector('.editor-scroll')
    const isFresh = this._freshMount
    this._freshMount = false
    if (!isFresh && scroll) scroll.classList.add('doc-fade')

    this._docPath = path
    const [html] = await Promise.all([
      api.fs.read(path).then(c => this._md2html(c)).catch(() => '<p></p>'),
      isFresh ? Promise.resolve() : new Promise(r => setTimeout(r, 150)),
    ])
    if (scroll) scroll.scrollTop = 0
    this.core.setContent(html)
    if (!isFresh && scroll) scroll.classList.remove('doc-fade')

    this._syncToolbar()
    await this._applyPageSize()
    this._updateUI()

    try {
      const v = await api.store.get(`editor-font-size:${path}`)
      const sz = v || 12
      this._setFontSize(sz)
      const s = document.querySelector('.editor-page-sel[title="Font size"]'); if(s) s.value=sz
    } catch {}
    try {
      const f = await api.store.get('editor-font-family')
      if (f) {
        this._setFontFamily(f)
        const inp = document.querySelector('input[title="Font family"]')
        if (inp) { const name = f.startsWith('var(') || f.includes(',') ? 'Lora' : f; inp.value = name; inp.style.fontFamily = `'${name}',serif` }
      }
    } catch {}
    requestAnimationFrame(()=>this.core.instance.commands.focus('end'))

    // Re-paginate after fonts finish loading — on first startup fonts may not
    // be ready when the 150ms debounce fires, causing wrong line-height measurements.
    document.fonts.ready.then(() => {
      clearTimeout(this._paginateTimer)
      this._paginateTimer = setTimeout(() => this.paginator.refresh(), 50)
    })
  },

  async _save() {
    if (!this._docPath) return
    try { await api.fs.write(this._docPath, this._html2md(this._getCleanHTML())) } catch {}
  },

  _getCleanHTML() {
    const html = this.core.getHTML();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const container = doc.body;

    // 1. Remove all layout-only spacers and indicators
    container.querySelectorAll('.page-auto-spacer, .page-break-spacer, .page-number-indicator, .page-break-node').forEach(s => s.remove());
    
    // 2. Transform or strip elements for Word compatibility
    const all = container.querySelectorAll('*');
    for (const el of all) {
      const tag = el.tagName.toLowerCase();

      // Replace manual page breaks with a standard HR
      if (el.getAttribute('data-type') === 'pageBreak' || tag === 'hr') {
        const pb = doc.createElement('div');
        pb.setAttribute('style', 'page-break-after: always;');
        el.replaceWith(pb);
        continue;
      }

      // Word dislikes empty paragraphs used for spacing
      if (tag === 'p' && !el.textContent.trim() && !el.querySelector('img, br')) {
        el.innerHTML = '&nbsp;'; 
      }

      // Only preserve critical inline styles (alignment)
      let cleanStyle = '';
      if (el.style.textAlign) cleanStyle += `text-align: ${el.style.textAlign};`;
      if (el.style.paddingLeft) cleanStyle += `padding-left: ${el.style.paddingLeft};`;
      if (el.style.fontWeight) cleanStyle += `font-weight: ${el.style.fontWeight};`;

      // Important: Save required attributes BEFORE removing them
      const saved = {};
      const allowedAttrs = ['href', 'src', 'alt', 'colspan', 'rowspan'];
      allowedAttrs.forEach(a => { if(el.hasAttribute(a)) saved[a] = el.getAttribute(a); });

      // Strip data attributes and classes which confuse Word, but keep IDs and basic structure
      Array.from(el.attributes).forEach(attr => { if(attr.name.startsWith('data-') || attr.name === 'class') el.removeAttribute(attr.name) });
      Object.entries(saved).forEach(([k,v]) => el.setAttribute(k, v));
      
      if (cleanStyle) el.setAttribute('style', cleanStyle);
    }

    return container.innerHTML;
  },

  // ── Markdown ───────────────────────────────────────────────────────────────
  _md2html(md) {
    if (!md) return '<p></p>';
    return (md
      .replace(/^---PAGE---$/gm, '<div data-type="pageBreak"></div>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/^> (.+)$/gm,   '<blockquote><p>$1</p></blockquote>')
      .split('\n\n').map(b=>b.startsWith('<')?b:`<p>${b||'<br>'}</p>`).join('')
    );
  },

  _html2md(html) {
    const doc = new DOMParser().parseFromString(html,'text/html')
    let md = ''
    const proc = n => {
      if (n.nodeType===Node.TEXT_NODE) return n.textContent
      if (n.nodeType!==Node.ELEMENT_NODE) return ''
      const tag=n.tagName.toLowerCase()
      const inner=Array.from(n.childNodes).map(proc).join('')
      switch(tag) {
        case 'h1': return '\n# '+inner+'\n'
        case 'h2': return '\n## '+inner+'\n'
        case 'h3': return '\n### '+inner+'\n'
        case 'p': case 'div': return inner.trim()?'\n\n'+inner:(n.innerHTML==='<br>'?'\n\n':'')
        case 'strong': case 'b': return '**'+inner+'**'
        case 'em': case 'i':     return '*'+inner+'*'
        case 'u':                return inner
        case 's':                return '~~'+inner+'~~'
        case 'blockquote': return '\n> '+inner.replace(/\n\n/g,'\n> ').trim()+'\n'
        case 'ul': case 'ol': return '\n'+inner+'\n'
        case 'li': return '- '+inner.trim()+'\n'
        case 'hr': return '\n---PAGE---\n'  // all HRs are page breaks in clean HTML
        case 'br': return '\n'
        default: return inner
      }
    }
    Array.from(doc.body.childNodes).forEach(n=>{ md+=proc(n) })
    md=md.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
        .replace(/\n{3,}/g,'\n\n').replace(/^\n+/,'').trim()
    if(md&&!md.endsWith('\n')) md+='\n'
    return md
  },

  // ── Export ──────────────────────────────────────────────────────────────────
  async _showExportOptions() {
    const name = this._docPath?this._docPath.split('/').pop().replace('.md',''):'Document'
    const ov=document.createElement('div'); ov.className='modal-overlay'
    ov.innerHTML=`<div class="modal">
      <div class="modal-header">Export Document</div>
      <div class="modal-body"><p class="modal-label">Choose format:</p>
        <div style="display:flex;gap:10px;margin-top:10px;">
          <button class="btn-sm primary" id="export-pdf-btn" style="flex:1">Export as PDF</button>
          <button class="btn-sm primary" id="export-docx-btn" style="flex:1">Export as DOCX</button>
        </div></div>
      <div class="modal-footer"><button class="btn-sm" id="modal-cancel">Cancel</button></div>
    </div>`
    document.body.appendChild(ov)
    const close=()=>ov.remove()
    ov.querySelector('#modal-cancel').onclick=close
    ov.onclick=e=>{if(e.target===ov)close()}
    ov.querySelector('#export-pdf-btn').onclick=async()=>{
      close()
      const p=await api.dialog.save('Export PDF',name+'.pdf',[{name:'PDF',extensions:['pdf']}])
      if(!p) return

      const pg = await this.getPageSize()
      // Pass dimensions if custom, otherwise preset name string
      const pdfSize = pg.preset === 'custom' ? { width: pg.width, height: pg.height } : (pg.preset === 'letter' ? 'Letter' : 'A4');

      document.documentElement.classList.add('is-exporting')

      // Increase delay slightly to ensure all CSS transitions (0.3s) and reflows are settled
      await new Promise(r => setTimeout(r, 700));

        try {
        await api.export.pdf(p, { pageSize: pdfSize })
          alert('Exported!')
        } catch(e) { console.error(e); alert('Failed: ' + e.message) }
        finally { document.documentElement.classList.remove('is-exporting') }
    }
    ov.querySelector('#export-docx-btn').onclick=async()=>{
      close()
      const p=await api.dialog.save('Export DOCX',name+'.docx',[{name:'DOCX',extensions:['docx']}])
      if(!p) return
      try {
        // Handle cases where the store might be empty (first run)
        const ff = await api.store.get('editor-font-family') || 'Lora'
        const fs = await api.store.get('editor-font-size') || 12
        // Extract clean font name from legacy CSS values or use as-is
        let fontName = ff
        if (ff.startsWith('var(--serif)')) fontName = 'Lora'
        else if (ff.startsWith('var(--sans)')) fontName = 'DM Sans'
        else if (ff.includes(',')) fontName = ff.split(',')[0].replace(/['"]/g, '').trim()
        const fontSizePt = parseInt(fs) || 12
        
        // html-to-docx uses half-points for its fontSize option
        const docxFontSize = fontSizePt * 2 

        const markdown = this._html2md(this._getCleanHTML())
        await api.export.docx(p, markdown, { font: fontName, fontSize: docxFontSize })
        alert('Exported!')
      } catch(e) { alert('Failed: ' + e.message) }
    }
  },

  _getCleanHTML(exportFontName, exportFontSizePt) {
    const html = this.core.getHTML();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const container = doc.body;

    // 1. Remove all layout-only spacers and indicators
    container.querySelectorAll('.page-auto-spacer, .page-break-spacer, .page-number-indicator, .page-break-node').forEach(s => s.remove());
    
    // 2. Transform or strip elements for Word compatibility
    const all = container.querySelectorAll('*');
    for (const el of all) {
      const tag = el.tagName.toLowerCase();

      // Replace manual page breaks with a standard HR
      if (el.getAttribute('data-type') === 'pageBreak' || tag === 'hr') {
        const pb = doc.createElement('div');
        pb.setAttribute('style', 'page-break-after: always;');
        el.replaceWith(pb);
        continue;
      }

      // Word dislikes empty paragraphs used for spacing
      if (tag === 'p' && !el.textContent.trim() && !el.querySelector('img, br')) {
        el.innerHTML = '&nbsp;'; 
      }

      // Preserve critical inline styles (alignment, font)
      let cleanStyle = '';
      if (el.style.textAlign) cleanStyle += `text-align: ${el.style.textAlign};`;
      if (el.style.paddingLeft) cleanStyle += `padding-left: ${el.style.paddingLeft};`;
      if (el.style.fontWeight) cleanStyle += `font-weight: ${el.style.fontWeight};`;

      // Explicitly set font-family and font-size for text-bearing elements
      const textTags = ['p', 'h1', 'h2', 'h3', 'li', 'span', 'div', 'strong', 'em', 's', 'u', 'blockquote'];
      if (textTags.includes(tag)) {
        cleanStyle += `font-family: '${exportFontName}';`;
        cleanStyle += `font-size: ${exportFontSizePt}pt;`;
      }

      // Important: Save required attributes BEFORE removing them
      const saved = {};
      const allowedAttrs = ['href', 'src', 'alt', 'colspan', 'rowspan'];
      allowedAttrs.forEach(a => { if(el.hasAttribute(a)) saved[a] = el.getAttribute(a); });

      // Strip data attributes and classes which confuse Word, but keep IDs and basic structure
      Array.from(el.attributes).forEach(attr => { if(attr.name.startsWith('data-') || attr.name === 'class') el.removeAttribute(attr.name) });
      Object.entries(saved).forEach(([k,v]) => el.setAttribute(k, v));
      
      if (cleanStyle) el.setAttribute('style', cleanStyle);
    }

    return container.innerHTML;
  },
}

// Expose to global scope for app.js
window.Editor = Editor;
