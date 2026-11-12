/** On-disk project format, version 2. Every path in it is relative to the project folder. */

export const FORMAT_VERSION = 2
export const MANIFEST_FILE = 'scriptum.json'

export type ItemKind = 'documents' | 'boards' | 'characters'
export const ITEM_KINDS = ['documents', 'boards', 'characters'] as const satisfies readonly ItemKind[]

export type TreeNode =
  | { type: 'document'; id: string; title: string }
  | { type: 'folder'; id: string; title: string; children: TreeNode[] }

export interface IndexEntry {
  id: string
  title: string
}

/** An item moved to the trash. Its file lives at trash/<kind>/<id>.json. */
export interface TrashEntry {
  kind: ItemKind
  id: string
  title: string
  trashedAt: number
}

/**
 * `scriptum.json`. Titles, folders and order live here, so listing a project
 * never has to read (or download) the item files themselves.
 */
export interface ProjectManifest {
  formatVersion: typeof FORMAT_VERSION
  id: string
  name: string
  created: number
  tree: TreeNode[]
  boards: IndexEntry[]
  characters: IndexEntry[]
  trash: TrashEntry[]
}

/**
 * Where a file's bytes are.
 * - local:       on this machine and readable
 * - cloud:       exists only in the cloud; a download has been requested
 * - downloading: a read is in progress and has not finished yet
 * - unavailable: the read failed (offline, permissions, I/O error, corrupt)
 * - missing:     no such file
 */
export type FileState = 'local' | 'cloud' | 'downloading' | 'unavailable' | 'missing'

/**
 * - saved:    disk matches memory
 * - dirty:    changes waiting to be written
 * - saving:   a write is in progress
 * - error:    the last write failed; it will be retried
 * - conflict: the file changed on disk since it was loaded; our version is
 *             being saved to a separate conflict copy instead
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

export interface ItemStatus {
  fileState: FileState
  saveState: SaveState
  error: string | null
  conflictPath: string | null
}
