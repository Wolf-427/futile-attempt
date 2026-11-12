import { create } from 'zustand'
import type { Mutation, OpenProjectResult, ProjectSnapshot, RecentProject } from '@shared/ipc'
import type { ItemKind, TreeNode } from '@shared/project'

export type View = ItemKind

export interface Selection {
  kind: ItemKind
  id: string
}

function firstDocument(tree: TreeNode[]): string | null {
  for (const node of tree) {
    if (node.type === 'document') return node.id
    const inside = firstDocument(node.children)
    if (inside) return inside
  }
  return null
}

/** What the main pane shows for a view: the item last open there, else the first one. */
function selectionFor(view: View, project: ProjectSnapshot | null, last: Partial<Record<View, string>>): Selection | null {
  if (!project) return null
  const remembered = last[view]
  if (remembered && `${view}/${remembered}` in project.states) return { kind: view, id: remembered }
  const first = view === 'documents' ? firstDocument(project.manifest.tree) : (project.manifest[view][0]?.id ?? null)
  return first ? { kind: view, id: first } : null
}

interface State {
  ready: boolean
  recent: RecentProject[]
  project: ProjectSnapshot | null
  view: View
  selected: Selection | null
  /** The item last open in each view, so switching views returns to it. */
  lastByView: Partial<Record<View, string>>
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
      set({
        project: result.project,
        selected: selectionFor('documents', result.project, {}),
        lastByView: {},
        renaming: null,
        view: 'documents',
        error: null
      })
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
    lastByView: {},
    renaming: null,
    error: null,

    async init() {
      const [recent, project] = await Promise.all([
        window.scriptum.projects.recent(),
        window.scriptum.project.current()
      ])
      set({ recent, project, ready: true, selected: selectionFor('documents', project, {}) })
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
        const { selected, view, lastByView } = get()
        const stillThere = selected && `${selected.kind}/${selected.id}` in result.project.states
        set({
          project: result.project,
          selected: stillThere ? selected : selectionFor(view, result.project, lastByView)
        })
        return result.createdId
      } catch (e) {
        set({ error: message(e) })
        return undefined
      }
    },

    setView: (view) =>
      set((s) => ({ view, renaming: null, selected: selectionFor(view, s.project, s.lastByView) })),
    select: (selected) =>
      set((s) => ({
        selected,
        lastByView: selected ? { ...s.lastByView, [selected.kind]: selected.id } : s.lastByView
      })),
    startRename: (renaming) => set({ renaming }),
    showError: (error) => set({ error })
  }
})
