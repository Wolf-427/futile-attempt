import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MANIFEST_FILE } from '@shared/project'
import type { RecentProject } from '@shared/ipc'
import { atomicWrite } from './storage/atomic'
import { probe } from './storage/fileState'
import { realFs } from './storage/fs'

interface StoredRecent {
  id: string
  name: string
  dir: string
  openedAt: number
}

function isStoredRecent(v: unknown): v is StoredRecent {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r['id'] === 'string' &&
    typeof r['name'] === 'string' &&
    typeof r['dir'] === 'string' &&
    typeof r['openedAt'] === 'number'
  )
}

/** App-wide state that is not part of any project: for now, the recent list. */
export class AppState {
  private recentList: StoredRecent[] = []
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      const recent = (raw as { recent?: unknown } | null)?.recent
      this.recentList = Array.isArray(recent) ? recent.filter(isStoredRecent) : []
    } catch {
      this.recentList = []
    }
  }

  private save(): Promise<void> {
    const text = JSON.stringify({ recent: this.recentList }, null, 2)
    this.writes = this.writes.then(() => atomicWrite(realFs, this.path, text)).catch(() => undefined)
    return this.writes
  }

  /** The recent list, newest first, with where each project currently is. */
  async recent(): Promise<RecentProject[]> {
    return Promise.all(
      this.recentList.map(async (r): Promise<RecentProject> => {
        let state: RecentProject['state'] = 'missing'
        try {
          const presence = await probe(realFs, join(r.dir, MANIFEST_FILE))
          state = presence === 'local' ? 'local' : presence === 'missing' ? 'missing' : 'cloud'
        } catch {
          state = 'missing'
        }
        return { ...r, state }
      })
    )
  }

  /**
   * Record that a project was opened. A project is identified by its id, so
   * one that was moved in Finder updates its entry instead of adding a second.
   */
  async touch(project: { id: string; name: string; dir: string }, now = Date.now()): Promise<void> {
    this.recentList = [
      { ...project, openedAt: now },
      ...this.recentList.filter((r) => r.id !== project.id && r.dir !== project.dir)
    ].slice(0, 30)
    await this.save()
  }

  async forget(dir: string): Promise<void> {
    this.recentList = this.recentList.filter((r) => r.dir !== dir)
    await this.save()
  }
}
