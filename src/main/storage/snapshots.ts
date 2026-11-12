import { join } from 'node:path'
import type { ItemKind } from '@shared/project'
import { atomicWrite } from './atomic'
import { errorCode, realFs, type Fs } from './fs'

export interface SnapshotInfo {
  name: string
  takenAt: string
  reason: string
}

/**
 * Local history of item contents, kept outside the project folder (and so
 * outside any cloud sync): <root>/<projectId>/<kind>/<itemId>/<time>_<reason>.json
 */
export class SnapshotStore {
  constructor(
    private readonly root: string,
    private readonly options: { fs?: Fs; keep?: number; now?: () => Date } = {}
  ) {}

  private get fs(): Fs {
    return this.options.fs ?? realFs
  }

  private dir(projectId: string, kind: ItemKind | 'manifest', itemId: string): string {
    return join(this.root, projectId, kind, itemId)
  }

  async list(
    projectId: string,
    kind: ItemKind | 'manifest',
    itemId: string
  ): Promise<SnapshotInfo[]> {
    let names: string[]
    try {
      names = await this.fs.readdir(this.dir(projectId, kind, itemId))
    } catch (e) {
      if (errorCode(e) === 'ENOENT') return []
      throw e
    }
    return names
      .filter((n) => n.endsWith('.json') && !n.startsWith('.'))
      .sort()
      .reverse()
      .map((name) => {
        const [stamp = '', reason = ''] = name.replace(/\.json$/, '').split('_')
        return { name, takenAt: stamp, reason }
      })
  }

  async read(
    projectId: string,
    kind: ItemKind | 'manifest',
    itemId: string,
    name: string
  ): Promise<string> {
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
      throw new Error(`Invalid snapshot name: ${name}`)
    }
    return this.fs.readFile(join(this.dir(projectId, kind, itemId), name), 'utf8')
  }

  /** Store a snapshot unless it is identical to the newest one. Returns whether one was written. */
  async add(
    projectId: string,
    kind: ItemKind | 'manifest',
    itemId: string,
    text: string,
    reason: string,
    at?: Date
  ): Promise<boolean> {
    const existing = await this.list(projectId, kind, itemId)
    const newest = existing[0]
    if (newest && (await this.read(projectId, kind, itemId, newest.name)) === text) return false

    const stamp = (at ?? this.options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
    const safeReason = reason.replace(/[^a-z0-9-]/gi, '-')
    const dir = this.dir(projectId, kind, itemId)
    await atomicWrite(this.fs, join(dir, `${stamp}_${safeReason}.json`), text)

    const keep = this.options.keep ?? 30
    for (const old of existing.slice(Math.max(0, keep - 1))) {
      try {
        await this.fs.unlink(join(dir, old.name))
      } catch {
        // pruning is best effort
      }
    }
    return true
  }
}
