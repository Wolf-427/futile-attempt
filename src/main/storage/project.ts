import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  FORMAT_VERSION,
  ITEM_KINDS,
  MANIFEST_FILE,
  type FileState,
  type IndexEntry,
  type ItemKind,
  type ItemStatus,
  type ProjectManifest,
  type TreeNode
} from '@shared/project'
import { cleanTempFiles } from './atomic'
import { probe } from './fileState'
import { errorMessage, exists, realFs, type Fs } from './fs'
import type { SnapshotStore } from './snapshots'
import { TrackedFile, type TrackedFileOptions } from './trackedFile'

const PROJECT_DIRS = [...ITEM_KINDS, 'assets', 'trash'] as const
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface ProjectOptions {
  fs?: Fs
  snapshots?: SnapshotStore
  file?: Pick<
    TrackedFileOptions,
    'platform' | 'readTimeoutMs' | 'saveDelayMs' | 'retryDelayMs' | 'requestDownload' | 'now'
  >
  onItemChange?: (kind: ItemKind | 'manifest', id: string, status: ItemStatus) => void
}

export type OpenResult =
  | { ok: true; project: ProjectStore }
  | {
      ok: false
      /**
       * A file state means the manifest could not be read yet (still in the
       * cloud, offline, ...). The folder may well be a valid project.
       */
      reason: Exclude<FileState, 'local'> | 'needs-import' | 'newer-format' | 'invalid'
      error?: string
    }

export type ItemResult<T> =
  | { ok: true; value: T }
  | { ok: false; state: Exclude<FileState, 'local'>; error?: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isIndex(v: unknown): v is IndexEntry[] {
  return (
    Array.isArray(v) &&
    v.every((e) => isRecord(e) && typeof e['id'] === 'string' && typeof e['title'] === 'string')
  )
}

function isTree(v: unknown): v is TreeNode[] {
  return (
    Array.isArray(v) &&
    v.every((n) => {
      if (!isRecord(n) || typeof n['id'] !== 'string' || typeof n['title'] !== 'string') return false
      if (n['type'] === 'document') return true
      return n['type'] === 'folder' && isTree(n['children'])
    })
  )
}

function parseManifest(
  text: string
):
  | { ok: true; manifest: ProjectManifest }
  | { ok: false; reason: 'needs-import' | 'newer-format' | 'invalid'; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, reason: 'invalid', error: errorMessage(e) }
  }
  if (!isRecord(raw) || typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string') {
    return { ok: false, reason: 'invalid', error: 'Not a Scriptum manifest' }
  }
  const version = raw['formatVersion']
  // v1 manifests are { id, name, created } with no version field.
  if (version === undefined) return { ok: false, reason: 'needs-import' }
  if (typeof version !== 'number') return { ok: false, reason: 'invalid', error: 'Bad formatVersion' }
  if (version > FORMAT_VERSION) return { ok: false, reason: 'newer-format' }
  if (version < FORMAT_VERSION) return { ok: false, reason: 'needs-import' }
  if (!isTree(raw['tree']) || !isIndex(raw['boards']) || !isIndex(raw['characters'])) {
    return { ok: false, reason: 'invalid', error: 'Manifest is missing its item lists' }
  }
  return {
    ok: true,
    manifest: {
      formatVersion: FORMAT_VERSION,
      id: raw['id'],
      name: raw['name'],
      created: typeof raw['created'] === 'number' ? raw['created'] : 0,
      tree: raw['tree'],
      boards: raw['boards'],
      characters: raw['characters']
    }
  }
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
  return slug || 'project'
}

function findNode(tree: TreeNode[], id: string): TreeNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node
    if (node.type === 'folder') {
      const hit = findNode(node.children, id)
      if (hit) return hit
    }
  }
  return undefined
}

function documentIds(tree: TreeNode[], out: string[] = []): string[] {
  for (const node of tree) {
    if (node.type === 'document') out.push(node.id)
    else documentIds(node.children, out)
  }
  return out
}

/** One open project folder. All access to its files goes through here. */
export class ProjectStore {
  private readonly files = new Map<string, TrackedFile>()

  private constructor(
    readonly dir: string,
    private manifestData: ProjectManifest,
    private readonly manifestFile: TrackedFile,
    private readonly options: ProjectOptions
  ) {}

