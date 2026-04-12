const App = {
  _project: null,

  init() {
    Store.sub(['activeId', 'view', 'sidebar', 'boardFile', 'boardStack'], () => {
      this.render()
    })
    this.render()
  },

  render() {
    const s = Store.get()
    const root = document.getElementById('app')
    if (!s.activeId || !Store.project) { this.renderWelcome(root); return }
    this._project = Store.project
    this.renderWorkspace(root, this._project)
  },

  // ── Welcome / Splash ────────────────────────────────────────────────────────

  renderWelcome(root) {
    const projects = Store.get('projects')
    root.innerHTML = `
      <div class="splash">
        <div class="splash-drag"></div>
        <div class="splash-body">

          <div class="splash-left">
            <div class="splash-logo">
              <div class="splash-logo-mark">S</div>
              <div class="splash-logo-text">Scriptum</div>
            </div>
            <p class="splash-version">Version ${window._appVersion || '0.2.0'}</p>
            <div class="splash-actions">
              <button class="splash-action-btn" id="btn-new">
                <span class="splash-action-icon">✦</span>
                <span class="splash-action-label">New project</span>
                <span class="splash-action-hint">Start from scratch</span>
              </button>
              <button class="splash-action-btn" id="btn-open">
                <span class="splash-action-icon">⌂</span>
                <span class="splash-action-label">Open project</span>
                <span class="splash-action-hint">Browse for a folder</span>
              </button>
            </div>
            <div id="splash-err" class="splash-err"></div>
            <div id="splash-form" class="splash-form hidden">
              <input class="splash-input" id="project-name" placeholder="Project name…" autocomplete="off"/>
              <div class="splash-form-row">
                <button class="splash-cancel" id="btn-cancel">Cancel</button>
                <button class="splash-confirm" id="btn-create">Choose location →</button>
              </div>
            </div>
          </div>

          <div class="splash-right">
            <div class="splash-recent-header">Recent projects</div>
            ${projects.length === 0
              ? `<div class="splash-no-recent">No recent projects yet</div>`
              : [...projects].reverse().map(p => `
                  <button class="splash-recent-item" data-id="${p.id}" data-dir="${p.dir}">
                    <div class="splash-recent-icon">📁</div>
                    <div class="splash-recent-info">
                      <div class="splash-recent-name">${p.name}</div>
                      <div class="splash-recent-path">${p.dir}</div>
                    </div>
                    <div class="splash-recent-arrow">›</div>
                  </button>
                `).join('')
            }
          </div>

        </div>
      </div>
    `

    // Bind
    document.getElementById('btn-new').onclick = () => this._showNewForm()
    document.getElementById('btn-open').onclick = () => this.openProject()
    document.querySelectorAll('.splash-recent-item').forEach(btn => {
      btn.onclick = () => Store.set('activeId', btn.dataset.id)
    })

    // Load version
    api.app.version().then(v => {
      window._appVersion = v
      const el = document.querySelector('.splash-version')
      if (el) el.textContent = `Version ${v}`
    }).catch(() => {})
  },

  _showNewForm() {
    document.getElementById('splash-form').classList.remove('hidden')
    document.getElementById('project-name').focus()
    document.getElementById('btn-new').style.opacity = '0.4'
    document.getElementById('btn-open').style.opacity = '0.4'
    document.getElementById('btn-cancel').onclick = () => {
      document.getElementById('splash-form').classList.add('hidden')
      document.getElementById('project-name').value = ''
      document.getElementById('btn-new').style.opacity = ''
      document.getElementById('btn-open').style.opacity = ''
    }
    document.getElementById('btn-create').onclick = () => this.createProject()
    document.getElementById('project-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.createProject()
      if (e.key === 'Escape') document.getElementById('btn-cancel').click()
    })
  },

  async createProject() {
    const name = document.getElementById('project-name')?.value?.trim()
    if (!name) return
    const btn = document.getElementById('btn-create')
    btn.textContent = 'Creating…'; btn.disabled = true
    try {
      const folder = await api.dialog.folder()
      if (!folder) { btn.textContent = 'Choose location →'; btn.disabled = false; return }
      const p = await Project.create(name, folder)
      Store._data.projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir }]
      Store.save()
      Store.set('activeId', p.id)
    } catch (e) {
      const err = document.getElementById('splash-err')
      if (err) err.textContent = e.message
      btn.textContent = 'Choose location →'; btn.disabled = false
    }
  },

  async openProject() {
    const btn = document.getElementById('btn-open')
    btn.style.opacity = '0.4'
    try {
      const folder = await api.dialog.folder()
      if (!folder) { btn.style.opacity = ''; return }
      const p = await Project.open(folder)
      const existing = Store.get('projects').find(x => x.dir === folder)
      if (existing) { Store.set('activeId', existing.id); return }
      Store._data.projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir }]
      Store.save()
      Store.set('activeId', p.id)
    } catch (e) {
      alert(e.message)
      btn.style.opacity = ''
    }
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
            <button class="nav-btn ${s.view === 'editor'   ? 'active' : ''}" data-view="editor">Editor</button>
            <button class="nav-btn ${s.view === 'board'    ? 'active' : ''}" data-view="board">Canvas</button>
            <button class="nav-btn ${s.view === 'settings' ? 'active' : ''}" data-view="settings">Settings</button>
          </div>
          <div class="spacer"></div>
          <div class="git-area">
            <span class="git-branch">⎇ ${s.git.branch}</span>
            <span class="git-dot ${s.git.dirty ? 'dirty' : 'clean'}" title="${s.git.dirty ? 'Unsaved changes' : 'All saved'}"></span>
            <button class="titlebar-close-project" id="close-project" title="Close project">Close project</button>
          </div>
        </div>
        <div class="body">
          <div id="sidebar-container" ${!s.sidebar || s.view === 'settings' ? 'class="hidden"' : ''}></div>
          <main class="main" id="main-content"></main>
        </div>
      </div>
    `

    root.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (Store.get('view') !== btn.dataset.view) Store.set('view', btn.dataset.view)
      })
    })
    document.getElementById('toggle-sidebar').addEventListener('click', () => {
      Store.set('sidebar', !Store.get('sidebar'))
    })
    document.getElementById('close-project').addEventListener('click', () => {
      Store._data.activeId = null
      Store._data.docPath = null
      Store._data.boardStack = []
      Store.save()
      Store._notify('activeId')
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
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { inp.remove(); addingDoc = false } })
      inp.addEventListener('blur', () => { if (addingDoc) { inp.remove(); addingDoc = false } })
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
      const b = await Project.newBoard(project.dir, `Board ${boards.filter(x => !x.isMaster).length + 1}`)
      this.openBoard(b.file)
    }
    boardsHdr.appendChild(boardsLbl); boardsHdr.appendChild(addBoardBtn); boardsSection.appendChild(boardsHdr)
    const masterBtn = document.createElement('button')
    masterBtn.className = 'sidebar-row' + (s.view === 'board' && s.boardFile === 'master.json' ? ' board-active' : '')
    masterBtn.textContent = '◎ Master board'
    masterBtn.onclick = () => this.openBoard('master.json', false)
    boardsSection.appendChild(masterBtn); container.appendChild(boardsSection)

    const footer = document.createElement('div'); footer.className = 'sidebar-footer'
    const pathBtn = document.createElement('button'); pathBtn.className = 'sidebar-path'
    pathBtn.innerHTML = `⌂ <span>${project.dir.split('/').pop()}</span>`
    pathBtn.onclick = () => api.shell.open(project.dir)
    footer.appendChild(pathBtn); container.appendChild(footer)

    Project.readDocs(project.dir).then(docs => {
      if (!docs.length) { const e = document.createElement('span'); e.className = 'sidebar-empty'; e.textContent = 'No documents yet'; docTree.appendChild(e); return }
      docs.forEach(n => this._docNode(n, docTree, s.docPath))
    })
    Project.readBoards(project.dir).then(boards => {
      boards.filter(b => !b.isMaster).forEach(b => {
        const btn = document.createElement('button')
        btn.className = 'sidebar-row' + (s.view === 'board' && s.boardFile === b.file ? ' board-active' : '')
        btn.innerHTML = `⊞ <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.name}</span><span class="board-count">${(b.nodes||[]).length}</span>`
        btn.onclick = () => this.openBoard(b.file, false)
        boardsSection.appendChild(btn)
      })
    })
  },

  _docNode(node, container, activePath) {
    const btn = document.createElement('button')
    if (node.type === 'file') {
      btn.className = 'sidebar-row' + (activePath === node.path ? ' active' : '')
      btn.textContent = `📄 ${node.name}`
      btn.onclick = () => {
        Store._data.docPath = node.path; Store.save()
        if (Store.get('view') === 'editor') {
          Editor.loadDoc(node.path)
          document.querySelectorAll('.sidebar-row.active').forEach(el => el.classList.remove('active'))
          btn.classList.add('active')
        } else {
          Store.set('view', 'editor')
        }
      }
      container.appendChild(btn)
    } else {
      btn.className = 'sidebar-row'; btn.textContent = `▾ 📁 ${node.name}`
      container.appendChild(btn)
      const sub = document.createElement('div'); sub.style.paddingLeft = '14px'
      node.children.forEach(c => this._docNode(c, sub, activePath))
      container.appendChild(sub)
      btn.onclick = () => sub.classList.toggle('hidden')
    }
  },

  renderEditor(container, project) {
    const docPath = Store.get('docPath')
    if (!docPath) { container.innerHTML = '<div class="editor-empty">Select a document from the sidebar</div>'; return }
    Editor.mount(container); Editor.loadDoc(docPath)
  },

  renderBoard(container, project) {
    container.innerHTML = ''
    Canvas.mount(container, project.dir, Store.get('boardFile'))
  },

  openBoard(file, push = true) {
    if (push) { Store._data.boardStack = [...Store.get('boardStack'), Store.get('boardFile')] }
    Store._data.boardFile = file; Store.save(); Store.set('view', 'board')
  }
}

App.init()
