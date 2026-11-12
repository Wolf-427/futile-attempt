import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import {
  CHARACTER_TEXT_FIELDS,
  blocksText,
  type Align,
  type BlockNode,
  type BoardEdge,
  type BoardFile,
  type BoardNode,
  type CharacterFile,
  type DocumentFile
} from '@shared/content'
import {
  FORMAT_VERSION,
  MANIFEST_FILE,
  type IndexEntry,
  type ItemKind,
  type ProjectManifest,
  type TrashEntry,
  type TreeNode
} from '@shared/project'
import { atomicWrite } from '../storage/atomic'
import { realFs } from '../storage/fs'
import { ProjectStore } from '../storage/project'
import type { SnapshotStore } from '../storage/snapshots'
import { htmlToBlocks } from './html'
import { v1MarkdownToDoc } from './v1markdown'

export interface ImportCount {
  found: number
  imported: number
}

export interface ImportReport {
  source: string
  destination: string
  projectName: string
  documents: ImportCount
  folders: number
  boards: ImportCount
  characters: ImportCount
  trash: ImportCount
  assets: number
  snapshots: number
  /** Things that were imported but need a look. */
  warnings: string[]
  /** Things that could not be imported. Non-empty means the import is incomplete. */
  errors: string[]
}

export interface ImportOptions {
  /** If given, v1 backups become the first local snapshots of their documents. */
  snapshots?: SnapshotStore
  now?: () => Date
}

type Raw = Record<string, unknown>

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function isDir(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false
  )
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false
  )
}

async function list(dir: string): Promise<string[]> {
  return (await isDir(dir)) ? (await readdir(dir)).sort(collator.compare) : []
}

