import { app, dialog, ipcMain, shell, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { BoardFile, CharacterFile, DocumentFile } from '@shared/content'
import type {
  IpcArgs,
  IpcChannel,
  IpcResult,
  Mutation,
  MutationResult,
  OpenProjectResult,
  ProjectSnapshot
} from '@shared/ipc'
import type { ItemKind } from '@shared/project'
import type { AppState } from './appState'
import type { ProjectStore, StorageService } from './storage'

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as IpcArgs<C>)))
}

const OPEN_FAILURES: Record<string, string> = {
  cloud: 'This project is still in the cloud. A download has been requested; try again in a moment.',
  downloading: 'This project is still downloading from the cloud. Try again in a moment.',
  unavailable: 'The project could not be read. Check that the disk or cloud service is reachable.',
  missing: 'There is no Scriptum project in this folder.',
  'needs-import': 'This is a project from Scriptum 1. It has to be imported first.',
  'newer-format': 'This project was saved by a newer version of Scriptum.',
  invalid: 'The project file (scriptum.json) is damaged.'
}

function emptyItem(kind: ItemKind): DocumentFile | BoardFile | CharacterFile {
  if (kind === 'documents') return { doc: { type: 'doc', content: [{ type: 'paragraph' }] } }
  if (kind === 'boards') return { isMaster: false, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
  return { image: null, refImages: [], created: Date.now() }
}

function cleanTitle(title: string, fallback: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 200) || fallback
}

export function registerIpc(storage: StorageService, state: AppState): void {
  // One window, one open project.
  let current: ProjectStore | null = null

  const snapshot = async (project: ProjectStore): Promise<ProjectSnapshot> => ({
    dir: project.dir,
    manifest: structuredClone(project.manifest) as ProjectSnapshot['manifest'],
    states: await project.itemStates()
  })

  const closeCurrent = async (): Promise<string[]> => {
    if (!current) return []
    const unsaved = await storage.closeProject(current.dir)
    if (unsaved.length === 0) current = null
    return unsaved
  }

  const adopt = async (project: ProjectStore): Promise<OpenProjectResult> => {
    current = project
    await state.touch({ id: project.manifest.id, name: project.manifest.name, dir: project.dir })
    return { ok: true, project: await snapshot(project) }
  }

  /** Folder picker. Tests set SCRIPTUM_E2E_PICK_DIR to answer it without a native dialog. */
  const pickFolder = async (
    event: IpcMainInvokeEvent,
    title: string,
    canCreate: boolean
  ): Promise<string | null> => {
    const scripted = process.env['SCRIPTUM_E2E_PICK_DIR']
    if (scripted) return scripted
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title,
      buttonLabel: 'Choose',
      properties: canCreate ? ['openDirectory', 'createDirectory'] : ['openDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  const requireCurrent = (): ProjectStore => {
    if (!current) throw new Error('No project is open')
    return current
  }

  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? ''
  }))

  handle('projects:recent', () => state.recent())

  handle('projects:forget', async (_event, dir) => {
    await state.forget(dir)
    return state.recent()
  })

  handle('projects:create', async (event, name) => {
    const title = cleanTitle(name, '')
    if (!title) return { ok: false, reason: 'failed', message: 'Give the project a name.' }
    const parent = await pickFolder(event, `Where should “${title}” be saved?`, true)
    if (!parent) return { ok: false, reason: 'cancelled' }
    const unsaved = await closeCurrent()
    if (unsaved.length) {
      return { ok: false, reason: 'failed', message: 'The open project has changes that could not be saved.' }
    }
    try {
      const project = await storage.createProject(parent, title)
      await project.createItem('documents', 'Untitled', emptyItem('documents'))
      await project.createItem('boards', 'Master board', { ...emptyItem('boards'), isMaster: true })
      return await adopt(project)
    } catch (e) {
      return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) }
    }
  })

  handle('projects:open', async (event, dir) => {
    const target = dir ?? (await pickFolder(event, 'Open a Scriptum project folder', false))
    if (!target) return { ok: false, reason: 'cancelled' }
    if (current && current.dir !== target) {
      const unsaved = await closeCurrent()
      if (unsaved.length) {
        return { ok: false, reason: 'failed', message: 'The open project has changes that could not be saved.' }
      }
    }
    const result = await storage.openProject(target)
    if (!result.ok) {
      const base = OPEN_FAILURES[result.reason] ?? 'The project could not be opened.'
      return { ok: false, reason: 'failed', message: result.error ? `${base} (${result.error})` : base }
    }
    return adopt(result.project)
  })

  handle('project:current', async () => (current ? snapshot(current) : null))

  handle('project:close', () => closeCurrent())

  handle('project:reveal', async () => {
    await shell.openPath(requireCurrent().dir)
  })

  handle('project:mutate', async (_event, m: Mutation): Promise<MutationResult> => {
    const project = requireCurrent()
    let createdId: string | undefined

    switch (m.op) {
      case 'createItem':
        createdId = await project.createItem(m.kind, cleanTitle(m.title, 'Untitled'), emptyItem(m.kind), m.parentId)
        break
      case 'createFolder':
        createdId = await project.createFolder(cleanTitle(m.title, 'New folder'), m.parentId)
        break
      case 'rename': {
        const title = cleanTitle(m.title, '')
        if (!title) throw new Error('A name cannot be empty')
        if (m.target === 'project') {
          await project.renameProject(title)
          await state.touch({ id: project.manifest.id, name: title, dir: project.dir })
        } else if (m.target === 'folder') await project.renameFolder(m.id, title)
        else await project.renameItem(m.target, m.id, title)
        break
      }
      case 'move':
        await project.moveNode(m.id, m.parentId, m.index)
        break
      case 'reorder':
        await project.reorderIndexEntry(m.kind, m.id, m.index)
        break
      case 'trash':
        if (m.target === 'folder') await project.trashFolder(m.id)
        else await project.trashItem(m.target, m.id)
        break
      case 'restore':
        await project.restoreItem(m.id)
        break
      case 'deleteFromTrash':
        await project.deleteFromTrash(m.id)
        break
    }

    const result: MutationResult = { project: await snapshot(project) }
    if (createdId) result.createdId = createdId
    return result
  })
}
