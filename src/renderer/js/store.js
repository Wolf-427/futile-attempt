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
    this._data[k] = v
    if (k !== 'git') this._notify(k)
    this.save()
  },

  patch(k, v) {
    this._data[k] = { ...this._data[k], ...v }
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

  async load() {
    try {
      const saved = localStorage.getItem('scriptum-store')
      if (saved) {
        const d = JSON.parse(saved)
        if (d.projects) this._data.projects = d.projects
        if (d.sidebar !== undefined) this._data.sidebar = d.sidebar
        if (d.boardFile) this._data.boardFile = d.boardFile

        // Only restore activeId if the project folder still exists
        if (d.activeId && d.projects) {
          const p = d.projects.find(x => x.id === d.activeId)
          if (p) {
            const exists = await api.fs.exists(`${p.dir}/scriptum.json`)
            if (exists) {
              this._data.activeId = d.activeId
              if (d.docPath) {
                const docExists = await api.fs.exists(d.docPath)
                if (docExists) this._data.docPath = d.docPath
              }
            }
          }
        }
      }
    } catch(e) { console.error('Store load error:', e) }
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
