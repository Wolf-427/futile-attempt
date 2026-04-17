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
  FONT_FAMILIES: [
    { label: 'Lora (Serif)', value: 'var(--serif)' },
    { label: 'DM Sans', value: 'var(--sans)' },
    { label: 'Arial', value: 'Arial, sans-serif' },
    { label: 'Times New Roman', value: '"Times New Roman", serif' },
    { label: 'Inter', value: '"Inter", sans-serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
  ],
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
    container.innerHTML = `
      <div class="editor">
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
    this._buildToolbar();
    this._applyPageSize();
    Store.sub(['visibleMargins', 'showFormattingChars', 'paperTheme', 'theme'], async () => {
      await this._applyPageSize();
      this._updateUI();
    });
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
    api.store.get('editor-font-size').then(v => { if(v){fsSel.value=v; this._setFontSize(v)} }).catch(()=>{})
    fsSel.addEventListener('change', () => {
      this._setFontSize(fsSel.value)
    })
    tb.appendChild(fsSel); tb.appendChild(sep())

    // Font Family
    const ffSel = document.createElement('select')
    ffSel.className='editor-page-sel'; ffSel.title='Font family'; ffSel.style.width='110px'
    this.FONT_FAMILIES.forEach(f => { const o=document.createElement('option'); o.value=f.value; o.textContent=f.label; ffSel.appendChild(o) })
    
    api.store.get('editor-font-family').then(v => { if(v){ffSel.value=v; this._setFontFamily(v)} }).catch(()=>{})
    
    ffSel.addEventListener('change', async () => {
      const val = ffSel.value
      this._setFontFamily(val)
      await api.store.set('editor-font-family', val)
    })
    tb.appendChild(ffSel); tb.appendChild(sep())

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
    tb.appendChild(langSel); tb.appendChild(dictBtn); tb.appendChild(sep())

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
  },

  async _applyLanguage(lang, persist = true) {
    if (persist) await api.store.set('spellcheck-languages', [lang]);
    document.documentElement.lang = lang.split('-')[0];
    if (this.core) await this.core.setLanguage(lang);
  },

  _setFontSize(v) {
    if (this.core?.instance) {
      const { from, to } = this.core.instance.state.selection
      if (from !== to) {
        // Text selected — apply as inline mark, don't touch the global default
        this.core.setFontSize(v)
        return
      }
    }
    // No selection — change the whole-document default and persist it
    const pm = document.querySelector('.ProseMirror')
    if (pm) pm.style.fontSize = v + 'px'
    api.store.set('editor-font-size', v).catch(() => {})
  },

  _setFontFamily(v) {
    const pm = document.querySelector('.ProseMirror')
    if (pm) pm.style.fontFamily = v
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
    this._docPath = path
    try {
      const html = this._md2html(await api.fs.read(path))
      this.core.setContent(html);
    } catch { this.core.setContent('<p></p>'); }

    this._syncToolbar()
    await this._applyPageSize()
    this._updateUI()

    try {
      const v = await api.store.get('editor-font-size')
      if (v) { this._setFontSize(v); const s=document.querySelector('.editor-page-sel[title="Font size"]'); if(s) s.value=v }
    } catch {}
    try {
      const f = await api.store.get('editor-font-family')
      if (f) { this._setFontFamily(f); const s=document.querySelector('.editor-page-sel[title="Font family"]'); if(s) s.value=f }
    } catch {}
    requestAnimationFrame(()=>this.core.instance.commands.focus('end'))
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
        const ff = await api.store.get('editor-font-family') || 'var(--serif)'
        const fs = await api.store.get('editor-font-size') || 12
        
        // Clean the font name for Word (e.g., "Lora (Serif)" -> "Lora") and get font size in points
        const fontEntry = this.FONT_FAMILIES.find(f => f.value === ff)
        let fontName = 'Lora' // Default fallback
        
        if (fontEntry) {
          fontName = fontEntry.label.replace(/\s*\(.*\)/, '').trim()
        } else if (ff.includes('"')) {
          // Extract name from raw values like '"Inter", sans-serif'
          fontName = ff.split(',')[0].replace(/"/g, '').trim()
        }
        const fontSizePt = parseInt(fs) || 12
        
        // html-to-docx uses half-points for its fontSize option
        const docxFontSize = fontSizePt * 2 

        await api.export.docx(p, this._getCleanHTML(fontName, fontSizePt), { font: fontName, fontSize: docxFontSize })
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
