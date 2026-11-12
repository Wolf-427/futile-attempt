import { create } from 'zustand'
import type { Mutation, OpenProjectResult, ProjectSnapshot, RecentProject } from '@shared/ipc'
import type { ItemKind } from '@shared/project'

export type View = ItemKind

export interface Selection {
  kind: ItemKind
  id: string
}

interface State {
  ready: boolean
  recent: RecentProject[]
  project: ProjectSnapshot | null
  view: View
  selected: Selection | null
  /** Id of the row currently being renamed inline. */
  renaming: string | null
  error: string | null

  init(): Promise<void>
  createProject(name: string): Promise<boolean>
  openProject(dir?: string): Promise<boolean>
  forgetProject(dir: string): Promise<void>
  closeProject(): Promise<void>
  mutate(mutation: Mutation): Promise<string | undefined>
  setView(view: View): void
  select(selection: Selection | null): void
  startRename(id: string | null): void
  showError(message: string | null): void
}

const message = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const useApp = create<State>((set, get) => {
  const adopt = (result: OpenProjectResult): boolean => {
    if (result.ok) {
      set({ project: result.project, selected: null, renaming: null, view: 'documents', error: null })
      return true
    }
    if (result.reason === 'failed') set({ error: result.message })
    return false
  }

  return {
    ready: false,
    recent: [],
    project: null,
    view: 'documents',
    selected: null,
    renaming: null,
    error: null,

    async init() {
      const [recent, project] = await Promise.all([
        window.scriptum.projects.recent(),
        window.scriptum.project.current()
      ])
      set({ recent, project, ready: true })
    },

    async createProject(name) {
      try {
        return adopt(await window.scriptum.projects.create(name))
      } catch (e) {
        set({ error: message(e) })
        return false
      }
    },

    async openProject(dir) {
      try {
        const opened = adopt(await window.scriptum.projects.open(dir))
        if (!opened) set({ recent: await window.scriptum.projects.recent() })
        return opened
      } catch (e) {
        set({ error: message(e) })
        return false
      }
    },

    async forgetProject(dir) {
      set({ recent: await window.scriptum.projects.forget(dir) })
    },

    async closeProject() {
      try {
        const unsaved = await window.scriptum.project.close()
        if (unsaved.length) {
          set({ error: `Some changes could not be saved, so the project stays open: ${unsaved.join(', ')}` })
          return
        }
        set({ project: null, selected: null, renaming: null, recent: await window.scriptum.projects.recent() })
      } catch (e) {
        set({ error: message(e) })
      }
    },

    async mutate(mutation) {
      try {
        const result = await window.scriptum.project.mutate(mutation)
        const selected = get().selected
        const gone =
          selected && !(`${selected.kind}/${selected.id}` in result.project.states) ? null : selected
        set({ project: result.project, selected: gone })
        return result.createdId
      } catch (e) {
        set({ error: message(e) })
        return undefined
      }
    },

    setView: (view) => set({ view, renaming: null }),
    select: (selected) => set({ selected }),
    startRename: (renaming) => set({ renaming }),
    showError: (error) => set({ error })
  }
})
