import { resolve } from 'node:path'
import { ProjectStore, type OpenResult, type ProjectOptions } from './project'
import { SnapshotStore } from './snapshots'

/** Owns every open project. The only object in the app that touches project files. */
export class StorageService {
  private readonly projects = new Map<string, ProjectStore>()
  readonly snapshots: SnapshotStore

  constructor(
    snapshotRoot: string,
    private readonly options: Omit<ProjectOptions, 'snapshots'> = {}
  ) {
    this.snapshots = new SnapshotStore(snapshotRoot, options.fs ? { fs: options.fs } : {})
  }

  private projectOptions(): ProjectOptions {
    return { ...this.options, snapshots: this.snapshots }
  }

  async createProject(parentDir: string, name: string): Promise<ProjectStore> {
    const project = await ProjectStore.create(resolve(parentDir), name, this.projectOptions())
    this.projects.set(project.dir, project)
    return project
  }

  async openProject(dir: string): Promise<OpenResult> {
    const key = resolve(dir)
    const open = this.projects.get(key)
    if (open) return { ok: true, project: open }
    const result = await ProjectStore.open(key, this.projectOptions())
    if (result.ok) this.projects.set(key, result.project)
    return result
  }

  async closeProject(dir: string): Promise<string[]> {
    const key = resolve(dir)
    const project = this.projects.get(key)
    if (!project) return []
    const unsaved = await project.close()
    if (unsaved.length === 0) this.projects.delete(key)
    return unsaved
  }

  /** Write everything pending in every open project. Returns what could not be saved. */
  async flushAll(): Promise<string[]> {
    const unsaved: string[] = []
    for (const [dir, project] of this.projects) {
      for (const key of await project.flushAll()) unsaved.push(`${dir}: ${key}`)
    }
    return unsaved
  }
}
