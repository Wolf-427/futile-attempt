const Canvas = {
  _board: null,
  _zoom: 1, _pan: { x: 80, y: 80 },
  _dir: null, _file: null,
  _world: null, _area: null, _svg: null,

  _mode: 'select',
  _drag: null, _resize: null, _marquee: null,
  _selected: new Set(), _locked: new Set(),
  _connecting: null,
  _panning: false, _lastMouse: { x: 0, y: 0 },
  _history: [], _historyIdx: -1,

  mount(container, dir, file) {
    this._dir = dir; this._file = file
    this._zoom = 1; this._pan = { x: 80, y: 80 }
    this._mode = 'select'; this._drag = null; this._resize = null; this._marquee = null
    this._selected = new Set(); this._locked = new Set(); this._connecting = null
    this._panning = false; this._history = []; this._historyIdx = -1

    container.innerHTML = `
      <div class="canvas-wrap">
        <div class="canvas-toolbar" id="canvas-tb"></div>
        <div class="canvas-area" id="canvas-area">
          <!-- SVG is viewport-fixed, arrows computed in screen space -->
          <svg id="canvas-svg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5;"></svg>
          <!-- World div: single CSS transform for all pins -->
          <div class="canvas-world" id="canvas-world"></div>
          <div class="canvas-marquee hidden" id="canvas-marquee"></div>
          <div class="canvas-minimap" id="canvas-minimap"></div>
        </div>
        <div class="canvas-hint" id="canvas-hint"></div>
      </div>
    `

    // Global context menu on body (fixed positioning)
    if (!document.getElementById('ctx-menu-global')) {
      const m = document.createElement('div')
      m.id = 'ctx-menu-global'; m.className = 'ctx-menu hidden'
      document.body.appendChild(m)
    }

    this._area  = document.getElementById('canvas-area')
    this._world = document.getElementById('canvas-world')
    this._svg   = document.getElementById('canvas-svg')
    this._bindEvents()
    this._load()
  },

  // ── Toolbar ───────────────────────────────────────────────────────────────

  _buildToolbar() {
    const tb = document.getElementById('canvas-tb')
    tb.innerHTML = ''

    const stack = Store.get('boardStack')
    if (stack?.length > 0) {
      const back = document.createElement('button')
      back.className = 'canvas-tool'; back.textContent = '← Back'
      back.onclick = () => { const s=Store.get('boardStack'); Store.set('boardStack',s.slice(0,-1)); App.openBoard(s[s.length-1],false) }
      tb.appendChild(back); this._sep(tb)
    }

    const nm = document.createElement('span')
    nm.style.cssText = 'font-family:var(--serif);font-size:14px;color:var(--tx2);'
    nm.textContent = this._board?.name || 'Board'; tb.appendChild(nm); this._sep(tb)

    ;[{id:'select',label:'↖ Select',title:'Select  V'},{id:'connect',label:'⤳ Connect',title:'Draw arrows  C'}].forEach(m => {
      const b = document.createElement('button')
      b.className='canvas-tool canvas-mode-btn'; b.id=`mode-${m.id}`; b.textContent=m.label; b.title=m.title
      b.onclick=()=>this._setMode(m.id); tb.appendChild(b)
    })
    this._sep(tb)

    ;[{c:'yellow',bg:'var(--ny-bg)',b:'var(--ny-b)'},{c:'blue',bg:'var(--nb-bg)',b:'var(--nb-b)'},{c:'green',bg:'var(--ng-bg)',b:'var(--ng-b)'},{c:'purple',bg:'var(--np-bg)',b:'var(--np-b)'}].forEach(({c,bg,b})=>{
      const dot=document.createElement('button'); dot.className='canvas-color-dot'
      dot.style.background=bg; dot.style.borderColor=b; dot.title=`${c} note`
      dot.onclick=()=>this._addNote(c); tb.appendChild(dot)
    })

    const sub=document.createElement('button'); sub.className='canvas-tool'; sub.textContent='⊞ Sub-board'; sub.onclick=()=>this._addSubBoard(); tb.appendChild(sub)
    this._sep(tb)

    ;[['↩','Undo ⌘Z',()=>this._undo()],['↪','Redo ⌘⇧Z',()=>this._redo()]].forEach(([l,t,fn])=>{
      const b=document.createElement('button'); b.className='canvas-tool'; b.textContent=l; b.title=t; b.onclick=fn; tb.appendChild(b)
    })

    const sp=document.createElement('div'); sp.style.flex='1'; tb.appendChild(sp)
    const zm=document.createElement('span'); zm.id='canvas-zoom'; zm.style.cssText='font-size:11px;color:var(--tx3);font-family:var(--mono);min-width:38px;text-align:right;'
    zm.textContent=`${Math.round(this._zoom*100)}%`; tb.appendChild(zm)

    ;[['−',-0.15],['⌂',null],['+',.15]].forEach(([l,d])=>{
      const b=document.createElement('button'); b.className='canvas-tool'; b.textContent=l
      b.onclick=()=>{ if(d===null){this._zoom=1;this._pan={x:80,y:80}}else this._zoom=Math.min(4,Math.max(0.1,this._zoom+d)); this._updateTransform() }
      tb.appendChild(b)
    })
    this._updateModeUI()
  },

  _sep(tb) { const d=document.createElement('div'); d.style.cssText='width:1px;height:18px;background:var(--b0);margin:0 4px;flex-shrink:0;'; tb.appendChild(d) },

  _setMode(mode) {
    this._mode=mode
    if(this._connecting){ document.querySelectorAll('.anchor-active').forEach(a=>{a.classList.remove('anchor-active');a.style.opacity='0'}); this._connecting=null }
    this._updateModeUI(); this._updateHint()
  },

  _updateModeUI() {
    document.querySelectorAll('.canvas-mode-btn').forEach(b=>{
      const active=b.id===`mode-${this._mode}`
      b.style.background=active?'var(--accent)':''; b.style.color=active?'#0f0f0d':''; b.style.border=active?'none':''
    })
    this._area.style.cursor='default'
  },

  _updateHint() {
    const hints={select:'Scroll to pan · Pinch to zoom · Drag to marquee-select · Right-click for menu · ⌘Z undo',connect:'Hover a pin → click an anchor → click another anchor to connect · Esc cancel'}
    const el=document.getElementById('canvas-hint'); if(el) el.textContent=hints[this._mode]||''
  },

  // ── History ───────────────────────────────────────────────────────────────

  _snapshot() {
    const snap=JSON.stringify({nodes:this._board.nodes,arrows:this._board.arrows})
    if(this._historyIdx>=0&&this._history[this._historyIdx]===snap) return
    this._history=this._history.slice(0,this._historyIdx+1)
    this._history.push(snap); this._historyIdx=this._history.length-1
    if(this._history.length>50){this._history.shift();this._historyIdx--}
  },

  _undo() { if(this._historyIdx<=0)return; this._historyIdx--; const s=JSON.parse(this._history[this._historyIdx]); this._board.nodes=s.nodes; this._board.arrows=s.arrows; this._renderAll(); this._persist() },
  _redo() { if(this._historyIdx>=this._history.length-1)return; this._historyIdx++; const s=JSON.parse(this._history[this._historyIdx]); this._board.nodes=s.nodes; this._board.arrows=s.arrows; this._renderAll(); this._persist() },

  // ── Context menu ──────────────────────────────────────────────────────────

  _showCtxMenu(cx, cy, items) {
    const menu=document.getElementById('ctx-menu-global'); if(!menu) return
    menu.innerHTML=''
    items.forEach(item=>{
      if(item==='---'){const s=document.createElement('div');s.className='ctx-sep';menu.appendChild(s);return}
      const btn=document.createElement('button'); btn.className='ctx-item'
      if(item.danger) btn.classList.add('ctx-danger')
      btn.innerHTML=`<span>${item.label}</span>${item.kbd?`<span class="ctx-kbd">${item.kbd}</span>`:''}`
      btn.onclick=e=>{e.stopPropagation();this._hideCtxMenu();item.action()}
      menu.appendChild(btn)
    })
    menu.classList.remove('hidden')
    menu.style.cssText=`position:fixed;left:${cx}px;top:${cy}px;z-index:9999;`
    requestAnimationFrame(()=>{
      const r=menu.getBoundingClientRect()
      if(r.right>window.innerWidth)  menu.style.left=(cx-r.width)+'px'
      if(r.bottom>window.innerHeight) menu.style.top=(cy-r.height)+'px'
    })
  },

  _hideCtxMenu() { document.getElementById('ctx-menu-global')?.classList.add('hidden') },

  _canvasCtxMenu(cx, cy) {
    const r=this._area.getBoundingClientRect()
    const wx=(cx-r.left-this._pan.x)/this._zoom, wy=(cy-r.top-this._pan.y)/this._zoom
    this._showCtxMenu(cx, cy, [
      {label:'Yellow note', action:()=>this._addNoteAt('yellow',wx,wy)},
      {label:'Blue note',   action:()=>this._addNoteAt('blue',wx,wy)},
      {label:'Green note',  action:()=>this._addNoteAt('green',wx,wy)},
      {label:'Purple note', action:()=>this._addNoteAt('purple',wx,wy)},
      '---',
      {label:'Add sub-board', action:()=>this._addSubBoardAt(wx,wy)},
      '---',
      {label:'Reset zoom', action:()=>{this._zoom=1;this._pan={x:80,y:80};this._updateTransform()}},
    ])
  },

  _nodeCtxMenu(cx, cy, node) {
    const items=[]
    if(this._selected.size>=2) {
      items.push({label:`Group ${this._selected.size} selected`,kbd:'⌘G',action:()=>this._groupSelected()})
      items.push('---')
    }
    if(node.type==='note'){
      items.push({label:'Duplicate',kbd:'⌘D',action:()=>this._duplicateNode(node)})
      items.push('---')
      ;['yellow','blue','green','purple'].filter(c=>c!==node.color).forEach(c=>
        items.push({label:`Change to ${c}`,action:()=>{node.color=c;this._renderNode(node);this._snapshot();this._persist()}})
      )
      items.push('---')
    }
    if(node.type==='subboard'){items.push({label:'Open board',action:()=>App.openBoard(node.file)});items.push({label:'Duplicate pin',action:()=>this._duplicateNode(node)});items.push('---')}
    if(node.type==='image'){items.push({label:'Duplicate',action:()=>this._duplicateNode(node)});items.push('---')}
    items.push({label:this._locked.has(node.id)?'Unlock position':'Lock position',action:()=>this._toggleLock(node.id)})
    items.push('---')
    items.push({label:'Delete',danger:true,action:()=>{this._removeNode(node.id);this._snapshot();this._persist();this._renderArrows()}})
    this._showCtxMenu(cx, cy, items)
  },

  _addNoteAt(color,wx,wy){const node={id:crypto.randomUUID(),type:'note',color,x:Math.round(wx-110),y:Math.round(wy-80),width:220,height:160,text:''};this._board.nodes.push(node);this._renderNode(node);this._snapshot();this._persist()},
  async _addSubBoardAt(wx,wy){const count=this._board.nodes.filter(n=>n.type==='subboard').length;const b=await Project.newBoard(this._dir,`Board ${count+1}`);const node={id:crypto.randomUUID(),type:'subboard',x:Math.round(wx-80),y:Math.round(wy-70),width:160,file:b.file,name:b.name,cover:null};this._board.nodes.push(node);this._renderNode(node);this._snapshot();this._persist()},
  _duplicateNode(node){const copy={...node,id:crypto.randomUUID(),x:node.x+24,y:node.y+24};this._board.nodes.push(copy);this._renderNode(copy);this._snapshot();this._persist()},
  _toggleLock(id){if(this._locked.has(id))this._locked.delete(id);else this._locked.add(id);document.getElementById(`pin-${id}`)?.classList.toggle('pin-locked',this._locked.has(id))},

  // ── Events ────────────────────────────────────────────────────────────────

  _bindEvents() {
    // Pinch = zoom, trackpad scroll = pan
    this._area.addEventListener('wheel',e=>{
      e.preventDefault()
      if(e.ctrlKey){
        const r=this._area.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top,old=this._zoom
        this._zoom=Math.min(4,Math.max(0.1,this._zoom*(1-e.deltaY*0.008)))
        this._pan.x=px-(px-this._pan.x)*(this._zoom/old); this._pan.y=py-(py-this._pan.y)*(this._zoom/old)
      } else { this._pan.x-=e.deltaX; this._pan.y-=e.deltaY }
      this._updateTransform()
    },{passive:false})

    // Right-click on canvas bg
    this._area.addEventListener('contextmenu',e=>{
      if(e.target===this._area||e.target===this._world){e.preventDefault();this._canvasCtxMenu(e.clientX,e.clientY)}
    })

    // Hide ctx menu
    document.addEventListener('mousedown',e=>{if(!e.target.closest('#ctx-menu-global'))this._hideCtxMenu()},true)

    this._area.addEventListener('mousedown',e=>{
      if(e.button===2) return
      if(e.button===1||(e.button===0&&e.altKey)){this._panning=true;this._lastMouse={x:e.clientX,y:e.clientY};this._area.style.cursor='grabbing';e.preventDefault();return}
      if(e.target!==this._area&&e.target!==this._world) return
      if(this._mode==='connect'&&this._connecting){document.querySelectorAll('.anchor-active').forEach(a=>{a.classList.remove('anchor-active');a.style.opacity='0'});this._connecting=null;return}
      if(this._mode==='select'){
        this._clearSelection()
        const r=this._area.getBoundingClientRect()
        this._marquee={startX:e.clientX-r.left,startY:e.clientY-r.top}
        const mel=document.getElementById('canvas-marquee')
        if(mel){mel.style.cssText=`left:${this._marquee.startX}px;top:${this._marquee.startY}px;width:0;height:0;`;mel.classList.remove('hidden')}
      }
    })

    window.addEventListener('mousemove',e=>{
      if(this._panning){this._pan.x+=e.clientX-this._lastMouse.x;this._pan.y+=e.clientY-this._lastMouse.y;this._lastMouse={x:e.clientX,y:e.clientY};this._updateTransform()}
      if(this._drag){
        const r=this._area.getBoundingClientRect()
        const wx=(e.clientX-r.left-this._pan.x)/this._zoom,wy=(e.clientY-r.top-this._pan.y)/this._zoom
        const node=this._board.nodes.find(n=>n.id===this._drag.id)
        if(node&&!this._locked.has(node.id)){node.x=Math.round(wx-this._drag.offX);node.y=Math.round(wy-this._drag.offY);const el=document.getElementById(`pin-${node.id}`);if(el){el.style.left=node.x+'px';el.style.top=node.y+'px'};this._renderArrows()}
      }
      if(this._resize){
        const dx=e.clientX-this._resize.startX,dy=e.clientY-this._resize.startY
        const node=this._board.nodes.find(n=>n.id===this._resize.id)
        if(node){node.width=Math.max(120,Math.round(this._resize.startW+dx/this._zoom));node.height=Math.max(80,Math.round(this._resize.startH+dy/this._zoom));const el=document.getElementById(`pin-${node.id}`);if(el){el.style.width=node.width+'px';el.style.height=node.height+'px'}}
      }
      if(this._marquee){
        const r=this._area.getBoundingClientRect(),cx=e.clientX-r.left,cy=e.clientY-r.top
        const x=Math.min(cx,this._marquee.startX),y=Math.min(cy,this._marquee.startY),w=Math.abs(cx-this._marquee.startX),h=Math.abs(cy-this._marquee.startY)
        const mel=document.getElementById('canvas-marquee'); if(mel) mel.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;`
        this._board.nodes.forEach(n=>{
          if(n.type==='group') return
          const nx=n.x*this._zoom+this._pan.x,ny=n.y*this._zoom+this._pan.y,nw=(n.width||220)*this._zoom,nh=(n.height||160)*this._zoom
          const hit=nx<x+w&&nx+nw>x&&ny<y+h&&ny+nh>y
          if(hit) this._selectNode(n.id); else {this._selected.delete(n.id);document.getElementById(`pin-${n.id}`)?.classList.remove('pin-selected')}
        })
      }
    })

    window.addEventListener('mouseup',()=>{
      if(this._panning){this._panning=false;this._area.style.cursor='default'}
      if(this._drag||this._resize){this._snapshot();this._persist();this._renderArrows()}
      this._drag=null;this._resize=null
      if(this._marquee){this._marquee=null;document.getElementById('canvas-marquee')?.classList.add('hidden')}
    })

    this._area.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/board-file')||e.dataTransfer.files?.length)e.preventDefault()})
    this._area.addEventListener('drop',e=>{
      const bf=e.dataTransfer.getData('text/board-file')
      if(bf){e.preventDefault();const r=this._area.getBoundingClientRect(),x=Math.round((e.clientX-r.left-this._pan.x)/this._zoom),y=Math.round((e.clientY-r.top-this._pan.y)/this._zoom);const node={id:crypto.randomUUID(),type:'subboard',x:x-80,y:y-70,width:160,file:bf,name:e.dataTransfer.getData('text/board-name'),cover:null};this._board.nodes.push(node);this._renderNode(node);this._snapshot();this._persist();return}
      const file=e.dataTransfer.files?.[0]; if(file?.type.startsWith('image/'))this._onImageDrop(e,file)
    })

    window.addEventListener('keydown',e=>{
      if(!this._world) return
      const active=document.activeElement
      if(active&&(active.tagName==='TEXTAREA'||active.tagName==='INPUT'||active.contentEditable==='true')) return
      const mod=e.metaKey||e.ctrlKey
      if(!mod&&(e.key==='v'||e.key==='V')) this._setMode('select')
      if(!mod&&(e.key==='c'||e.key==='C')) this._setMode('connect')
      if(e.key==='Escape'){this._setMode('select');this._clearSelection()}
      if(mod&&(e.key==='g'||e.key==='G')){e.preventDefault();this._groupSelected()}
      if(mod&&(e.key==='d'||e.key==='D')&&this._selected.size===1){e.preventDefault();const node=this._board.nodes.find(n=>n.id===[...this._selected][0]);if(node)this._duplicateNode(node)}
      if(mod&&e.key==='z'&&!e.shiftKey){e.preventDefault();this._undo()}
      if(mod&&e.key==='z'&&e.shiftKey){e.preventDefault();this._redo()}
      if(mod&&e.key==='y'){e.preventDefault();this._redo()}
      if((e.key==='Delete'||e.key==='Backspace')&&this._selected.size>0){e.preventDefault();this._selected.forEach(id=>this._removeNode(id));this._selected.clear();this._snapshot();this._persist();this._renderArrows()}
    })
  },

  _startDrag(e,node){if(e.button!==0)return;e.stopPropagation();if(this._mode==='connect')return;if(this._locked.has(node.id))return;const r=this._area.getBoundingClientRect();this._drag={id:node.id,offX:(e.clientX-r.left-this._pan.x)/this._zoom-node.x,offY:(e.clientY-r.top-this._pan.y)/this._zoom-node.y};if(!e.shiftKey)this._clearSelection();this._selectNode(node.id)},
  _startResize(e,node){e.stopPropagation();e.preventDefault();this._resize={id:node.id,startX:e.clientX,startY:e.clientY,startW:node.width||220,startH:node.height||160}},
  _selectNode(id){this._selected.add(id);document.getElementById(`pin-${id}`)?.classList.add('pin-selected')},
  _clearSelection(){this._selected.forEach(id=>document.getElementById(`pin-${id}`)?.classList.remove('pin-selected'));this._selected.clear()},
  _removeNode(id){this._board.nodes=this._board.nodes.filter(n=>n.id!==id);if(this._board.arrows)this._board.arrows=this._board.arrows.filter(a=>a.from!==id&&a.to!==id);document.getElementById(`pin-${id}`)?.remove()},

  // ── Anchors ───────────────────────────────────────────────────────────────

  _addAnchors(el,node){
    ;[{cls:'anchor-top',css:'top:-6px;left:50%;transform:translateX(-50%);'},{cls:'anchor-right',css:'top:50%;right:-6px;transform:translateY(-50%);'},{cls:'anchor-bottom',css:'bottom:-6px;left:50%;transform:translateX(-50%);'},{cls:'anchor-left',css:'top:50%;left:-6px;transform:translateY(-50%);'}].forEach(({cls,css})=>{
      const a=document.createElement('div'); a.className=`pin-anchor ${cls}`
      a.style.cssText=`position:absolute;${css}width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid var(--bg2);opacity:0;cursor:crosshair;z-index:20;pointer-events:all;transition:opacity .1s;`
      a.addEventListener('mousedown',e=>{e.stopPropagation();e.preventDefault();if(this._mode!=='connect')this._setMode('connect');this._handleAnchorClick(node.id,a)})
      el.appendChild(a)
    })
    el.addEventListener('mouseenter',()=>el.querySelectorAll('.pin-anchor').forEach(a=>{a.style.opacity='1'}))
    el.addEventListener('mouseleave',()=>el.querySelectorAll('.pin-anchor:not(.anchor-active)').forEach(a=>{a.style.opacity='0'}))
  },

  _handleAnchorClick(nodeId,anchorEl){
    if(!this._connecting){this._connecting=nodeId;anchorEl.classList.add('anchor-active');anchorEl.style.opacity='1'}
    else if(this._connecting!==nodeId){
      if(!this._board.arrows)this._board.arrows=[]
      if(!this._board.arrows.some(a=>a.from===this._connecting&&a.to===nodeId))
        this._board.arrows.push({id:crypto.randomUUID(),from:this._connecting,to:nodeId})
      document.querySelectorAll('.anchor-active').forEach(a=>{a.classList.remove('anchor-active');a.style.opacity='0'})
      this._connecting=null; this._snapshot(); this._persist(); this._renderArrows()
    }
  },

  // ── Transform — single transform on world div ─────────────────────────────

  _updateTransform() {
    this._zoom=Math.min(4,Math.max(0.1,this._zoom))
    // Only transform the world — SVG is viewport-fixed
    this._world.style.transform=`translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})`
    const zm=document.getElementById('canvas-zoom'); if(zm) zm.textContent=`${Math.round(this._zoom*100)}%`
    // Re-render arrows using screen-space coords
    this._renderArrows()
    this._updateMinimap()
  },

  // ── Arrows — viewport-fixed SVG, screen-space coords ─────────────────────
  // This means: no SVG transform, arrows never get clipped, single DOM update

  _worldToScreen(wx, wy) {
    return {
      x: wx * this._zoom + this._pan.x,
      y: wy * this._zoom + this._pan.y,
    }
  },

  _renderArrows() {
    const svg = this._svg; if (!svg) return
    svg.innerHTML = ''
    const arrows = this._board?.arrows || []; if (!arrows.length) return

    // Arrowhead marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs')
    const marker = document.createElementNS('http://www.w3.org/2000/svg','marker')
    marker.setAttribute('id','arr-vp'); marker.setAttribute('markerWidth','8'); marker.setAttribute('markerHeight','6')
    marker.setAttribute('refX','7'); marker.setAttribute('refY','3'); marker.setAttribute('orient','auto')
    const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon')
    poly.setAttribute('points','0 0, 8 3, 0 6'); poly.setAttribute('fill','rgba(201,169,110,0.9)')
    marker.appendChild(poly); defs.appendChild(marker); svg.appendChild(defs)

    arrows.forEach(a => {
      const from = this._board.nodes.find(n=>n.id===a.from)
      const to   = this._board.nodes.find(n=>n.id===a.to)
      if (!from||!to) return

      // Center of each node in world coords
      const fw = from.x + (from.width||220)/2,  fh = from.y + (from.height||160)/2
      const tw = to.x   + (to.width  ||220)/2,  th = to.y   + (to.height ||160)/2

      // Convert to screen space
      const {x:x1,y:y1} = this._worldToScreen(fw, fh)
      const {x:x2,y:y2} = this._worldToScreen(tw, th)

      // Cubic bezier control points
      const cx1=x1+(x2-x1)*0.5, cy1=y1
      const cx2=x1+(x2-x1)*0.5, cy2=y2
      const d=`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`

      const path=document.createElementNS('http://www.w3.org/2000/svg','path')
      path.setAttribute('d',d); path.setAttribute('stroke','rgba(201,169,110,0.75)')
      path.setAttribute('stroke-width','1.5'); path.setAttribute('fill','none')
      path.setAttribute('marker-end','url(#arr-vp)')

      // Wide invisible hit area
      const hit=document.createElementNS('http://www.w3.org/2000/svg','path')
      hit.setAttribute('d',d); hit.setAttribute('stroke','transparent')
      hit.setAttribute('stroke-width','14'); hit.setAttribute('fill','none')
      hit.style.pointerEvents='stroke'; hit.style.cursor='pointer'
      const arrowId=a.id
      hit.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();this._showCtxMenu(e.clientX,e.clientY,[{label:'Delete arrow',danger:true,action:()=>{this._board.arrows=this._board.arrows.filter(x=>x.id!==arrowId);this._persist();this._renderArrows()}}])})
      hit.addEventListener('dblclick',e=>{e.stopPropagation();this._board.arrows=this._board.arrows.filter(x=>x.id!==arrowId);this._persist();this._renderArrows()})

      svg.appendChild(path); svg.appendChild(hit)
    })
  },

  // ── Minimap ───────────────────────────────────────────────────────────────

  _updateMinimap() {
    const mm=document.getElementById('canvas-minimap'); if(!mm||!this._board) return
    const nodes=this._board.nodes; if(!nodes.length){mm.style.display='none';return}
    mm.style.display='block'; const S=0.04; mm.innerHTML=''
    nodes.forEach(n=>{
      const d=document.createElement('div'); d.className='minimap-node'
      d.style.cssText=`left:${n.x*S}px;top:${n.y*S}px;width:${Math.max(4,(n.width||160)*S)}px;height:${Math.max(3,(n.height||100)*S)}px;`
      if(n.type==='note') d.style.background=n.color==='yellow'?'var(--ny-bg)':n.color==='blue'?'var(--nb-bg)':n.color==='green'?'var(--ng-bg)':'var(--np-bg)'
      else if(n.type==='group'){d.style.background='transparent';d.style.border='1px solid rgba(201,169,110,0.3)'}
      mm.appendChild(d)
    })
    const vp=document.createElement('div'); vp.className='minimap-viewport'
    vp.style.cssText=`left:${(-this._pan.x/this._zoom)*S}px;top:${(-this._pan.y/this._zoom)*S}px;width:${(this._area.clientWidth/this._zoom)*S}px;height:${(this._area.clientHeight/this._zoom)*S}px;`
    mm.appendChild(vp)
  },

  // ── Image drop ────────────────────────────────────────────────────────────

  async _onImageDrop(e,file){
    const r=this._area.getBoundingClientRect()
    const x=Math.round((e.clientX-r.left-this._pan.x)/this._zoom),y=Math.round((e.clientY-r.top-this._pan.y)/this._zoom)
    const dest=`${this._dir}/references/${crypto.randomUUID()}-${file.name}`
    await api.fs.copy(file.path,dest)
    const node={id:crypto.randomUUID(),type:'image',x,y,width:240,src:dest}
    this._board.nodes.push(node);this._renderNode(node);this._snapshot();this._persist()
  },

  // ── Load & persist ────────────────────────────────────────────────────────

  async _load(){
    try{this._board=JSON.parse(await api.fs.read(`${this._dir}/boards/${this._file}`))}
    catch{this._board={name:'Board',nodes:[],arrows:[]}}
    if(!this._board.arrows)this._board.arrows=[]
    this._buildToolbar();this._renderAll();this._updateHint();this._snapshot()
  },

  async _persist(){await Project.saveBoard(this._dir,this._file,this._board);Store.patch('git',{dirty:true})},

  _centerPos(){return{x:Math.round((-this._pan.x+this._area.clientWidth/2)/this._zoom),y:Math.round((-this._pan.y+this._area.clientHeight/2)/this._zoom)}},

  _addNote(color){const{x,y}=this._centerPos();const node={id:crypto.randomUUID(),type:'note',color,x:x-110,y:y-80,width:220,height:160,text:''};this._board.nodes.push(node);this._renderNode(node);this._snapshot();this._persist()},
  async _addSubBoard(){const count=this._board.nodes.filter(n=>n.type==='subboard').length;const b=await Project.newBoard(this._dir,`Board ${count+1}`);const{x,y}=this._centerPos();const node={id:crypto.randomUUID(),type:'subboard',x:x-80,y:y-70,width:160,file:b.file,name:b.name,cover:null};this._board.nodes.push(node);this._renderNode(node);this._snapshot();this._persist()},

  // ── GROUP ─────────────────────────────────────────────────────────────────

  _groupSelected() {
    const ids=[...this._selected]
    if(ids.length<2){alert('Select 2 or more pins first (shift+click or drag-select), then group.');return}
    const name=prompt('Group name:','Group'); if(!name) return
    const nodes=ids.map(id=>this._board.nodes.find(n=>n.id===id)).filter(Boolean)
    const PAD=28
    const minX=Math.min(...nodes.map(n=>n.x))-PAD
    const minY=Math.min(...nodes.map(n=>n.y))-PAD-24
    const maxX=Math.max(...nodes.map(n=>n.x+(n.width||220)))+PAD
    const maxY=Math.max(...nodes.map(n=>n.y+(n.height||160)))+PAD
    const group={id:crypto.randomUUID(),type:'group',name,x:minX,y:minY,width:maxX-minX,height:maxY-minY,members:ids}
    const idxs=ids.map(id=>this._board.nodes.findIndex(n=>n.id===id)).filter(i=>i>=0)
    this._board.nodes.splice(Math.min(...idxs),0,group)
    this._clearSelection();this._snapshot();this._persist();this._renderAll()
  },

  // ── Render ────────────────────────────────────────────────────────────────

  _renderAll(){this._world.innerHTML='';this._board.nodes.forEach(n=>this._renderNode(n));this._renderArrows();this._updateMinimap()},
  _renderNode(n){document.getElementById(`pin-${n.id}`)?.remove();let el;if(n.type==='note')el=this._makeNote(n);if(n.type==='image')el=this._makeImage(n);if(n.type==='subboard')el=this._makeSub(n);if(n.type==='group')el=this._makeGroup(n);if(el)this._world.appendChild(el)},

  // ── Pin factories ─────────────────────────────────────────────────────────

  _resizeHandle(node){const h=document.createElement('div');h.className='pin-resize-handle';h.addEventListener('mousedown',e=>{e.stopPropagation();this._startResize(e,node)});return h},
  _delBtn(node){const b=document.createElement('button');b.className='pin-del';b.textContent='×';b.addEventListener('mousedown',e=>e.stopPropagation());b.onclick=()=>{this._removeNode(node.id);this._snapshot();this._persist()};return b},

  _makeNote(n){
    const el=document.createElement('div')
    el.id=`pin-${n.id}`;el.className=`pin pin-note pin-note-${n.color}`
    el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.width||220}px;height:${n.height||160}px;position:absolute;`
    const bar=document.createElement('div');bar.className='pin-bar'
    const lbl=document.createElement('span');lbl.className='pin-label';lbl.textContent='Note'
    bar.appendChild(lbl);bar.appendChild(this._delBtn(n));el.appendChild(bar)
    const ta=document.createElement('textarea');ta.className='pin-note-text';ta.value=n.text||'';ta.placeholder='Type a note…'
    ta.addEventListener('mousedown',e=>e.stopPropagation());ta.addEventListener('input',()=>{n.text=ta.value;this._persist()})
    el.appendChild(ta);el.appendChild(this._resizeHandle(n));this._addAnchors(el,n)
    el.addEventListener('mousedown',e=>this._startDrag(e,n))
    el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!this._selected.has(n.id)){this._clearSelection();this._selectNode(n.id)};this._nodeCtxMenu(e.clientX,e.clientY,n)})
    if(this._locked.has(n.id))el.classList.add('pin-locked');return el
  },

  _makeImage(n){
    const el=document.createElement('div');el.id=`pin-${n.id}`;el.className='pin pin-img'
    el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.width||240}px;position:absolute;`
    const bar=document.createElement('div');bar.className='pin-bar';const lbl=document.createElement('span');lbl.className='pin-label';lbl.style.color='var(--tx2)';lbl.textContent='Image'
    bar.appendChild(lbl);bar.appendChild(this._delBtn(n));el.appendChild(bar)
    const ph=document.createElement('div');ph.style.cssText='height:80px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--tx3);';ph.textContent='Loading…';el.appendChild(ph)
    api.fs.readBin(n.src).then(b=>{const img=document.createElement('img');img.src=`data:image/jpeg;base64,${b}`;img.draggable=false;img.style.cssText='display:block;width:100%;border-radius:0 0 6px 6px;';ph.replaceWith(img)}).catch(()=>{ph.textContent='Not found'})
    this._addAnchors(el,n);el.addEventListener('mousedown',e=>this._startDrag(e,n))
    el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!this._selected.has(n.id)){this._clearSelection();this._selectNode(n.id)};this._nodeCtxMenu(e.clientX,e.clientY,n)})
    return el
  },

  _makeSub(n){
    const el=document.createElement('div');el.id=`pin-${n.id}`;el.className='subboard'
    el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.width||160}px;position:absolute;`
    const cover=document.createElement('div');cover.className='subboard-cover'
    if(n.cover){api.fs.readBin(n.cover).then(b=>{const img=document.createElement('img');img.src=`data:image/jpeg;base64,${b}`;img.draggable=false;cover.innerHTML='';cover.appendChild(img)}).catch(()=>{})}else{cover.textContent='⊞';cover.style.opacity='.3'}
    el.appendChild(cover)
    const foot=document.createElement('div');foot.className='subboard-foot';const nm=document.createElement('span');nm.className='subboard-name';nm.textContent=n.name;foot.appendChild(nm);el.appendChild(foot)
    const acts=document.createElement('div');acts.className='subboard-actions';acts.addEventListener('mousedown',e=>e.stopPropagation())
    const rename=document.createElement('button');rename.className='subboard-act';rename.textContent='✎';rename.onclick=()=>{const v=prompt('Name:',n.name);if(v?.trim()){n.name=v.trim();nm.textContent=n.name;this._persist()}}
    const setCover=document.createElement('button');setCover.className='subboard-act';setCover.textContent='⊡';setCover.onclick=async()=>{const fp=await api.dialog.file([{name:'Images',extensions:['jpg','jpeg','png','webp','gif']}]);if(!fp)return;const dest=`${this._dir}/references/cover-${crypto.randomUUID()}-${fp.split('/').pop()}`;await api.fs.copy(fp,dest);n.cover=dest;api.fs.readBin(dest).then(b=>{const img=document.createElement('img');img.src=`data:image/jpeg;base64,${b}`;img.draggable=false;cover.innerHTML='';cover.appendChild(img)}).catch(()=>{});this._persist()}
    const del=document.createElement('button');del.className='subboard-act';del.style.color='var(--err)';del.textContent='×';del.onclick=()=>{this._removeNode(n.id);this._persist()}
    acts.appendChild(rename);acts.appendChild(setCover);acts.appendChild(del);el.appendChild(acts)
    const hint=document.createElement('div');hint.className='subboard-hint';hint.textContent='Double-click to open';el.appendChild(hint)
    el.addEventListener('dblclick',e=>{e.stopPropagation();App.openBoard(n.file)})
    this._addAnchors(el,n);el.addEventListener('mousedown',e=>this._startDrag(e,n))
    el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!this._selected.has(n.id)){this._clearSelection();this._selectNode(n.id)};this._nodeCtxMenu(e.clientX,e.clientY,n)})
    return el
  },

  // GROUP: renders as a visible box BEHIND other pins
  _makeGroup(n){
    const el=document.createElement('div')
    el.id=`pin-${n.id}`; el.className='canvas-group'
    // Explicit pixel dimensions — this is the bounding box
    el.style.cssText=`
      position:absolute;
      left:${n.x}px;
      top:${n.y}px;
      width:${n.width}px;
      height:${n.height}px;
      border:2px solid rgba(201,169,110,0.4);
      border-radius:14px;
      background:rgba(201,169,110,0.04);
      box-sizing:border-box;
      cursor:move;
      user-select:none;
    `
    // Label in top-left corner of the box
    const label=document.createElement('div')
    label.style.cssText='position:absolute;top:8px;left:14px;font-size:11px;font-weight:500;color:rgba(201,169,110,0.7);letter-spacing:.06em;text-transform:uppercase;pointer-events:none;'
    label.textContent=n.name; el.appendChild(label)

    // Rename on double-click
    el.addEventListener('dblclick',e=>{
      e.stopPropagation()
      const v=prompt('Group name:',n.name); if(v?.trim()){n.name=v.trim();label.textContent=n.name;this._persist()}
    })

    // Delete button top-right
    const del=document.createElement('button')
    del.style.cssText='position:absolute;top:4px;right:8px;background:transparent;border:none;color:rgba(201,169,110,0.4);font-size:14px;cursor:pointer;line-height:1;'
    del.textContent='×'
    del.addEventListener('mousedown',e=>e.stopPropagation())
    del.onclick=()=>{this._removeNode(n.id);this._persist()}
    el.appendChild(del)

    // Resize handle
    el.appendChild(this._resizeHandle(n))
    el.addEventListener('mousedown',e=>this._startDrag(e,n))
    return el
  },
}
