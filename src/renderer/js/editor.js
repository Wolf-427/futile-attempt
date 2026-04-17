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
  MARGIN:   96,
  PAGE_GAP: 32,
  FONT_SIZES: [8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72],

  async getPageSize() {
    try { const s = await api.store.get('page-size'); if (s?.width) return s } catch {}
    return { ...this.PAGE_SIZES.a4, preset: 'a4' }
  },

  mount(container) {
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
        </div>
      </div>`;

    this.core = new EditorCore(container.querySelector('#tiptap-target'), {
      onUpdate: () => this._onUpdate(),
      onSelectionUpdate: () => this._syncToolbar()
    });
    this.paginator = new Paginator(this.core);
    this._buildToolbar();
    this._applyPageSize();
    Store.sub(['visibleMargins', 'showFormattingChars', 'paperTheme', 'theme'], () => this._applyPageSize());
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
    this.FONT_SIZES.forEach(sz => { const o=document.createElement('option'); o.value=sz; o.textContent=sz + 'px'; fsSel.appendChild(o) })
    fsSel.value=18
    api.store.get('editor-font-size').then(v => { if(v){fsSel.value=v; this._setFontSize(v)} }).catch(()=>{})
    fsSel.addEventListener('change', async () => {
      this._setFontSize(fsSel.value)
      await api.store.set('editor-font-size', fsSel.value)
    })
    tb.appendChild(fsSel); tb.appendChild(sep())

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
      btn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="12" x2="22" y2="12" stroke-dasharray="4 4"/></svg>',
          () => t.core?.instance?.chain().focus().setHorizontalRule().run(), 
          null, 'Manual Page Break'),
    ].forEach(b=>tb.appendChild(b)); tb.appendChild(sep())

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

  _setFontSize(v) {
    const pm = document.querySelector('.ProseMirror');
    if (pm) {
      pm.style.fontSize = v + 'px';
      // We need a slight delay to ensure Tiptap has finished its internal 
      // font-size update before we measure coordinates.
      requestAnimationFrame(() => this.paginator.refresh());
    }
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

    const tileH = pg.height + this.PAGE_GAP
    wrap.style.width           = pg.width + 'px'
    wrap.style.height          = 'min-content'
    wrap.style.padding         = this.MARGIN + 'px'
    wrap.style.position        = 'relative'
    wrap.style.boxShadow       = 'none'
    wrap.style.border          = 'none'
    wrap.style.background      = 'transparent'
    wrap.style.backgroundImage = 'none'

    // Set CSS variables for the margin overlay
    wrap.style.setProperty('--pg-w', pg.width + 'px')
    wrap.style.setProperty('--pg-h', pg.height + 'px')
    wrap.style.setProperty('--pg-m', this.MARGIN + 'px')
    wrap.style.setProperty('--pg-gap', this.PAGE_GAP + 'px')

    const pm = document.querySelector('.ProseMirror');
    if (pm) {
      pm.style.minHeight = (pg.height - 2 * this.MARGIN) + 'px';
      const fs = document.querySelector('.editor-page-sel[title="Font size"]')?.value || 18;
      this._setFontSize(fs);
    }

    let styleEl = document.getElementById('editor-page-style')
    if (!styleEl) { styleEl=document.createElement('style'); styleEl.id='editor-page-style'; document.head.appendChild(styleEl) }
    styleEl.textContent = `@page{size:${pg.width}px ${pg.height}px;margin:0}`

    if (this.paginator) this.paginator.refresh();
  },

  _onUpdate() {
    if (!this.core?.instance) return;
    
    const text = this.core.instance.getText();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('word-count').textContent = words + ' words';
    document.getElementById('char-count').textContent = text.length + ' chars';

    // Debounce pagination to handle large pastes without crashing
    clearTimeout(this._paginateTimer);
    this._paginateTimer = setTimeout(() => this.paginator.refresh(), 150);

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
    this._applyPageSize()
    try {
      const v = await api.store.get('editor-font-size')
      if (v) { this._setFontSize(v); const s=document.querySelector('.editor-page-sel[title="Font size"]'); if(s) s.value=v }
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
    const clone = doc.body;
    clone.querySelectorAll('.page-auto-spacer').forEach(s=>s.remove())
    return clone.innerHTML
  },

  // ── Markdown ───────────────────────────────────────────────────────────────
  _md2html(md) {
    if (!md) return '<p></p>';
    return (md
      .replace(/^---PAGE---$/gm, '<hr />')
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
      document.documentElement.classList.add('is-exporting')

      // Give the DOM more time to reflow and bypass any background transitions
      setTimeout(async () => {
        try {
          await api.export.pdf(p, { pageSize: pg.preset.toUpperCase() })
          alert('Exported!')
        } catch(e) { console.error(e); alert('Failed: ' + e.message) }
        finally { document.documentElement.classList.remove('is-exporting') }
      }, 350)
    }
    ov.querySelector('#export-docx-btn').onclick=async()=>{
      close()
      const p=await api.dialog.save('Export DOCX',name+'.docx',[{name:'DOCX',extensions:['docx']}])
      if(!p) return
      try{await api.export.docx(p,this._getCleanHTML());alert('Exported!')}catch(e){alert('Failed: '+e.message)}
    }
  },
}

// Expose to global scope for app.js
window.Editor = Editor;
