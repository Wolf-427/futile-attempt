const App = {
  _project: null,

  async init() {
    // Only re-render when navigation-relevant keys change
    Store.sub(['activeId', 'view', 'sidebar', 'boardFile', 'boardStack'], (data, key) => {
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

  renderWelcome(root) {
    root.innerHTML = `
      <div class="welcome">
        <div class="welcome-drag"></div>
        <div class="welcome-center">
          <div class="welcome-title">Scriptum</div>
          <p class="welcome-sub">A place for writing that thinks</p>
          <div id="welcome-main"></div>
          <div id="welcome-err" class="welcome-err"></div>
          <div id="welcome-recent"></div>
        </div>
      </div>
    `
    this.renderWelcomeMain()
    this.renderRecent()
  },

  renderWelcomeMain(creating = false) {
    const el = document.getElementById('welcome-main')
    if (!creating) {
      el.innerHTML = `<div class="welcome-actions"><button class="btn btn-primary" id="btn-new">New project</button><button class="btn" id="btn-open">Open project</button></div>`
      document.getElementById('btn-new').onclick = () => this.renderWelcomeMain(true)
      document.getElementById('btn-open').onclick = () => this.openProject()
    } else {
      el.innerHTML = `
        <div class="welcome-form">
          <input class="welcome-input" id="project-name" placeholder="Project name…"/>
          <div class="welcome-form-row">
            <button class="btn" id="btn-cancel">Cancel</button>
            <button class="btn btn-primary" id="btn-create">Choose folder →</button>
          </div>
        </div>
      `
      document.getElementById('project-name').focus()
      document.getElementById('project-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') this.createProject()
        if (e.key === 'Escape') this.renderWelcomeMain()
      })
      document.getElementById('btn-cancel').onclick = () => this.renderWelcomeMain()
      document.getElementById('btn-create').onclick = () => this.createProject()
    }
  },

  renderRecent() {
    const el = document.getElementById('welcome-recent')
    const projects = Store.get('projects')
    if (!projects.length) return
    el.innerHTML = `
      <div class="welcome-recent">
        <div class="welcome-recent-label">Recent</div>
        ${[...projects].reverse().slice(0, 5).map(p => `
          <button class="welcome-recent-item" data-id="${p.id}">
            <span class="welcome-recent-name">${p.name}</span>
            <span class="welcome-recent-path">${p.dir}</span>
          </button>
        `).join('')}
      </div>
    `
    el.querySelectorAll('.welcome-recent-item').forEach(btn => {
      btn.onclick = () => Store.set('activeId', btn.dataset.id)
    })
  },

  async createProject() {
    const name = document.getElementById('project-name')?.value?.trim()
    if (!name) return
    try {
      const folder = await api.dialog.folder(); if (!folder) return
      const p = await Project.create(name, folder)
      const projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir }]
      // Set without triggering listener yet
      Store._data.projects = projects
      Store.save()
      Store.set('activeId', p.id)
    } catch (e) {
      const err = document.getElementById('welcome-err')
      if (err) err.textContent = e.message
    }
  },

  async openProject() {
    try {
      const folder = await api.dialog.folder(); if (!folder) return
      const p = await Project.open(folder)
      const existing = Store.get('projects').find(x => x.dir === folder)
      if (existing) { Store.set('activeId', existing.id); return }
      const projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir }]
      Store._data.projects = projects
      Store.save()
      Store.set('activeId', p.id)
    } catch (e) { alert(e.message) }
  },

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
            <span class="git-branch" id="git-branch">⎇ ${s.git.branch}</span>
            <span class="git-dot ${s.git.dirty ? 'dirty' : 'clean'}" id="git-dot" title="${s.git.dirty ? 'Unsaved changes' : 'All saved'}"></span>
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
        // Don't re-render if already on this view
        if (Store.get('view') !== btn.dataset.view) Store.set('view', btn.dataset.view)
      })
    })

    document.getElementById('toggle-sidebar').addEventListener('click', () => {
      Store.set('sidebar', !Store.get('sidebar'))
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
        // Update docPath without full re-render — just switch view
        Store._data.docPath = p
        Store.save()
        Store.set('view', 'editor')
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
    masterBtn.onclick = () => { this.openBoard('master.json', false) }
    boardsSection.appendChild(masterBtn); container.appendChild(boardsSection)

    const footer = document.createElement('div'); footer.className = 'sidebar-footer'
    const pathBtn = document.createElement('button'); pathBtn.className = 'sidebar-path'
    pathBtn.innerHTML = `⌂ <span>${project.dir.split('/').pop()}</span>`
    pathBtn.onclick = () => api.shell.open(project.dir)
    footer.appendChild(pathBtn); container.appendChild(footer)

    Project.readDocs(project.dir).then(docs => {
      if (!docs.length) {
        const e = document.createElement('span'); e.className = 'sidebar-empty'; e.textContent = 'No documents yet'
        docTree.appendChild(e); return
      }
      docs.forEach(n => this._docNode(n, docTree, s.docPath))
    })

    Project.readBoards(project.dir).then(boards => {
      boards.filter(b => !b.isMaster).forEach(b => {
        const btn = document.createElement('button')
        btn.className = 'sidebar-row' + (s.view === 'board' && s.boardFile === b.file ? ' board-active' : '')
        btn.innerHTML = `⊞ <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.name}</span><span class="board-count">${(b.nodes || []).length}</span>`
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
        // Load doc without full re-render if already in editor view
        Store._data.docPath = node.path
        Store.save()
        if (Store.get('view') === 'editor') {
          Editor.loadDoc(node.path)
          // Update active state in sidebar
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
    if (!docPath) {
      container.innerHTML = '<div class="editor-empty">Select a document from the sidebar</div>'
      return
    }
    Editor.mount(container)
    Editor.loadDoc(docPath)
  },

  renderBoard(container, project) {
    container.innerHTML = ''
    Canvas.mount(container, project.dir, Store.get('boardFile'))
  },

  openBoard(file, push = true) {
    if (push) {
      const stack = Store.get('boardStack')
      Store._data.boardStack = [...stack, Store.get('boardFile')]
    }
    Store._data.boardFile = file
    Store.save()
    Store.set('view', 'board')
  }
}

App.init()
