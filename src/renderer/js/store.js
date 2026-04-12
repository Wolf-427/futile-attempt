const Store = {
  _data: {
    projects: [], activeId: null, docPath: null,
    boardFile: 'master.json', boardStack: [],
    view: 'editor', sidebar: true,
    git: { dirty: false, branch: 'main', syncing: false, error: null }
  },
  _listeners: [],

  get(k) { return k ? this._data[k] : this._data },

  set(k, v) {
    const old = this._data[k]
    this._data[k] = v
    // Only notify on structural changes, not git dirty flag
    if (k !== 'git') this._notify(k, old, v)
    this.save()
  },

  patch(k, v) {
    this._data[k] = { ...this._data[k], ...v }
    // git patches never trigger re-render
    if (k !== 'git') this._notify(k, null, this._data[k])
    this.save()
  },

  // Subscribe to specific keys only
  sub(keys, fn) {
    const handler = (changedKey) => {
      if (!keys || keys.includes(changedKey)) fn(this._data, changedKey)
    }
    this._listeners.push(handler)
    return () => { this._listeners = this._listeners.filter(l => l !== handler) }
  },

  _notify(key) {
    this._listeners.forEach(fn => fn(key))
  },

  get project() { return this._data.projects.find(p => p.id === this._data.activeId) || null },

  load() {
    try {
      const saved = localStorage.getItem('scriptum-store')
      if (saved) {
        const d = JSON.parse(saved)
        if (d.projects) this._data.projects = d.projects
        if (d.activeId) this._data.activeId = d.activeId
        if (d.docPath)  this._data.docPath  = d.docPath
        if (d.sidebar !== undefined) this._data.sidebar = d.sidebar
        if (d.boardFile) this._data.boardFile = d.boardFile
      }
    } catch {}
  },

  save() {
    try {
      localStorage.setItem('scriptum-store', JSON.stringify({
        projects:  this._data.projects,
        activeId:  this._data.activeId,
        docPath:   this._data.docPath,
        sidebar:   this._data.sidebar,
        boardFile: this._data.boardFile,
      }))
    } catch {}
  }
}

Store.load()
