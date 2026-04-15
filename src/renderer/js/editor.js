// ── Paged TipTap editor ───────────────────────────────────────────────────────
//
// Pagination model (inspired by TipTap Pro "Pages"):
//   • A custom PageBreak node acts as a variable-height filler.  Its height is
//     set by the Pagination plugin so that content after it always starts at
//     the top of the next page.
//   • Auto page-breaks (content overflow) are handled by inserting
//     Decoration.widget spacers — ProseMirror-managed, survive re-renders.
//   • The wrap background uses a repeating CSS gradient that tiles one page
//     rectangle + gap per cycle, so every page is fully drawn automatically.

const Editor = {
  _docPath:  null,
  _saveTimer: null,
  _tt:       null,   // TipTap Editor instance
  _pg:       null,   // cached page-size object

  PAGE_SIZES: {
    a4:     { width: 794,  height: 1123 },
    letter: { width: 816,  height: 1056 },
    custom: { width: 794,  height: 1123 },
  },
  MARGIN:   80,
  PAGE_GAP: 32,

  FONT_SIZES: [8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72],

  async getPageSize() {
    try { const s = await api.store.get('page-size'); if (s?.width) return s } catch {}
    return { ...this.PAGE_SIZES.a4, preset: 'a4' }
  },

  // ── Mount ──────────────────────────────────────────────────────────────────
  mount(container) {
    container.innerHTML = `
      <div class="editor">
        <div class="editor-toolbar" id="editor-toolbar"></div>
        <div class="editor-scroll" id="editor-scroll">
          <div class="editor-page-wrap" id="editor-page-wrap">
            <div id="editor-tiptap"></div>
          </div>
        </div>
        <div class="editor-status">
          <span id="word-count">0 words</span>
          <span id="char-count">0 chars</span>
          <span id="page-count" style="margin-left:auto"></span>
        </div>
      </div>`
    this._initTipTap()
    this._buildToolbar()
    this._applyPageSize()
  },

  // ── TipTap + Extensions ────────────────────────────────────────────────────
  _initTipTap() {
    const { Editor: TT, Extension, Node, StarterKit,
            Underline, TextAlign, Placeholder,
            Plugin, PluginKey, Decoration, DecorationSet } = window.Tiptap

    const self = this

    // ── PageBreak node ──────────────────────────────────────────────────────
    // Renders as a block div whose height is controlled by the pagination plugin.
    // The visual "page break line" sits in the middle; the rest is transparent filler.
    const PageBreak = Node.create({
      name: 'pageBreak',
      group: 'block',
      atom: true,     // not editable / no children
      selectable: true,
      draggable: false,
      parseHTML() { return [{ tag: 'div[data-type="pageBreak"]' }] },
      renderHTML({ HTMLAttributes }) {
        return ['div', { 'data-type': 'pageBreak', class: 'page-break-node', ...HTMLAttributes }, 0]
      },
      addKeyboardShortcuts() {
        return { 'Mod-Enter': () => this.editor.commands.insertPageBreak() }
      },
      addCommands() {
        return {
          insertPageBreak: () => ({ commands }) =>
            commands.insertContent({ type: 'pageBreak' }),
        }
      },
      addNodeView() {
        return ({ node, getPos, editor }) => {
          const wrap = document.createElement('div')
          wrap.setAttribute('data-type', 'pageBreak')
          wrap.className = 'page-break-node'
          wrap.contentEditable = 'false'
          const line = document.createElement('div')
          line.className = 'page-break-line'
          wrap.appendChild(line)
          return {
            dom: wrap,
            stopEvent: () => true,
            ignoreMutation: () => true,
            // setHeight called by the pagination plugin
            setHeight(h) { wrap.style.height = Math.max(0, h) + 'px' },
          }
        }
      },
    })

    // ── Pagination plugin ───────────────────────────────────────────────────
    const paginationKey = new PluginKey('pagination')

    const makeSpacer = (h) => {
      const d = document.createElement('div')
      d.className = 'page-auto-spacer'
      d.contentEditable = 'false'
      d.style.cssText = `height:${h}px;display:block;pointer-events:none;user-select:none;flex-shrink:0;`
      return d
    }

    const Pagination = Extension.create({
      name: 'pagination',
      addProseMirrorPlugins() {
        let isOwnDispatch = false
        let rafId = null

        const PB_MIN_H = 4  // natural (unexpanded) height of a pageBreak node in px

        const runLayout = (view) => {
          rafId = null
          const pg = self._pg
          if (!pg) return

          const MARGIN   = self.MARGIN
          const PAGE_GAP = self.PAGE_GAP
          const contentH = pg.height - 2 * MARGIN  // usable px per page (e.g. 963)
          const gapH     = PAGE_GAP + 2 * MARGIN    // inter-page gap in content coords (192)

          const editorDom    = view.dom          // the .ProseMirror element
          const editorOffset = editorDom.offsetTop  // = MARGIN (wrap top padding)

          // Previous state — widget auto-spacers (pos→height) and pb fills (pos→height).
          // Both are in the prevState so we can strip their effect from DOM measurements.
          const prevState    = paginationKey.getState(view.state)
          const prevWidgets  = prevState?.specs?.widgets || {}  // auto-spacer widget heights
          const prevFills    = prevState?.specs?.fills   || {}  // pageBreak fill heights

          const newDecos    = []
          const newWidgets  = {}
          const newFills    = {}
          let pageNum       = 0
          let newSpacerAcc  = 0  // cumulative new spacers added so far this pass

          const pagedLimit = () => (pageNum + 1) * contentH + pageNum * gapH

          view.state.doc.forEach((node, offset) => {
            const dom = view.nodeDOM(offset)
            if (!(dom instanceof HTMLElement)) return

            // rawTop: measured DOM position relative to editor top.
            // It includes effects of: prev widget spacers above + prev pb fills above.
            // We strip both to get the "natural" (un-paged) position of this block.
            let stripAbove = 0
            for (const [p, h] of Object.entries(prevWidgets)) {
              if (Number(p) <= offset) stripAbove += h
            }
            for (const [p, h] of Object.entries(prevFills)) {
              // strip (fill - min) because the min height is "real" content height
              if (Number(p) < offset) stripAbove += Math.max(0, h - PB_MIN_H)
            }

            const rawTop    = dom.offsetTop - editorOffset
            const rawH      = dom.offsetHeight
            const natTop    = rawTop - stripAbove
            const natBottom = natTop + rawH  // note: pb rawH = prevFill, see below

            if (node.type.name === 'pageBreak') {
              const pagedTop  = natTop + newSpacerAcc
              const remaining = Math.max(0, pagedLimit() - pagedTop)
              const fillH     = Math.max(PB_MIN_H, remaining + PAGE_GAP + MARGIN)

              dom.style.height = fillH + 'px'
              newFills[offset] = fillH
              // The fill beyond PB_MIN_H acts as a spacer for subsequent blocks
              newSpacerAcc += fillH - PB_MIN_H
              pageNum++
              return
            }

            const pagedTop    = natTop    + newSpacerAcc
            const pagedBottom = natBottom + newSpacerAcc

            if (pagedBottom > pagedLimit()) {
              const remaining = Math.max(0, pagedLimit() - pagedTop)
              const insertH   = remaining + gapH
              newDecos.push(Decoration.widget(offset, makeSpacer(insertH), { side: -1, key: 'as-' + offset }))
              newWidgets[offset] = insertH
              newSpacerAcc += insertH
              pageNum++
            }
          })

          const pages     = pageNum + 1
          const decoSet   = DecorationSet.create(view.state.doc, newDecos)
          const unchanged = prevState &&
            prevState.pages === pages &&
            JSON.stringify(prevState.specs?.widgets) === JSON.stringify(newWidgets) &&
            JSON.stringify(prevState.specs?.fills)   === JSON.stringify(newFills)

          if (!unchanged) {
            isOwnDispatch = true
            view.dispatch(
              view.state.tr.setMeta(paginationKey, { decoSet, specs: { widgets: newWidgets, fills: newFills }, pages })
            )
            isOwnDispatch = false

            // Update UI
            const wrap = document.getElementById('editor-page-wrap')
            if (wrap) {
              const reqH = pages * (pg.height + PAGE_GAP) - PAGE_GAP
              wrap.style.minHeight = reqH + 'px'
              wrap.style.height = 'auto'
            }
            const pc = document.getElementById('page-count')
            if (pc) pc.textContent = 'Page ' + pages
          }
        }

        return [new Plugin({
          key: paginationKey,
          state: {
            init: () => ({ decoSet: DecorationSet.empty, specs: {}, pages: 1 }),
            apply(tr, prev) {
              const meta = tr.getMeta(paginationKey)
              if (meta) return meta
              return { decoSet: prev.decoSet.map(tr.mapping, tr.doc), specs: prev.specs, pages: prev.pages }
            },
          },
          props: {
            decorations: (state) => paginationKey.getState(state).decoSet,
          },
          view(editorView) {
            return {
              update(view, prevState) {
                if (isOwnDispatch) return
                if (rafId) cancelAnimationFrame(rafId)
                rafId = requestAnimationFrame(() => runLayout(view))
              },
            }
          },
        })]
      },
    })

    // ── Build TipTap instance ───────────────────────────────────────────────
    this._tt = new TT({
      element: document.getElementById('editor-tiptap'),
      extensions: [
        StarterKit.configure({ horizontalRule: false }),
        Underline,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Placeholder.configure({ placeholder: 'Begin writing…' }),
        PageBreak,
        Pagination,
      ],
      editorProps: {
        attributes: { class: 'ProseMirror', spellcheck: 'true' },
      },
      onUpdate:          () => this._onUpdate(),
      onSelectionUpdate: () => this._syncToolbar(),
    })
  },

  // ── Toolbar ────────────────────────────────────────────────────────────────
  _buildToolbar() {
    const tb = document.getElementById('editor-toolbar')
    tb.innerHTML = ''
    const t = this

    const btn = (html, act, chk, title) => {
      const b = document.createElement('button')
      b.className = 'editor-tool'; b.innerHTML = html; b.title = title||''
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
      if (!t._tt) return
      const v = hSel.value
      if      (v==='p')          t._tt.chain().focus().setParagraph().run()
      else if (v==='blockquote') t._tt.chain().focus().toggleBlockquote().run()
      else t._tt.chain().focus().toggleHeading({ level: parseInt(v[1]) }).run()
    })
    tb.appendChild(hSel); tb.appendChild(sep())

    // Formatting
    ;[
      btn('<strong>B</strong>', ()=>t._tt?.chain().focus().toggleBold().run(),      ()=>t._tt?.isActive('bold'),      'Bold ⌘B'),
      btn('<em>I</em>',         ()=>t._tt?.chain().focus().toggleItalic().run(),    ()=>t._tt?.isActive('italic'),    'Italic ⌘I'),
      btn('<u>U</u>',           ()=>t._tt?.chain().focus().toggleUnderline().run(), ()=>t._tt?.isActive('underline'), 'Underline ⌘U'),
      btn('<s>S</s>',           ()=>t._tt?.chain().focus().toggleStrike().run(),    ()=>t._tt?.isActive('strike'),    'Strikethrough'),
    ].forEach(b=>tb.appendChild(b)); tb.appendChild(sep())

    // Alignment
    const ASVG = [
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect x="2" y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect x="3" y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect x="4" y="3" width="10" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect x="6" y="9" width="8" height="1.5" rx=".75"/></svg>',
      '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="1.5" rx=".75"/><rect y="3" width="14" height="1.5" rx=".75"/><rect y="6" width="14" height="1.5" rx=".75"/><rect y="9" width="14" height="1.5" rx=".75"/></svg>',
    ]
    ;['left','center','right','justify'].forEach((a,i)=>{
      const b=btn(ASVG[i], ()=>t._tt?.chain().focus().setTextAlign(a).run(), ()=>t._tt?.isActive({textAlign:a}), ['Left','Center','Right','Justify'][i])
      b.style.padding='4px 6px'; tb.appendChild(b)
    }); tb.appendChild(sep())

    // Lists
    ;[
      btn('•—', ()=>t._tt?.chain().focus().toggleBulletList().run(),          ()=>t._tt?.isActive('bulletList'),  'Bullet list'),
      btn('1—', ()=>t._tt?.chain().focus().toggleOrderedList().run(),         ()=>t._tt?.isActive('orderedList'), 'Numbered list'),
      btn('⇥',  ()=>t._tt?.chain().focus().sinkListItem('listItem').run(),    null, 'Indent'),
      btn('⇤',  ()=>t._tt?.chain().focus().liftListItem('listItem').run(),    null, 'Outdent'),
    ].forEach(b=>tb.appendChild(b)); tb.appendChild(sep())

    // Page break
    tb.appendChild(btn('⊟', ()=>t._tt?.commands.insertPageBreak(), null, 'Page break ⌘↵'))
    tb.appendChild(sep())

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
  },

  _setFontSize(v) {
    const pm = document.querySelector('#editor-tiptap .ProseMirror')
    if (pm) pm.style.fontSize = v + 'pt'
  },

  _syncToolbar() {
    if (!this._tt) return
    document.querySelectorAll('.editor-tool').forEach(b => {
      if (b._chk) { try { b.classList.toggle('active', !!b._chk()) } catch {} }
    })
    const hSel = document.querySelector('.editor-page-sel[title="Paragraph style"]')
    if (hSel) {
      if      (this._tt.isActive('heading',{level:1})) hSel.value='h1'
      else if (this._tt.isActive('heading',{level:2})) hSel.value='h2'
      else if (this._tt.isActive('heading',{level:3})) hSel.value='h3'
      else if (this._tt.isActive('blockquote'))         hSel.value='blockquote'
      else                                              hSel.value='p'
    }
  },

  // ── Page background ────────────────────────────────────────────────────────
  async _applyPageSize() {
    this._pg = await this.getPageSize()
    const pg   = this._pg
    const wrap = document.getElementById('editor-page-wrap')
    if (!wrap) return

    const paperTheme = Store.get('paperTheme')
    const isLight = paperTheme==='light' || (paperTheme==='auto' && Store.get('theme')==='light')
    const isDark  = paperTheme==='dark'  || (paperTheme==='auto' && Store.get('theme')==='dark')
    wrap.classList.toggle('paper-light', isLight)
    wrap.classList.toggle('paper-dark',  isDark)

    const tileH = pg.height + this.PAGE_GAP
    wrap.style.width           = pg.width + 'px'
    wrap.style.minHeight       = pg.height + 'px'
    wrap.style.height          = 'auto'
    wrap.style.padding         = this.MARGIN + 'px'
    wrap.style.position        = 'relative'
    wrap.style.boxShadow       = 'none'
    wrap.style.border          = 'none'

    const cs        = getComputedStyle(wrap)
    const paperBg   = cs.getPropertyValue('--paper-bg').trim()   || '#ffffff'
    const deskColor = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0f0f0d'

    wrap.style.backgroundImage = [
      `linear-gradient(to bottom,transparent 0,transparent ${pg.height}px,rgba(0,0,0,.22) ${pg.height}px,rgba(0,0,0,.06) ${pg.height+18}px,transparent ${pg.height+36}px,transparent ${tileH}px)`,
      `linear-gradient(to bottom,${paperBg} 0,${paperBg} ${pg.height}px,${deskColor} ${pg.height}px,${deskColor} ${tileH}px)`,
    ].join(',')
    wrap.style.backgroundColor    = paperBg
    wrap.style.backgroundSize     = '100% ' + tileH + 'px'
    wrap.style.backgroundRepeat   = 'repeat-y'
    wrap.style.backgroundPosition = '0 0'

    const pm = document.querySelector('#editor-tiptap .ProseMirror')
    if (pm) pm.style.minHeight = (pg.height - 2 * this.MARGIN) + 'px'

    let styleEl = document.getElementById('editor-page-style')
    if (!styleEl) { styleEl=document.createElement('style'); styleEl.id='editor-page-style'; document.head.appendChild(styleEl) }
    styleEl.textContent = `@page{size:${pg.width}px ${pg.height}px;margin:${this.MARGIN}px}`

    // Trigger a pagination re-layout now that pg changed
    if (this._tt) {
      this._tt.commands.focus()
      // fire a no-op transaction to trigger the pagination plugin view.update
      this._tt.view.dispatch(this._tt.state.tr)
    }
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  _onUpdate() {
    const pm = document.querySelector('#editor-tiptap .ProseMirror')
    const text = pm?.innerText || ''
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const wc=document.getElementById('word-count'); const cc=document.getElementById('char-count')
    if(wc) wc.textContent=words+' words'
    if(cc) cc.textContent=text.length+' chars'
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(()=>this._save(), 1400)
    Store.patch('git',{dirty:true})
  },

  // ── Load / Save ─────────────────────────────────────────────────────────────
  async loadDoc(path) {
    this._docPath = path
    try {
      const html = this._md2html(await api.fs.read(path))
      this._tt?.commands.setContent(html, false)
    } catch { this._tt?.commands.setContent('<p></p>', false) }
    this._syncToolbar()
    this._applyPageSize()
    try {
      const v = await api.store.get('editor-font-size')
      if (v) { this._setFontSize(v); const s=document.querySelector('.editor-page-sel[title="Font size"]'); if(s) s.value=v }
    } catch {}
    requestAnimationFrame(()=>this._tt?.commands.focus('end'))
  },

  async _save() {
    if (!this._docPath) return
    try { await api.fs.write(this._docPath, this._html2md(this._getCleanHTML())) } catch {}
  },

  _getCleanHTML() {
    const pm = document.querySelector('#editor-tiptap .ProseMirror')
    if (!pm) return ''
    const clone = pm.cloneNode(true)
    clone.querySelectorAll('.page-auto-spacer').forEach(s=>s.remove())
    // Convert page-break-node divs back to a serializable marker
    clone.querySelectorAll('.page-break-node').forEach(n=>{
      const hr = document.createElement('hr'); hr.className='page-break'; n.replaceWith(hr)
    })
    return clone.innerHTML
  },

  // ── Markdown ───────────────────────────────────────────────────────────────
  _md2html(md) {
    return (md
      .replace(/^---PAGE---$/gm, '<div data-type="pageBreak"></div>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,   '<em>$1</em>')
      .replace(/^> (.+)$/gm,   '<blockquote><p>$1</p></blockquote>')
      .split('\n\n').map(b=>b.startsWith('<')?b:`<p>${b||'<br>'}</p>`).join('')
    ) || '<p></p>'
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
      document.body.classList.add('is-exporting')
      try{await api.export.pdf(p);alert('Exported!')}catch(e){alert('Failed: '+e.message)}
      finally{document.body.classList.remove('is-exporting')}
    }
    ov.querySelector('#export-docx-btn').onclick=async()=>{
      close()
      const p=await api.dialog.save('Export DOCX',name+'.docx',[{name:'DOCX',extensions:['docx']}])
      if(!p) return
      try{await api.export.docx(p,this._getCleanHTML());alert('Exported!')}catch(e){alert('Failed: '+e.message)}
    }
  },
}
