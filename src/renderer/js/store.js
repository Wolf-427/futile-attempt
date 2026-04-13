const Store = {
  _data: {
    projects: [], activeId: null, docPath: null,
    boardFile: 'master.json', boardStack: [],
    view: 'editor', sidebar: true,
    git: { dirty: false, branch: 'main', syncing: false, error: null }
  },
  _listeners: [],

  _saveTimer: null,

  get(k) { return k ? this._data[k] : this._data },

  set(k, v) {
    if (this._data[k] === v) return
    this._data[k] = v
    if (k !== 'git') this._notify(k)
    this.save()
  },

  patch(k, v) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      // Note: Deep equality check could go here, but for Git state simple patch is fine
      this._data[k] = { 
        ...(typeof this._data[k] === 'object' ? this._data[k] : {}), 
        ...v 
      }
    } else {
      this._data[k] = v
    }
    if (k !== 'git') this._notify(k)
    this.save()
  },

  sub(keys, fn) {
    const handler = (changedKey) => {
      if (!keys || keys.includes(changedKey)) fn(this._data, changedKey)
    }
    this._listeners.push(handler)
    return () => { this._listeners = this._listeners.filter(l => l !== handler) }
  },

  _notify(key) { this._listeners.forEach(fn => fn(key)) },

  get project() { return this._data.projects.find(p => p.id === this._data.activeId) || null },

  // Sync load from localStorage first — always works
  loadSync() {
    try {
      const saved = localStorage.getItem('scriptum-store')
      if (saved) {
        const d = JSON.parse(saved)
        if (d.projects) this._data.projects = d.projects
        if (d.sidebar !== undefined) this._data.sidebar = d.sidebar
        if (d.boardFile) this._data.boardFile = d.boardFile
        if (d.docPath) this._data.docPath = d.docPath
        // Restore activeId immediately — verify existence async separately
        if (d.activeId) this._data.activeId = d.activeId
      }
    } catch(e) { console.error('Store loadSync error:', e) }
  },

  // Then async-verify the project folder still exists
  async verifyProject() {
    const id = this._data.activeId
    if (!id) return
    const p = this._data.projects.find(x => x.id === id)
    if (!p) { this._data.activeId = null; return }
    try {
      const exists = await api.fs.exists(`${p.dir}/scriptum.json`)
      if (!exists) {
        this._data.activeId = null
        this._data.docPath = null
        this.save()
      } else if (this._data.docPath) {
        const docExists = await api.fs.exists(this._data.docPath)
        if (!docExists) { this._data.docPath = null; this.save() }
      }
    } catch { this._data.activeId = null; this._data.docPath = null; this.save() }
  },

  save() {
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('scriptum-store', JSON.stringify({
          projects:  this._data.projects,
          activeId:  this._data.activeId,
          docPath:   this._data.docPath,
          sidebar:   this._data.sidebar,
          boardFile: this._data.boardFile,
        }))
      } catch(e) { console.error('Store save error:', e) }
    }, 100)
  }
}

// Load sync immediately so data is available before App.init()
Store.loadSync()
