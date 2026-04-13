const App = {

  async init() {
    const start = Date.now()
    // Ensure the last active project still exists on disk before rendering
    await Store.verifyProject()

    Store.sub(['activeId', 'view', 'sidebar', 'boardFile', 'boardStack', 'docPath'], () => {
      this.render()
    })

    this._bindGlobalKeys()
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
    if (!s.activeId || !Store.project) { this.renderSplash(root); return }
    this.renderWorkspace(root, Store.project)
  },

  // ── Splash ──────────────────────────────────────────────────────────────────

  async renderSplash(root) {
    const projects = Store.get('projects')
    const version = await api.app.version().catch(() => '0.3.0-alpha')

    root.innerHTML = `
      <div class="splash">
        <div class="splash-drag"></div>
        <div class="splash-layout">

          <div class="splash-sidebar">
            <div class="splash-logo">
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
            <button class="splash-side-btn" id="btn-settings">
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
            <div id="splash-settings-panel" class="hidden"></div>
            <div id="splash-home" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
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
    document.getElementById('btn-new').onclick = () => this._showNewForm()
    document.getElementById('btn-open').onclick = () => this.openProject()
    document.getElementById('btn-settings').onclick = () => this._showSplashSettings()

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

  _showSplashHome() {
    document.getElementById('splash-settings-panel')?.classList.add('hidden')
    const home = document.getElementById('splash-home')
    if (home) { home.style.display = 'flex'; home.style.flexDirection = 'column'; home.style.flex = '1'; home.style.overflow = 'hidden' }
    document.querySelectorAll('.splash-side-btn').forEach(b => b.classList.remove('active-nav'))
  },

  _showSplashSettings() {
    const home = document.getElementById('splash-home')
    if (home) home.style.display = 'none'
    const panel = document.getElementById('splash-settings-panel')
    if (!panel) return
    panel.classList.remove('hidden')
    panel.style.cssText = 'flex:1;overflow-y:auto;position:relative;'
    document.querySelectorAll('.splash-side-btn').forEach(b => b.classList.remove('active-nav'))
    document.getElementById('btn-settings')?.classList.add('active-nav')
    Settings.mount(panel, null)
    // Inject a close/back button at the top of settings
    const backBtn = document.createElement('button')
    backBtn.className = 'splash-settings-back'
    backBtn.textContent = '← Back to projects'
    backBtn.onclick = () => {
      panel.classList.add('hidden')
      const home = document.getElementById('splash-home')
      if (home) { home.style.display = 'flex'; home.style.flexDirection = 'column'; home.style.flex = '1'; home.style.overflow = 'hidden' }
      document.querySelectorAll('.splash-side-btn').forEach(b => b.classList.remove('active-nav'))
    }
    panel.insertBefore(backBtn, panel.firstChild)
  },

  _showNewForm() {
    this._showSplashHome()
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
    // Restore last doc for this project
    const lastDoc = s.docPath
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
            <span class="git-dot ${s.git.dirty?'dirty':'clean'}" title="${s.git.dirty?'Unsaved':'Saved'}"></span>
            <button class="titlebar-close-project" id="close-project">Close</button>
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
      // Save last doc before closing
      Store._data.activeId = null; Store._data.boardStack = []
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

      // Show name input
      const inp = document.createElement('input')
      inp.className = 'sidebar-new-input'; inp.placeholder = 'Name…'
      docsSection.insertBefore(inp, docTree)
      inp.focus()

      const cancel = () => { inp.remove(); addingDoc = false }

      const finish = async () => {
        const name = inp.value.trim()
        if (!name) { cancel(); return }

        // Remove input first — but don't set addingDoc = false yet
        inp.remove()

        // Show template picker inline
        const picker = document.createElement('div')
        picker.className = 'template-picker'
        const lbl = document.createElement('div'); lbl.className = 'template-label'; lbl.textContent = 'Choose template'
        picker.appendChild(lbl)

        const createDoc = async (tmpl) => {
          picker.remove(); addingDoc = false
          const p = `${project.dir}/documents/${name}.md`
          const body = (tmpl?.content || '# {name}\n\n').replace(/\{name\}/g, name)
          await api.fs.write(p, body)
          Store._data.docPath = p; Store.save(); Store.set('view', 'editor')
        }

        Object.entries(Project.templates).forEach(([key, tmpl]) => {
          const b = document.createElement('button'); b.className = 'template-btn'; b.textContent = tmpl.label
          b.onclick = () => createDoc(tmpl)
          picker.appendChild(b)
        })

        // Also allow pressing Escape to cancel picker
        picker.addEventListener('keydown', e => { if (e.key === 'Escape') { picker.remove(); addingDoc = false } })

        docsSection.insertBefore(picker, docTree)
        // Auto-dismiss after 10s
        setTimeout(() => { if (picker.parentNode) { picker.remove(); addingDoc = false } }, 10000)
      }

      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish() }
        if (e.key === 'Escape') cancel()
      })
      // Only cancel on blur if picker isn't showing yet
      inp.addEventListener('blur', () => {
        setTimeout(() => {
          // If input is still in DOM somehow, or addingDoc still true and no picker exists
          if (addingDoc && !docsSection.querySelector('.template-picker')) cancel()
        }, 150)
      })
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

    // 1. Static Master Board Button (Never cleared)
    const masterBtn = document.createElement('button')
    masterBtn.className = 'sidebar-row master-board-row' + (s.view==='board'&&s.boardFile==='master.json'?' board-active':'')
    const masterIcon = document.createElement('span'); masterIcon.textContent = '◎ '
    const masterName = document.createElement('span'); masterName.textContent = 'Master board'
    masterName.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    masterBtn.appendChild(masterIcon); masterBtn.appendChild(masterName)
    masterBtn.onclick = () => this.openBoard('master.json', false)
    boardsSection.appendChild(masterBtn)

    // 2. Container for dynamic sub-boards
    const subBoardsList = document.createElement('div'); subBoardsList.id = 'sidebar-sub-boards'
    boardsSection.appendChild(subBoardsList)
    container.appendChild(boardsSection)

    const footer = document.createElement('div'); footer.className = 'sidebar-footer'
    const pathBtn = document.createElement('button'); pathBtn.className = 'sidebar-path'
    pathBtn.innerHTML = `⌂ <span>${project.dir.split('/').pop()}</span>`
    pathBtn.onclick = () => api.shell.open(project.dir)
    footer.appendChild(pathBtn); container.appendChild(footer)

    Project.readDocs(project.dir).then(docs => {
      if (!docs.length) { const e=document.createElement('span'); e.className='sidebar-empty'; e.textContent='No documents yet'; docTree.appendChild(e); return }
      docs.forEach(n => this._docNode(n, docTree, s.docPath, project))
    }).catch(e => console.error("Error reading docs:", e))

    Project.readBoards(project.dir).then(boards => {
      // Clear only the sub-boards container
      subBoardsList.innerHTML = ''

      boards.filter(b=>!b.isMaster).forEach(b => {
        const btn = document.createElement('button')
        btn.className = 'sidebar-row'+(s.view==='board'&&s.boardFile===b.file?' board-active':'')
        
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
    })
  },


  _docNode(node, container, activePath, project) {
    if (node.type === 'file') {
      const btn = document.createElement('button')
      const isCurrentDoc = activePath === node.path
      btn.className = 'sidebar-row' + (isCurrentDoc && Store.get('view') === 'editor' ? ' active' : '')
      btn.title = node.name

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
      node.children.forEach(c => this._docNode(c, sub, activePath, project))
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
    if (push) { 
      const stack = Store.get('boardStack')
      Store.set('boardStack', [...stack, Store.get('boardFile')]) 
    }
    Store.set('boardFile', file)
    Store.set('view', 'board')
  }
}

App.init()