/** `.Chapter.md.icloud` is an iCloud placeholder for `Chapter.md`. */
function stubTarget(name: string): string | null {
  const m = /^\.(.+)\.icloud$/.exec(name)
  return m?.[1] ?? null
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Rough plain text of a v1 document, for comparing word counts before and after. */
function v1PlainText(md: string): string {
  return md
    .replace(/^---PAGE---$/gm, '')
    .replace(/<\/?(ul|ol|li|p|strong|em|u|s|br|span|b|i)(\s[^>]*)?>/g, ' ')
    .replace(/^(#{1,3} |(>\s*)+)/gm, '')
    .replace(/\*\*|~~|\*(?=\S)|(?<=\S)\*/g, '')
}

function noteContent(node: Raw): BlockNode[] {
  const html = str(node['html'])
  if (html.trim()) {
    const blocks = htmlToBlocks(html)
    if (blocks.length) return blocks
  }
  return str(node['text'])
    .split('\n')
    .map((line): BlockNode => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
}

/**
 * Convert a v1 project folder into a new format 2 folder.
 *
 * The v1 folder is only read. The destination must not exist; its manifest is
 * written last, so an interrupted import never leaves something that opens as
 * a project.
 */
export async function importV1Project(
  source: string,
  destination: string,
  options: ImportOptions = {}
): Promise<ImportReport> {
  const now = options.now ?? (() => new Date())
  const warnings: string[] = []
  const errors: string[] = []

  // ── source manifest ──────────────────────────────────────────────────────
  let v1: Raw
  try {
    const parsed: unknown = JSON.parse(await readFile(join(source, MANIFEST_FILE), 'utf8'))
    if (!isRecord(parsed)) throw new Error('not an object')
    v1 = parsed
  } catch (e) {
    throw new Error(`Cannot read ${join(source, MANIFEST_FILE)}: ${message(e)}`)
  }
  if (v1['formatVersion'] !== undefined) {
    throw new Error('This folder is already a format 2 project; nothing to import.')
  }
  if (await stat(destination).then(() => true, () => false)) {
    throw new Error(`Destination already exists: ${destination}`)
  }

  const projectId = randomUUID()
  const projectName = str(v1['name'], basename(source))
  const report: ImportReport = {
    source,
    destination,
    projectName,
    documents: { found: 0, imported: 0 },
    folders: 0,
    boards: { found: 0, imported: 0 },
    characters: { found: 0, imported: 0 },
    trash: { found: 0, imported: 0 },
    assets: 0,
    snapshots: 0,
    warnings,
    errors
  }

  const files = new Map<string, string>() // destination-relative path -> JSON text
  const put = (kind: ItemKind | `trash/${ItemKind}`, id: string, value: unknown): void => {
    files.set(join(kind, `${id}.json`), JSON.stringify(value))
  }

  // ── assets ───────────────────────────────────────────────────────────────
  const assetCopies = new Map<string, string>() // asset path -> absolute source
  const refDir = join(source, 'references')
  for (const name of await list(refDir)) {
    const stub = stubTarget(name)
    if (stub) errors.push(`Image not downloaded from the cloud: references/${stub}`)
    else if (!name.startsWith('.') && (await isFile(join(refDir, name)))) assetCopies.set(name, join(refDir, name))
  }
  const charImgDir = join(source, 'characters', 'images')
  for (const name of await list(charImgDir)) {
    const stub = stubTarget(name)
    if (stub) errors.push(`Image not downloaded from the cloud: characters/images/${stub}`)
    else if (!name.startsWith('.') && (await isFile(join(charImgDir, name)))) {
      assetCopies.set(join('characters', name), join(charImgDir, name))
    }
  }

  /** Map a v1 image path (absolute, possibly from an older location) to an asset. */
  const resolveAsset = async (v1Path: string, context: string): Promise<string | null> => {
    if (!v1Path) return null
    const name = basename(v1Path)
    if (assetCopies.has(name)) return name
    if (v1Path.startsWith('/') && (await isFile(v1Path))) {
      assetCopies.set(name, v1Path)
      return name
    }
    warnings.push(`${context}: image not found (${v1Path})`)
    return null
  }

  // ── documents ────────────────────────────────────────────────────────────
  const docIdByRelPath = new Map<string, string>()
  const docIdsByTitle = new Map<string, string[]>()
  const backups: { docKey: string; path: string; at: Date }[] = []

  const readDocument = async (path: string, label: string): Promise<DocumentFile | null> => {
    try {
      const md = await readFile(path, 'utf8')
      const doc = v1MarkdownToDoc(md)
      const before = words(v1PlainText(md))
      const after = words(blocksText(doc.content))
      if (Math.abs(before - after) > Math.max(3, before * 0.02)) {
        warnings.push(`${label}: word count changed from ${before} to ${after}; compare with the original`)
      }
      return { doc }
    } catch (e) {
      errors.push(`${label}: could not be read (${message(e)})`)
      return null
    }
  }

  const walk = async (dir: string): Promise<TreeNode[]> => {
    const nodes: TreeNode[] = []
    for (const name of await list(dir)) {
      const path = join(dir, name)
      const rel = relative(join(source, 'documents'), path).split(sep).join('/')
      const stub = stubTarget(name)
      if (stub?.endsWith('.md')) {
        report.documents.found++
        errors.push(`documents/${dirname(rel) === '.' ? '' : dirname(rel) + '/'}${stub}: not downloaded from the cloud`)
        continue
      }
      if (name.startsWith('.')) continue

      if (await isDir(path)) {
        if (name === 'backups') {
          for (const b of await list(path)) {
            const m = /^(.+)_(?:timed|switch)_(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)\.md$/.exec(b)
            if (!m) continue
            const parent = dirname(rel)
            const docKey = (parent === '.' ? '' : parent + '/') + `${m[1]}.md`
            const at = new Date(`${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}`)
            backups.push({ docKey, path: join(path, b), at })
          }
          continue
        }
        report.folders++
        nodes.push({ type: 'folder', id: randomUUID(), title: name, children: await walk(path) })
      } else if (name.endsWith('.md')) {
        report.documents.found++
        const file = await readDocument(path, `documents/${rel}`)
        if (!file) continue
        const id = randomUUID()
        const title = name.replace(/\.md$/, '')
        put('documents', id, file)
        docIdByRelPath.set(rel, id)
        docIdsByTitle.set(title, [...(docIdsByTitle.get(title) ?? []), id])
        nodes.push({ type: 'document', id, title })
        report.documents.imported++
      }
    }
    return nodes
  }
  const tree = await walk(join(source, 'documents'))

  const resolveDocLink = (v1Path: string, title: string): string | null => {
    const marker = '/documents/'
    const at = v1Path.lastIndexOf(marker)
    const byPath = at >= 0 ? docIdByRelPath.get(v1Path.slice(at + marker.length)) : undefined
    if (byPath) return byPath
    const byTitle = docIdsByTitle.get(title || basename(v1Path, '.md'))
    return byTitle?.length === 1 ? (byTitle[0] ?? null) : null
  }

  // ── boards ───────────────────────────────────────────────────────────────
  const boardsDir = join(source, 'boards')
  const rawBoards: { file: string; id: string; data: Raw }[] = []
  for (const name of await list(boardsDir)) {
    const stub = stubTarget(name)
    if (stub?.endsWith('.json')) {
      report.boards.found++
      errors.push(`boards/${stub}: not downloaded from the cloud`)
      continue
    }
    if (name.startsWith('.') || !name.endsWith('.json')) continue
    report.boards.found++
    try {
      const data: unknown = JSON.parse(await readFile(join(boardsDir, name), 'utf8'))
      if (!isRecord(data)) throw new Error('not an object')
      rawBoards.push({ file: name, id: randomUUID(), data })
    } catch (e) {
      errors.push(`boards/${name}: could not be read (${message(e)})`)
    }
  }
  const boardIdByFile = new Map(rawBoards.map((b) => [b.file, b.id]))

  const convertBoard = async (data: Raw, label: string): Promise<BoardFile> => {
    const rawNodes = Array.isArray(data['nodes']) ? data['nodes'].filter(isRecord) : []
    const ids = new Set(rawNodes.map((n) => str(n['id'])).filter(Boolean))
    const nodes: BoardNode[] = []

    for (const n of rawNodes) {
      const id = str(n['id']) || randomUUID()
      const base = { id, x: num(n['x'], 0), y: num(n['y'], 0), width: num(n['width'], 220) }
      const height = typeof n['height'] === 'number' ? { height: n['height'] } : {}
      const fontSize = typeof n['fontSize'] === 'number' ? { fontSize: n['fontSize'] } : {}
      const a = n['align']
      const align: { align?: Align } =
        a === 'left' || a === 'center' || a === 'right' || a === 'justify' ? { align: a } : {}

      switch (n['type']) {
        case 'note':
          nodes.push({ ...base, ...height, ...fontSize, ...align, type: 'note', color: str(n['color'], 'yellow'), content: noteContent(n) })
          break
        case 'text':
          nodes.push({ ...base, ...height, ...fontSize, ...align, type: 'text', content: noteContent(n) })
          break
        case 'image': {
          const asset = await resolveAsset(str(n['src']), label)
          const ratio = typeof n['aspectRatio'] === 'number' ? { aspectRatio: n['aspectRatio'] } : {}
          nodes.push({ ...base, ...height, ...ratio, type: 'image', asset })
          break
        }
        case 'subboard': {
          const boardId = boardIdByFile.get(str(n['file'])) ?? null
          if (!boardId) warnings.push(`${label}: sub-board "${str(n['name'])}" points to a board that no longer exists`)
          const cover = n['cover'] ? await resolveAsset(str(n['cover']), label) : null
          nodes.push({ ...base, type: 'subboard', boardId, title: str(n['name']), cover })
          break
        }
        case 'doclink': {
          const title = str(n['name'])
          const documentId = resolveDocLink(str(n['path']), title)
          if (!documentId) warnings.push(`${label}: link to document "${title}" could not be matched`)
          nodes.push({ ...base, ...height, type: 'doclink', documentId, title })
          break
        }
        case 'group': {
          const members = (Array.isArray(n['members']) ? n['members'] : []).filter(
            (m): m is string => typeof m === 'string' && ids.has(m)
          )
          nodes.push({ ...base, height: num(n['height'], 160), type: 'group', name: str(n['name'], 'Group'), members: [...new Set(members)] })
          break
        }
        default:
          warnings.push(`${label}: skipped an item of unknown type "${str(n['type'])}"`)
      }
    }

    const kept = new Set(nodes.map((n) => n.id))
    const edges: BoardEdge[] = []
    for (const arrow of Array.isArray(data['arrows']) ? data['arrows'].filter(isRecord) : []) {
      const source = str(arrow['from'])
      const target = str(arrow['to'])
      if (!kept.has(source) || !kept.has(target)) continue
      const edge: BoardEdge = { id: str(arrow['id']) || randomUUID(), source, target }
      const color = str(arrow['color'])
      if (color && color !== 'default') edge.color = color
      if (arrow['dashed'] === true) edge.dashed = true
      edges.push(edge)
    }

    const view = isRecord(data['viewState']) ? data['viewState'] : {}
    const pan = isRecord(view['pan']) ? view['pan'] : {}
    return {
      isMaster: data['isMaster'] === true,
      nodes,
      edges,
      viewport: { x: num(pan['x'], 0), y: num(pan['y'], 0), zoom: num(view['zoom'], 1) }
    }
  }

  const boards: IndexEntry[] = []
  for (const b of rawBoards) {
    const title = str(b.data['name'], b.file.replace(/\.json$/, ''))
    put('boards', b.id, await convertBoard(b.data, `Board "${title}"`))
    boards.push({ id: b.id, title })
    report.boards.imported++
  }
  const masterIds = new Set(rawBoards.filter((b) => b.data['isMaster'] === true).map((b) => b.id))
  boards.sort((x, y) => Number(masterIds.has(y.id)) - Number(masterIds.has(x.id)) || collator.compare(x.title, y.title))

  // ── characters ───────────────────────────────────────────────────────────
  const convertCharacter = (data: Raw): CharacterFile => {
    const out: CharacterFile = { image: null, refImages: [], created: num(data['created'], now().getTime()) }
    for (const field of CHARACTER_TEXT_FIELDS) {
      const value = data[field]
      if (typeof value === 'string' && value) out[field] = value
    }
    const image = str(data['imageFile'])
    if (image) {
      if (assetCopies.has(join('characters', image))) out.image = `characters/${image}`
      else warnings.push(`Character "${str(data['name'])}": portrait not found (${image})`)
    }
    for (const ref of Array.isArray(data['refImages']) ? data['refImages'] : []) {
      if (typeof ref !== 'string') continue
      if (assetCopies.has(join('characters', ref))) out.refImages.push(`characters/${ref}`)
      else warnings.push(`Character "${str(data['name'])}": reference image not found (${ref})`)
    }
    return out
  }

  const characters: IndexEntry[] = []
  const charDir = join(source, 'characters')
  for (const name of await list(charDir)) {
    const stub = stubTarget(name)
    if (stub?.endsWith('.json')) {
      report.characters.found++
      errors.push(`characters/${stub}: not downloaded from the cloud`)
      continue
    }
    if (name.startsWith('.') || !name.endsWith('.json')) continue
    report.characters.found++
    try {
      const data: unknown = JSON.parse(await readFile(join(charDir, name), 'utf8'))
      if (!isRecord(data)) throw new Error('not an object')
      const id = randomUUID()
      put('characters', id, convertCharacter(data))
      characters.push({ id, title: str(data['name'], 'Unnamed') })
      report.characters.imported++
    } catch (e) {
      errors.push(`characters/${name}: could not be read (${message(e)})`)
    }
  }
  characters.sort((x, y) => collator.compare(x.title, y.title))

  // ── trash ────────────────────────────────────────────────────────────────
  const trash: TrashEntry[] = []
  const trashManifest = join(source, 'trash', 'manifest.json')
  if (await isFile(trashManifest)) {
    let entries: Raw[] = []
    try {
      const parsed: unknown = JSON.parse(await readFile(trashManifest, 'utf8'))
      entries = Array.isArray(parsed) ? parsed.filter(isRecord) : []
    } catch (e) {
      errors.push(`trash/manifest.json: could not be read (${message(e)})`)
    }
    const kinds: Record<string, ItemKind> = { document: 'documents', board: 'boards', character: 'characters' }
    for (const entry of entries) {
      report.trash.found++
      const kind = kinds[str(entry['type'])]
      const title = str(entry['name'], 'Untitled')
      if (!kind) {
        warnings.push(`Trash: skipped "${title}" of unknown type`)
        continue
      }
      // Stored paths are absolute and may be stale; only the file name is trusted.
      const path = join(source, 'trash', kind, basename(str(entry['trashPath'])))
      const id = randomUUID()
      try {
        if (kind === 'documents') {
          const file = await readDocument(path, `Trash "${title}"`)
          if (!file) continue
          put('trash/documents', id, file)
        } else {
          const data: unknown = JSON.parse(await readFile(path, 'utf8'))
          if (!isRecord(data)) throw new Error('not an object')
          if (kind === 'boards') put('trash/boards', id, await convertBoard(data, `Trashed board "${title}"`))
          else put('trash/characters', id, convertCharacter(data))
        }
        trash.push({ kind, id, title, trashedAt: num(entry['trashedAt'], now().getTime()) })
        report.trash.imported++
      } catch (e) {
        errors.push(`Trash "${title}": could not be read (${message(e)})`)
      }
    }
  }

  // ── write ────────────────────────────────────────────────────────────────
  for (const sub of ['documents', 'boards', 'characters', 'assets', 'trash']) {
    await mkdir(join(destination, sub), { recursive: true })
  }
  for (const [asset, from] of assetCopies) {
    try {
      await mkdir(dirname(join(destination, 'assets', asset)), { recursive: true })
      await copyFile(from, join(destination, 'assets', asset))
      report.assets++
    } catch (e) {
      errors.push(`Image ${asset}: could not be copied (${message(e)})`)
    }
  }
  for (const [path, text] of files) await atomicWrite(realFs, join(destination, path), text)

  if (options.snapshots) {
    backups.sort((a, b) => a.at.getTime() - b.at.getTime())
    for (const backup of backups) {
      const id = docIdByRelPath.get(backup.docKey)
      if (!id || Number.isNaN(backup.at.getTime())) continue
      try {
        const file: DocumentFile = { doc: v1MarkdownToDoc(await readFile(backup.path, 'utf8')) }
        if (await options.snapshots.add(projectId, 'documents', id, JSON.stringify(file), 'v1-backup', backup.at)) {
          report.snapshots++
        }
      } catch (e) {
        warnings.push(`Backup ${basename(backup.path)}: could not be imported (${message(e)})`)
      }
    }
  }

  const manifest: ProjectManifest = {
    formatVersion: FORMAT_VERSION,
    id: projectId,
    name: projectName,
    created: num(v1['created'], now().getTime()),
    tree,
    boards,
    characters,
    trash
  }
  await atomicWrite(realFs, join(destination, MANIFEST_FILE), JSON.stringify(manifest, null, 2))

  // ── verify: open the result the way the app will, and read every item back ─
  const opened = await ProjectStore.open(destination)
  if (!opened.ok) {
    errors.push(`The imported project does not open: ${opened.reason}`)
    return report
  }
  const check = async (kind: ItemKind, id: string, title: string): Promise<void> => {
    const item = await opened.project.loadItem(kind, id)
    if (!item.ok) errors.push(`Verification: ${kind} "${title}" cannot be read back (${item.state})`)
  }
  const checkTree = async (nodes: TreeNode[]): Promise<void> => {
    for (const n of nodes) {
      if (n.type === 'folder') await checkTree(n.children)
      else await check('documents', n.id, n.title)
    }
  }
  await checkTree(tree)
  for (const b of boards) await check('boards', b.id, b.title)
  for (const c of characters) await check('characters', c.id, c.title)
  await opened.project.close()

  return report
}

export function formatReport(r: ImportReport): string {
  const row = (label: string, c: ImportCount): string =>
    `  ${label.padEnd(11)} ${c.imported} of ${c.found}${c.imported === c.found ? '' : '   <-- INCOMPLETE'}`
  const lines = [
    `Imported "${r.projectName}"`,
    `  from  ${r.source}`,
    `  to    ${r.destination}`,
    '',
    row('Documents', r.documents),
    `  Folders     ${r.folders}`,
    row('Boards', r.boards),
    row('Characters', r.characters),
    row('Trash', r.trash),
    `  Images      ${r.assets}`,
    `  Snapshots   ${r.snapshots} (from v1 backups)`
  ]
  if (r.warnings.length) lines.push('', `Warnings (${r.warnings.length}):`, ...r.warnings.map((w) => `  - ${w}`))
  if (r.errors.length) lines.push('', `Errors (${r.errors.length}):`, ...r.errors.map((e) => `  - ${e}`))
  lines.push('', r.errors.length ? 'RESULT: INCOMPLETE' : 'RESULT: COMPLETE')
  return lines.join('\n')
}