  private static fileOptions(
    options: ProjectOptions,
    kind: ItemKind | 'manifest',
    id: string,
    projectId: () => string
  ): TrackedFileOptions {
    const base: TrackedFileOptions = { ...options.file }
    if (options.fs) base.fs = options.fs
    const snapshots = options.snapshots
    if (snapshots) {
      base.beforeFirstWrite = async (text) => {
        await snapshots.add(projectId(), kind, id, text, 'session-start')
      }
    }
    const notify = options.onItemChange
    if (notify) base.onChange = (file) => notify(kind, id, file.status())
    return base
  }

  /** Create a new project folder inside `parentDir`. Never writes into an existing folder. */
  static async create(
    parentDir: string,
    name: string,
    options: ProjectOptions = {}
  ): Promise<ProjectStore> {
    const fs = options.fs ?? realFs
    const title = name.trim()
    if (!title) throw new Error('Project name is empty')

    const slug = slugify(title)
    let dir = join(parentDir, slug)
    for (let n = 2; await exists(fs, dir); n++) dir = join(parentDir, `${slug}-${n}`)

    for (const sub of PROJECT_DIRS) await fs.mkdir(join(dir, sub), { recursive: true })

    const manifest: ProjectManifest = {
      formatVersion: FORMAT_VERSION,
      id: randomUUID(),
      name: title,
      created: (options.file?.now?.() ?? new Date()).getTime(),
      tree: [],
      boards: [],
      characters: []
    }
    const manifestFile = await TrackedFile.createNew(
      join(dir, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
      ProjectStore.fileOptions(options, 'manifest', 'manifest', () => manifest.id)
    )
    return new ProjectStore(dir, manifest, manifestFile, options)
  }

  /** Open an existing project folder. Reads only the manifest. */
  static async open(dir: string, options: ProjectOptions = {}): Promise<OpenResult> {
    const fs = options.fs ?? realFs
    let projectId = ''
    const manifestFile = new TrackedFile(
      join(dir, MANIFEST_FILE),
      ProjectStore.fileOptions(options, 'manifest', 'manifest', () => projectId)
    )
    const loaded = await manifestFile.load()
    if (!loaded.ok) {
      manifestFile.dispose()
      return loaded.error === undefined
        ? { ok: false, reason: loaded.state }
        : { ok: false, reason: loaded.state, error: loaded.error }
    }
    const parsed = parseManifest(loaded.text)
    if (!parsed.ok) {
      manifestFile.dispose()
      return parsed.error === undefined
        ? { ok: false, reason: parsed.reason }
        : { ok: false, reason: parsed.reason, error: parsed.error }
    }
    projectId = parsed.manifest.id

    // Leftovers from a crash between writing a temp file and renaming it.
    await cleanTempFiles(fs, dir)
    for (const kind of ITEM_KINDS) await cleanTempFiles(fs, join(dir, kind))

    return { ok: true, project: new ProjectStore(dir, parsed.manifest, manifestFile, options) }
  }

  get manifest(): Readonly<ProjectManifest> {
    return this.manifestData
  }

  // ── items ────────────────────────────────────────────────────────────────

  private itemPath(kind: ItemKind, id: string): string {
    if (!ITEM_KINDS.includes(kind)) throw new Error(`Unknown item kind: ${String(kind)}`)
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid item id: ${id}`)
    return join(this.dir, kind, `${id}.json`)
  }

  private knownIds(kind: ItemKind): string[] {
    if (kind === 'documents') return documentIds(this.manifestData.tree)
    return this.manifestData[kind].map((e) => e.id)
  }

  private tracked(kind: ItemKind, id: string): TrackedFile {
    const path = this.itemPath(kind, id)
    const key = `${kind}/${id}`
    let file = this.files.get(key)
    if (!file) {
      file = new TrackedFile(
        path,
        ProjectStore.fileOptions(this.options, kind, id, () => this.manifestData.id)
      )
      this.files.set(key, file)
    }
    return file
  }

  /** Create a new item file and list it in the manifest. Returns its id. */
  async createItem(
    kind: ItemKind,
    title: string,
    initial: unknown,
    parentFolderId?: string
  ): Promise<string> {
    if (kind === 'documents' && parentFolderId) {
      if (findNode(this.manifestData.tree, parentFolderId)?.type !== 'folder') {
        throw new Error(`No such folder: ${parentFolderId}`)
      }
    }
    const id = randomUUID()
    const file = await TrackedFile.createNew(
      this.itemPath(kind, id),
      JSON.stringify(initial),
      ProjectStore.fileOptions(this.options, kind, id, () => this.manifestData.id)
    )
    this.files.set(`${kind}/${id}`, file)

    const next = structuredClone(this.manifestData)
    if (kind === 'documents') {
      const parent = parentFolderId ? findNode(next.tree, parentFolderId) : undefined
      const siblings = parent?.type === 'folder' ? parent.children : next.tree
      siblings.push({ type: 'document', id, title })
    } else {
      next[kind].push({ id, title })
    }
    await this.writeManifest(next)
    return id
  }

  /** Change a title. Titles live in the manifest, so no item file is touched. */
  async renameItem(kind: ItemKind, id: string, title: string): Promise<void> {
    const next = structuredClone(this.manifestData)
    const entry = kind === 'documents' ? findNode(next.tree, id) : next[kind].find((e) => e.id === id)
    if (!entry) throw new Error(`No such item: ${kind}/${id}`)
    entry.title = title
    await this.writeManifest(next)
  }

  /** Read and parse an item. A failed read never yields an empty value. */
  async loadItem<T = unknown>(kind: ItemKind, id: string): Promise<ItemResult<T>> {
    const file = this.tracked(kind, id)
    const loaded = await file.load()
    if (!loaded.ok) return loaded
    try {
      return { ok: true, value: JSON.parse(loaded.text) as T }
    } catch (e) {
      // Corrupt content. Drop the handle so nothing can be written over it.
      file.dispose()
      this.files.delete(`${kind}/${id}`)
      return { ok: false, state: 'unavailable', error: `File is not valid JSON: ${errorMessage(e)}` }
    }
  }

  /** Replace an item's content. Throws if the item was not loaded successfully first. */
  updateItem(kind: ItemKind, id: string, value: unknown): void {
    const file = this.files.get(`${kind}/${id}`)
    if (!file?.isLoaded) throw new Error(`Item is not loaded: ${kind}/${id}`)
    file.update(JSON.stringify(value))
  }

  async reloadItem<T = unknown>(kind: ItemKind, id: string): Promise<ItemResult<T>> {
    await this.tracked(kind, id).reload()
    return this.loadItem<T>(kind, id)
  }

  itemStatus(kind: ItemKind, id: string): ItemStatus | null {
    return this.files.get(`${kind}/${id}`)?.status() ?? null
  }

  /** Where every listed item's bytes are, without reading (or downloading) any of them. */
  async itemStates(): Promise<Record<string, FileState>> {
    const fs = this.options.fs ?? realFs
    const out: Record<string, FileState> = {}
    for (const kind of ITEM_KINDS) {
      for (const id of this.knownIds(kind)) {
        const key = `${kind}/${id}`
        const open = this.files.get(key)
        if (open?.isLoaded) {
          out[key] = 'local'
          continue
        }
        try {
          const presence = await probe(fs, this.itemPath(kind, id), this.options.file?.platform)
          out[key] = presence === 'local' ? 'local' : presence === 'missing' ? 'missing' : 'cloud'
        } catch {
          out[key] = 'unavailable'
        }
      }
    }
    return out
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Write everything pending. Returns the keys that are still not safely on disk. */
  async flushAll(): Promise<string[]> {
    const entries: [string, TrackedFile][] = [['manifest', this.manifestFile], ...this.files]
    const unsaved: string[] = []
    await Promise.all(
      entries.map(async ([key, file]) => {
        const status = await file.flush()
        if (status.saveState === 'error' || status.saveState === 'dirty') unsaved.push(key)
      })
    )
    return unsaved
  }

  async close(): Promise<string[]> {
    const unsaved = await this.flushAll()
    this.manifestFile.dispose()
    for (const file of this.files.values()) file.dispose()
    return unsaved
  }

  private async writeManifest(next: ProjectManifest): Promise<void> {
    this.manifestFile.update(JSON.stringify(next, null, 2))
    const status = await this.manifestFile.flush()
    if (status.saveState === 'error') {
      throw new Error(`Could not save the project manifest: ${status.error ?? 'unknown error'}`)
    }
    this.manifestData = next
  }
}

