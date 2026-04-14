const App = {

  async init() {
    const start = Date.now()
    // Ensure the last active project still exists on disk before rendering
    await Store.verifyProject()

    Store.sub(['activeId', 'view', 'sidebar', 'boardFile', 'boardStack', 'docPath', 'theme', 'paperTheme'], () => {
      this._applyTheme()
      this.render()
    })

    this._bindGlobalKeys()
    this._applyTheme()
    this.render()

    // Dismiss the loading screen overlay defined in index.html/app.css
    const ls = document.getElementById('ls')
    if (ls) {
      // Ensure at least 1000ms has passed since startup to show the animation
      const wait = Math.max(0, 1000 - (Date.now() - start))
      setTimeout(() => {
        ls.classList.add('ls-out')
        // Remove from DOM after the opacity transition (0.45s) finishes
        setTimeout(() => ls.remove(), 500)
      }, wait)
    }
  },

  _applyTheme() {
    document.body.classList.toggle('light-mode', Store.get('theme') === 'light')
  },

  _bindGlobalKeys() {
    document.addEventListener('keydown', async e => {
      if (!e.metaKey && !e.ctrlKey) return
      if (e.key === 'n') { e.preventDefault(); this._handleNewProject() }
      if (e.key === 'o') { e.preventDefault(); this.openProject() }
    })
  },

  _handleNewProject() {
    const s = Store.get()
    if (!s.activeId) {
      // On splash — show new form
      this._showNewForm()
    }
    // Inside workspace — could add new doc here in future
  },

  render() {
    const s = Store.get()
    const root = document.getElementById('app')
    const isSplashSettings = !s.activeId && s.view === 'settings'
    if (!s.activeId || !Store.project || isSplashSettings) { this.renderSplash(root); return }
    this.renderWorkspace(root, Store.project)
  },

  // ── Splash ──────────────────────────────────────────────────────────────────

  async renderSplash(root) {
    const projects = Store.get('projects')
    const version = await api.app.version().catch(() => '0.3.0-alpha')
    const view = Store.get('view')
    const isSettings = view === 'settings'

    root.innerHTML = `
      <div class="splash">
        <div class="splash-drag"></div>
        <div class="splash-layout">

          <div class="splash-sidebar">
            <div class="splash-logo" style="cursor:pointer" id="splash-logo">
              <div class="splash-mark">S</div>
              <div class="splash-wordmark">Scriptum</div>
            </div>
            <div class="splash-ver">v${version}</div>
            <div class="splash-divider"></div>
            <button class="splash-side-btn primary" id="btn-new">
              <span class="splash-side-icon">+</span>
              New project
              <span class="splash-side-kbd">⌘N</span>
            </button>
            <button class="splash-side-btn" id="btn-open">
              <span class="splash-side-icon">⌂</span>
              Open project
              <span class="splash-side-kbd">⌘O</span>
            </button>
            <div class="splash-divider" style="margin-top:auto"></div>
            <button class="splash-side-btn ${isSettings ? 'active-nav' : ''}" id="btn-settings">
              <span class="splash-side-icon">⚙</span>
              Settings
            </button>
            <div id="splash-form" class="splash-form hidden">
              <input class="splash-input" id="project-name" placeholder="Project name…" autocomplete="off"/>
              <div class="splash-form-row">
                <button class="splash-form-cancel" id="btn-cancel">Cancel</button>
                <button class="splash-form-confirm" id="btn-create">Choose folder →</button>
              </div>
              <div id="splash-err" class="splash-err"></div>
            </div>
          </div>

          <div class="splash-main">
            <div id="splash-settings-panel" class="${isSettings ? '' : 'hidden'}"></div>
            <div id="splash-home" style="display:${isSettings ? 'none' : 'flex'};flex-direction:column;flex:1;overflow:hidden">
              <div class="splash-welcome" id="splash-welcome"></div>
              <div class="splash-main-header">
                <div class="splash-main-title">Recent projects</div>
              </div>
              ${projects.length === 0
                ? `<div class="splash-empty">No recent projects yet.<br>Create your first project to get started.</div>`
                : `<div class="splash-grid">
                    ${[...projects].reverse().map((p, i) => `
                      <div class="splash-card" data-id="${p.id}" data-index="${i}">
                        <div class="splash-card-thumb">
                          <div class="splash-card-empty" id="cover-${p.id}"><span>S</span></div>
                          <button class="splash-card-set-cover" data-id="${p.id}" title="Set cover image">Set cover</button>
                          <button class="splash-card-remove" data-id="${p.id}" title="Remove from recents">✕</button>
                        </div>
                        <div class="splash-card-meta">
                          <div class="splash-card-name" title="${p.name}">${p.name}</div>
                          <div class="splash-card-path" title="${p.dir}">${p.dir.split('/').slice(-2).join('/')}</div>
                          ${p.updatedAt ? `<div class="splash-card-updated">${new Date(p.updatedAt).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})}</div>` : ''}
                        </div>
                      </div>
                    `).join('')}
                  </div>`
              }
            </div>
          </div>

        </div>
      </div>
    `

    // Bind nav
    document.getElementById('splash-logo').onclick = () => Store.set('view', 'editor')
    document.getElementById('btn-new').onclick = () => { Store.set('view', 'editor'); this._showNewForm() }
    document.getElementById('btn-open').onclick = () => this.openProject()
    document.getElementById('btn-settings').onclick = () => Store.set('view', isSettings ? 'editor' : 'settings')

    // If in settings, mount the panel
    if (isSettings) {
      const panel = document.getElementById('splash-settings-panel')
      if (panel) {
        panel.style.cssText = 'flex:1;overflow-y:auto;position:relative;'
        Settings.mount(panel, null)
        
        const backBtn = document.createElement('button')
        backBtn.className = 'splash-settings-back'
        backBtn.textContent = '← Back to projects'
        backBtn.onclick = () => Store.set('view', 'editor')
        panel.insertBefore(backBtn, panel.firstChild)
      }
    }

    // Open project cards
    document.querySelectorAll('.splash-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.splash-card-set-cover') || e.target.closest('.splash-card-remove')) return
        const id = card.dataset.id
        // Update last opened timestamp
        Store._data.projects = Store.get('projects').map(p => p.id === id ? { ...p, updatedAt: Date.now() } : p)
        Store.save()
        Store.set('activeId', id)
      })
    })

    // Remove from recents
    document.querySelectorAll('.splash-card-remove').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const id = btn.dataset.id
        Store._data.projects = Store.get('projects').filter(p => p.id !== id)
        Store.save()
        // Remove card from DOM without full re-render
        btn.closest('.splash-card').remove()
        if (Store.get('projects').length === 0) {
          document.querySelector('.splash-grid')?.replaceWith(
            Object.assign(document.createElement('div'), { className: 'splash-empty', innerHTML: 'No recent projects yet.<br>Create your first project to get started.' })
          )
        }
      })
    })

    // Set cover image
    document.querySelectorAll('.splash-card-set-cover').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const id = btn.dataset.id
        const fp = await api.dialog.file([{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] }])
        if (!fp) return
        await api.store.set(`project-cover-path-${id}`, fp)
        const el = document.getElementById(`cover-${id}`)
        const img = document.createElement('img')
        img.src = `file://${fp}`; img.className = 'splash-card-img'; img.draggable = false
        if (el) el.replaceWith(img)
        else btn.closest('.splash-card-thumb').prepend(img)
      })
    })

    // Welcome message rotation
    const messages = [
      'What are you writing today?',
      'Every great story begins with a single word.',
      'Your ideas deserve a beautiful home.',
      'Ready when you are.',
      'Good writers write. Great writers rewrite.',
      'The page is waiting.',
      'Where were we?',
      'Blank pages are full of possibilities.',
      'Words have power. Use them well.',
      'Time to make something.',
    ]
    const welcomeEl = document.getElementById('splash-welcome')
    if (welcomeEl) {
      let idx = Math.floor(Math.random() * messages.length)
      welcomeEl.textContent = messages[idx]
      welcomeEl.classList.add('splash-welcome-visible')
      setInterval(() => {
        welcomeEl.classList.remove('splash-welcome-visible')
        setTimeout(() => {
          idx = (idx + 1) % messages.length
          welcomeEl.textContent = messages[idx]
          welcomeEl.classList.add('splash-welcome-visible')
        }, 600)
      }, 5000)
    }

    // Load covers async
    ;(async () => {
      for (const p of projects) {
        try {
          const coverPath = await api.store.get(`project-cover-path-${p.id}`)
          if (!coverPath) continue
          const el = document.getElementById(`cover-${p.id}`)
          if (!el) continue
          const img = document.createElement('img')
          img.src = `file://${coverPath}`; img.className = 'splash-card-img'; img.draggable = false
          img.onerror = () => {}
          el.replaceWith(img)
        } catch {}
      }
    })()
  },
  _showNewForm() {
    document.getElementById('splash-form').classList.remove('hidden')
    document.getElementById('project-name').focus()
    document.getElementById('btn-cancel').onclick = () => {
      document.getElementById('splash-form').classList.add('hidden')
      document.getElementById('project-name').value = ''
      document.getElementById('splash-err').textContent = ''
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
      Store._data.projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir, updatedAt: Date.now() }]
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
      Store._data.projects = [...Store.get('projects'), { id: p.id, name: p.name, dir: p.dir, updatedAt: Date.now() }]
      Store.save()
      Store.set('activeId', p.id)
    } catch (e) { alert(e.message) }
  },

  // ── Workspace ────────────────────────────────────────────────────────────────

  renderWorkspace(root, project) {
    const s = Store.get()

    if (!root.querySelector('.workspace')) {
      root.innerHTML = `
      <div class="workspace">
        <div class="titlebar">
          <div class="titlebar-lights"></div>
          <button class="titlebar-btn" id="btn-home" title="Return to home screen">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </button>
          <button class="titlebar-btn" id="toggle-sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/>
              <line x1="5" y1="3" x2="5" y2="13" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
          <span class="project-name">${project.name}</span>
          <div class="nav-group">
            <button class="nav-btn" data-view="editor">Editor</button>
            <button class="nav-btn" data-view="board">Canvas</button>
            <button class="nav-btn" data-view="settings">Settings</button>
          </div>
          <div class="spacer"></div>
        </div>
        <div class="body">
          <div id="sidebar-container" ${!s.sidebar||s.view==='settings'?'class="hidden"':''}></div>
          <main class="main" id="main-content"></main>
        </div>
      </div>
    `
      // Bind events once for the persistent shell
      root.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (Store.get('view') !== btn.dataset.view) Store.set('view', btn.dataset.view)
        })
      })
      document.getElementById('toggle-sidebar').addEventListener('click', () => Store.set('sidebar', !Store.get('sidebar')))
      document.getElementById('btn-home').addEventListener('click', () => {
        Store._data.activeId = null; Store._data.boardStack = []; Store._data.view = 'editor'
        Store.save(); this.render()
      })
    }

    // Sync dynamic states without re-rendering the layout
    root.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', s.view === btn.dataset.view)
    })

    const sidebarContainer = document.getElementById('sidebar-container')
    if (sidebarContainer) {
      sidebarContainer.classList.toggle('hidden', !s.sidebar || s.view === 'settings')
    }

    // Optimized sidebar rendering
    if (s.sidebar && s.view !== 'settings') {
      if (!sidebarContainer || sidebarContainer.innerHTML === '' || sidebarContainer.dataset.projectId !== project.id) {
        this.renderSidebar(project)
      } else {
        this._updateSidebarSelection()
      }
    }

    const main = document.getElementById('main-content')
    if (s.view === 'editor')   this.renderEditor(main, project)
    if (s.view === 'board')    this.renderBoard(main, project)
    if (s.view === 'settings') Settings.mount(main, project)
  },

  async renderSidebar(project) {
    const s = Store.get()
    const container = document.getElementById('sidebar-container')
    if (!container) return
    container.className = 'sidebar'
    container.dataset.projectId = project.id

    // 1. Fetch data BEFORE clearing DOM
    const [docs, boards] = await Promise.all([
      Project.readDocs(project.dir),
      Project.readBoards(project.dir)
    ])

    // 2. Build everything in memory
    const fragment = document.createDocumentFragment()

    const docsSection = document.createElement('div'); docsSection.className = 'sidebar-section'
    const docsHdr = document.createElement('div'); docsHdr.className = 'sidebar-header'
    const docsLbl = document.createElement('span'); docsLbl.className = 'sidebar-label'; docsLbl.textContent = 'Documents'
    const addDocBtn = document.createElement('button'); addDocBtn.className = 'sidebar-add'; addDocBtn.textContent = '+'
    addDocBtn.onclick = () => this._showNewDocModal(project)
    docsHdr.appendChild(docsLbl); docsHdr.appendChild(addDocBtn); docsSection.appendChild(docsHdr)
    const docTree = document.createElement('div'); docsSection.appendChild(docTree)
    fragment.appendChild(docsSection)

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

    // 1. Static Master Board Button (Never cleared)
    const masterBtn = document.createElement('button')
    masterBtn.className = 'sidebar-row master-board-row' + (s.view==='board'&&s.boardFile==='master.json'?' board-active':'')
    masterBtn.dataset.file = 'master.json'
    const masterIcon = document.createElement('span'); masterIcon.textContent = '◎ '
    const masterName = document.createElement('span'); masterName.textContent = 'Master board'
    masterName.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    masterBtn.appendChild(masterIcon); masterBtn.appendChild(masterName)
    masterBtn.onclick = () => this.openBoard('master.json', false)
    boardsSection.appendChild(masterBtn)

    // 2. Container for dynamic sub-boards
    const subBoardsList = document.createElement('div'); subBoardsList.id = 'sidebar-sub-boards'
    boardsSection.appendChild(subBoardsList)
    fragment.appendChild(boardsSection)

    const footer = document.createElement('div'); footer.className = 'sidebar-footer'
    const pathBtn = document.createElement('button'); pathBtn.className = 'sidebar-path'
    pathBtn.innerHTML = `⌂ <span>${project.dir.split('/').pop()}</span>`
    pathBtn.onclick = () => api.shell.open(project.dir)
    footer.appendChild(pathBtn); fragment.appendChild(footer)

    // 3. Populate Lists
    if (!docs.length) {
      const e = document.createElement('span'); e.className = 'sidebar-empty'; e.textContent = 'No documents yet'; docTree.appendChild(e)
    } else {
      this._sortDocs(docs, project.docOrder).forEach(n => this._docNode(n, docTree, s.docPath, project))
    }

    boards.filter(b => !b.isMaster).forEach(b => {
      const btn = document.createElement('button')
      btn.className = 'sidebar-row' + (s.view === 'board' && s.boardFile === b.file ? ' board-active' : '')
      btn.dataset.file = b.file
      
      const icon = document.createElement('span'); icon.textContent = '⊞ '; btn.appendChild(icon)
      const lbl = document.createElement('span'); lbl.textContent = b.name; lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; btn.appendChild(lbl)
      const cnt = document.createElement('span'); cnt.className = 'board-count'; cnt.textContent = (b.nodes||[]).length; btn.appendChild(cnt)

      btn.onclick = () => {
        if (Store.get('boardFile') === b.file && Store.get('view') === 'board') return
        Store.set('view', 'board')
        this.openBoard(b.file, false)
      }

      const _startBoardRename = (ev) => {
          if (ev) { ev.stopPropagation(); ev.preventDefault() }
          const inp = document.createElement('input')
          inp.value = b.name
          inp.className = 'sidebar-new-input'
          inp.style.margin = '0'
          lbl.replaceWith(inp)
          inp.focus(); inp.select()

          const commit = async () => {
            const newName = inp.value.trim()
            if (newName && newName !== b.name) {
              try {
                b.name = newName
                await Project.saveBoard(project.dir, b.file, b)
                this.render() // Refresh to update list and counts
                return
              } catch (err) { console.error('Board rename failed:', err) }
            }
            if (inp.parentNode) inp.replaceWith(lbl)
          }

          inp.onblur = commit
          inp.onkeydown = (e) => { if(e.key==='Enter') inp.blur(); if(e.key==='Escape') inp.replaceWith(lbl) }
          inp.onmousedown = (e) => e.stopPropagation()
        }

        // Double-click label to rename
        lbl.addEventListener('dblclick', (e) => { e.stopPropagation(); _startBoardRename(e) })

        btn.addEventListener('contextmenu', e => {
          e.preventDefault(); e.stopPropagation()
          this._showSidebarMenu(e.clientX, e.clientY, [
            { label: 'Rename Board', action: () => _startBoardRename(e) },
            { label: 'Delete Board', danger: true, action: () => this._deleteBoard(project.dir, b.file) }
          ])
        })

        // Make draggable onto master board canvas
        btn.draggable = true
        btn.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/board-file', b.file)
          e.dataTransfer.setData('text/board-name', b.name)
          e.dataTransfer.effectAllowed = 'link'
        })
        btn.title = 'Click to open · Drag onto canvas to pin'
        subBoardsList.appendChild(btn)
    })

    // 4. Atomic Swap
    container.innerHTML = ''
    container.appendChild(fragment)
  },

  _updateSidebarSelection() {
    const s = Store.get()
    const container = document.getElementById('sidebar-container')
    if (!container) return

    // Update Doc selection
    container.querySelectorAll('.sidebar-row[data-path]').forEach(btn => {
      const active = s.view === 'editor' && btn.dataset.path === s.docPath
      btn.classList.toggle('active', active)
    })

    // Update Board selection
    container.querySelectorAll('.sidebar-row[data-file]').forEach(btn => {
      const active = s.view === 'board' && btn.dataset.file === s.boardFile
      btn.classList.toggle('board-active', active)
    })
  },

  _showNewDocModal(project) {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">New Document</div>
        <div class="modal-body">
          <label class="modal-label">NAME</label>
          <input type="text" id="doc-name" class="modal-input" placeholder="Untitled document..." autocomplete="off"/>
          
          <label class="modal-label" style="margin-top:20px">SELECT TEMPLATE</label>
          <div class="template-grid" id="template-grid">
            ${Object.entries(Project.templates).map(([key, tmpl]) => `
              <div class="template-card" data-key="${key}">
                <div class="template-card-icon">${key === 'blank' ? '📄' : '📝'}</div>
                <div class="template-card-name">${tmpl.label}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-sm" id="modal-cancel">Cancel</button>
          <button class="btn-sm primary" id="modal-create" disabled>Create Document</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const inp = overlay.querySelector('#doc-name')
    const createBtn = overlay.querySelector('#modal-create')
    let selectedTemplate = 'blank'

    // Focus and selection
    setTimeout(() => inp.focus(), 50)
    overlay.querySelector(`[data-key="${selectedTemplate}"]`).classList.add('active')

    const close = () => overlay.remove()
    
    const create = async () => {
      const name = inp.value.trim()
      if (!name) return
      const tmpl = Project.templates[selectedTemplate]
      const p = `${project.dir}/documents/${name}.md`
      const body = (tmpl?.content || '# {name}\n\n').replace(/\{name\}/g, name)
      
      await api.fs.write(p, body)
      if (project.docOrder) {
        const newOrder = [...project.docOrder, p]
        Store._data.projects = Store.get('projects').map(pj => 
          pj.id === project.id ? { ...pj, docOrder: newOrder } : pj
        )
      }
      Store.set('docPath', p)
      Store.set('view', 'editor')
      close()
    }

    inp.oninput = () => { createBtn.disabled = !inp.value.trim() }
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') create()
      if (e.key === 'Escape') close()
    }

    overlay.querySelectorAll('.template-card').forEach(card => {
      card.onclick = () => {
        overlay.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'))
        card.classList.add('active')
        selectedTemplate = card.dataset.key
      }
    })

    overlay.querySelector('#modal-cancel').onclick = close
    createBtn.onclick = create
    
    overlay.onclick = (e) => { if (e.target === overlay) close() }
  },


  _docNode(node, container, activePath, project) {
    if (node.type === 'file') {
      const btn = document.createElement('button')
      const isCurrentDoc = activePath === node.path
      btn.className = 'sidebar-row' + (isCurrentDoc && Store.get('view') === 'editor' ? ' active' : '')
      btn.dataset.path = node.path
      btn.title = node.name

      // Drag & Drop
      btn.draggable = true
      btn.ondragstart = (e) => {
        e.dataTransfer.setData('text/doc-path', node.path)
        e.dataTransfer.setData('text/doc-name', node.name)
        e.dataTransfer.effectAllowed = 'move'
        btn.classList.add('dragging')
      }
      btn.ondragend = () => btn.classList.remove('dragging')
      btn.ondragover = (e) => { e.preventDefault(); btn.classList.add('drag-over') }
      btn.ondragleave = () => btn.classList.remove('drag-over')
      btn.ondrop = (e) => {
        e.preventDefault()
        btn.classList.remove('drag-over')
        const draggedPath = e.dataTransfer.getData('text/doc-path')
        if (draggedPath && draggedPath !== node.path) this._reorderDocs(project, draggedPath, node.path)
      }

      // Document Label
      const lbl = document.createElement('span')
      lbl.textContent = `📄 ${node.name}`
      lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
      btn.appendChild(lbl)

      // Navigation
      btn.onclick = () => {
        if (Store.get('docPath') === node.path && Store.get('view') === 'editor') return
        Store.set('docPath', node.path)
        Store.set('view', 'editor')
      }

      // Document Renaming
      const _startRename = (ev) => {
        if (ev) { ev.stopPropagation(); ev.preventDefault() }
        const inp = document.createElement('input')
        inp.value = node.name
        inp.className = 'sidebar-new-input'
        inp.style.margin = '0'
        lbl.replaceWith(inp)
        inp.focus(); inp.select()

        const commit = async () => {
          const newName = inp.value.trim()
          if (newName && newName !== node.name) {
            const lastSlash = node.path.lastIndexOf('/')
            const dir = node.path.substring(0, lastSlash + 1)
            const newPath = `${dir}${newName}.md`
            try {
              await api.fs.rename(node.path, newPath)

              // Update order to keep position
              let order = project.docOrder
              if (!order) {
                const docs = await Project.readDocs(project.dir)
                order = this._flattenPaths(docs)
              }
              const newOrder = order.map(p => p === node.path ? newPath : (p.startsWith(node.path + '/') ? p.replace(node.path, newPath) : p))
              const projects = Store.get('projects').map(p => p.id === project.id ? { ...p, docOrder: newOrder } : p)
              Store._data.projects = projects
              Store.save()

              const wasActive = Store.get('docPath') === node.path
              node.path = newPath; node.name = newName // Update local reference
              if (wasActive) {
                Store.set('docPath', newPath) // Triggers render
              } else {
                this.render() // Force sidebar refresh from disk
              }
              return
            } catch (err) { console.error('Rename failed:', err) }
          }
          if (inp.parentNode) { inp.replaceWith(lbl); lbl.textContent = `📄 ${node.name}` }
        }

        inp.onblur = commit
        inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') inp.replaceWith(lbl) }
        inp.onmousedown = (e) => e.stopPropagation()
      }

      // Double-click label to rename
      lbl.addEventListener('dblclick', (e) => { e.stopPropagation(); _startRename(e) })

      // Context menu for files
      btn.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation()
        this._showSidebarMenu(e.clientX, e.clientY, [
          { label: 'Rename', action: () => _startRename(e) },
          { label: 'Delete Document', danger: true, action: () => this._deleteDoc(node.path) }
        ])
      })

      container.appendChild(btn)
    } else {
      const btn = document.createElement('button')
      btn.className = 'sidebar-row'; btn.textContent = `▾ 📁 ${node.name}`
      container.appendChild(btn)

      const sub = document.createElement('div'); sub.style.paddingLeft='14px'
      this._sortDocs(node.children, project.docOrder).forEach(c => this._docNode(c, sub, activePath, project))
      container.appendChild(sub)
      btn.onclick = () => sub.classList.toggle('hidden')
    }
  },

  _showSidebarMenu(x, y, items) {
    // Reuse the existing context menu element if it exists (from Canvas)
    let menu = document.getElementById('canvas-ctx')
    if (!menu) {
      menu = document.createElement('div')
      menu.id = 'canvas-ctx'; menu.className = 'ctx-menu hidden'
      document.body.appendChild(menu)
    }
    menu.innerHTML = ''
    items.forEach(item => {
      const b = document.createElement('button')
      b.className = 'ctx-item' + (item.danger ? ' ctx-danger' : '')
      b.innerHTML = `<span>${item.label}</span>`
      b.onclick = (e) => { 
        e.stopPropagation()
        menu.classList.add('hidden')
        item.action() 
      }
      menu.appendChild(b)
    })
    menu.style.left = x + 'px'; menu.style.top = y + 'px'
    menu.classList.remove('hidden')
    
    const close = (e) => {
      if (menu.contains(e.target)) return
      menu.classList.add('hidden')
      document.removeEventListener('mousedown', close)
    }
    setTimeout(() => document.addEventListener('mousedown', close), 10)
  },

  async _deleteDoc(path) {
    if (!confirm('Are you sure you want to delete this document? This cannot be undone.')) return
    await api.fs.delete(path)

    const project = Store.project
    if (project && project.docOrder) {
      const newOrder = project.docOrder.filter(p => p !== path && !p.startsWith(path + '/'))
      const projects = Store.get('projects').map(p => 
        p.id === project.id ? { ...p, docOrder: newOrder } : p
      )
      Store._data.projects = projects
      Store.save()
    }

    if (Store.get('docPath') === path) {
      Store.set('docPath', null)
    } else {
      this.render() // Force refresh sidebar
    }
  },

  async _deleteBoard(projectDir, file) {
    if (file === 'master.json') return alert('The Master board cannot be deleted.')
    if (!confirm('Delete this board? All nodes and arrows on this specific board will be lost.')) return
    await api.fs.delete(`${projectDir}/boards/${file}`)
    if (Store.get('boardFile') === file) {
      Store._data.boardFile = 'master.json'
      Store._data.boardStack = []
      Store.save()
      this.render()
    } else {
      this.render()
    }
  },

  _sortDocs(docs, order) {
    if (!order || !order.length) return docs
    return [...docs].sort((a, b) => {
      const idxA = order.indexOf(a.path)
      const idxB = order.indexOf(b.path)
      if (idxA === -1 && idxB === -1) return a.name.localeCompare(b.name)
      if (idxA === -1) return 1
      if (idxB === -1) return -1
      return idxA - idxB
    })
  },

  _flattenPaths(nodes) {
    let out = []
    for (const n of nodes) {
      out.push(n.path)
      if (n.children) out = out.concat(this._flattenPaths(n.children))
    }
    return out
  },

  async _reorderDocs(project, draggedPath, targetPath) {
    const docs = await Project.readDocs(project.dir)
    const allPaths = this._flattenPaths(docs)
    let order = project.docOrder || allPaths
    
    const fromIdx = order.indexOf(draggedPath)
    const toIdx = order.indexOf(targetPath)
    
    if (fromIdx > -1 && toIdx > -1) {
      const newOrder = [...order]
      const [item] = newOrder.splice(fromIdx, 1)
      newOrder.splice(toIdx, 0, item)
      
      const projects = Store.get('projects').map(p => p.id === project.id ? { ...p, docOrder: newOrder } : p)
      Store._data.projects = projects
      Store.save()
      this.render()
    }
  },

  renderEditor(container, project) {
    const docPath = Store.get('docPath')
    if (!docPath) {
      container.innerHTML = '<div class="editor-empty">Select a document from the sidebar</div>'
      container.dataset.path = ''
      return
    }
    // Only mount if the editor structure isn't there
    if (!container.querySelector('.editor')) {
      Editor.mount(container)
    }
    // Only load if the document actually changed
    if (container.dataset.path !== docPath) {
      container.dataset.path = docPath
      Editor.loadDoc(docPath)
    }
  },

  renderBoard(container, project) {
    const boardFile = Store.get('boardFile')
    // If we're already viewing this board, do nothing
    if (container.querySelector('.canvas-wrap') && container.dataset.file === boardFile) {
      return
    }
    
    container.innerHTML = '' // Clear for the canvas mount
    container.dataset.file = boardFile
    Canvas.mount(container, project.dir, boardFile)
  },

  openBoard(file, push=true) {
    if (push) { 
      const stack = Store.get('boardStack')
      Store.set('boardStack', [...stack, Store.get('boardFile')]) 
    }
    Store.set('boardFile', file)
    Store.set('view', 'board')
  }
}

App.init()
