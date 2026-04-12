import { v4 as uuid } from 'uuid'

export async function createProject(name, parent) {
  const slug = name.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-').toLowerCase()
  const dir = `${parent}/${slug}`
  await window.api.fs.mkdir(dir)
  for (const d of ['documents', 'references', 'boards', 'exports']) {
    await window.api.fs.mkdir(`${dir}/${d}`)
  }
  const manifest = { id: uuid(), name: name.trim(), created: Date.now() }
  await window.api.fs.write(`${dir}/scriptum.json`, JSON.stringify(manifest, null, 2))
  await window.api.fs.write(`${dir}/boards/master.json`, JSON.stringify({ name: 'Master board', isMaster: true, nodes: [], updated: Date.now() }, null, 2))
  await window.api.fs.write(`${dir}/documents/Untitled.md`, `# ${name.trim()}\n\n`)
  return { ...manifest, dir }
}

export async function openProject(dir) {
  const ok = await window.api.fs.exists(`${dir}/scriptum.json`)
  if (!ok) throw new Error('Not a Scriptum project')
  return { ...JSON.parse(await window.api.fs.read(`${dir}/scriptum.json`)), dir }
}

export async function readDocs(dir) {
  return readTree(`${dir}/documents`)
}

async function readTree(dir) {
  if (!await window.api.fs.exists(dir)) return []
  const entries = await window.api.fs.readdir(dir)
  const out = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDir) out.push({ type: 'folder', name: e.name, path: e.path, children: await readTree(e.path) })
    else if (e.name.endsWith('.md')) out.push({ type: 'file', name: e.name.replace(/\.md$/, ''), path: e.path })
  }
  return out
}

export async function readBoards(dir) {
  const out = []
  try {
    const entries = await window.api.fs.readdir(`${dir}/boards`)
    for (const e of entries) {
      if (!e.name.endsWith('.json')) continue
      try { out.push({ file: e.name, ...JSON.parse(await window.api.fs.read(e.path)) }) } catch {}
    }
  } catch {}
  return out
}

export async function saveBoard(dir, file, data) {
  await window.api.fs.write(`${dir}/boards/${file}`, JSON.stringify({ ...data, updated: Date.now() }, null, 2))
}

export async function newBoard(dir, name) {
  const file = `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
  const data = { name, isMaster: false, nodes: [], updated: Date.now() }
  await saveBoard(dir, file, data)
  return { file, ...data }
}
