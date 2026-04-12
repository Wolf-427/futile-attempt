const Project = {
  async create(name, parent) {
    const slug = name.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-').toLowerCase()
    const dir = `${parent}/${slug}`
    await api.fs.mkdir(dir)
    for (const d of ['documents', 'references', 'boards', 'exports']) await api.fs.mkdir(`${dir}/${d}`)
    const id = crypto.randomUUID()
    const manifest = { id, name: name.trim(), created: Date.now() }
    await api.fs.write(`${dir}/scriptum.json`, JSON.stringify(manifest, null, 2))
    await api.fs.write(`${dir}/boards/master.json`, JSON.stringify({ name: 'Master board', isMaster: true, nodes: [], updated: Date.now() }, null, 2))
    await api.fs.write(`${dir}/documents/Untitled.md`, `# ${name.trim()}\n\n`)
    await api.fs.write(`${dir}/.gitignore`, '.DS_Store\n')
    return { ...manifest, dir }
  },

  async open(dir) {
    const ok = await api.fs.exists(`${dir}/scriptum.json`)
    if (!ok) throw new Error('Not a Scriptum project')
    return { ...JSON.parse(await api.fs.read(`${dir}/scriptum.json`)), dir }
  },

  async readDocs(dir) { return this._tree(`${dir}/documents`) },

  async _tree(dir) {
    if (!await api.fs.exists(dir)) return []
    const entries = await api.fs.readdir(dir)
    const out = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (e.isDir) out.push({ type: 'folder', name: e.name, path: e.path, children: await this._tree(e.path) })
      else if (e.name.endsWith('.md')) out.push({ type: 'file', name: e.name.replace(/\.md$/, ''), path: e.path })
    }
    return out
  },

  async readBoards(dir) {
    const out = []
    try {
      const entries = await api.fs.readdir(`${dir}/boards`)
      for (const e of entries) {
        if (!e.name.endsWith('.json')) continue
        try { out.push({ file: e.name, ...JSON.parse(await api.fs.read(e.path)) }) } catch {}
      }
    } catch {}
    return out
  },

  async saveBoard(dir, file, data) {
    await api.fs.write(`${dir}/boards/${file}`, JSON.stringify({ ...data, updated: Date.now() }, null, 2))
  },

  async newBoard(dir, name) {
    const file = `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
    const data = { name, isMaster: false, nodes: [], updated: Date.now() }
    await this.saveBoard(dir, file, data)
    return { file, ...data }
  }
}
