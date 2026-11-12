/**
 * The single contract between the main process and the renderer.
 *
 * The renderer never touches the file system. Every capability it has is one
 * entry in this map: a channel name, its arguments and its result. Main
 * registers a handler per entry, the preload exposes one function per entry,
 * and TypeScript checks both sides against this file.
 */
import type { FileState, ItemKind, ProjectManifest } from './project'

export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
  chrome: string
}

export interface RecentProject {
  id: string
  name: string
  dir: string
  openedAt: number
  /** Whether the project's manifest is on this machine, in the cloud, or gone. */
  state: 'local' | 'cloud' | 'missing'
}

/** Everything the UI needs to draw a project, without any item content. */
export interface ProjectSnapshot {
  dir: string
  manifest: ProjectManifest
  /** `<kind>/<id>` -> where that item's file is. */
  states: Record<string, FileState>
}

export type OpenProjectResult =
  | { ok: true; project: ProjectSnapshot }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'failed'; message: string }

export type Mutation =
  | { op: 'createItem'; kind: ItemKind; title: string; parentId?: string }
  | { op: 'createFolder'; title: string; parentId?: string }
  | { op: 'rename'; target: ItemKind | 'folder' | 'project'; id: string; title: string }
  | { op: 'move'; id: string; parentId: string | null; index: number }
  | { op: 'reorder'; kind: 'boards' | 'characters'; id: string; index: number }
  | { op: 'trash'; target: ItemKind | 'folder'; id: string }
  | { op: 'restore'; id: string }
  | { op: 'deleteFromTrash'; id?: string }

export interface MutationResult {
  project: ProjectSnapshot
  createdId?: string
}

export interface IpcContract {
  'app:getInfo': { args: []; result: AppInfo }
  'projects:recent': { args: []; result: RecentProject[] }
  /** Asks the user where to put it, then creates and opens the project. */
  'projects:create': { args: [name: string]; result: OpenProjectResult }
  /** Opens `dir`, or asks the user to pick a folder when omitted. */
  'projects:open': { args: [dir?: string]; result: OpenProjectResult }
  /** Removes an entry from the recent list. Touches no files. */
  'projects:forget': { args: [dir: string]; result: RecentProject[] }
  'project:current': { args: []; result: ProjectSnapshot | null }
  'project:mutate': { args: [mutation: Mutation]; result: MutationResult }
  /** Writes everything pending and closes the project. Returns what could not be saved. */
  'project:close': { args: []; result: string[] }
  'project:reveal': { args: []; result: void }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Runtime list of channels. Typed so it cannot drift from the contract. */
export const IPC_CHANNELS = [
  'app:getInfo',
  'projects:recent',
  'projects:create',
  'projects:open',
  'projects:forget',
  'project:current',
  'project:mutate',
  'project:close',
  'project:reveal'
] as const satisfies readonly IpcChannel[]

type Missing = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>
// Compile error here means a channel was added to IpcContract but not to IPC_CHANNELS.
const _exhaustive: Missing extends never ? true : never = true
void _exhaustive

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value)
}

/** The object the preload exposes as `window.scriptum`. */
export interface ScriptumApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  projects: {
    recent(): Promise<RecentProject[]>
    create(name: string): Promise<OpenProjectResult>
    open(dir?: string): Promise<OpenProjectResult>
    forget(dir: string): Promise<RecentProject[]>
  }
  project: {
    current(): Promise<ProjectSnapshot | null>
    mutate(mutation: Mutation): Promise<MutationResult>
    close(): Promise<string[]>
    reveal(): Promise<void>
  }
}
