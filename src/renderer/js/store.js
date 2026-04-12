const Store = {
  _data: {
    projects: [], activeId: null, docPath: null,
    boardFile: 'master.json', boardStack: [],
    view: 'editor', sidebar: true,
    git: { dirty: false, branch: 'main', syncing: false, error: null }
  },
  _listeners: [],
  get(k) { return k ? this._data[k] : this._data },
  set(k, v) { this._data[k] = v; this._notify() },
  patch(k, v) { this._data[k] = { ...this._data[k], ...v }; this._notify() },
  sub(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(l => l !== fn) } },
  _notify() { this._listeners.forEach(fn => fn(this._data)) },
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
      }
    } catch {}
  },
  save() {
    try {
      localStorage.setItem('scriptum-store', JSON.stringify({
        projects: this._data.projects,
        activeId: this._data.activeId,
        docPath:  this._data.docPath,
        sidebar:  this._data.sidebar,
      }))
    } catch {}
  }
}
Store.load()
