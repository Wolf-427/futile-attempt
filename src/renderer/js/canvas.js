const Canvas = {
  _board: null,
  _zoom: 1, _pan: { x: 80, y: 80 },
  _dir: null, _file: null,
  _world: null, _area: null,

  _mode: 'select',
  _drag: null,
  _resize: null,
  _selected: new Set(),
  _connecting: null,
  _panning: false,
  _lastMouse: { x: 0, y: 0 },

  mount(container, dir, file) {
    this._dir = dir; this._file = file
    this._zoom = 1; this._pan = { x: 80, y: 80 }
    this._mode = 'select'; this._drag = null; this._resize = null
    this._selected = new Set(); this._connecting = null; this._panning = false

    container.innerHTML = `
      <div class="canvas-wrap">
        <div class="canvas-toolbar" id="canvas-tb"></div>
        <div class="canvas-area" id="canvas-area">
          <svg class="canvas-svg" id="canvas-svg"></svg>
          <div class="canvas-world" id="canvas-world"></div>
        </div>
        <div class="canvas-hint" id="canvas-hint"></div>
      </div>
    `
    this._area  = document.getElementById('canvas-area')
    this._world = document.getElementById('canvas-world')
    this._bindEvents()
    this._load()
  },

  // ── Toolbar ───────────────────────────────────────────────────────────────

  _buildToolbar() {
    const tb = document.getElementById('canvas-tb')
    tb.innerHTML = ''

    const stack = Store.get('boardStack')
    if (stack && stack.length > 0) {
      const back = document.createElement('button')
      back.className = 'canvas-tool'; back.textContent = '← Back'
      back.onclick = () => {
        const s = Store.get('boardStack')
        Store.set('boardStack', s.slice(0, -1))
        App.openBoard(s[s.length - 1], false)
      }
      tb.appendChild(back)
      this._sep(tb)
    }

    const name = document.createElement('span')
    name.style.cssText = 'font-family:var(--serif);font-size:14px;color:var(--tx2);'
    name.textContent = this._board?.name || 'Board'
    tb.appendChild(name)
    this._sep(tb)

    // Mode buttons
    ;[
      { id: 'select',  label: '↖ Select',  title: 'Select & move  V' },
      { id: 'connect', label: '⤳ Connect', title: 'Draw arrows  C' },
    ].forEach(m => {
      const b = document.createElement('button')
      b.className = 'canvas-tool canvas-mode-btn'; b.id = `mode-${m.id}`
      b.textContent = m.label; b.title = m.title
      b.onclick = () => this._setMode(m.id)
      tb.appendChild(b)
    })
    this._sep(tb)

    // Note colors
    ;[
      { c:'yellow', bg:'var(--ny-bg)', b:'var(--ny-b)' },
      { c:'blue',   bg:'var(--nb-bg)', b:'var(--nb-b)' },
      { c:'green',  bg:'var(--ng-bg)', b:'var(--ng-b)' },
      { c:'purple', bg:'var(--np-bg)', b:'var(--np-b)' },
    ].forEach(({ c, bg, b }) => {
      const dot = document.createElement('button')
      dot.className = 'canvas-color-dot'
      dot.style.background = bg; dot.style.borderColor = b
      dot.title = `${c} note`; dot.onclick = () => this._addNote(c)
      tb.appendChild(dot)
    })

    const subBtn = document.createElement('button')
    subBtn.className = 'canvas-tool'; subBtn.textContent = '⊞ Sub-board'
    subBtn.onclick = () => this._addSubBoard()
    tb.appendChild(subBtn)

    const grpBtn = document.createElement('button')
    grpBtn.className = 'canvas-tool'; grpBtn.id = 'group-btn'
    grpBtn.textContent = '⊡ Group'; grpBtn.title = 'Group selected  ⌘G'
    grpBtn.onclick = () => this._groupSelected()
    tb.appendChild(grpBtn)

    const sp = document.createElement('div'); sp.style.flex = '1'; tb.appendChild(sp)

    const zmLabel = document.createElement('span')
    zmLabel.id = 'canvas-zoom'
    zmLabel.style.cssText = 'font-size:11px;color:var(--tx3);font-family:var(--mono);min-width:38px;text-align:right;'
    zmLabel.textContent = `${Math.round(this._zoom * 100)}%`
    tb.appendChild(zmLabel)

    ;[['−', -0.15], ['⌂', null], ['+', 0.15]].forEach(([label, delta]) => {
      const b = document.createElement('button'); b.className = 'canvas-tool'; b.textContent = label
      b.onclick = () => {
        if (delta === null) { this._zoom = 1; this._pan = { x: 80, y: 80 } }
        else this._zoom = Math.min(4, Math.max(0.1, this._zoom + delta))
        this._updateTransform()
      }
      tb.appendChild(b)
    })

    this._updateModeUI()
  },

  _sep(tb) {
    const d = document.createElement('div')
    d.style.cssText = 'width:1px;height:18px;background:var(--b0);margin:0 4px;flex-shrink:0;'
    tb.appendChild(d)
  },

  _setMode(mode) {
    this._mode = mode
    // Clear connecting state
    if (this._connecting) {
      document.getElementById(`pin-${this._connecting}`)?.querySelectorAll('.pin-anchor').forEach(a => a.classList.remove('anchor-active'))
      this._connecting = null
    }
    this._clearSelection()
    this._updateModeUI()
    this._updateHint()
  },

  _updateModeUI() {
    document.querySelectorAll('.canvas-mode-btn').forEach(b => {
      const active = b.id === `mode-${this._mode}`
      b.style.background = active ? 'var(--accent)' : ''
      b.style.color = active ? '#0f0f0d' : ''
      b.style.border = active ? 'none' : ''
    })
    this._area.style.cursor = 'default'
  },

  _updateHint() {
    const hints = {
      select:  'Scroll to pan · Pinch to zoom · Click to select · ⌘G to group · Del to delete',
      connect: 'Click an anchor point on a pin, then click another — esc to cancel',
    }
    const el = document.getElementById('canvas-hint')
    if (el) el.textContent = hints[this._mode] || ''
  },

  // ── Events ────────────────────────────────────────────────────────────────

  _bindEvents() {
    // Trackpad scroll = pan, ctrl+scroll = zoom (pinch)
    this._area.addEventListener('wheel', e => {
      e.preventDefault()
      if (e.ctrlKey) {
        const r = this._area.getBoundingClientRect()
        const px = e.clientX - r.left, py = e.clientY - r.top
        const old = this._zoom
        this._zoom = Math.min(4, Math.max(0.1, this._zoom * (1 - e.deltaY * 0.008)))
        this._pan.x = px - (px - this._pan.x) * (this._zoom / old)
        this._pan.y = py - (py - this._pan.y) * (this._zoom / old)
      } else {
        this._pan.x -= e.deltaX
        this._pan.y -= e.deltaY
      }
      this._updateTransform()
    }, { passive: false })

    // Middle-click or alt+drag = pan
    this._area.addEventListener('mousedown', e => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this._panning = true
        this._lastMouse = { x: e.clientX, y: e.clientY }
        this._area.style.cursor = 'grabbing'
        e.preventDefault()
        return
      }
      // Click empty canvas in connect mode = cancel connect
      if (e.target === this._area || e.target === this._world) {
        if (this._mode === 'connect' && this._connecting) {
          document.getElementById(`pin-${this._connecting}`)?.querySelectorAll('.pin-anchor').forEach(a => a.classList.remove('anchor-active'))
          this._connecting = null
          return
        }
        // Click empty canvas in select mode = deselect
        if (this._mode === 'select') {
          this._clearSelection()
          // Also switch back to select mode if we were elsewhere
          this._setMode('select')
        }
      }
    })

    window.addEventListener('mousemove', e => {
      if (this._panning) {
        this._pan.x += e.clientX - this._lastMouse.x
        this._pan.y += e.clientY - this._lastMouse.y
        this._lastMouse = { x: e.clientX, y: e.clientY }
        this._updateTransform()
      }
      if (this._drag) {
        const r = this._area.getBoundingClientRect()
        const wx = (e.clientX - r.left - this._pan.x) / this._zoom
        const wy = (e.clientY - r.top  - this._pan.y) / this._zoom
        const node = this._board.nodes.find(n => n.id === this._drag.id)
        if (node) {
          node.x = Math.round(wx - this._drag.offX)
          node.y = Math.round(wy - this._drag.offY)
          const el = document.getElementById(`pin-${node.id}`)
          if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px' }
          this._renderArrows()
        }
      }
      if (this._resize) {
        const dx = e.clientX - this._resize.startX
        const dy = e.clientY - this._resize.startY
        const node = this._board.nodes.find(n => n.id === this._resize.id)
        if (node) {
          node.width  = Math.max(120, Math.round(this._resize.startW + dx / this._zoom))
          node.height = Math.max(80,  Math.round(this._resize.startH + dy / this._zoom))
          const el = document.getElementById(`pin-${node.id}`)
          if (el) { el.style.width = node.width + 'px'; el.style.height = node.height + 'px' }
          // Update group box if this node is a group
          if (node.type === 'group') this._updateGroupBox(el, node)
        }
      }
    })

    window.addEventListener('mouseup', () => {
      if (this._panning) { this._panning = false; this._area.style.cursor = 'default' }
      if (this._drag || this._resize) { this._persist(); this._renderArrows() }
      this._drag = null; this._resize = null
    })

    // Drop image
    this._area.addEventListener('drop', e => this._onDrop(e))
    this._area.addEventListener('dragover', e => e.preventDefault())

    // Sidebar board drag onto canvas
    this._area.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('text/board-file')) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'link'
      }
    })
    this._area.addEventListener('drop', e => {
      const boardFile = e.dataTransfer.getData('text/board-file')
      const boardName = e.dataTransfer.getData('text/board-name')
      if (boardFile) {
        e.preventDefault(); e.stopPropagation()
        const r = this._area.getBoundingClientRect()
        const x = Math.round((e.clientX - r.left - this._pan.x) / this._zoom)
        const y = Math.round((e.clientY - r.top  - this._pan.y) / this._zoom)
        const node = { id: crypto.randomUUID(), type:'subboard', x:x-80, y:y-70, width:160, height:null, file:boardFile, name:boardName, cover:null }
        this._board.nodes.push(node); this._renderNode(node); this._persist()
      }
    })

    // Keyboard
    window.addEventListener('keydown', e => {
      if (!this._world) return
      const active = document.activeElement
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.contentEditable === 'true')) return

      if (e.key === 'v' || e.key === 'V') { this._setMode('select') }
      if (e.key === 'c' || e.key === 'C') { this._setMode('connect') }
      if (e.key === 'Escape') { this._setMode('select') }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') { e.preventDefault(); this._groupSelected() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this._selected.size > 0) {
        this._selected.forEach(id => this._removeNode(id))
        this._selected.clear()
        this._persist(); this._renderArrows()
      }
    })
  },

  // ── Drag / resize / select helpers ───────────────────────────────────────

  _startDrag(e, node) {
    if (e.button !== 0) return
    e.stopPropagation()
    if (this._mode === 'connect') return // anchors handle connecting
    const r = this._area.getBoundingClientRect()
    const wx = (e.clientX - r.left - this._pan.x) / this._zoom
    const wy = (e.clientY - r.top  - this._pan.y) / this._zoom
    this._drag = { id: node.id, offX: wx - node.x, offY: wy - node.y }
    if (!e.shiftKey) this._clearSelection()
    this._selectNode(node.id)
  },

  _startResize(e, node) {
    e.stopPropagation(); e.preventDefault()
    this._resize = { id: node.id, startX: e.clientX, startY: e.clientY, startW: node.width || 220, startH: node.height || 160 }
  },

  _selectNode(id) {
    this._selected.add(id)
    document.getElementById(`pin-${id}`)?.classList.add('pin-selected')
  },

  _clearSelection() {
    this._selected.forEach(id => document.getElementById(`pin-${id}`)?.classList.remove('pin-selected'))
    this._selected.clear()
  },

  _removeNode(id) {
    this._board.nodes = this._board.nodes.filter(n => n.id !== id)
    if (this._board.arrows) this._board.arrows = this._board.arrows.filter(a => a.from !== id && a.to !== id)
    document.getElementById(`pin-${id}`)?.remove()
  },

  // ── Anchor-point connection system ────────────────────────────────────────

  _addAnchors(el, node) {
    // 4 anchor points: top, right, bottom, left
    ;[
      { cls: 'anchor-top',    style: 'top:-6px;left:50%;transform:translateX(-50%);' },
      { cls: 'anchor-right',  style: 'top:50%;right:-6px;transform:translateY(-50%);' },
      { cls: 'anchor-bottom', style: 'bottom:-6px;left:50%;transform:translateX(-50%);' },
      { cls: 'anchor-left',   style: 'top:50%;left:-6px;transform:translateY(-50%);' },
    ].forEach(({ cls, style }) => {
      const a = document.createElement('div')
      a.className = `pin-anchor ${cls}`
      a.style.cssText = `position:absolute;${style}width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid var(--bg);opacity:0;cursor:crosshair;z-index:10;transition:opacity .15s;`
      a.addEventListener('mouseenter', () => { a.style.opacity = '1' })
      a.addEventListener('mouseleave', () => { if (!a.classList.contains('anchor-active')) a.style.opacity = '0' })
      a.addEventListener('mousedown', e => {
        e.stopPropagation()
        if (this._mode !== 'connect') { this._setMode('connect'); }
        this._handleAnchorClick(node.id, a)
      })
      el.appendChild(a)
    })
    // Show anchors on hover when in connect mode or always
    el.addEventListener('mouseenter', () => {
      el.querySelectorAll('.pin-anchor').forEach(a => { a.style.opacity = '1' })
    })
    el.addEventListener('mouseleave', () => {
      el.querySelectorAll('.pin-anchor').forEach(a => {
        if (!a.classList.contains('anchor-active')) a.style.opacity = '0'
      })
    })
  },

  _handleAnchorClick(nodeId, anchorEl) {
    if (!this._connecting) {
      this._connecting = nodeId
      anchorEl.classList.add('anchor-active')
      anchorEl.style.opacity = '1'
    } else if (this._connecting !== nodeId) {
      if (!this._board.arrows) this._board.arrows = []
      const exists = this._board.arrows.some(a => a.from === this._connecting && a.to === nodeId)
      if (!exists) this._board.arrows.push({ id: crypto.randomUUID(), from: this._connecting, to: nodeId })
      // Clear active anchors
      document.querySelectorAll('.anchor-active').forEach(a => {
        a.classList.remove('anchor-active'); a.style.opacity = '0'
      })
      this._connecting = null
      this._persist(); this._renderArrows()
    }
  },

  // ── Transform ────────────────────────────────────────────────────────────

  _updateTransform() {
    this._zoom = Math.min(4, Math.max(0.1, this._zoom))
    this._world.style.transform = `translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})`
    const svg = document.getElementById('canvas-svg')
    if (svg) svg.style.transform = `translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})`
    const zm = document.getElementById('canvas-zoom')
    if (zm) zm.textContent = `${Math.round(this._zoom * 100)}%`
  },

  // ── Drop image ────────────────────────────────────────────────────────────

  async _onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file?.type.startsWith('image/')) return
    const r = this._area.getBoundingClientRect()
    const x = Math.round((e.clientX - r.left - this._pan.x) / this._zoom)
    const y = Math.round((e.clientY - r.top  - this._pan.y) / this._zoom)
    const dest = `${this._dir}/references/${crypto.randomUUID()}-${file.name}`
    await api.fs.copy(file.path, dest)
    const node = { id: crypto.randomUUID(), type: 'image', x, y, width: 240, height: null, src: dest }
    this._board.nodes.push(node); this._renderNode(node); this._persist()
  },

  // ── Load & persist ────────────────────────────────────────────────────────

  async _load() {
    try { this._board = JSON.parse(await api.fs.read(`${this._dir}/boards/${this._file}`)) }
    catch { this._board = { name: 'Board', nodes: [], arrows: [] } }
    if (!this._board.arrows) this._board.arrows = []
    this._buildToolbar()
    this._renderAll()
    this._updateHint()
  },

  async _persist() {
    await Project.saveBoard(this._dir, this._file, this._board)
    Store.patch('git', { dirty: true })
  },

  _centerPos() {
    return {
      x: Math.round((-this._pan.x + this._area.clientWidth  / 2) / this._zoom),
      y: Math.round((-this._pan.y + this._area.clientHeight / 2) / this._zoom),
    }
  },

  _addNote(color) {
    const { x, y } = this._centerPos()
    const node = { id: crypto.randomUUID(), type: 'note', color, x: x-110, y: y-80, width: 220, height: 160, text: '' }
    this._board.nodes.push(node); this._renderNode(node); this._persist()
  },

  async _addSubBoard() {
    const count = this._board.nodes.filter(n => n.type === 'subboard').length
    const b = await Project.newBoard(this._dir, `Board ${count + 1}`)
    const { x, y } = this._centerPos()
    const node = { id: crypto.randomUUID(), type: 'subboard', x: x-80, y: y-70, width: 160, file: b.file, name: b.name, cover: null }
    this._board.nodes.push(node); this._renderNode(node); this._persist()
  },

  _groupSelected() {
    const ids = [...this._selected]
    if (ids.length < 2) {
      // Flash the group button to indicate nothing selected
      const btn = document.getElementById('group-btn')
      if (btn) { btn.style.borderColor = 'var(--err)'; setTimeout(() => btn.style.borderColor = '', 800) }
      return
    }
    const name = prompt('Group name:', 'Group')
    if (!name) return
    const nodes = ids.map(id => this._board.nodes.find(n => n.id === id)).filter(Boolean)
    const PAD = 24
    const minX = Math.min(...nodes.map(n => n.x)) - PAD
    const minY = Math.min(...nodes.map(n => n.y)) - PAD - 20 // room for header
    const maxX = Math.max(...nodes.map(n => n.x + (n.width  || 220))) + PAD
    const maxY = Math.max(...nodes.map(n => n.y + (n.height || 160))) + PAD
    const groupId = crypto.randomUUID()
    const group = { id: groupId, type: 'group', name, x: minX, y: minY, width: maxX - minX, height: maxY - minY, members: ids }
    // Insert group BEFORE member nodes so it renders behind them
    const memberIndices = ids.map(id => this._board.nodes.findIndex(n => n.id === id)).filter(i => i >= 0)
    const firstIdx = Math.min(...memberIndices)
    this._board.nodes.splice(firstIdx, 0, group)
    this._clearSelection()
    this._persist()
    this._renderAll()
  },

  // ── Render ────────────────────────────────────────────────────────────────

  _renderAll() {
    this._world.innerHTML = ''
    this._board.nodes.forEach(n => this._renderNode(n))
    this._renderArrows()
  },

  _renderNode(n) {
    document.getElementById(`pin-${n.id}`)?.remove()
    let el
    if (n.type === 'note')     el = this._makeNote(n)
    if (n.type === 'image')    el = this._makeImage(n)
    if (n.type === 'subboard') el = this._makeSub(n)
    if (n.type === 'group')    el = this._makeGroup(n)
    if (el) this._world.appendChild(el)
  },

  _renderArrows() {
    const svg = document.getElementById('canvas-svg')
    if (!svg) return
    svg.innerHTML = ''
    svg.style.cssText = 'position:absolute;top:0;left:0;width:6000px;height:6000px;pointer-events:none;transform-origin:0 0;overflow:visible;'
    const arrows = this._board.arrows || []
    if (!arrows.length) return

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
    marker.setAttribute('id', 'arr'); marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '6')
    marker.setAttribute('refX', '7'); marker.setAttribute('refY', '3'); marker.setAttribute('orient', 'auto')
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    poly.setAttribute('points', '0 0, 8 3, 0 6'); poly.setAttribute('fill', 'rgba(201,169,110,0.9)')
    marker.appendChild(poly); defs.appendChild(marker); svg.appendChild(defs)

    arrows.forEach(a => {
      const from = this._board.nodes.find(n => n.id === a.from)
      const to   = this._board.nodes.find(n => n.id === a.to)
      if (!from || !to) return
      const x1 = from.x + (from.width  || 220) / 2
      const y1 = from.y + (from.height || 160) / 2
      const x2 = to.x   + (to.width    || 220) / 2
      const y2 = to.y   + (to.height   || 160) / 2
      const cx1 = x1 + (x2 - x1) * 0.5, cy1 = y1
      const cx2 = x1 + (x2 - x1) * 0.5, cy2 = y2
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`)
      path.setAttribute('stroke', 'rgba(201,169,110,0.75)')
      path.setAttribute('stroke-width', '1.5')
      path.setAttribute('fill', 'none')
      path.setAttribute('marker-end', 'url(#arr)')
      // Hit area for deletion
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hit.setAttribute('d', `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`)
      hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '12'); hit.setAttribute('fill', 'none')
      hit.style.pointerEvents = 'stroke'; hit.style.cursor = 'pointer'
      hit.addEventListener('dblclick', e => {
        e.stopPropagation()
        this._board.arrows = this._board.arrows.filter(x => x.id !== a.id)
        this._persist(); this._renderArrows()
      })
      svg.appendChild(path); svg.appendChild(hit)
    })
  },

  // ── Pin factories ─────────────────────────────────────────────────────────

  _resizeHandle(node) {
    const h = document.createElement('div'); h.className = 'pin-resize-handle'
    h.addEventListener('mousedown', e => this._startResize(e, node))
    return h
  },

  _delBtn(node) {
    const b = document.createElement('button'); b.className = 'pin-del'; b.textContent = '×'
    b.addEventListener('mousedown', e => e.stopPropagation())
    b.onclick = () => { this._removeNode(node.id); this._persist() }
    return b
  },

  _makeNote(n) {
    const el = document.createElement('div')
    el.id = `pin-${n.id}`
    el.className = `pin pin-note pin-note-${n.color}`
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width||220}px;height:${n.height||160}px;`

    const bar = document.createElement('div'); bar.className = 'pin-bar'
    const lbl = document.createElement('span'); lbl.className = 'pin-label'; lbl.textContent = 'Note'
    bar.appendChild(lbl); bar.appendChild(this._delBtn(n)); el.appendChild(bar)

    const ta = document.createElement('textarea'); ta.className = 'pin-note-text'
    ta.value = n.text || ''; ta.placeholder = 'Type a note…'
    ta.addEventListener('mousedown', e => e.stopPropagation())
    ta.addEventListener('input', () => { n.text = ta.value; this._persist() })
    el.appendChild(ta)

    el.appendChild(this._resizeHandle(n))
    this._addAnchors(el, n)
    el.addEventListener('mousedown', e => this._startDrag(e, n))
    return el
  },

  _makeImage(n) {
    const el = document.createElement('div')
    el.id = `pin-${n.id}`; el.className = 'pin pin-img'
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width||240}px;`

    const bar = document.createElement('div'); bar.className = 'pin-bar'
    const lbl = document.createElement('span'); lbl.className = 'pin-label'; lbl.style.color='var(--tx2)'; lbl.textContent='Image'
    bar.appendChild(lbl); bar.appendChild(this._delBtn(n)); el.appendChild(bar)

    const ph = document.createElement('div'); ph.className = 'loading'; ph.textContent = 'Loading…'; el.appendChild(ph)
    api.fs.readBin(n.src).then(b => {
      const img = document.createElement('img')
      img.src = `data:image/jpeg;base64,${b}`; img.draggable = false
      img.style.cssText = 'display:block;width:100%;border-radius:0 0 6px 6px;'
      ph.replaceWith(img)
    }).catch(() => { ph.textContent = 'Not found' })

    this._addAnchors(el, n)
    el.addEventListener('mousedown', e => this._startDrag(e, n))
    return el
  },

  _makeSub(n) {
    const el = document.createElement('div')
    el.id = `pin-${n.id}`; el.className = 'subboard'
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width||160}px;`

    const cover = document.createElement('div'); cover.className = 'subboard-cover'
    if (n.cover) {
      api.fs.readBin(n.cover).then(b => {
        const img = document.createElement('img'); img.src = `data:image/jpeg;base64,${b}`; img.draggable = false
        cover.innerHTML = ''; cover.appendChild(img)
      }).catch(() => {})
    } else { cover.textContent = '⊞'; cover.style.opacity = '.3' }
    el.appendChild(cover)

    const foot = document.createElement('div'); foot.className = 'subboard-foot'
    const nm = document.createElement('span'); nm.className = 'subboard-name'; nm.textContent = n.name
    foot.appendChild(nm); el.appendChild(foot)

    const acts = document.createElement('div'); acts.className = 'subboard-actions'
    acts.addEventListener('mousedown', e => e.stopPropagation())
    const rename = document.createElement('button'); rename.className = 'subboard-act'; rename.textContent = '✎'
    rename.onclick = () => { const v = prompt('Name:', n.name); if (v?.trim()) { n.name = v.trim(); nm.textContent = n.name; this._persist() } }
    const setCover = document.createElement('button'); setCover.className = 'subboard-act'; setCover.textContent = '⊡'
    setCover.onclick = async () => {
      const fp = await api.dialog.file([{ name:'Images', extensions:['jpg','jpeg','png','webp','gif'] }]); if (!fp) return
      const dest = `${this._dir}/references/cover-${crypto.randomUUID()}-${fp.split('/').pop()}`
      await api.fs.copy(fp, dest); n.cover = dest
      api.fs.readBin(dest).then(b => { const img = document.createElement('img'); img.src = `data:image/jpeg;base64,${b}`; img.draggable = false; cover.innerHTML=''; cover.appendChild(img) }).catch(() => {})
      this._persist()
    }
    const del = document.createElement('button'); del.className = 'subboard-act'; del.style.color='var(--err)'; del.textContent = '×'
    del.onclick = () => { this._removeNode(n.id); this._persist() }
    acts.appendChild(rename); acts.appendChild(setCover); acts.appendChild(del); el.appendChild(acts)

    const hint = document.createElement('div'); hint.className = 'subboard-hint'; hint.textContent = 'Double-click to open'; el.appendChild(hint)
    el.addEventListener('dblclick', e => { e.stopPropagation(); App.openBoard(n.file) })
    this._addAnchors(el, n)
    el.addEventListener('mousedown', e => this._startDrag(e, n))
    return el
  },

  _makeGroup(n) {
    const el = document.createElement('div')
    el.id = `pin-${n.id}`; el.className = 'canvas-group'
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;`

    const header = document.createElement('div'); header.className = 'canvas-group-header'
    const nameEl = document.createElement('span'); nameEl.className = 'canvas-group-name'; nameEl.textContent = n.name
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation()
      const v = prompt('Group name:', n.name); if (v?.trim()) { n.name = v.trim(); nameEl.textContent = n.name; this._persist() }
    })
    const del = document.createElement('button'); del.className = 'pin-del'; del.style.fontSize='12px'; del.textContent='×'
    del.addEventListener('mousedown', e => e.stopPropagation())
    del.onclick = () => { this._removeNode(n.id); this._persist() }
    header.appendChild(nameEl); header.appendChild(del); el.appendChild(header)
    el.appendChild(this._resizeHandle(n))
    el.addEventListener('mousedown', e => this._startDrag(e, n))
    return el
  },

  _updateGroupBox(el, node) {
    el.style.width = node.width + 'px'
    el.style.height = node.height + 'px'
  },
}
