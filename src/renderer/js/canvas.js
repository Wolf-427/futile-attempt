const Canvas = {

  // State
  _board:      null,
  _dir:        null,
  _file:       null,
  _area:       null,
  _world:      null,
  _svg:        null,
  _zoom:       1,
  _pan:        { x: 80, y: 80 },
  _mode:       'select',
  _drag:       null,
  _resize:     null,
  _marquee:    null,
  _selected:   new Set(),
  _connecting: null,
  _panning:    false,
  _lastMouse:  { x: 0, y: 0 },
  _history:    [],
  _histIdx:    -1,

  // Custom prompt — replaces native prompt() which is blocked in Electron
  _prompt(message, defaultVal = '') {
    return new Promise(resolve => {
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;'
      const box = document.createElement('div')
      box.style.cssText = 'background:var(--bg2);border:1px solid var(--b2);border-radius:var(--r3);padding:24px;min-width:300px;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.6);'
      const lbl = document.createElement('div')
      lbl.style.cssText = 'font-size:13px;color:var(--tx2);'
      lbl.textContent = message
      const inp = document.createElement('input')
      inp.value = defaultVal
      inp.style.cssText = 'padding:8px 12px;background:var(--bg);border:1px solid var(--accent);border-radius:var(--r2);color:var(--tx);font-size:14px;outline:none;width:100%;box-sizing:border-box;'
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;'
      const cancel = document.createElement('button')
      cancel.textContent = 'Cancel'
      cancel.style.cssText = 'padding:7px 16px;background:transparent;border:1px solid var(--b1);border-radius:var(--r2);color:var(--tx2);font-size:12px;cursor:pointer;'
      const ok = document.createElement('button')
      ok.textContent = 'OK'
      ok.style.cssText = 'padding:7px 16px;background:var(--accent);border:none;border-radius:var(--r2);color:#0f0f0d;font-size:12px;font-weight:500;cursor:pointer;'
      const finish = (val) => { overlay.remove(); resolve(val) }
      cancel.onclick = () => finish(null)
      ok.onclick = () => finish(inp.value.trim() || null)
      inp.addEventListener('keydown', e => { if(e.key==='Enter') finish(inp.value.trim()||null); if(e.key==='Escape') finish(null) })
      row.appendChild(cancel); row.appendChild(ok)
      box.appendChild(lbl); box.appendChild(inp); box.appendChild(row)
      overlay.appendChild(box); document.body.appendChild(overlay)
      setTimeout(() => { inp.focus(); inp.select() }, 50)
    })
  },

  // ── Mount ─────────────────────────────────────────────────────────────────

  mount(container, dir, file) {
    document.getElementById('canvas-ctx')?.remove()
    const ctx = document.createElement('div')
    ctx.id = 'canvas-ctx'; ctx.className = 'ctx-menu hidden'
    document.body.appendChild(ctx)

    this._dir = dir; this._file = file
    this._zoom = 1; this._pan = { x: 80, y: 80 }
    this._mode = 'select'; this._drag = null; this._resize = null; this._marquee = null
    this._selected = new Set(); this._connecting = null; this._panning = false
    this._history = []; this._histIdx = -1; this._previewGroup = null; this._textDraw = null

    container.innerHTML = `
      <div class="canvas-wrap">
        <div class="canvas-toolbar" id="cv-tb"></div>
        <div class="canvas-area" id="cv-area">
          <svg id="cv-svg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5;"></svg>
          <div id="cv-world" style="position:absolute;top:0;left:0;width:6000px;height:6000px;transform-origin:0 0;"></div>
          <div id="cv-marquee" class="canvas-marquee hidden"></div>
          <div id="cv-minimap" class="canvas-minimap"></div>
        </div>
        <div id="cv-hint" class="canvas-hint"></div>
      </div>
    `
    this._area  = document.getElementById('cv-area')
    this._world = document.getElementById('cv-world')
    this._svg   = document.getElementById('cv-svg')
    this._bindEvents()
    this._load()
  },

  // ── Toolbar ───────────────────────────────────────────────────────────────

  _buildToolbar() {
    const tb = document.getElementById('cv-tb'); tb.innerHTML = ''

    const stack = Store.get('boardStack')
    if (stack?.length) {
      const b = document.createElement('button'); b.className = 'canvas-tool'; b.textContent = '← Back'
      b.onclick = () => { const s=Store.get('boardStack'); Store.set('boardStack',s.slice(0,-1)); App.openBoard(s[s.length-1],false) }
      tb.appendChild(b); this._sep(tb)
    }

    const nm = document.createElement('span')
    nm.style.cssText = 'font-family:var(--serif);font-size:14px;color:var(--tx2);'
    nm.textContent = this._board?.name || 'Board'; tb.appendChild(nm); this._sep(tb)

    for (const [id,label,title] of [['select','↖ Select','Select  V'],['connect','⤳ Connect','Connect  C']]) {
      const b = document.createElement('button'); b.className='canvas-tool canvas-mode-btn'; b.id=`cvmode-${id}`
      b.textContent=label; b.title=title; b.onclick=()=>this._setMode(id); tb.appendChild(b)
    }
    this._sep(tb)

    for (const [c,bg,bd] of [['yellow','var(--ny-bg)','var(--ny-b)'],['blue','var(--nb-bg)','var(--nb-b)'],['green','var(--ng-bg)','var(--ng-b)'],['purple','var(--np-bg)','var(--np-b)']]) {
      const d = document.createElement('button'); d.className='canvas-color-dot'
      d.style.background=bg; d.style.borderColor=bd; d.title=`${c} note`; d.onclick=()=>this._addNote(c); tb.appendChild(d)
    }

    const sub = document.createElement('button'); sub.className='canvas-tool'; sub.textContent='⊞ Sub-board'; sub.onclick=()=>this._addSubBoard(); tb.appendChild(sub)

    const txtBtn = document.createElement('button'); txtBtn.className='canvas-tool canvas-mode-btn'; txtBtn.id='cvmode-text'; txtBtn.textContent='T Text'; txtBtn.title='Text tool  T'
    txtBtn.onclick=()=>this._setMode('text'); tb.appendChild(txtBtn)
    this._sep(tb)

    for (const [l,t,fn] of [['↩','Undo ⌘Z',()=>this._undo()],['↪','Redo ⌘⇧Z',()=>this._redo()]]) {
      const b=document.createElement('button'); b.className='canvas-tool'; b.textContent=l; b.title=t; b.onclick=fn; tb.appendChild(b)
    }

    const sp=document.createElement('div'); sp.style.flex='1'; tb.appendChild(sp)
    const zm=document.createElement('span'); zm.id='cv-zoom'; zm.style.cssText='font-size:11px;color:var(--tx3);font-family:var(--mono);min-width:38px;text-align:right;'
    zm.textContent=`${Math.round(this._zoom*100)}%`; tb.appendChild(zm)

    for (const [l,d] of [['−',-0.15],['⌂',null],['+',.15]]) {
      const b=document.createElement('button'); b.className='canvas-tool'; b.textContent=l
      b.onclick=()=>{ d===null?(this._zoom=1,this._pan={x:80,y:80}):this._zoom=Math.min(4,Math.max(0.1,this._zoom+d)); this._applyTransform() }
      tb.appendChild(b)
    }
    this._refreshModeUI()
  },

  _sep(tb) { const d=document.createElement('div'); d.style.cssText='width:1px;height:18px;background:var(--b0);margin:0 4px;flex-shrink:0;'; tb.appendChild(d) },

  _setMode(m) {
    this._mode = m
    if (this._connecting) { document.querySelectorAll('.anchor-active').forEach(a=>{a.classList.remove('anchor-active');a.style.opacity='0'}); this._connecting=null }
    this._refreshModeUI()
    if (m === 'text') {
      this._area.style.cursor = 'text'
      this._area.classList.add('mode-text')
    } else {
      this._area.style.cursor = 'default'
      this._area.classList.remove('mode-text')
    }
    document.getElementById('cv-hint').textContent = m==='select'
      ? 'Scroll to pan · Pinch to zoom · Drag canvas to marquee-select · Shift+click for multi · Right-click for menu · ⌘G to group'
      : m === 'text' ? 'Click to place a text field · Click and drag to draw its size'
      : 'Hover a pin → click an anchor → click another anchor · Esc to cancel'
  },

  _refreshModeUI() {
    document.querySelectorAll('.canvas-mode-btn').forEach(b => {
      const on = b.id===`cvmode-${this._mode}`
      b.style.background=on?'var(--accent)':''; b.style.color=on?'#0f0f0d':''; b.style.border=on?'none':''
    })
  },

  // ── Events ────────────────────────────────────────────────────────────────

  _bindEvents() {
    // Trackpad: scroll = pan, pinch (ctrl+wheel) = zoom
    this._area.addEventListener('wheel', e => {
      e.preventDefault()
      if (e.ctrlKey) {
        const r=this._area.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top, old=this._zoom
        this._zoom=Math.min(4,Math.max(0.1,this._zoom*(1-e.deltaY*.008)))
        this._pan.x=px-(px-this._pan.x)*this._zoom/old; this._pan.y=py-(py-this._pan.y)*this._zoom/old
      } else { this._pan.x-=e.deltaX; this._pan.y-=e.deltaY }
      this._applyTransform()
    }, {passive:false})

    // Middle-click / alt+drag = pan
    this._area.addEventListener('mousedown', e => {
      if (e.button===2) return
      if (e.button===1||(e.button===0&&e.altKey)) { this._panning=true; this._lastMouse={x:e.clientX,y:e.clientY}; this._area.style.cursor='grabbing'; e.preventDefault(); return }
      if (e.target!==this._area&&e.target!==this._world) return
      // Cancel connect
      if (this._mode==='connect'&&this._connecting) { document.querySelectorAll('.anchor-active').forEach(a=>{a.classList.remove('anchor-active');a.style.opacity='0'}); this._connecting=null; return }

      // Text draw mode — click or drag to place a text field
      if (this._mode==='text') {
        const r=this._area.getBoundingClientRect()
        const sx=e.clientX-r.left, sy=e.clientY-r.top
        this._textDraw = { startX:sx, startY:sy, moved:false }
        // Ghost rect — inline element, no transitions
        let ghost = document.getElementById('cv-text-ghost')
        if (!ghost) {
          ghost = document.createElement('div'); ghost.id='cv-text-ghost'
          ghost.style.cssText='position:absolute;pointer-events:none;z-index:50;box-sizing:border-box;border:1.5px dashed var(--accent);background:rgba(201,169,110,0.06);border-radius:3px;display:none;'
          this._area.appendChild(ghost)
        }
        ghost.style.left=sx+'px'; ghost.style.top=sy+'px'; ghost.style.width='0'; ghost.style.height='0'; ghost.style.display='block'
        return
      }

      // Start marquee
      this._clearSelection()
      const r=this._area.getBoundingClientRect()
      this._marquee={startX:e.clientX-r.left, startY:e.clientY-r.top}
      const mel=document.getElementById('cv-marquee')
      mel.style.cssText=`left:${this._marquee.startX}px;top:${this._marquee.startY}px;width:0;height:0;`; mel.classList.remove('hidden')
    })

    window.addEventListener('mousemove', e => {
      if (this._panning) { this._pan.x+=e.clientX-this._lastMouse.x; this._pan.y+=e.clientY-this._lastMouse.y; this._lastMouse={x:e.clientX,y:e.clientY}; this._applyTransform(); return }

      // Finalize text draw
      if (this._textDraw) {
        const r=this._area.getBoundingClientRect()
        const cx=e.clientX-r.left, cy=e.clientY-r.top
        const rawW=Math.abs(cx-this._textDraw.startX), rawH=Math.abs(cy-this._textDraw.startY)
        document.getElementById('cv-text-ghost')?.remove()

        const wasDrag = rawW > 8 || rawH > 8

        // Convert screen coords to world coords
        let wx, wy, ww, wh
        if (wasDrag) {
          const sx = Math.min(cx, this._textDraw.startX)
          const sy = Math.min(cy, this._textDraw.startY)
          wx = (sx - this._pan.x) / this._zoom
          wy = (sy - this._pan.y) / this._zoom
          ww = Math.round(rawW / this._zoom)
          wh = Math.round(rawH / this._zoom)
        } else {
          // Just a click — place default-sized box at click point
          wx = (this._textDraw.startX - this._pan.x) / this._zoom
          wy = (this._textDraw.startY - this._pan.y) / this._zoom
          ww = 220; wh = 60
        }

        const node = { id:crypto.randomUUID(), type:'text', x:Math.round(wx), y:Math.round(wy), width:Math.max(60,ww), height:Math.max(30,wh), text:'', fontSize:16, color:'var(--tx)' }
        this._board.nodes.push(node)
        this._renderNode(node)
        this._snapshot(); this._persist()

        // Immediately focus the text content for typing
        requestAnimationFrame(() => {
          const el = document.getElementById(`pin-${node.id}`)
          const content = el?.querySelector('.pin-text-content')
          if (content) {
            content.contentEditable = 'true'
            content.style.cursor = 'text'
            content.focus()
          }
        })

        this._textDraw = null
        this._setMode('select') // return to select after placing
        return
      }

      if (this._drag) {
        const r=this._area.getBoundingClientRect()
        const wx=(e.clientX-r.left-this._pan.x)/this._zoom, wy=(e.clientY-r.top-this._pan.y)/this._zoom
        if (this._drag.type==='group') {
          const g=this._board.nodes.find(n=>n.id===this._drag.id)
          if (g) {
            const newX=Math.round(wx-this._drag.offX), newY=Math.round(wy-this._drag.offY)
            const dx=newX-g.x, dy=newY-g.y
            g.x=newX; g.y=newY
            document.getElementById(`pin-${g.id}`)?.style.setProperty('left',g.x+'px')
            document.getElementById(`pin-${g.id}`)?.style.setProperty('top', g.y+'px')
            // Move every member node by the same delta
            if (dx||dy) for (const mid of (g.members||[])) {
              const mn=this._board.nodes.find(n=>n.id===mid); if(!mn) continue
              mn.x+=dx; mn.y+=dy
              const mel=document.getElementById(`pin-${mn.id}`)
              if (mel) { mel.style.left=mn.x+'px'; mel.style.top=mn.y+'px' }
            }
          }
        } else {
          const node=this._board.nodes.find(n=>n.id===this._drag.id)
          if (node) { node.x=Math.round(wx-this._drag.offX); node.y=Math.round(wy-this._drag.offY); const el=document.getElementById(`pin-${node.id}`); if(el){el.style.left=node.x+'px';el.style.top=node.y+'px'} }
        }
        this._renderArrows()
        // Live-preview group resize while dragging a node
        if (this._drag.type === 'node') {
          const node = this._board.nodes.find(n => n.id === this._drag.id)
          if (node && node.type !== 'group') {
            // Which group is this node currently a member of?
            const memberOf = this._board.nodes.find(g => g.type === 'group' && g.members?.includes(node.id)) || null
            // Which group is the node's center currently hovering over?
            const hovering = this._groupAt(node)

            // Restore all previews first (using stored data, not DOM state)
            this._board.nodes.filter(g => g.type === 'group').forEach(g => this._restoreGroupDOM(g))

            if (hovering) {
              if (memberOf && memberOf.id === hovering.id) {
                // Inside its own group — preview with node at current position
                const b = this._computeGroupBounds(hovering, node, node.id)
                if (b) this._previewGroupDOM(hovering, b)
              } else {
                // Hovering over a different group — preview adding node
                const b = this._computeGroupBounds(hovering, node, null)
                if (b) this._previewGroupDOM(hovering, b)
                // If leaving a group, preview that group shrinking
                if (memberOf) {
                  const b2 = this._computeGroupBounds(memberOf, null, node.id)
                  if (b2) this._previewGroupDOM(memberOf, b2)
                  else this._restoreGroupDOM(memberOf)
                }
              }
            } else if (memberOf) {
              // Node dragged outside all groups — preview memberOf shrinking
              const b = this._computeGroupBounds(memberOf, null, node.id)
              if (b) this._previewGroupDOM(memberOf, b)
              else this._restoreGroupDOM(memberOf)
            }
          }
        }
        return
      }

      if (this._resize) {
        const dx=e.clientX-this._resize.startX, dy=e.clientY-this._resize.startY
        const node=this._board.nodes.find(n=>n.id===this._resize.id)
        if (node) { node.width=Math.max(120,Math.round(this._resize.startW+dx/this._zoom)); node.height=Math.max(80,Math.round(this._resize.startH+dy/this._zoom)); const el=document.getElementById(`pin-${node.id}`); if(el){el.style.width=node.width+'px';el.style.height=node.height+'px'} }
        return
      }

      // Text draw ghost — direct style, no transition
      if (this._textDraw) {
        const r=this._area.getBoundingClientRect()
        const cx=e.clientX-r.left, cy=e.clientY-r.top
        const x=Math.min(cx,this._textDraw.startX), y=Math.min(cy,this._textDraw.startY)
        const w=Math.max(1,Math.abs(cx-this._textDraw.startX)), h=Math.max(1,Math.abs(cy-this._textDraw.startY))
        const ghost=document.getElementById('cv-text-ghost')
        if (ghost) { ghost.style.left=x+'px'; ghost.style.top=y+'px'; ghost.style.width=w+'px'; ghost.style.height=h+'px' }
        return
      }

      if (this._marquee) {
        const r=this._area.getBoundingClientRect(), cx=e.clientX-r.left, cy=e.clientY-r.top
        const x=Math.min(cx,this._marquee.startX), y=Math.min(cy,this._marquee.startY)
        const w=Math.abs(cx-this._marquee.startX), h=Math.abs(cy-this._marquee.startY)
        document.getElementById('cv-marquee').style.cssText=`position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;`
        for (const n of this._board.nodes) {
          if (n.type==='group') continue
          const sx=n.x*this._zoom+this._pan.x, sy=n.y*this._zoom+this._pan.y
          const sw=(n.width||220)*this._zoom, sh=(n.height||160)*this._zoom
          sx<x+w&&sx+sw>x&&sy<y+h&&sy+sh>y ? this._selectNode(n.id) : this._deselectNode(n.id)
        }
      }
    })

    window.addEventListener('mouseup', () => {
      this._area.style.cursor = 'default'
      // Clear highlight and restore any live preview before computing membership
      document.querySelectorAll('.group-drop-target').forEach(el => el.classList.remove('group-drop-target'))
      // Restore all group DOMs to their stored data bounds before computing membership
      this._board?.nodes?.filter(g => g.type === 'group').forEach(g => this._restoreGroupDOM(g))

      if (this._panning) { this._panning = false; return }

      // Finalize text draw
      if (this._textDraw) {
        const r=this._area.getBoundingClientRect()
        const cx=e.clientX-r.left, cy=e.clientY-r.top
        const rawW=Math.abs(cx-this._textDraw.startX), rawH=Math.abs(cy-this._textDraw.startY)
        document.getElementById('cv-text-ghost')?.remove()

        const wasDrag = rawW > 8 || rawH > 8

        // Convert screen coords to world coords
        let wx, wy, ww, wh
        if (wasDrag) {
          const sx = Math.min(cx, this._textDraw.startX)
          const sy = Math.min(cy, this._textDraw.startY)
          wx = (sx - this._pan.x) / this._zoom
          wy = (sy - this._pan.y) / this._zoom
          ww = Math.round(rawW / this._zoom)
          wh = Math.round(rawH / this._zoom)
        } else {
          // Just a click — place default-sized box at click point
          wx = (this._textDraw.startX - this._pan.x) / this._zoom
          wy = (this._textDraw.startY - this._pan.y) / this._zoom
          ww = 220; wh = 60
        }

        const node = { id:crypto.randomUUID(), type:'text', x:Math.round(wx), y:Math.round(wy), width:Math.max(60,ww), height:Math.max(30,wh), text:'', fontSize:16, color:'var(--tx)' }
        this._board.nodes.push(node)
        this._renderNode(node)
        this._snapshot(); this._persist()

        // Immediately focus the text content for typing
        requestAnimationFrame(() => {
          const el = document.getElementById(`pin-${node.id}`)
          const content = el?.querySelector('.pin-text-content')
          if (content) {
            content.contentEditable = 'true'
            content.style.cursor = 'text'
            content.focus()
          }
        })

        this._textDraw = null
        this._setMode('select') // return to select after placing
        return
      }

      if (this._drag) {
        if (this._drag.type === 'node') {
          const node = this._board.nodes.find(n => n.id === this._drag.id)
          if (node && node.type !== 'group') {
            const targetGroup = this._groupAt(node)

            // Handle old group membership
            const groups = this._board.nodes.filter(n => n.type === 'group')
            for (const g of groups) {
              if (!g.members) continue
              const wasMember = g.members.includes(node.id)
              if (!wasMember) continue
              if (targetGroup && targetGroup.id === g.id) {
                // Still in same group — recompute
                this._recomputeGroup(g)
              } else {
                // Left this group
                g.members = g.members.filter(id => id !== node.id)
                if (g.members.length > 0) this._recomputeGroup(g)
                else this._removeNode(g.id)
              }
            }

            // Join new group
            if (targetGroup) {
              if (!targetGroup.members) targetGroup.members = []
              if (!targetGroup.members.includes(node.id)) {
                targetGroup.members.push(node.id)
                this._recomputeGroup(targetGroup)
              }
            }
          }
        }
        this._snapshot(); this._persist(); this._renderArrows()
      }

      if (this._resize) { this._snapshot(); this._persist() }

      this._drag = null
      this._resize = null
      // Text draw ghost — direct style, no transition
      if (this._textDraw) {
        const r=this._area.getBoundingClientRect()
        const cx=e.clientX-r.left, cy=e.clientY-r.top
        const x=Math.min(cx,this._textDraw.startX), y=Math.min(cy,this._textDraw.startY)
        const w=Math.max(1,Math.abs(cx-this._textDraw.startX)), h=Math.max(1,Math.abs(cy-this._textDraw.startY))
        const ghost=document.getElementById('cv-text-ghost')
        if (ghost) { ghost.style.left=x+'px'; ghost.style.top=y+'px'; ghost.style.width=w+'px'; ghost.style.height=h+'px' }
        return
      }

      if (this._marquee) { this._marquee = null; document.getElementById('cv-marquee')?.classList.add('hidden') }
    })

    // Right-click on canvas background
    this._area.addEventListener('contextmenu', e => {
      if (e.target===this._area||e.target===this._world) { e.preventDefault(); this._showCanvasMenu(e.clientX,e.clientY) }
    })

    document.addEventListener('mousedown', e => { if(!e.target.closest('#canvas-ctx')) this._hideMenu() }, true)

    // Drop
    this._area.addEventListener('dragover', e => { if(e.dataTransfer.types.includes('text/board-file')||e.dataTransfer.files?.length) e.preventDefault() })
    this._area.addEventListener('drop', e => {
      const bf=e.dataTransfer.getData('text/board-file')
      const r=this._area.getBoundingClientRect()
      const wx=Math.round((e.clientX-r.left-this._pan.x)/this._zoom), wy=Math.round((e.clientY-r.top-this._pan.y)/this._zoom)
      if (bf) { e.preventDefault(); const n={id:crypto.randomUUID(),type:'subboard',x:wx-80,y:wy-70,width:160,file:bf,name:e.dataTransfer.getData('text/board-name'),cover:null}; this._board.nodes.push(n); this._renderNode(n); this._snapshot(); this._persist(); return }
      const f=e.dataTransfer.files?.[0]; if(f?.type.startsWith('image/'))this._dropImage(e,f)
    })

    // Keyboard shortcuts
    window.addEventListener('keydown', e => {
      if (!this._dir) return
      const tag=document.activeElement?.tagName
      if (tag==='TEXTAREA'||tag==='INPUT'||document.activeElement?.contentEditable==='true') return
      const mod=e.metaKey||e.ctrlKey
      if (!mod&&e.key==='v') this._setMode('select')
      if (!mod&&e.key==='c') this._setMode('connect')
      if (!mod&&e.key==='t') this._setMode('text')
      if (e.key==='Escape'){this._setMode('select');this._clearSelection()}
      if (mod&&e.key.toLowerCase()==='g'){e.preventDefault();this._groupSelected()}
      if (mod&&e.key.toLowerCase()==='d'&&this._selected.size===1){e.preventDefault();const n=this._board.nodes.find(n=>n.id===[...this._selected][0]);if(n)this._duplicateNode(n)}
      if (mod&&e.key==='z'&&!e.shiftKey){e.preventDefault();this._undo()}
      if (mod&&(e.key==='z'&&e.shiftKey||e.key==='y')){e.preventDefault();this._redo()}
      if ((e.key==='Delete'||e.key==='Backspace')&&this._selected.size>0){e.preventDefault();this._selected.forEach(id=>this._removeNode(id));this._selected.clear();this._snapshot();this._persist();this._renderArrows()}
    })
  },

  // ── Drag starts ───────────────────────────────────────────────────────────

  _startNodeDrag(e, node) {
    if (e.button!==0) return; e.stopPropagation()
    if (this._mode==='connect') return
    const r=this._area.getBoundingClientRect()
    const wx=(e.clientX-r.left-this._pan.x)/this._zoom, wy=(e.clientY-r.top-this._pan.y)/this._zoom
    if (!e.shiftKey&&!this._selected.has(node.id)) this._clearSelection()
    this._selectNode(node.id)
    this._drag={type:'node', id:node.id, offX:wx-node.x, offY:wy-node.y}
  },

  _startGroupDrag(e, group) {
    if (e.button!==0) return; e.stopPropagation()
    const r=this._area.getBoundingClientRect()
    const wx=(e.clientX-r.left-this._pan.x)/this._zoom, wy=(e.clientY-r.top-this._pan.y)/this._zoom
    // Select group (shift = add to selection, no shift = replace)
    if (!e.shiftKey && !this._selected.has(group.id)) this._clearSelection()
    this._selectNode(group.id)
    this._drag={type:'group', id:group.id, offX:wx-group.x, offY:wy-group.y}
  },

  _startResize(e, node) {
    e.stopPropagation(); e.preventDefault()
    this._resize={id:node.id, startX:e.clientX, startY:e.clientY, startW:node.width||220, startH:node.height||160}
  },

  // ── Selection ─────────────────────────────────────────────────────────────

  _selectNode(id) {
    this._selected.add(id)
    const el = document.getElementById(`pin-${id}`)
    if (!el) return
    const node = this._board?.nodes?.find(n => n.id === id)
    if (node?.type === 'group') {
      // Groups use inline style — override border and background directly
      el.style.border = '2px solid rgba(201,169,110,0.95)'
      el.style.background = 'rgba(201,169,110,0.12)'
      el.style.boxShadow = '0 0 0 3px rgba(201,169,110,0.3)'
    } else {
      el.classList.add('pin-selected')
    }
  },
  _deselectNode(id) {
    this._selected.delete(id)
    const el = document.getElementById(`pin-${id}`)
    if (!el) return
    const node = this._board?.nodes?.find(n => n.id === id)
    if (node?.type === 'group') {
      el.style.border = '2px solid rgba(201,169,110,0.5)'
      el.style.background = 'rgba(201,169,110,0.05)'
      el.style.boxShadow = ''
    } else {
      el.classList.remove('pin-selected')
    }
  },
  _clearSelection() { [...this._selected].forEach(id=>this._deselectNode(id)); this._selected.clear() },

  // ── GROUPING ──────────────────────────────────────────────────────────────

  _showHint(msg, ms=2000) {
    const el=document.getElementById('cv-hint'); if(!el) return
    const prev=el.textContent; el.textContent=msg; el.style.color='var(--accent)'
    setTimeout(()=>{el.textContent=prev;el.style.color=''}, ms)
  },

  // ── Group helpers ────────────────────────────────────────────────────────

  _recomputeGroup(group) {
    const PAD = 32
    const members = (group.members || [])
      .map(id => this._board.nodes.find(n => n.id === id))
      .filter(Boolean)
    if (!members.length) return
    // Update the data object
    group.x      = Math.min(...members.map(n => n.x)) - PAD
    group.y      = Math.min(...members.map(n => n.y)) - PAD - 28
    group.width  = Math.max(...members.map(n => n.x + (n.width  || 220))) + PAD - group.x
    group.height = Math.max(...members.map(n => n.y + (n.height || 160))) + PAD - group.y
    // Update DOM
    const el = document.getElementById(`pin-${group.id}`)
    if (el) {
      el.style.left   = group.x + 'px'
      el.style.top    = group.y + 'px'
      el.style.width  = group.width  + 'px'
      el.style.height = group.height + 'px'
    }
  },

  // Compute what a group's bounds would be with extraNode included or excluded
  _computeGroupBounds(group, includeNode, excludeNodeId) {
    const PAD = 32
    let members = (group.members || [])
      .filter(id => id !== excludeNodeId)
      .map(id => this._board.nodes.find(n => n.id === id))
      .filter(Boolean)
    if (includeNode) members = [...members, includeNode]
    if (!members.length) return null
    const x = Math.min(...members.map(n => n.x)) - PAD
    const y = Math.min(...members.map(n => n.y)) - PAD - 28
    const w = Math.max(...members.map(n => n.x + (n.width  || 220))) + PAD - x
    const h = Math.max(...members.map(n => n.y + (n.height || 160))) + PAD - y
    return { x, y, w, h }
  },

  // Uses the group's STORED data bounds (not any live preview)
  // so hit-testing is always stable
  _groupAt(node) {
    const cx = node.x + (node.width  || 220) / 2
    const cy = node.y + (node.height || 160) / 2
    return this._board.nodes.find(g =>
      g.type === 'group' &&
      cx > g.x && cx < g.x + g.width &&
      cy > g.y && cy < g.y + g.height
    ) || null
  },

  // Preview group bounds in DOM without touching the data object
  _previewGroupDOM(group, bounds) {
    const el = document.getElementById(`pin-${group.id}`)
    if (!el) return
    el.classList.add('group-drop-target')
    el.style.left   = bounds.x + 'px'
    el.style.top    = bounds.y + 'px'
    el.style.width  = bounds.w + 'px'
    el.style.height = bounds.h + 'px'
  },

  // Restore group DOM to match its data object
  _restoreGroupDOM(group) {
    const el = document.getElementById(`pin-${group.id}`)
    if (!el) return
    el.classList.remove('group-drop-target')
    el.style.left   = group.x + 'px'
    el.style.top    = group.y + 'px'
    el.style.width  = group.width  + 'px'
    el.style.height = group.height + 'px'
  },

  async _groupSelected() {
    const ids = [...this._selected]
    if (ids.length < 2) { this._showHint('Shift+click or drag-select 2+ pins first, then group.', 3000); return }

    const selectedNodes = ids.map(id => this._board.nodes.find(n => n.id === id)).filter(Boolean)
    const selectedGroups = selectedNodes.filter(n => n.type === 'group')
    const selectedPins   = selectedNodes.filter(n => n.type !== 'group')

    // If exactly one group is selected alongside other pins → add those pins to the group
    if (selectedGroups.length === 1 && selectedPins.length >= 1) {
      const group = selectedGroups[0]
      let added = 0
      for (const pin of selectedPins) {
        if (!group.members.includes(pin.id)) { group.members.push(pin.id); added++ }
      }
      if (added > 0) {
        this._recomputeGroup(group)
        this._snapshot(); this._persist()
        this._showHint(`Added ${added} pin${added>1?'s':''} to "${group.name}"`, 2000)
      } else {
        this._showHint('Those pins are already in the group.', 2000)
      }
      this._clearSelection()
      return
    }

    // Otherwise create a new group from selected pins
    const members = selectedPins
    if (members.length < 2) { this._showHint('Select at least 2 pins to group.', 3000); return }

    const name = await this._prompt('Group name:', 'Group')
    if (!name) return

    const PAD = 32
    const minX = Math.min(...members.map(n => n.x)) - PAD
    const minY = Math.min(...members.map(n => n.y)) - PAD - 28
    const maxX = Math.max(...members.map(n => n.x + (n.width  || 220))) + PAD
    const maxY = Math.max(...members.map(n => n.y + (n.height || 160))) + PAD

    const group = {
      id:      crypto.randomUUID(),
      type:    'group',
      name:    name.trim(),
      x:       minX,
      y:       minY,
      width:   maxX - minX,
      height:  maxY - minY,
      members: members.map(n => n.id),
    }
    this._board.nodes.unshift(group)
    this._clearSelection()
    this._snapshot(); this._persist(); this._renderAll()
  },

  // ── Context menus ─────────────────────────────────────────────────────────

  _showCanvasMenu(cx, cy) {
    const items = []
    if (this._selected.size >= 2) {
      const selNodes = [...this._selected].map(id => this._board.nodes.find(n => n.id === id)).filter(Boolean)
      const hasGroup = selNodes.some(n => n.type === 'group')
      const pinCount = selNodes.filter(n => n.type !== 'group').length
      const label = hasGroup && selNodes.filter(n=>n.type==='group').length===1
        ? `⊡  Add ${pinCount} pin${pinCount!==1?'s':''} to group`
        : `⊡  Group ${this._selected.size} pins`
      items.push({label, kbd:'⌘G', action:()=>this._groupSelected()})
      items.push('---')
    }
    items.push(
      {label:'Add yellow note',  action:()=>this._addNoteAt(cx,cy,'yellow')},
      {label:'Add blue note',    action:()=>this._addNoteAt(cx,cy,'blue')},
      {label:'Add green note',   action:()=>this._addNoteAt(cx,cy,'green')},
      {label:'Add purple note',  action:()=>this._addNoteAt(cx,cy,'purple')},
      '---',
      {label:'Add sub-board',    action:()=>this._addSubBoardAt(cx,cy)},
      {label:'Add text field',    action:()=>this._addTextAt(cx,cy)},
      '---',
      {label:'Reset zoom',       action:()=>{this._zoom=1;this._pan={x:80,y:80};this._applyTransform()}},
    )
    this._showMenu(cx, cy, items)
  },

  _showNodeMenu(cx, cy, node) {
    const items = []
    if (this._selected.size >= 2) {
      const selNodes = [...this._selected].map(id => this._board.nodes.find(n => n.id === id)).filter(Boolean)
      const hasGroup = selNodes.some(n => n.type === 'group')
      const pinCount = selNodes.filter(n => n.type !== 'group').length
      const label = hasGroup && selNodes.filter(n=>n.type==='group').length===1
        ? `⊡  Add ${pinCount} pin${pinCount!==1?'s':''} to group`
        : `⊡  Group ${this._selected.size} pins`
      items.push({label, kbd:'⌘G', action:()=>this._groupSelected()})
      items.push('---')
    }
    if (node.type==='note') {
      items.push({label:'Duplicate', kbd:'⌘D', action:()=>this._duplicateNode(node)}); items.push('---')
      ;['yellow','blue','green','purple'].filter(c=>c!==node.color).forEach(c=>items.push({label:`Change to ${c}`,action:()=>{node.color=c;this._renderNode(node);this._snapshot();this._persist()}}))
      items.push('---')
    }
    if (node.type==='subboard') { items.push({label:'Open board',action:()=>App.openBoard(node.file)}); items.push({label:'Duplicate',action:()=>this._duplicateNode(node)}); items.push('---') }
    if (node.type==='image') { items.push({label:'Duplicate',action:()=>this._duplicateNode(node)}); items.push('---') }
    if (node.type==='group') { items.push({label:'Rename group',action:()=>{this._prompt('Group name:',node.name).then(v=>{if(v){node.name=v;this._renderNode(node);this._persist()}})}}); items.push('---') }
    items.push({label:'Delete', danger:true, action:()=>{this._removeNode(node.id);this._snapshot();this._persist();this._renderArrows()}})
    this._showMenu(cx, cy, items)
  },

  _showMenu(cx, cy, items) {
    const menu = document.getElementById('canvas-ctx'); if (!menu) return
    menu.innerHTML = ''
    for (const item of items) {
      if (item==='---') { const s=document.createElement('div');s.className='ctx-sep';menu.appendChild(s);continue }
      const btn=document.createElement('button'); btn.className='ctx-item'
      if (item.danger) btn.classList.add('ctx-danger')
      btn.innerHTML=`<span>${item.label}</span>${item.kbd?`<span class="ctx-kbd">${item.kbd}</span>`:''}`
      btn.onclick=()=>{this._hideMenu();item.action()}
      menu.appendChild(btn)
    }
    menu.classList.remove('hidden')
    menu.style.cssText=`position:fixed;left:${cx}px;top:${cy}px;z-index:9999;`
    requestAnimationFrame(()=>{const r=menu.getBoundingClientRect();if(r.right>window.innerWidth)menu.style.left=(cx-r.width)+'px';if(r.bottom>window.innerHeight)menu.style.top=(cy-r.height)+'px'})
  },

  _hideMenu() { document.getElementById('canvas-ctx')?.classList.add('hidden') },

  // ── Anchors ───────────────────────────────────────────────────────────────

  _addAnchors(el, node) {
    for (const [cls,css] of [['anchor-top','top:-6px;left:50%;transform:translateX(-50%);'],['anchor-right','top:50%;right:-6px;transform:translateY(-50%);'],['anchor-bottom','bottom:-6px;left:50%;transform:translateX(-50%);'],['anchor-left','top:50%;left:-6px;transform:translateY(-50%);']]) {
      const a=document.createElement('div'); a.className=`pin-anchor ${cls}`
      a.style.cssText=`position:absolute;${css}width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid var(--bg2);opacity:0;cursor:crosshair;z-index:20;pointer-events:all;transition:opacity .1s;`
      a.addEventListener('mousedown', e=>{
        e.stopPropagation();e.preventDefault()
        if (this._mode!=='connect') this._setMode('connect')
        if (!this._connecting) { this._connecting=node.id;a.classList.add('anchor-active');a.style.opacity='1' }
        else if (this._connecting!==node.id) {
          if (!this._board.arrows) this._board.arrows=[]
          if (!this._board.arrows.some(ar=>ar.from===this._connecting&&ar.to===node.id))
            this._board.arrows.push({id:crypto.randomUUID(),from:this._connecting,to:node.id})
          document.querySelectorAll('.anchor-active').forEach(aa=>{aa.classList.remove('anchor-active');aa.style.opacity='0'})
          this._connecting=null;this._snapshot();this._persist();this._renderArrows()
        }
      })
      el.appendChild(a)
    }
    el.addEventListener('mouseenter',()=>el.querySelectorAll('.pin-anchor').forEach(a=>{a.style.opacity='1'}))
    el.addEventListener('mouseleave',()=>el.querySelectorAll('.pin-anchor:not(.anchor-active)').forEach(a=>{a.style.opacity='0'}))
  },

  // ── Transform ─────────────────────────────────────────────────────────────

  _applyTransform() {
    this._zoom=Math.min(4,Math.max(0.1,this._zoom))
    this._world.style.transform=`translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})`
    const zm=document.getElementById('cv-zoom'); if(zm) zm.textContent=`${Math.round(this._zoom*100)}%`
    this._renderArrows(); this._updateMinimap()
  },

  // ── Arrows (viewport-fixed SVG, screen-space coords) ─────────────────────

  _toScreen(wx,wy) { return {x:wx*this._zoom+this._pan.x, y:wy*this._zoom+this._pan.y} },

  _renderArrows() {
    const svg=this._svg; if(!svg) return
    svg.innerHTML=''
    const arrows=this._board?.arrows||[]; if(!arrows.length) return
    const defs=document.createElementNS('http://www.w3.org/2000/svg','defs')
    const mk=document.createElementNS('http://www.w3.org/2000/svg','marker')
    mk.setAttribute('id','cvmk');mk.setAttribute('markerWidth','8');mk.setAttribute('markerHeight','6');mk.setAttribute('refX','7');mk.setAttribute('refY','3');mk.setAttribute('orient','auto')
    const pl=document.createElementNS('http://www.w3.org/2000/svg','polygon')
    pl.setAttribute('points','0 0,8 3,0 6');pl.setAttribute('fill','rgba(201,169,110,0.9)')
    mk.appendChild(pl);defs.appendChild(mk);svg.appendChild(defs)
    for (const a of arrows) {
      const fn=this._board.nodes.find(n=>n.id===a.from), tn=this._board.nodes.find(n=>n.id===a.to)
      if(!fn||!tn) continue
      const {x:x1,y:y1}=this._toScreen(fn.x+(fn.width||220)/2, fn.y+(fn.height||160)/2)
      const {x:x2,y:y2}=this._toScreen(tn.x+(tn.width||220)/2, tn.y+(tn.height||160)/2)
      const d=`M${x1},${y1} C${x1+(x2-x1)*.5},${y1} ${x1+(x2-x1)*.5},${y2} ${x2},${y2}`
      const path=document.createElementNS('http://www.w3.org/2000/svg','path')
      path.setAttribute('d',d);path.setAttribute('stroke','rgba(201,169,110,0.75)');path.setAttribute('stroke-width','1.5');path.setAttribute('fill','none');path.setAttribute('marker-end','url(#cvmk)')
      const hit=document.createElementNS('http://www.w3.org/2000/svg','path')
      hit.setAttribute('d',d);hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','14');hit.setAttribute('fill','none')
      hit.style.pointerEvents='stroke';hit.style.cursor='pointer'
      const aid=a.id
      hit.addEventListener('dblclick',e=>{e.stopPropagation();this._board.arrows=this._board.arrows.filter(x=>x.id!==aid);this._persist();this._renderArrows()})
      hit.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();this._showMenu(e.clientX,e.clientY,[{label:'Delete arrow',danger:true,action:()=>{this._board.arrows=this._board.arrows.filter(x=>x.id!==aid);this._persist();this._renderArrows()}}])})
      svg.appendChild(path);svg.appendChild(hit)
    }
  },

  // ── Minimap ───────────────────────────────────────────────────────────────

  _updateMinimap() {
    const mm=document.getElementById('cv-minimap'); if(!mm||!this._board) return
    if(!this._board.nodes.length){mm.style.display='none';return}
    mm.style.display='block'; const S=0.04; mm.innerHTML=''
    for (const n of this._board.nodes) {
      const d=document.createElement('div');d.className='minimap-node'
      d.style.cssText=`left:${n.x*S}px;top:${n.y*S}px;width:${Math.max(4,(n.width||160)*S)}px;height:${Math.max(3,(n.height||100)*S)}px;`
      if(n.type==='note') d.style.background={yellow:'var(--ny-bg)',blue:'var(--nb-bg)',green:'var(--ng-bg)',purple:'var(--np-bg)'}[n.color]||'var(--bg3)'
      else if(n.type==='group'){d.style.background='transparent';d.style.border='1px solid rgba(201,169,110,0.4)';d.style.borderRadius='2px'}
      mm.appendChild(d)
    }
    const vp=document.createElement('div');vp.className='minimap-viewport'
    vp.style.cssText=`left:${(-this._pan.x/this._zoom)*S}px;top:${(-this._pan.y/this._zoom)*S}px;width:${(this._area.clientWidth/this._zoom)*S}px;height:${(this._area.clientHeight/this._zoom)*S}px;`
    mm.appendChild(vp)
  },

  // ── Load / persist / history ──────────────────────────────────────────────

  async _load() {
    try{this._board=JSON.parse(await api.fs.read(`${this._dir}/boards/${this._file}`))}
    catch{this._board={name:'Board',nodes:[],arrows:[]}}
    if(!this._board.arrows) this._board.arrows=[]
    this._buildToolbar(); this._renderAll(); this._setMode('select'); this._snapshot()
  },

  async _persist(){await Project.saveBoard(this._dir,this._file,this._board);Store.patch('git',{dirty:true})},

  _snapshot(){
    const snap=JSON.stringify({nodes:this._board.nodes,arrows:this._board.arrows})
    if(this._histIdx>=0&&this._history[this._histIdx]===snap) return
    this._history=this._history.slice(0,this._histIdx+1); this._history.push(snap); this._histIdx=this._history.length-1
    if(this._history.length>60){this._history.shift();this._histIdx--}
  },

  _undo(){if(this._histIdx<=0)return;this._histIdx--;const s=JSON.parse(this._history[this._histIdx]);this._board.nodes=s.nodes;this._board.arrows=s.arrows;this._renderAll();this._persist()},
  _redo(){if(this._histIdx>=this._history.length-1)return;this._histIdx++;const s=JSON.parse(this._history[this._histIdx]);this._board.nodes=s.nodes;this._board.arrows=s.arrows;this._renderAll();this._persist()},

  // ── Add nodes ─────────────────────────────────────────────────────────────

  _sw(cx,cy){const r=this._area.getBoundingClientRect();return{wx:(cx-r.left-this._pan.x)/this._zoom,wy:(cy-r.top-this._pan.y)/this._zoom}},
  _center(){return{wx:(-this._pan.x+this._area.clientWidth/2)/this._zoom,wy:(-this._pan.y+this._area.clientHeight/2)/this._zoom}},

  _addNote(color){const{wx,wy}=this._center();const n={id:crypto.randomUUID(),type:'note',color,x:Math.round(wx-110),y:Math.round(wy-80),width:220,height:160,text:''};this._board.nodes.push(n);this._renderNode(n);this._snapshot();this._persist()},
  _addNoteAt(cx,cy,color){const{wx,wy}=this._sw(cx,cy);const n={id:crypto.randomUUID(),type:'note',color,x:Math.round(wx-110),y:Math.round(wy-80),width:220,height:160,text:''};this._board.nodes.push(n);this._renderNode(n);this._snapshot();this._persist()},

  async _addSubBoard(){const count=this._board.nodes.filter(n=>n.type==='subboard').length;const b=await Project.newBoard(this._dir,`Board ${count+1}`);const{wx,wy}=this._center();const n={id:crypto.randomUUID(),type:'subboard',x:Math.round(wx-80),y:Math.round(wy-70),width:160,file:b.file,name:b.name,cover:null};this._board.nodes.push(n);this._renderNode(n);this._snapshot();this._persist()},
  async _addSubBoardAt(cx,cy){const count=this._board.nodes.filter(n=>n.type==='subboard').length;const b=await Project.newBoard(this._dir,`Board ${count+1}`);const{wx,wy}=this._sw(cx,cy);const n={id:crypto.randomUUID(),type:'subboard',x:Math.round(wx-80),y:Math.round(wy-70),width:160,file:b.file,name:b.name,cover:null};this._board.nodes.push(n);this._renderNode(n);this._snapshot();this._persist()},

  _addText() {
    const {wx,wy} = this._center()
    const node = { id:crypto.randomUUID(), type:'text', x:Math.round(wx-100), y:Math.round(wy-30), width:200, height:60, text:'Double-click to edit', fontSize:16, color:'var(--tx)' }
    this._board.nodes.push(node); this._renderNode(node); this._snapshot(); this._persist()
  },

  _addTextAt(cx, cy) {
    const {wx,wy} = this._sw(cx, cy)
    const node = { id:crypto.randomUUID(), type:'text', x:Math.round(wx-100), y:Math.round(wy-30), width:200, height:60, text:'Double-click to edit', fontSize:16, color:'var(--tx)' }
    this._board.nodes.push(node); this._renderNode(node); this._snapshot(); this._persist()
  },

  _duplicateNode(n){const copy={...n,id:crypto.randomUUID(),x:n.x+24,y:n.y+24};this._board.nodes.push(copy);this._renderNode(copy);this._snapshot();this._persist()},
  _removeNode(id){
    this._board.nodes=this._board.nodes.filter(n=>n.id!==id)
    if(this._board.arrows)this._board.arrows=this._board.arrows.filter(a=>a.from!==id&&a.to!==id)
    const el=document.getElementById(`pin-${id}`)
    if(el?._cleanup) el._cleanup()
    el?.remove()
  },

  async _dropImage(e,file){const r=this._area.getBoundingClientRect();const wx=Math.round((e.clientX-r.left-this._pan.x)/this._zoom),wy=Math.round((e.clientY-r.top-this._pan.y)/this._zoom);const dest=`${this._dir}/references/${crypto.randomUUID()}-${file.name}`;await api.fs.copy(file.path,dest);const n={id:crypto.randomUUID(),type:'image',x:wx,y:wy,width:240,src:dest};this._board.nodes.push(n);this._renderNode(n);this._snapshot();this._persist()},

  // ── Render ────────────────────────────────────────────────────────────────

  _renderAll(){
    this._world.innerHTML=''
    // Groups first (they go in behind)
    for(const n of this._board.nodes) if(n.type==='group') this._world.appendChild(this._makeGroup(n))
    // Then everything else
    for(const n of this._board.nodes) if(n.type!=='group') { const el=this._makePin(n); if(el) this._world.appendChild(el) }
    this._renderArrows(); this._updateMinimap()
  },

  _renderNode(n){
    document.getElementById(`pin-${n.id}`)?.remove()
    const el = n.type==='group' ? this._makeGroup(n) : this._makePin(n)
    if(el) this._world.appendChild(el)
  },

  _makePin(n){
    if(n.type==='note')     return this._makeNote(n)
    if(n.type==='image')    return this._makeImage(n)
    if(n.type==='subboard') return this._makeSub(n)
    if(n.type==='text')     return this._makeText(n)
    return null
  },

  // ── Pin factories ─────────────────────────────────────────────────────────

  _resizeHandle(node){const h=document.createElement('div');h.className='pin-resize-handle';h.addEventListener('mousedown',e=>{e.stopPropagation();this._startResize(e,node)});return h},
  _xBtn(node){const b=document.createElement('button');b.className='pin-del';b.textContent='×';b.addEventListener('mousedown',e=>e.stopPropagation());b.onclick=()=>{this._removeNode(node.id);this._snapshot();this._persist()};return b},

  // GROUP: explicit inline styles, renders behind all other pins
  _makeGroup(n) {
    const el = document.createElement('div')
    el.id = `pin-${n.id}`
    el.style.cssText = [
      `position:absolute`,
      `left:${n.x}px`,
      `top:${n.y}px`,
      `width:${n.width}px`,
      `height:${n.height}px`,
      `border:2px solid rgba(201,169,110,0.5)`,
      `border-radius:14px`,
      `background:rgba(201,169,110,0.05)`,
      `box-sizing:border-box`,
      `cursor:move`,
      `user-select:none`,
    ].join(';')

    const label = document.createElement('div')
    label.style.cssText = 'position:absolute;top:8px;left:14px;right:32px;font-size:11px;font-weight:600;color:rgba(201,169,110,0.85);letter-spacing:.07em;text-transform:uppercase;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    label.textContent = n.name
    el.appendChild(label)

    const del = document.createElement('button')
    del.style.cssText = 'position:absolute;top:4px;right:8px;background:transparent;border:none;color:rgba(201,169,110,0.45);font-size:16px;cursor:pointer;line-height:1;padding:0;'
    del.textContent = '×'
    del.addEventListener('mousedown', e => e.stopPropagation())
    del.onclick = () => { this._removeNode(n.id); this._persist() }
    el.appendChild(del)

    // Inline rename — single or double click on the label
    const startRename = (e) => {
      e.stopPropagation(); e.preventDefault()
      const inp = document.createElement('input')
      inp.value = n.name
      inp.style.cssText = 'position:absolute;top:5px;left:14px;right:32px;background:rgba(0,0,0,.45);border:none;border-bottom:1.5px solid rgba(201,169,110,0.9);color:rgba(201,169,110,0.95);font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;outline:none;padding:2px 4px;font-family:var(--sans);box-sizing:border-box;'
      el.appendChild(inp)
      label.style.visibility = 'hidden'
      inp.focus(); inp.select()
      const commit = () => {
        const v = inp.value.trim()
        if (v) { n.name = v; label.textContent = v }
        inp.remove(); label.style.visibility = ''
        this._persist()
      }
      inp.addEventListener('blur', commit)
      inp.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter') { e2.preventDefault(); inp.blur() }
        if (e2.key === 'Escape') { inp.remove(); label.style.visibility = '' }
        e2.stopPropagation()
      })
      inp.addEventListener('mousedown', e2 => e2.stopPropagation())
    }
    label.addEventListener('click', startRename)
    label.addEventListener('dblclick', startRename)

    el.appendChild(this._resizeHandle(n))
    el.addEventListener('mousedown', e => this._startGroupDrag(e, n))
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this._showNodeMenu(e.clientX, e.clientY, n) })
    return el
  },

  _makeText(n) {
    const el = document.createElement('div')
    el.id = `pin-${n.id}`; el.className = 'pin pin-text'
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width||220}px;min-height:${n.height||60}px;position:absolute;z-index:2;display:flex;flex-direction:column;`

    const content = document.createElement('div')
    content.className = 'pin-text-content'
    content.contentEditable = 'false'
    content.innerHTML = n.html || (n.text ? n.text.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '')
    content.style.cssText = `font-size:${n.fontSize||16}px;color:${n.color||'var(--tx)'};outline:none;cursor:default;word-break:break-word;flex:1;padding:6px 8px;line-height:1.5;font-family:var(--sans);`
    el.appendChild(content)

    // Floating format toolbar — shown when text is selected inside content
    const fmt = document.createElement('div')
    fmt.className = 'text-fmt-bar'
    fmt.style.display = 'none'
    document.body.appendChild(fmt)

    const fmtBtn = (label, cmd, arg) => {
      const b = document.createElement('button'); b.className = 'text-fmt-btn'; b.innerHTML = label
      b.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation()
        document.execCommand(cmd, false, arg || null)
        content.focus()
        updateFmt()
      })
      fmt.appendChild(b); return b
    }
    const boldBtn   = fmtBtn('<strong>B</strong>', 'bold')
    const italicBtn = fmtBtn('<em>I</em>', 'italic')
    const ulBtn     = fmtBtn('•—', 'insertUnorderedList')
    // Font size in format bar
    const fmtSep = document.createElement('div'); fmtSep.style.cssText='width:1px;height:14px;background:rgba(255,255,255,0.12);margin:0 3px;'; fmt.appendChild(fmtSep)
    const fmtSmaller = document.createElement('button'); fmtSmaller.className='text-fmt-btn'; fmtSmaller.textContent='A−'
    fmtSmaller.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); n.fontSize=Math.max(8,(n.fontSize||16)-2); content.style.fontSize=n.fontSize+'px'; this._persist() })
    fmt.appendChild(fmtSmaller)
    const fmtSzLabel = document.createElement('span'); fmtSzLabel.style.cssText='font-size:10px;color:var(--tx3);font-family:var(--mono);padding:0 2px;min-width:26px;text-align:center;'; fmtSzLabel.textContent=(n.fontSize||16)+'px'; fmt.appendChild(fmtSzLabel)
    const fmtBigger  = document.createElement('button'); fmtBigger.className='text-fmt-btn';  fmtBigger.textContent='A+'
    fmtBigger.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); n.fontSize=Math.min(96,(n.fontSize||16)+2); content.style.fontSize=n.fontSize+'px'; fmtSzLabel.textContent=n.fontSize+'px'; this._persist() })
    fmt.appendChild(fmtBigger)

    const updateFmt = () => {
      try {
        boldBtn.style.background   = document.queryCommandState('bold')   ? 'rgba(255,255,255,0.15)' : ''
        italicBtn.style.background = document.queryCommandState('italic') ? 'rgba(255,255,255,0.15)' : ''
        ulBtn.style.background     = document.queryCommandState('insertUnorderedList') ? 'rgba(255,255,255,0.15)' : ''
        fmtSzLabel.textContent = (n.fontSize||16)+'px'
      } catch {}
    }

    const positionFmt = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) { fmt.style.display='none'; return }
      // Check selection is inside this content
      const range = sel.getRangeAt(0)
      if (!content.contains(range.commonAncestorContainer)) { fmt.style.display='none'; return }
      const rect = range.getBoundingClientRect()
      if (!rect.width) { fmt.style.display='none'; return }
      fmt.style.display = 'flex'
      // Position above the selection
      const fw = fmt.offsetWidth || 200
      let x = rect.left + rect.width/2 - fw/2
      let y = rect.top - 40
      if (x < 8) x = 8
      if (x + fw > window.innerWidth - 8) x = window.innerWidth - fw - 8
      if (y < 8) y = rect.bottom + 8
      fmt.style.left = x + 'px'; fmt.style.top = y + 'px'
      updateFmt()
    }

    // Small × delete handle in corner (only on hover, not during edit)
    const delBtn = document.createElement('button'); delBtn.className='pin-text-del-corner'
    delBtn.textContent='×'; delBtn.title='Delete'
    delBtn.addEventListener('mousedown', e=>e.stopPropagation())
    delBtn.onclick=()=>{ fmt.remove(); this._removeNode(n.id); this._snapshot(); this._persist() }
    el.appendChild(delBtn)

    // Enter edit mode on double-click or when placed fresh (text is empty)
    const startEdit = () => {
      content.contentEditable = 'true'; content.style.cursor = 'text'; content.focus()
    }
    el.addEventListener('dblclick', e => { e.stopPropagation(); startEdit() })

    content.addEventListener('focus',  () => { content.contentEditable='true'; content.style.cursor='text' })
    content.addEventListener('blur',   () => {
      content.contentEditable='false'; content.style.cursor='default'
      fmt.style.display='none'
      n.html = content.innerHTML; n.text = content.textContent; this._persist()
    })
    content.addEventListener('keydown', e => { e.stopPropagation(); if(e.key==='Escape') content.blur() })
    content.addEventListener('mouseup', () => setTimeout(positionFmt, 10))
    content.addEventListener('keyup',  () => setTimeout(positionFmt, 10))

    this._addAnchors(el, n)
    el.addEventListener('mousedown', e => {
      if (content.contentEditable==='true') { e.stopPropagation(); return }
      this._startNodeDrag(e, n)
    })
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation()
      if(!this._selected.has(n.id)){this._clearSelection();this._selectNode(n.id)}
      this._showNodeMenu(e.clientX,e.clientY,n)
    })
    el.appendChild(this._resizeHandle(n))

    // Clean up floating fmt bar when node is removed
    const origRemove = this._removeNode.bind(this)
    el._cleanup = () => fmt.remove()

    return el
  },

  _makeNote(n) {
    const el=document.createElement('div'); el.id=`pin-${n.id}`; el.className=`pin pin-note pin-note-${n.color}`
    el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.width||220}px;height:${n.height||160}px;position:absolute;z-index:2;`
    const bar=document.createElement('div');bar.className='pin-bar'
    const lbl=document.createElement('span');lbl.className='pin-label';lbl.textContent='Note'
    bar.appendChild(lbl);bar.appendChild(this._xBtn(n));el.appendChild(bar)
    const ta=document.createElement('textarea');ta.className='pin-note-text';ta.value=n.text||'';ta.placeholder='Type a note…'
    ta.addEventListener('mousedown',e=>e.stopPropagation());ta.addEventListener('input',()=>{n.text=ta.value;this._persist()})
    el.appendChild(ta);el.appendChild(this._resizeHandle(n));this._addAnchors(el,n)
    el.addEventListener('mousedown',e=>this._startNodeDrag(e,n))
    el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!this._selected.has(n.id)){this._clearSelection();this._selectNode(n.id)};this._showNodeMenu(e.clientX,e.clientY,n)})
    return el
  },

  _makeImage(n) {
    const el=document.createElement('div');el.id=`pin-${n.id}`;el.className='pin pin-img'
    el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.width||240}px;position:absolute;z-index:2;`
    const bar=document.createElement('div');bar.className='pin-bar';const lbl=document.createElement('span');lbl.className='pin-label';lbl.style.color='var(--tx2)';lbl.textContent='Image'
    bar.appendChild(lbl);bar.appendChild(this._xBtn(n));el.appendChild(bar)
    const ph=document.createElement('div');ph.style.cssText='height:80px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--tx3);';ph.textContent='Loading…';el.appendChild(ph)
    api.fs.readBin(n.src).then(b=>{const img=document.createElement('img');img.src=`data:image/jpeg;base64,${b}`;img.draggable=false;img.style.cssText='display:block;width:100%;border-radius:0 0 6px 6px;';ph.replaceWith(img)}).catch(()=>{ph.textContent='Not found'})
    this._addAnchors(el,n);el.addEventListener('mousedown',e=>this._startNodeDrag(e,n))
    el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!this._selected.has(n.id)){this._clearSelection();this._selectNode(n.id)};this._showNodeMenu(e.clientX,e.clientY,n)})
    return el
  },

  _makeSub(n) {
    const el=document.createElement('div');el.id=`pin-${n.id}`;el.className='subboard'
    el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.width||160}px;position:absolute;z-index:2;`
    const cover=document.createElement('div');cover.className='subboard-cover'
    if(n.cover){api.fs.readBin(n.cover).then(b=>{const img=document.createElement('img');img.src=`data:image/jpeg;base64,${b}`;img.draggable=false;cover.innerHTML='';cover.appendChild(img)}).catch(()=>{})}else{cover.textContent='⊞';cover.style.opacity='.3'}
    el.appendChild(cover)
    const foot=document.createElement('div');foot.className='subboard-foot';const nm=document.createElement('span');nm.className='subboard-name';nm.textContent=n.name;foot.appendChild(nm);el.appendChild(foot)
    const acts=document.createElement('div');acts.className='subboard-actions';acts.addEventListener('mousedown',e=>e.stopPropagation())
    const ren=document.createElement('button');ren.className='subboard-act';ren.textContent='✎';ren.onclick=()=>{this._prompt('Name:',n.name).then(v=>{if(v){n.name=v;nm.textContent=n.name;this._persist()}})}
    const sc=document.createElement('button');sc.className='subboard-act';sc.textContent='⊡';sc.onclick=async()=>{const fp=await api.dialog.file([{name:'Images',extensions:['jpg','jpeg','png','webp','gif']}]);if(!fp)return;const dest=`${this._dir}/references/cover-${crypto.randomUUID()}-${fp.split('/').pop()}`;await api.fs.copy(fp,dest);n.cover=dest;api.fs.readBin(dest).then(b=>{const img=document.createElement('img');img.src=`data:image/jpeg;base64,${b}`;img.draggable=false;cover.innerHTML='';cover.appendChild(img)}).catch(()=>{});this._persist()}
    const dl=document.createElement('button');dl.className='subboard-act';dl.style.color='var(--err)';dl.textContent='×';dl.onclick=()=>{this._removeNode(n.id);this._persist()}
    acts.appendChild(ren);acts.appendChild(sc);acts.appendChild(dl);el.appendChild(acts)
    const hint=document.createElement('div');hint.className='subboard-hint';hint.textContent='Double-click to open';el.appendChild(hint)
    el.addEventListener('dblclick',e=>{e.stopPropagation();App.openBoard(n.file)})
    this._addAnchors(el,n);el.addEventListener('mousedown',e=>this._startNodeDrag(e,n))
    el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!this._selected.has(n.id)){this._clearSelection();this._selectNode(n.id)};this._showNodeMenu(e.clientX,e.clientY,n)})
    return el
  },
}
