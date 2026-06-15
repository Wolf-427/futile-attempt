const Project = {
  async create(name, parent) {
    const slug = name.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-').toLowerCase()
    const dir = `${parent}/${slug}`
    await api.fs.mkdir(dir)
    for (const d of ['documents', 'references', 'boards', 'exports', 'characters', 'characters/images']) await api.fs.mkdir(`${dir}/${d}`)
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
      if (e.name.startsWith('.') || e.name === 'backups') continue
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
    const { file: _, ...cleanData } = data
    await api.fs.write(`${dir}/boards/${file}`, JSON.stringify({ ...cleanData, updated: Date.now() }, null, 2))
  },

  templates: {
    blank:   { label: 'Blank', content: '# {name}\n\n' },
    chapter: { label: 'Chapter', content: '# Chapter {name}\n\n## Scene 1\n\n\n\n## Notes\n\n' },
    outline: { label: 'Outline', content: '# {name}\n\n## Act 1\n\n- \n\n## Act 2\n\n- \n\n## Act 3\n\n- \n\n' },
    scene:   { label: 'Scene', content: '# {name}\n\n**Location:** \n**Time:** \n**Characters:** \n\n---\n\n' },
    notes:   { label: 'Notes', content: '# {name}\n\n## Key ideas\n\n## References\n\n## To-do\n\n' },
  },

  async newBoard(dir, name) {
    const file = `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
    const data = { name, isMaster: false, nodes: [], updated: Date.now() }
    await this.saveBoard(dir, file, data)
    return { file, ...data }
  },

  async readCharacters(dir) {
    const out = []
    const charDir = `${dir}/characters`
    if (!await api.fs.exists(charDir)) return out
    const entries = await api.fs.readdir(charDir)
    for (const e of entries) {
      if (!e.name.endsWith('.json')) continue
      try { out.push(JSON.parse(await api.fs.read(e.path))) } catch {}
    }
    return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  },

  async saveCharacter(dir, char) {
    await api.fs.mkdir(`${dir}/characters`)
    await api.fs.write(`${dir}/characters/${char.id}.json`, JSON.stringify({ ...char, updated: Date.now() }, null, 2))
  },

  async deleteCharacter(dir, id) {
    const charFile = `${dir}/characters/${id}.json`
    if (await api.fs.exists(charFile)) await api.fs.delete(charFile)
    const imgDir = `${dir}/characters/images`
    if (await api.fs.exists(imgDir)) {
      const entries = await api.fs.readdir(imgDir)
      for (const e of entries) {
        if (e.name.startsWith(id + '.')) await api.fs.delete(e.path)
      }
    }
  },

  // ── Trash ─────────────────────────────────────────────────────────────────────

  async readTrash(dir) {
    try {
      const p = `${dir}/trash/manifest.json`
      if (!await api.fs.exists(p)) return []
      return JSON.parse(await api.fs.read(p))
    } catch { return [] }
  },

  async _writeTrashManifest(dir, items) {
    await api.fs.mkdir(`${dir}/trash`)
    await api.fs.write(`${dir}/trash/manifest.json`, JSON.stringify(items, null, 2))
  },

  async trashItem(dir, { type, name, originalPath }) {
    const items = await this.readTrash(dir)
    const id = crypto.randomUUID()
    const filename = originalPath.split('/').pop()
    const subdir = type === 'document' ? 'documents' : type === 'board' ? 'boards' : 'characters'
    await api.fs.mkdir(`${dir}/trash/${subdir}`)
    const trashPath = `${dir}/trash/${subdir}/${id}_${filename}`
    await api.fs.rename(originalPath, trashPath)
    const entry = { id, type, name, originalPath, trashPath, trashedAt: Date.now() }
    await this._writeTrashManifest(dir, [...items, entry])
    return entry
  },

  async restoreItem(dir, trashId) {
    const items = await this.readTrash(dir)
    const entry = items.find(i => i.id === trashId)
    if (!entry) return null
    const parentDir = entry.originalPath.substring(0, entry.originalPath.lastIndexOf('/'))
    await api.fs.mkdir(parentDir)
    await api.fs.rename(entry.trashPath, entry.originalPath)
    await this._writeTrashManifest(dir, items.filter(i => i.id !== trashId))
    return entry
  },

  async permanentDelete(dir, trashId) {
    const items = await this.readTrash(dir)
    const entry = items.find(i => i.id === trashId)
    if (!entry) return
    try { await api.fs.delete(entry.trashPath) } catch {}
    if (entry.type === 'character') {
      const charId = entry.originalPath.split('/').pop().replace(/\.json$/, '')
      try { await api.fs.delete(`${dir}/characters/${charId}.md`) } catch {}
      const imgDir = `${dir}/characters/images`
      if (await api.fs.exists(imgDir)) {
        const entries = await api.fs.readdir(imgDir)
        for (const e of entries) {
          if (e.name.startsWith(charId)) try { await api.fs.delete(e.path) } catch {}
        }
      }
    }
    await this._writeTrashManifest(dir, items.filter(i => i.id !== trashId))
  },

  async emptyTrash(dir) {
    const items = await this.readTrash(dir)
    for (const entry of items) {
      try { await api.fs.delete(entry.trashPath) } catch {}
      if (entry.type === 'character') {
        const charId = entry.originalPath.split('/').pop().replace(/\.json$/, '')
        try { await api.fs.delete(`${dir}/characters/${charId}.md`) } catch {}
        const imgDir = `${dir}/characters/images`
        if (await api.fs.exists(imgDir)) {
          const entries = await api.fs.readdir(imgDir)
          for (const e of entries) {
            if (e.name.startsWith(charId)) try { await api.fs.delete(e.path) } catch {}
          }
        }
      }
    }
    await this._writeTrashManifest(dir, [])
  }
}
