const Canvas = {
  _board: null, _zoom: 1, _pan: { x: 80, y: 80 },
  _panning: false, _lm: { x: 0, y: 0 },
  _drag: null, _off: { x: 0, y: 0 },
  _dir: null, _file: null,
  _world: null, _area: null,

  mount(container, dir, file) {
    this._dir = dir; this._file = file; this._zoom = 1; this._pan = { x: 80, y: 80 }
    container.innerHTML = `
      <div class="canvas-wrap">
        <div class="canvas-toolbar" id="canvas-tb"></div>
        <div class="canvas-area" id="canvas-area">
          <div class="canvas-world" id="canvas-world"></div>
        </div>
        <div class="canvas-hint">Alt+drag or middle-click to pan · Scroll to zoom · Drop images onto canvas</div>
      </div>
    `
    this._area = document.getElementById('canvas-area')
    this._world = document.getElementById('canvas-world')
    this._bindEvents()
    this._load()
  },

  _buildToolbar() {
    const tb = document.getElementById('canvas-tb')
    tb.innerHTML = ''
    const stack = Store.get('boardStack')
    if (stack && stack.length > 0) {
      const back = document.createElement('button'); back.className = 'canvas-tool'; back.textContent = '← Back'
      back.onclick = () => { const s = Store.get('boardStack'); const prev = s[s.length - 1]; Store.set('boardStack', s.slice(0, -1)); App.openBoard(prev, false) }
      tb.appendChild(back)
    }
    const name = document.createElement('span'); name.style.cssText = 'font-family:var(--serif);font-size:14px;color:var(--tx2);'; name.textContent = this._board?.name || 'Board'; tb.appendChild(name)
    const sep = () => { const d = document.createElement('div'); d.style.cssText = 'width:1px;height:18px;background:var(--b0);margin:0 4px;'; return d }
    tb.appendChild(sep())
    ;[{c:'yellow',bg:'var(--ny-bg)',b:'var(--ny-b)'},{c:'blue',bg:'var(--nb-bg)',b:'var(--nb-b)'},{c:'green',bg:'var(--ng-bg)',b:'var(--ng-b)'},{c:'purple',bg:'var(--np-bg)',b:'var(--np-b)'}].forEach(({c,bg,b}) => {
      const dot = document.createElement('button'); dot.className = 'canvas-color-dot'; dot.style.background = bg; dot.style.borderColor = b; dot.title = `${c} note`; dot.onclick = () => this._addNote(c); tb.appendChild(dot)
    })
    const sub = document.createElement('button'); sub.className = 'canvas-tool'; sub.textContent = '⊞ Sub-board'; sub.onclick = () => this._addSubBoard(); tb.appendChild(sub)
    const sp = document.createElement('div'); sp.style.flex = '1'; tb.appendChild(sp)
    const zm = document.createElement('span'); zm.id = 'canvas-zoom'; zm.style.cssText = 'font-size:11px;color:var(--tx3);font-family:var(--mono);'; zm.textContent = `${Math.round(this._zoom * 100)}%`; tb.appendChild(zm)
    ;[['−', -0.1], ['⌂', null], ['+', 0.1]].forEach(([label, delta]) => {
      const b = document.createElement('button'); b.className = 'canvas-tool'; b.textContent = label
      b.onclick = () => { if (delta === null) { this._zoom = 1; this._pan = { x: 80, y: 80 } } else this._zoom = Math.min(3, Math.max(0.15, this._zoom + delta)); this._updateTransform(); document.getElementById('canvas-zoom').textContent = `${Math.round(this._zoom * 100)}%` }
      tb.appendChild(b)
    })
  },

  _bindEvents() {
    this._area.addEventListener('mousedown', e => this._onMD(e))
    this._area.addEventListener('mousemove', e => this._onMM(e))
    this._area.addEventListener('mouseup', () => this._onMU())
    this._area.addEventListener('mouseleave', () => this._onMU())
    this._area.addEventListener('wheel', e => this._onWheel(e), { passive: false })
    this._area.addEventListener('drop', e => this._onDrop(e))
    this._area.addEventListener('dragover', e => e.preventDefault())
  },

  _onMD(e) { if (e.button === 1 || (e.button === 0 && e.altKey)) { this._panning = true; this._lm = { x: e.clientX, y: e.clientY }; e.preventDefault() } },
  _onMM(e) {
    if (this._panning) { this._pan.x += e.clientX - this._lm.x; this._pan.y += e.clientY - this._lm.y; this._lm = { x: e.clientX, y: e.clientY }; this._updateTransform() }
    if (this._drag) {
      const r = this._area.getBoundingClientRect()
      const x = (e.clientX - r.left - this._pan.x) / this._zoom - this._off.x
      const y = (e.clientY - r.top - this._pan.y) / this._zoom - this._off.y
      const node = this._board.nodes.find(n => n.id === this._drag)
      if (node) { node.x = Math.round(x); node.y = Math.round(y); const el = document.getElementById(`pin-${node.id}`); if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px` } }
    }
  },
  _onMU() { this._panning = false; if (this._drag) { this._persist(); this._drag = null } },
  _onWheel(e) { e.preventDefault(); this._zoom = Math.min(3, Math.max(0.15, this._zoom - e.deltaY * 0.001 * this._zoom)); this._updateTransform(); const zm = document.getElementById('canvas-zoom'); if (zm) zm.textContent = `${Math.round(this._zoom * 100)}%` },
  async _onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]; if (!file?.type.startsWith('image/')) return
    const r = this._area.getBoundingClientRect()
    const x = Math.round((e.clientX - r.left - this._pan.x) / this._zoom)
    const y = Math.round((e.clientY - r.top - this._pan.y) / this._zoom)
    const dest = `${this._dir}/references/${crypto.randomUUID()}-${file.name}`
    await api.fs.copy(file.path, dest)
    const node = { id: crypto.randomUUID(), type: 'image', x, y, width: 240, src: dest }
    this._board.nodes.push(node); this._renderNode(node); this._persist()
  },
  _updateTransform() { this._world.style.transform = `translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})` },

  async _load() {
    try { this._board = JSON.parse(await api.fs.read(`${this._dir}/boards/${this._file}`)) }
    catch { this._board = { name: 'Board', nodes: [] } }
    this._buildToolbar(); this._renderAll()
  },

  _addNote(color) {
    const x = Math.round((-this._pan.x + 400) / this._zoom), y = Math.round((-this._pan.y + 300) / this._zoom)
    const node = { id: crypto.randomUUID(), type: 'note', color, x: x - 100, y: y - 80, width: 200, text: '' }
    this._board.nodes.push(node); this._renderNode(node); this._persist()
  },

  async _addSubBoard() {
    const count = this._board.nodes.filter(n => n.type === 'subboard').length
    const b = await Project.newBoard(this._dir, `Board ${count + 1}`)
    const x = Math.round((-this._pan.x + 400) / this._zoom), y = Math.round((-this._pan.y + 300) / this._zoom)
    const node = { id: crypto.randomUUID(), type: 'subboard', x: x - 80, y: y - 70, file: b.file, name: b.name, cover: null }
    this._board.nodes.push(node); this._renderNode(node); this._persist()
  },

  async _persist() { await Project.saveBoard(this._dir, this._file, this._board); Store.patch('git', { dirty: true }) },
  _renderAll() { this._world.innerHTML = ''; this._board.nodes.forEach(n => this._renderNode(n)) },
  _renderNode(n) {
    document.getElementById(`pin-${n.id}`)?.remove()
    let el
    if (n.type === 'note') el = this._makeNote(n)
    if (n.type === 'image') el = this._makeImg(n)
    if (n.type === 'subboard') el = this._makeSub(n)
    if (el) this._world.appendChild(el)
  },

  _dragHandle(el, n) {
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return; e.stopPropagation()
      const r = this._area.getBoundingClientRect()
      this._drag = n.id; this._off = { x: (e.clientX - r.left - this._pan.x) / this._zoom - n.x, y: (e.clientY - r.top - this._pan.y) / this._zoom - n.y }
    })
  },

  _delBtn(n) {
    const b = document.createElement('button'); b.className = 'pin-del'; b.textContent = '×'
    b.addEventListener('mousedown', e => e.stopPropagation())
    b.onclick = () => { this._board.nodes = this._board.nodes.filter(x => x.id !== n.id); document.getElementById(`pin-${n.id}`)?.remove(); this._persist() }
    return b
  },

  _makeNote(n) {
    const el = document.createElement('div'); el.id = `pin-${n.id}`; el.className = `pin pin-note pin-note-${n.color}`; el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width}px;`
    const bar = document.createElement('div'); bar.className = 'pin-bar'
    const lbl = document.createElement('span'); lbl.className = 'pin-label'; lbl.textContent = 'Note'
    bar.appendChild(lbl); bar.appendChild(this._delBtn(n)); el.appendChild(bar)
    const ta = document.createElement('textarea'); ta.value = n.text; ta.placeholder = 'Type a note…'
    ta.addEventListener('mousedown', e => e.stopPropagation())
    ta.addEventListener('input', () => { n.text = ta.value; this._persist() })
    el.appendChild(ta); this._dragHandle(el, n); return el
  },

  _makeImg(n) {
    const el = document.createElement('div'); el.id = `pin-${n.id}`; el.className = 'pin pin-img'; el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width}px;`
    const bar = document.createElement('div'); bar.className = 'pin-bar'
    const lbl = document.createElement('span'); lbl.className = 'pin-label'; lbl.style.color = 'var(--tx2)'; lbl.textContent = 'Image'
    bar.appendChild(lbl); bar.appendChild(this._delBtn(n)); el.appendChild(bar)
    const ph = document.createElement('div'); ph.className = 'loading'; ph.textContent = 'Loading…'; el.appendChild(ph)
    api.fs.readBin(n.src).then(b => { const img = document.createElement('img'); img.src = `data:image/jpeg;base64,${b}`; img.draggable = false; ph.replaceWith(img) }).catch(() => { ph.textContent = 'Not found' })
    this._dragHandle(el, n); return el
  },

  _makeSub(n) {
    const el = document.createElement('div'); el.id = `pin-${n.id}`; el.className = 'subboard'; el.style.cssText = `left:${n.x}px;top:${n.y}px;`
    const cover = document.createElement('div'); cover.className = 'subboard-cover'
    if (n.cover) { api.fs.readBin(n.cover).then(b => { const img = document.createElement('img'); img.src = `data:image/jpeg;base64,${b}`; img.draggable = false; cover.innerHTML = ''; cover.appendChild(img) }).catch(() => {}) }
    else { cover.textContent = '⊞'; cover.style.opacity = '.3' }
    el.appendChild(cover)
    const foot = document.createElement('div'); foot.className = 'subboard-foot'
    const nm = document.createElement('span'); nm.className = 'subboard-name'; nm.textContent = n.name; foot.appendChild(nm); el.appendChild(foot)
    const acts = document.createElement('div'); acts.className = 'subboard-actions'; acts.addEventListener('mousedown', e => e.stopPropagation())
    const rename = document.createElement('button'); rename.className = 'subboard-act'; rename.textContent = '✎'
    rename.onclick = () => { const v = prompt('Board name:', n.name); if (v?.trim()) { n.name = v.trim(); nm.textContent = n.name; this._persist() } }
    const setCover = document.createElement('button'); setCover.className = 'subboard-act'; setCover.textContent = '⊡'
    setCover.onclick = async () => {
      const fp = await api.dialog.file([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]); if (!fp) return
      const dest = `${this._dir}/references/cover-${crypto.randomUUID()}-${fp.split('/').pop()}`
      await api.fs.copy(fp, dest); n.cover = dest
      api.fs.readBin(dest).then(b => { const img = document.createElement('img'); img.src = `data:image/jpeg;base64,${b}`; img.draggable = false; cover.innerHTML = ''; cover.appendChild(img) }).catch(() => {})
      this._persist()
    }
    const del = document.createElement('button'); del.className = 'subboard-act'; del.style.color = 'var(--err)'; del.textContent = '×'
    del.onclick = () => { this._board.nodes = this._board.nodes.filter(x => x.id !== n.id); el.remove(); this._persist() }
    acts.appendChild(rename); acts.appendChild(setCover); acts.appendChild(del); el.appendChild(acts)
    const hint = document.createElement('div'); hint.className = 'subboard-hint'; hint.textContent = 'Double-click to open'; el.appendChild(hint)
    el.addEventListener('dblclick', e => { e.stopPropagation(); App.openBoard(n.file) })
    this._dragHandle(el, n); return el
  }
}
