const App = {

  init() {
    Store.sub(['activeId', 'view', 'sidebar', 'boardFile', 'boardStack'], () => {
      this.render()
    })
    this.render()
  },

  render() {
    const s = Store.get()
    const root = document.getElementById('app')
    if (!s.activeId || !Store.project) { this.renderSplash(root); return }
    this.renderWorkspace(root, Store.project)
  },

  // ── Splash ──────────────────────────────────────────────────────────────────

  async renderSplash(root) {
    const projects = Store.get('projects')
    const version = await api.app.version().catch(() => '0.2.2-alpha')

    // Load cover images for recent projects
    const covers = {}
    for (const p of projects) {
      try {
        const meta = await api.store.get(`project-cover-${p.id}`)
        if (meta) covers[p.id] = meta
      } catch {}
    }

    root.innerHTML = `
      <div class="splash">
        <div class="splash-drag"></div>

        <div class="splash-top">
          <div class="splash-brand">
            <div class="splash-mark">S</div>
            <div>
              <div class="splash-name">Scriptum</div>
              <div class="splash-ver">v${version}</div>
            </div>
          </div>
          <div class="splash-btns">
            <button class="splash-btn primary" id="btn-new">New project</button>
            <button class="splash-btn" id="btn-open">Open project</button>
          </div>
        </div>

        <div id="splash-form" class="splash-form hidden">
          <input class="splash-input" id="project-name" placeholder="Project name…" autocomplete="off"/>
          <button class="splash-btn primary" id="btn-create">Choose folder →</button>
          <button class="splash-btn" id="btn-cancel">Cancel</button>
          <div id="splash-err" class="splash-err"></div>
        </div>

        <div class="splash-recent-wrap">
          <div class="splash-recent-label">Recent</div>
          ${projects.length === 0
            ? `<div class="splash-empty">No recent projects</div>`
            : `<div class="splash-cards">
                ${[...projects].reverse().map(p => {
                  const cover = covers[p.id]
                  return `
                    <div class="splash-card" data-id="${p.id}">
                      <div class="splash-card-cover" data-id="${p.id}">
                        ${cover
                          ? `<img src="${cover}" class="splash-card-img" draggable="false"/>`
                          : `<div class="splash-card-placeholder"><span>S</span></div>`
                        }
                        <button class="splash-card-cover-btn" data-id="${p.id}" title="Set cover image">⊡</button>
                      </div>
                      <div class="splash-card-footer">
                        <div class="splash-card-name">${p.name}</div>
                        <div class="splash-card-path">${p.dir.split('/').slice(-2).join('/')}</div>
                      </div>
                    </div>
                  `
                }).join('')}
              </div>`
          }
        </div>
      </div>
    `

    // Bind actions
    document.getElementById('btn-new').onclick = () => this._showNewForm()
    document.getElementById('btn-open').onclick = () => this.openProject()

    // Open project cards
    document.querySelectorAll('.splash-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.splash-card-cover-btn')) return
        Store.set('activeId', card.dataset.id)
      })
    })

    // Cover image buttons
    document.querySelectorAll('.splash-card-cover-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const id = btn.dataset.id
        const fp = await api.dialog.file([{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] }])
        if (!fp) return
        // Read as base64 and store
        const b64 = await api.fs.readBin(fp)
        const src = `data:image/jpeg;base64,${b64}`
        await api.store.set(`project-cover-${id}`, src)
        // Update UI immediately
        const coverEl = document.querySelector(`.splash-card-cover[data-id="${id}"]`)
        if (coverEl) {
          coverEl.querySelector('.splash-card-placeholder,.splash-card-img')?.remove()
          const img = document.createElement('img')
          img.src = src; img.className = 'splash-card-img'; img.draggable = false
          coverEl.prepend(img)
        }
      })
    })
  },

  _showNewForm() {
    const form = document.getElementById('splash-form')
    form.classList.remove('hidden')
    document.getElementById('project-name').focus()
    document.getElementById('btn-new').disabled = true
    document.getElementById('btn-open').disabled = true
    document.getElementById('btn-cancel').onclick = () => {
      form.classList.add('hidden')
      document.getElementById('project-name').value = ''
      document.getElementById('btn-new').disabled = false
      document.getElementById('btn-open').disabled = false
    }
    document.getElementById('btn-create').onclick = () => this.createProject()
    document.getElementById('project-name').onkeydown = e => {
      if (e.key === 'Enter') this.createProject()
      if (e.key === 'Escape') document.getElementById('btn-cancel').click()
    }
  },

  async createProject() {
    const name = document.getElementById('project-name')?.value?.trim()
    if (!name) return
    const btn = document.getElementById('btn-create')
    btn.textContent = 'Creating…'; btn.disabled = true
    try {
      const folder = await api.dialog.folder()
      if (!folder) { btn.textContent = 'Choose folder →'; btn.disabled = false; return }
      const p = await Project.create(name, folder)
      Store._data.projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir }]
      Store.save()
      Store.set('activeId', p.id)
    } catch (e) {
      const err = document.getElementById('splash-err')
      if (err) err.textContent = e.message
      btn.textContent = 'Choose folder →'; btn.disabled = false
    }
  },

  async openProject() {
    try {
      const folder = await api.dialog.folder()
      if (!folder) return
      const p = await Project.open(folder)
      const existing = Store.get('projects').find(x => x.dir === folder)
      if (existing) { Store.set('activeId', existing.id); return }
      Store._data.projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir }]
      Store.save()
      Store.set('activeId', p.id)
    } catch (e) { alert(e.message) }
  },

  // ── Workspace ────────────────────────────────────────────────────────────────

  renderWorkspace(root, project) {
    const s = Store.get()
    root.innerHTML = `
      <div class="workspace">
        <div class="titlebar">
          <div class="titlebar-lights"></div>
          <button class="titlebar-btn" id="toggle-sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/>
              <line x1="5" y1="3" x2="5" y2="13" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
          <span class="project-name">${project.name}</span>
          <div class="nav-group">
            <button class="nav-btn ${s.view==='editor'   ?'active':''}" data-view="editor">Editor</button>
            <button class="nav-btn ${s.view==='board'    ?'active':''}" data-view="board">Canvas</button>
            <button class="nav-btn ${s.view==='settings' ?'active':''}" data-view="settings">Settings</button>
          </div>
          <div class="spacer"></div>
          <div class="git-area">
            <span class="git-branch">⎇ ${s.git.branch}</span>
            <span class="git-dot ${s.git.dirty?'dirty':'clean'}" title="${s.git.dirty?'Unsaved':'All saved'}"></span>
            <button class="titlebar-close-project" id="close-project">Close project</button>
          </div>
        </div>
        <div class="body">
          <div id="sidebar-container" ${!s.sidebar||s.view==='settings'?'class="hidden"':''}></div>
          <main class="main" id="main-content"></main>
        </div>
      </div>
    `

    root.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (Store.get('view') !== btn.dataset.view) Store.set('view', btn.dataset.view)
      })
    })
    document.getElementById('toggle-sidebar').addEventListener('click', () => Store.set('sidebar', !Store.get('sidebar')))
    document.getElementById('close-project').addEventListener('click', () => {
      Store._data.activeId = null; Store._data.docPath = null; Store._data.boardStack = []
      Store.save(); Store._notify('activeId')
    })

    if (s.sidebar && s.view !== 'settings') this.renderSidebar(project)
    const main = document.getElementById('main-content')
    if (s.view === 'editor')   this.renderEditor(main, project)
    if (s.view === 'board')    this.renderBoard(main, project)
    if (s.view === 'settings') Settings.mount(main, project)
  },

  renderSidebar(project) {
    const s = Store.get()
    const container = document.getElementById('sidebar-container')
    container.className = 'sidebar'; container.innerHTML = ''

    const docsSection = document.createElement('div'); docsSection.className = 'sidebar-section'
    const docsHdr = document.createElement('div'); docsHdr.className = 'sidebar-header'
    const docsLbl = document.createElement('span'); docsLbl.className = 'sidebar-label'; docsLbl.textContent = 'Documents'
    const addDocBtn = document.createElement('button'); addDocBtn.className = 'sidebar-add'; addDocBtn.textContent = '+'
    let addingDoc = false
    addDocBtn.onclick = () => {
      if (addingDoc) return; addingDoc = true
      const inp = document.createElement('input'); inp.className = 'sidebar-new-input'; inp.placeholder = 'Name…'
      docsSection.insertBefore(inp, docTree); inp.focus()
      const finish = async () => {
        const name = inp.value.trim(); inp.remove(); addingDoc = false
        if (!name) return
        const p = `${project.dir}/documents/${name}.md`
        await api.fs.write(p, `# ${name}\n\n`)
        Store._data.docPath = p; Store.save(); Store.set('view', 'editor')
      }
      inp.addEventListener('keydown', e => { if (e.key==='Enter') finish(); if (e.key==='Escape') { inp.remove(); addingDoc=false } })
      inp.addEventListener('blur', () => { if (addingDoc) { inp.remove(); addingDoc=false } })
    }
    docsHdr.appendChild(docsLbl); docsHdr.appendChild(addDocBtn); docsSection.appendChild(docsHdr)
    const docTree = document.createElement('div'); docsSection.appendChild(docTree)
    container.appendChild(docsSection)

    const boardsSection = document.createElement('div'); boardsSection.className = 'sidebar-section'
    const boardsHdr = document.createElement('div'); boardsHdr.className = 'sidebar-header'
    const boardsLbl = document.createElement('span'); boardsLbl.className = 'sidebar-label'; boardsLbl.textContent = 'Canvas boards'
    const addBoardBtn = document.createElement('button'); addBoardBtn.className = 'sidebar-add'; addBoardBtn.textContent = '+'
    addBoardBtn.onclick = async () => {
      const boards = await Project.readBoards(project.dir)
      const b = await Project.newBoard(project.dir, `Board ${boards.filter(x=>!x.isMaster).length+1}`)
      this.openBoard(b.file)
    }
    boardsHdr.appendChild(boardsLbl); boardsHdr.appendChild(addBoardBtn); boardsSection.appendChild(boardsHdr)
    const masterBtn = document.createElement('button')
    masterBtn.className = 'sidebar-row'+(s.view==='board'&&s.boardFile==='master.json'?' board-active':'')
    masterBtn.textContent = '◎ Master board'
    masterBtn.onclick = () => this.openBoard('master.json', false)
    boardsSection.appendChild(masterBtn); container.appendChild(boardsSection)

    const footer = document.createElement('div'); footer.className = 'sidebar-footer'
    const pathBtn = document.createElement('button'); pathBtn.className = 'sidebar-path'
    pathBtn.innerHTML = `⌂ <span>${project.dir.split('/').pop()}</span>`
    pathBtn.onclick = () => api.shell.open(project.dir)
    footer.appendChild(pathBtn); container.appendChild(footer)

    Project.readDocs(project.dir).then(docs => {
      if (!docs.length) { const e=document.createElement('span'); e.className='sidebar-empty'; e.textContent='No documents yet'; docTree.appendChild(e); return }
      docs.forEach(n => this._docNode(n, docTree, s.docPath))
    })
    Project.readBoards(project.dir).then(boards => {
      boards.filter(b=>!b.isMaster).forEach(b => {
        const btn = document.createElement('button')
        btn.className = 'sidebar-row'+(s.view==='board'&&s.boardFile===b.file?' board-active':'')
        btn.innerHTML = `⊞ <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.name}</span><span class="board-count">${(b.nodes||[]).length}</span>`
        btn.onclick = () => this.openBoard(b.file, false)
        boardsSection.appendChild(btn)
      })
    })
  },

  _docNode(node, container, activePath) {
    const btn = document.createElement('button')
    if (node.type === 'file') {
      btn.className = 'sidebar-row'+(activePath===node.path?' active':'')
      btn.textContent = `📄 ${node.name}`
      btn.onclick = () => {
        Store._data.docPath = node.path; Store.save()
        if (Store.get('view')==='editor') {
          Editor.loadDoc(node.path)
          document.querySelectorAll('.sidebar-row.active').forEach(el=>el.classList.remove('active'))
          btn.classList.add('active')
        } else { Store.set('view','editor') }
      }
      container.appendChild(btn)
    } else {
      btn.className = 'sidebar-row'; btn.textContent = `▾ 📁 ${node.name}`
      container.appendChild(btn)
      const sub = document.createElement('div'); sub.style.paddingLeft='14px'
      node.children.forEach(c => this._docNode(c, sub, activePath))
      container.appendChild(sub)
      btn.onclick = () => sub.classList.toggle('hidden')
    }
  },

  renderEditor(container, project) {
    const docPath = Store.get('docPath')
    if (!docPath) { container.innerHTML='<div class="editor-empty">Select a document from the sidebar</div>'; return }
    Editor.mount(container); Editor.loadDoc(docPath)
  },

  renderBoard(container, project) {
    container.innerHTML = ''
    Canvas.mount(container, project.dir, Store.get('boardFile'))
  },

  openBoard(file, push=true) {
    if (push) { Store._data.boardStack = [...Store.get('boardStack'), Store.get('boardFile')] }
    Store._data.boardFile = file; Store.save(); Store.set('view','board')
  }
}

App.init()
